import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { LEVEL3_ACTIONS, type Level3Action } from "@/core/services/mcp/coreTools";
import { redactSecrets } from "./redact";
import { boundResult, closeInterrupted, INTERRUPTED_MESSAGE, type RunProgress, type RunResult } from "./background";

/**
 * FILE DES DEMANDES d'actions à risque (niveau 3). Avec la « validation humaine » (le défaut), l'appel d'une IA ne fait QUE créer une demande ici ;
 * seul un propriétaire connecté peut l'approuver (ce qui l'exécute) ou la refuser.
 *
 * Invariants :
 *  - une demande ne s'approuve qu'UNE fois : le passage « en attente → en cours » est atomique (verrou du processus) ;
 *  - une demande refusée ou expirée (24 h) ne s'exécute jamais ;
 *  - le « plan » (version de départ et d'arrivée…) est figé à la création : à l'exécution, les conditions sont revérifiées et la demande n'est exécutée
 *    que si elle vise toujours la même chose ;
 *  - seuls des identifiants, des versions et des textes courts masqués sont conservés : jamais de secret.
 * Stockage : un réglage du cœur (pas de colonne, donc pas de migration), lu directement en base. Les 50 dernières demandes TERMINÉES sont gardées (jamais une demande en attente ou en cours).
 */
export const REQUEST_TTL_MS = 24 * 60 * 60_000;
const KEEP = 50;
const KEY = "maintenance.requests";

/** The names of the level 3 actions come from the list of core tools (services/mcp/coreTools.ts); what each one does is defined in level3Registry.ts. */
export { LEVEL3_ACTIONS };
export type { Level3Action };

export type Plan = {
  /** Cœur : version actuelle → visée. */
  from?: string; to?: string; level?: string;
  /** Un module (mise à jour, désinstallation). */
  module?: string;
  /** Désinstallation : true = les réglages et données sont gardés (rangés, retrouvés à la réinstallation), false = tout est effacé. */
  keepData?: boolean;
  /** Plusieurs modules (tout mettre à jour) : identifiant, version actuelle, version visée. */
  modules?: { id: string; from: string; to: string }[];
  /** Installation : les modules qui viendront AVEC celui-ci (fournisseurs que le module exige), montrés à la personne propriétaire ; jamais installés en cachette. `to` = la version installée. */
  adds?: { id: string; action: "install" | "setup" | "update"; name?: string }[];
  /** Installation : le nom lisible du module (il n'est pas encore installé : l'admin ne peut pas le retrouver autrement). */
  name?: string;
  /** Installation : clé choisie pour la première instance (sinon dérivée de l'identifiant du module). */
  instanceKey?: string;
  /** Installation : les permissions que demande le module (pour que la personne propriétaire sache ce qu'elle accorde). */
  permissions?: string[];
  /** Skins (installer, utiliser, retirer) : l'identifiant du skin ; `name` est son nom lisible, `to` la version à installer, `from` le skin en place (utiliser) ou la version installée (retirer). */
  skin?: string;
  /** Polices (`font_set`) : ce qui change (`titles`, `text` : valeur choisie, "" = celle du skin ; absent = inchangé) et son résumé lisible pour la personne propriétaire. */
  fonts?: { titles?: string; text?: string; names: string };
  /** Installation of several modules at once (one request, one approval): one plan per module, in the order they will be installed. */
  bundle?: Plan[];
  /** `skin_set_options`: the colours to set (field -> hex, "" = back to the skin's own) for one mode, with a readable summary for the owner. */
  options?: { mode?: "light" | "dark"; colors: Record<string, string>; names: string };
  /** `skin_customize`: the values to set (checked), the look, the settings to reset, and a readable summary for the owner. */
  customize?: { values: Record<string, unknown>; look?: string; reset: string[]; names: string };
  /** `instance_add`: the module is `module`; the nickname that tells the new instance apart from the existing ones. */
  newInstance?: { nickname: string };
  /**
   * `entry_publish` / `entry_unpublish`: the instance key and the entries as they were when the request was made (title and languages for the owner to read,
   * a fingerprint of the text so that a draft edited after the request is NOT published without a new look).
   */
  site?: { changes: { field: string; locale?: string; from: string; fromFp: string; to: string }[]; names: string };
  entry?: { instance: string; locale?: string; items: { id: string; title: string; locales: string[]; fp: string; /** (0.45.0) the page skin the entry will show with, named in the approval text. */ skin?: string }[] };
  /**
   * `navigation_set` / `home_sections_set`: the whole new menu (`entries`: menu nodes) or home page (`entries`: sections), frozen when the request is made, with a
   * fingerprint of the state it was made from (`before`: a change made by someone else in between is NOT overwritten) and a summary in labels only for the owner.
   */
  change?: { target: "navigation" | "home"; before: string; entries: unknown[]; summary: { beforeCount: number; afterCount: number; added: string[]; removed: string[]; changed?: string[]; reordered: boolean; same: boolean } };
};
export type RequestStatus = "pending" | "running" | "done" | "failed" | "denied" | "expired";
export type MaintenanceRequest = {
  id: string; action: Level3Action; plan: Plan;
  tokenId: string; tokenName: string;
  /** (0.46.0) The user who owns the access that asked (a personal AI), read from the access row when the request is made. Absent for an independent access. */
  ownerId?: string;
  createdAt: number; expiresAt: number;
  status: RequestStatus;
  decidedAt?: number;
  /** « human » : approuvée ou refusée par un propriétaire connecté (son adresse n'est pas gardée ici : elle est dans le journal d'audit). */
  decidedBy?: "owner";
  result?: RunResult;
  /** A long action (updating all modules…) that is running: how far it is, module by module. */
  progress?: RunProgress;
};

