import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { redactSecrets } from "./redact";

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
 * Stockage : un réglage du cœur (pas de colonne, donc pas de migration), lu directement en base. Les 50 dernières demandes sont gardées.
 */
export const REQUEST_TTL_MS = 24 * 60 * 60_000;
const KEEP = 50;
const KEY = "maintenance.requests";

export const LEVEL3_ACTIONS = ["module_update", "modules_update_all", "core_update", "module_uninstall", "module_install"] as const;
export type Level3Action = (typeof LEVEL3_ACTIONS)[number];

export type Plan = {
  /** Cœur : version actuelle → visée. */
  from?: string; to?: string; level?: string;
  /** Un module (mise à jour, désinstallation). */
  module?: string;
  /** Désinstallation : true = les réglages et données sont gardés (rangés, retrouvés à la réinstallation), false = tout est effacé. */
  keepData?: boolean;
  /** Plusieurs modules (tout mettre à jour) : identifiant, version actuelle, version visée. */
  modules?: { id: string; from: string; to: string }[];
  /** Installation : les modules qui viendront AVEC celui-ci (fournisseurs que le module exige), montrés à la propriétaire ; jamais installés en cachette. `to` = la version installée. */
  adds?: { id: string; action: "install" | "setup" | "update"; name?: string }[];
  /** Installation : le nom lisible du module (il n'est pas encore installé : l'admin ne peut pas le retrouver autrement). */
  name?: string;
  /** Installation : clé choisie pour la première instance (sinon dérivée de l'identifiant du module). */
  instanceKey?: string;
  /** Installation : les permissions que demande le module (pour que la propriétaire sache ce qu'elle accorde). */
  permissions?: string[];
};
export type RequestStatus = "pending" | "running" | "done" | "failed" | "denied" | "expired";
export type MaintenanceRequest = {
  id: string; action: Level3Action; plan: Plan;
  tokenId: string; tokenName: string;
  createdAt: number; expiresAt: number;
  status: RequestStatus;
  decidedAt?: number;
  /** « human » : approuvée ou refusée par un propriétaire connecté (son adresse n'est pas gardée ici : elle est dans le journal d'audit). */
  decidedBy?: "owner";
  result?: { ok: boolean; message: string };
};

let chain: Promise<unknown> = Promise.resolve();
/** Une seule lecture-modification-écriture à la fois dans ce processus. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function load(): Promise<MaintenanceRequest[]> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: KEY, locale: "" } } });
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? (v as MaintenanceRequest[]).filter((r) => r && typeof r.id === "string" && (LEVEL3_ACTIONS as readonly string[]).includes(r.action)) : [];
  } catch { return []; }
}
async function save(list: MaintenanceRequest[]): Promise<void> {
  const json = JSON.stringify(list.slice(-KEEP));
  await prisma.setting.upsert({ where: { key_locale: { key: KEY, locale: "" } }, create: { key: KEY, locale: "", value: json }, update: { value: json } });
}

/** Les demandes en attente dont le délai est passé deviennent « expirées » (et ne s'exécuteront plus jamais). */
function sweep(list: MaintenanceRequest[], now: number): boolean {
  let changed = false;
  for (const r of list) if (r.status === "pending" && r.expiresAt <= now) { r.status = "expired"; changed = true; }
  return changed;
}

export async function listRequests(now = Date.now()): Promise<MaintenanceRequest[]> {
  return exclusive(async () => {
    const list = await load();
    if (sweep(list, now)) await save(list);
    return list.slice().reverse();
  });
}

export async function getRequest(id: string, now = Date.now()): Promise<MaintenanceRequest | null> {
  return (await listRequests(now)).find((r) => r.id === id) ?? null;
}

export async function pendingCount(now = Date.now()): Promise<number> {
  return (await listRequests(now)).filter((r) => r.status === "pending").length;
}

const same = (a: Plan, b: Plan) => JSON.stringify(a) === JSON.stringify(b);
export const MAX_PENDING_PER_TOKEN = 5;

/** Crée une demande, ou renvoie celle qui attend déjà pour la même chose (un appel répété ne remplit pas la file). */
export async function createRequest(input: { action: Level3Action; plan: Plan; tokenId: string; tokenName: string }, now = Date.now()): Promise<{ ok: true; request: MaintenanceRequest; existing: boolean } | { ok: false; error: string }> {
  return exclusive(async () => {
    const list = await load();
    sweep(list, now);
    const twin = list.find((r) => r.status === "pending" && r.tokenId === input.tokenId && r.action === input.action && same(r.plan, input.plan));
    if (twin) return { ok: true as const, request: twin, existing: true };
    if (list.filter((r) => r.status === "pending" && r.tokenId === input.tokenId).length >= MAX_PENDING_PER_TOKEN) return { ok: false as const, error: `Too many requests are already waiting for approval (${MAX_PENDING_PER_TOKEN}). Ask the owner to answer them first.` };
    const request: MaintenanceRequest = {
      id: `req_${crypto.randomBytes(9).toString("base64url")}`, action: input.action, plan: input.plan,
      tokenId: input.tokenId, tokenName: redactSecrets(input.tokenName, 80), createdAt: now, expiresAt: now + REQUEST_TTL_MS, status: "pending",
    };
    list.push(request);
    await save(list);
    return { ok: true as const, request, existing: false };
  });
}

export type ClaimResult = { ok: true; request: MaintenanceRequest } | { ok: false; reason: "unknown" | "not-pending" | "expired" };

/** Approbation : fait passer la demande de « en attente » à « en cours », une seule fois. Rien n'est exécuté ici. */
export async function claimRequest(id: string, now = Date.now()): Promise<ClaimResult> {
  return exclusive(async () => {
    const list = await load();
    const changed = sweep(list, now);
    const r = list.find((x) => x.id === id);
    if (changed) await save(list);
    if (!r) return { ok: false as const, reason: "unknown" as const };
    if (r.status === "expired") return { ok: false as const, reason: "expired" as const };
    if (r.status !== "pending") return { ok: false as const, reason: "not-pending" as const };
    r.status = "running"; r.decidedAt = now; r.decidedBy = "owner";
    await save(list);
    return { ok: true as const, request: { ...r } };
  });
}

export async function denyRequest(id: string, now = Date.now()): Promise<ClaimResult> {
  return exclusive(async () => {
    const list = await load();
    sweep(list, now);
    const r = list.find((x) => x.id === id);
    if (!r) return { ok: false as const, reason: "unknown" as const };
    if (r.status === "expired") { await save(list); return { ok: false as const, reason: "expired" as const }; }
    if (r.status !== "pending") return { ok: false as const, reason: "not-pending" as const };
    r.status = "denied"; r.decidedAt = now; r.decidedBy = "owner";
    await save(list);
    return { ok: true as const, request: { ...r } };
  });
}

/** L'exécution n'a pas pu commencer (une autre opération tourne) : la demande redevient « en attente », l'approbation n'est pas consommée. */
export async function reopenRequest(id: string): Promise<void> {
  await exclusive(async () => {
    const list = await load();
    const r = list.find((x) => x.id === id);
    if (!r || r.status !== "running") return;
    r.status = "pending"; delete r.decidedAt; delete r.decidedBy;
    await save(list);
  });
}

/** Garde le résultat de l'exécution (texte court, masqué). */
export async function finishRequest(id: string, result: { ok: boolean; message: string }, now = Date.now()): Promise<void> {
  await exclusive(async () => {
    const list = await load();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    r.status = result.ok ? "done" : "failed";
    r.result = { ok: result.ok, message: redactSecrets(result.message, 400) };
    r.decidedAt ??= now;
    await save(list);
  });
}