/**
 * One read-modify-write at a time, in this process AND across copies of this module: the chain lives on `globalThis` like the maintenance lock (0.46.1; it used to be in
 * module scope, so two copies of the module, one per bundle, did not exclude each other). Across processes the write itself is a compare-and-swap, see `transact`.
 */
const g = globalThis as unknown as { curiosaRequestsChain?: Promise<unknown> };
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.curiosaRequestsChain ?? Promise.resolve()).then(fn, fn);
  g.curiosaRequestsChain = run.catch(() => {});
  return run;
}

async function loadRaw(): Promise<{ list: MaintenanceRequest[]; raw: string | null }> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: KEY, locale: "" } } });
  if (!row) return { list: [], raw: null };
  try {
    const v = JSON.parse(row.value);
    return { raw: row.value, list: Array.isArray(v) ? (v as MaintenanceRequest[]).filter((r) => r && typeof r.id === "string" && (LEVEL3_ACTIONS as readonly string[]).includes(r.action)) : [] };
  } catch { return { raw: row.value, list: [] }; }
}

/** The list as it will be stored: see the retention rules in the comment. */
function trimmed(list: MaintenanceRequest[]): string {
  // (0.46.0) The last 50 requests of independent accesses and, separately, the last 50 of personal ones: many people cannot push each other's pending requests out.
  // (0.46.1) Only FINISHED requests are cut: one that still waits for a decision (or is being run) is never dropped, however many newer ones there are. It is bounded anyway:
  // at most MAX_PENDING_PER_TOKEN wait per access, and each one expires after REQUEST_TTL_MS, which makes it a finished one.
  const own = (r: MaintenanceRequest) => !!r.ownerId;
  const open = (r: MaintenanceRequest) => r.status === "pending" || r.status === "running";
  const finished = (pick: (r: MaintenanceRequest) => boolean) => list.filter((r) => pick(r) && !open(r)).slice(-KEEP);
  const keep = new Set([...list.filter(open), ...finished((r) => !own(r)), ...finished(own)]);
  return JSON.stringify(list.filter((r) => keep.has(r)));
}

/** Compare-and-swap: writes only if the stored value is still `raw` (what this change was computed from). False: somebody else (another process) wrote first. */
async function save(list: MaintenanceRequest[], raw: string | null): Promise<boolean> {
  const value = trimmed(list);
  if (raw === null) {
    try { await prisma.setting.create({ data: { key: KEY, locale: "", value } }); return true; } catch { return false; }
  }
  return (await prisma.setting.updateMany({ where: { key: KEY, locale: "", value: raw }, data: { value } })).count === 1;
}

/**
 * A change of the queue: `change` receives the list, edits it and says whether to store it; it must be a pure function of the list (it is run again on a conflict).
 * Serialised in this process by `exclusive`, and retried from a fresh read when another process changed the stored value in between (compare-and-swap).
 */
function transact<T>(change: (list: MaintenanceRequest[]) => { out: T; dirty: boolean }): Promise<T> {
  return exclusive(async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { list, raw } = await loadRaw();
      const r = change(list);
      if (!r.dirty || (await save(list, raw))) return r.out;
    }
    throw new Error("the request queue is busy, try again");
  });
}

/** Les demandes en attente dont le délai est passé deviennent « expirées » (et ne s'exécuteront plus jamais). */
function sweep(list: MaintenanceRequest[], now: number): boolean {
  let changed = false;
  for (const r of list) if (r.status === "pending" && r.expiresAt <= now) { r.status = "expired"; changed = true; }
  return changed;
}

export async function listRequests(now = Date.now()): Promise<MaintenanceRequest[]> {
  return transact((list) => {
    // Two sweeps, both saved at once: pending requests whose time is over, and approved requests whose work died with a restart.
    const expired = sweep(list, now);
    const closed = closeInterrupted(list, now);
    return { out: list.slice().reverse(), dirty: closed || expired };
  });
}

export async function getRequest(id: string, now = Date.now()): Promise<MaintenanceRequest | null> {
  return (await listRequests(now)).find((r) => r.id === id) ?? null;
}

export async function pendingCount(now = Date.now()): Promise<number> {
  return (await listRequests(now)).filter((r) => r.status === "pending").length;
}

const same = (a: Plan, b: Plan) => JSON.stringify(a) === JSON.stringify(b);
/** Pending requests per access. A bundle (several modules in one request) counts as ONE. */
export const MAX_PENDING_PER_TOKEN = 5;

type CreateResult = { ok: true; request: MaintenanceRequest; existing: boolean } | { ok: false; error: string };

/** Crée une demande, ou renvoie celle qui attend déjà pour la même chose (un appel répété ne remplit pas la file). */
export async function createRequest(input: { action: Level3Action; plan: Plan; tokenId: string; tokenName: string; ownerId?: string }, now = Date.now()): Promise<CreateResult> {
  return transact<CreateResult>((list) => {
    const swept = sweep(list, now);
    const twin = list.find((r) => r.status === "pending" && r.tokenId === input.tokenId && r.action === input.action && same(r.plan, input.plan));
    if (twin) return { out: { ok: true as const, request: twin, existing: true as boolean }, dirty: swept };
    if (list.filter((r) => r.status === "pending" && r.tokenId === input.tokenId).length >= MAX_PENDING_PER_TOKEN) return { out: { ok: false as const, error: `Too many requests are already waiting for approval (${MAX_PENDING_PER_TOKEN}). Ask the owner to answer them first.` }, dirty: swept };
    const request: MaintenanceRequest = {
      id: `req_${crypto.randomBytes(9).toString("base64url")}`, action: input.action, plan: input.plan,
      tokenId: input.tokenId, tokenName: redactSecrets(input.tokenName, 80), ...(input.ownerId ? { ownerId: input.ownerId } : {}), createdAt: now, expiresAt: now + REQUEST_TTL_MS, status: "pending",
    };
    list.push(request);
    return { out: { ok: true as const, request, existing: false }, dirty: true };
  });
}

export type ClaimResult = { ok: true; request: MaintenanceRequest } | { ok: false; reason: "unknown" | "not-pending" | "expired" };

/** Approbation : fait passer la demande de « en attente » à « en cours », une seule fois. Rien n'est exécuté ici. */
export async function claimRequest(id: string, now = Date.now()): Promise<ClaimResult> {
  return transact<ClaimResult>((list) => {
    const changed = sweep(list, now);
    const r = list.find((x) => x.id === id);
    if (!r) return { out: { ok: false, reason: "unknown" }, dirty: changed };
    if (r.status === "expired") return { out: { ok: false, reason: "expired" }, dirty: changed };
    if (r.status !== "pending") return { out: { ok: false, reason: "not-pending" }, dirty: changed };
    r.status = "running"; r.decidedAt = now; r.decidedBy = "owner";
    return { out: { ok: true, request: { ...r } }, dirty: true };
  });
}

export async function denyRequest(id: string, now = Date.now()): Promise<ClaimResult> {
  return transact<ClaimResult>((list) => {
    const changed = sweep(list, now);
    const r = list.find((x) => x.id === id);
    if (!r) return { out: { ok: false, reason: "unknown" }, dirty: changed };
    if (r.status === "expired") return { out: { ok: false, reason: "expired" }, dirty: changed };
    if (r.status !== "pending") return { out: { ok: false, reason: "not-pending" }, dirty: changed };
    r.status = "denied"; r.decidedAt = now; r.decidedBy = "owner";
    return { out: { ok: true, request: { ...r } }, dirty: true };
  });
}

/** L'exécution n'a pas pu commencer (une autre opération tourne) : la demande redevient « en attente », l'approbation n'est pas consommée. */
export async function reopenRequest(id: string): Promise<void> {
  await transact((list) => {
    const r = list.find((x) => x.id === id);
    if (!r || r.status !== "running") return { out: undefined, dirty: false };
    r.status = "pending"; delete r.decidedAt; delete r.decidedBy;
    return { out: undefined, dirty: true };
  });
}

/**
 * Garde le résultat de l'exécution (texte court, masqué). (0.46.1) Only a request that is running (or that a sweep just closed as interrupted while its work was
 * still alive) receives a result: a refused, expired or still pending request is never turned into "done" by a late call.
 */
export async function finishRequest(id: string, result: RunResult, now = Date.now()): Promise<void> {
  await transact((list) => {
    const r = list.find((x) => x.id === id);
    if (!r || !(r.status === "running" || (r.status === "failed" && r.result?.message === INTERRUPTED_MESSAGE))) return { out: undefined, dirty: false };
    r.status = result.ok ? "done" : "failed";
    r.result = boundResult(result);
    r.decidedAt ??= now;
    return { out: undefined, dirty: true };
  });
}

/** The progress of the long action an approved request is running (module by module). */
export async function setRequestProgress(id: string, progress: RunProgress): Promise<void> {
  await transact((list) => {
    const r = list.find((x) => x.id === id);
    if (!r || r.status !== "running") return { out: undefined, dirty: false };
    r.progress = progress;
    return { out: undefined, dirty: true };
  });
}

/** Pending requests of ONE access as `expired` at once (the access was removed): they never run. Other accesses of the same person are untouched. Returns how many. */
export async function expirePendingOfToken(tokenId: string): Promise<number> {
  return transact((list) => {
    let n = 0;
    for (const r of list) if (r.status === "pending" && r.tokenId === tokenId) { r.status = "expired"; n++; }
    return { out: n, dirty: n > 0 };
  });
}

/** (0.46.0) Pending requests of the personal AI of one user, as `expired` at once (the right was withdrawn, or the person was demoted): they never run. Returns how many. */
export async function expirePendingOf(ownerId: string): Promise<number> {
  return transact((list) => {
    let n = 0;
    for (const r of list) if (r.status === "pending" && r.ownerId === ownerId) { r.status = "expired"; n++; }
    return { out: n, dirty: n > 0 };
  });
}
