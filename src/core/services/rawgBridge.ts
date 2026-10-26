import { callProvider, providerInstance } from "@/core/modules/dependencies";
import { buildContext } from "@/core/modules/context";
import { audit } from "@/core/permissions";
import { getSetting, setSetting } from "@/core/settings";
import { getRawgKey, type RawgCandidate, type RawgCandidates, type RawgCover, type RawgStatus } from "./rawg";
import { readFixes, readToCheck, type Doubtful, type Fix } from "./rawgFixes";

/**
 * CALE DE COMPATIBILITÉ « RAWG » — À RETIRER EN 0.3.0 (avec tout ce qui touche à `rawg*` dans le cœur : services/rawg*.ts, rawgAdmin.ts, rawgMcp.ts, l'écran
 * `settings/rawg-covers`, la carte « Clé RAWG » des réglages, la permission `rawg`).
 *
 * Les jaquettes de jeux ne sont plus un service du cœur : c'est le module officiel « game-covers » (service `game.cover`). Ce fichier fait la transition sans rien demander à personne :
 *   1. DÉLÉGUER. Tant que le module est là, `ctx.api.rawg.cover/candidates/configured` (les anciens modules : permission `rawg`), l'écran `/admin/settings/rawg-covers` (adresse
 *      publiée dans les liens « Ce n'est pas le bon jeu ? ») et les deux outils de l'assistant passent par lui. Sans le module : l'ancien service du cœur répond comme avant,
 *      avec sa clé et ses corrections, donc la mise à jour du cœur seule ne change rien pour personne.
 *   2. REPRENDRE. Un site qui utilisait RAWG (une clé ou des corrections dans les réglages du cœur) voit le module installé tout seul (catalogue officiel, avec son instance), puis
 *      la clé, les corrections et le journal « à vérifier » lui sont confiés UNE fois (`adopt`). C'est une COPIE : rien n'est effacé du cœur dans cette version, on peut donc revenir
 *      en arrière (désinstaller le module : l'ancien service reprend, avec la clé et les corrections d'avant la copie). La clé ne traverse que la mémoire, vers le seul module officiel
 *      `game-covers` : elle n'est ni affichée, ni journalisée. Le repère `rawg.handover` dit où on en est (jamais une valeur).
 *   3. QUAND ? Au démarrage, après une installation ou une mise à jour de module, et à la première demande d'un ancien module. Les tentatives réseau (catalogue, installation) sont
 *      espacées de 10 minutes ; aucun minuteur de fond. Une seule installation automatique par site : si le propriétaire désinstalle ensuite le module, il n'est pas remis.
 */
export const COVERS_SERVICE = "game.cover";
export const COVERS_MODULE = "game-covers";
export const HANDOVER_SETTING = "rawg.handover";
const RETRY_MS = 10 * 60_000;
const DECISION_MS = 5_000;
const ADOPT_WAIT_MS = 4_000;
let lastInstallTry = 0;

export type Handover = { installedAt?: string; doneAt?: string; key?: boolean; fixes?: number; todo?: number };
export async function handoverState(): Promise<Handover> {
  const raw = await getSetting<Handover>(HANDOVER_SETTING);
  return raw && typeof raw === "object" ? raw : {};
}

/** Ce que le cœur garde encore de l'ancien service : de quoi décider s'il y a quelque chose à reprendre. Aucune valeur n'en sort hors de ce fichier. */
async function legacyData(): Promise<{ key: string; fixes: Record<string, Fix>; todo: Doubtful[]; empty: boolean }> {
  const key = await getRawgKey();
  const fixes = await readFixes();
  const todo = await readToCheck();
  return { key, fixes, todo, empty: !key && Object.keys(fixes).length === 0 };
}

// ── Déléguer au module ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Delegate = { adminPath: string };
let decided: { at: number; value: Delegate | null } | null = null;
export function forgetBridgeDecision(): void { decided = null; }
/** Pour les tests : oublie aussi l'espacement des tentatives d'installation. */
export function resetBridge(): void { decided = null; lastInstallTry = 0; }

/**
 * La cale doit-elle relayer vers le module ? Oui s'il y a un fournisseur de `game.cover` ET que la reprise est faite (ou qu'il n'y a rien à reprendre). Si le module est là mais la
 * reprise pas encore faite, on la tente tout de suite (4 s au plus) ; sinon l'ancien service répond. Décision gardée 5 s (un module installé ou retiré compte donc très vite).
 */
export async function delegate(): Promise<Delegate | null> {
  if (decided && Date.now() - decided.at < DECISION_MS) return decided.value;
  let value: Delegate | null = null;
  try {
    const provider = await providerInstance(COVERS_SERVICE);
    if (provider) {
      const path = `/admin/instances/${provider.instance.id}`;
      const st = await handoverState();
      if (st.doneAt || (await legacyData()).empty) value = { adminPath: path };
      else if (provider.mod.manifest.id === COVERS_MODULE) {
        const done = await Promise.race([ensureRawgHandover({ install: false }), new Promise<string>((r) => { const t = setTimeout(() => r("late"), ADOPT_WAIT_MS); t.unref?.(); })]);
        if (done === "done") value = { adminPath: path };
      }
    } else void ensureRawgHandover({ install: true }).catch(() => {});   // un ancien module demande une jaquette : le moment de préparer la reprise (espacé)
  } catch (error) {
    console.error("[rawg] bridge failed:", (error as Error)?.name);
  }
  decided = { at: Date.now(), value };
  return value;
}

const STATUSES: RawgStatus[] = ["found", "none", "no-key", "refused", "unreachable"];
const httpsUrl = (v: unknown): string | null => { if (typeof v !== "string" || v.length > 2000) return null; try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; } };
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/** La réponse d'un fournisseur, relue avec méfiance : le cœur ne rend à un ancien module que la forme qu'il connaît. */
function coverOf(v: unknown): RawgCover {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const status = STATUSES.includes(o.status as RawgStatus) ? (o.status as RawgStatus) : "unreachable";
  if (status !== "found") return { status, url: null };
  const url = httpsUrl(o.url);
  if (!url) return { status: "none", url: null };
  const name = text(o.name, 150);
  return { status, url, ...(name ? { name } : {}), ...(typeof o.id === "number" && Number.isSafeInteger(o.id) && o.id > 0 ? { id: o.id } : {}), ...(typeof o.ambiguous === "boolean" ? { ambiguous: o.ambiguous } : {}) };
}
function candidatesOf(v: unknown): RawgCandidates {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const status = STATUSES.includes(o.status as RawgStatus) ? (o.status as RawgStatus) : "unreachable";
  const list: RawgCandidate[] = [];
  for (const c of Array.isArray(o.candidates) ? o.candidates.slice(0, 6) : []) {
    const r = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const url = httpsUrl(r.url);
    if (!url || typeof r.id !== "number" || !Number.isSafeInteger(r.id) || r.id <= 0 || !text(r.name, 150)) continue;
    list.push({ id: r.id, name: text(r.name, 150), year: typeof r.year === "number" && Number.isInteger(r.year) ? r.year : null, platforms: (Array.isArray(r.platforms) ? r.platforms : []).slice(0, 3).map((p) => text(p, 40)).filter(Boolean), url });
  }
  return { status: status === "found" && !list.length ? "none" : status, candidates: status === "found" ? list : [] };
}

/** `null` : pas de module, l'ancien service répond. Sinon la réponse du module (jamais d'exception ; module en panne : `unreachable`). */
export async function bridgedCover(title: string): Promise<RawgCover | null> {
  if (!(await delegate())) return null;
  const r = await callProvider(COVERS_SERVICE, "cover", { title });
  return r.ok ? coverOf(r.value) : r.reason === "unavailable" ? null : { status: "unreachable", url: null };
}
export async function bridgedCandidates(title: string): Promise<RawgCandidates | null> {
  if (!(await delegate())) return null;
  const r = await callProvider(COVERS_SERVICE, "candidates", { title });
  return r.ok ? candidatesOf(r.value) : r.reason === "unavailable" ? null : { status: "unreachable", candidates: [] };
}
export async function bridgedConfigured(): Promise<boolean | null> {
  if (!(await delegate())) return null;
  const r = await callProvider(COVERS_SERVICE, "status", {});
  if (!r.ok) return r.reason === "unavailable" ? null : false;
  return (r.value as { configured?: unknown } | null)?.configured === true;
}

/** Les deux outils de l'assistant gardent leur nom : tant que la cale existe, ils relaient vers l'outil du module. Vrai si le module les offre. */
export async function bridgedTool(name: string, args: Record<string, unknown>, actor: unknown): Promise<{ done: true; value: unknown } | { done: false }> {
  if (!(await delegate())) return { done: false };
  const provider = await providerInstance(COVERS_SERVICE);
  const handler = (provider?.mod.def.mcp as Record<string, ((ctx: unknown, args: unknown, actor: unknown) => unknown) | undefined> | undefined)?.[name];
  if (!provider || typeof handler !== "function") return { done: false };
  return { done: true, value: await handler(await buildContext(provider.mod, provider.instance), args, actor) };
}

// ── Installer et reprendre ────────────────────────────────────────────────────────────────────────────────────────────────
export type HandoverResult = "nothing" | "done" | "waiting" | "failed";
let running: Promise<HandoverResult> | null = null;

/**
 * Prépare puis fait la reprise. `install` : installer le module du catalogue officiel s'il manque (une seule fois par site, tentatives espacées de 10 minutes). Idempotente :
 * rejouée, elle ne fait rien de plus ; ne lève jamais. « nothing » : le site n'utilisait pas RAWG ; « waiting » : pas de module (encore) ; « failed » : le module a refusé.
 */
export function ensureRawgHandover(opts: { install?: boolean; force?: boolean } = {}): Promise<HandoverResult> {
  // Une tentative est en cours : une demande ordinaire la rejoint ; un événement explicite (`force`) attend qu'elle finisse, puis passe à son tour (elle a pu ignorer l'installation).
  if (running) return opts.force ? running.then(() => ensureRawgHandover(opts)) : running;
  const job = run(opts).catch((error): HandoverResult => { console.error("[rawg] handover failed:", (error as Error)?.name); return "failed"; }).finally(() => { running = null; });
  running = job;
  return job;
}

async function run(opts: { install?: boolean; force?: boolean }): Promise<HandoverResult> {
  const st = await handoverState();
  if (st.doneAt) return "done";
  const legacy = await legacyData();
  if (legacy.empty) return "nothing";

  let provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
  if (!provider && opts.install) {
    await installProvider(st, opts.force === true);
    provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
  }
  if (!provider) return "waiting";

  const r = await callProvider(COVERS_SERVICE, "adopt", { ...(legacy.key ? { key: legacy.key } : {}), fixes: legacy.fixes, todo: legacy.todo }, { moduleId: COVERS_MODULE });
  const v = r.ok && r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : null;
  // Réussi seulement si le module tient bien la clé (quand il y en avait une) : sinon on réessaiera.
  if (!v || v.ok !== true || (legacy.key && v.keyHeld !== true)) return "failed";
  await setSetting(HANDOVER_SETTING, { ...(await handoverState()), doneAt: new Date().toISOString(), key: v.keyHeld === true, fixes: Number(v.fixes) || 0, todo: Number(v.todo) || 0 } satisfies Handover);
  await audit("core", "rawg.handover", COVERS_MODULE);   // jamais une valeur
  forgetBridgeDecision();
  return "done";
}

/** Installe le module officiel (avec son instance), une seule fois par site. `force` : un événement explicite (démarrage, installation ou mise à jour de module) passe outre l'espacement. Ne lève jamais ; rien n'est fait sans entrée « officielle » compatible dans le catalogue. */
async function installProvider(st: Handover, force: boolean): Promise<boolean> {
  if (!force && Date.now() - lastInstallTry < RETRY_MS) return false;
  lastInstallTry = Date.now();
  try {
    const { getModule } = await import("@/core/modules/registry");
    const { findCatalogueEntry } = await import("@/core/modules/catalogue");
    const { installFromCatalogue } = await import("@/core/modules/installer");
    const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
    if (await getModule(COVERS_MODULE)) {
      // Installé (par la personne, ou par nous plus tôt) : on ne lui crée une instance que si c'est nous qui l'avons installé.
      if (st.installedAt) await ensureDefaultInstance(COVERS_MODULE);
      return true;
    }
    if (st.installedAt) return false;   // installé par nous, puis retiré par la personne : on ne le remet pas
    const entry = await findCatalogueEntry(COVERS_MODULE);
    if (!entry || entry.origin !== "official" || !entry.compatible || entry.needsNewerCore || !entry.offers?.some((o) => o.service === COVERS_SERVICE)) return false;
    const installed = await installFromCatalogue(COVERS_MODULE);
    if (!installed.ok) { console.error("[rawg] automatic install refused:", installed.error); return false; }
    await ensureDefaultInstance(COVERS_MODULE);
    await setSetting(HANDOVER_SETTING, { ...st, installedAt: new Date().toISOString() } satisfies Handover);
    await audit("core", "module.install.auto", COVERS_MODULE);
    return true;
  } catch (error) {
    console.error("[rawg] automatic install failed:", (error as Error)?.name);
    return false;
  }
}

/** Après une installation ou une mise à jour de module : la reprise se prépare (au mieux, sans attendre, sans jamais faire échouer l'opération). */
export function noteModulesChanged(): void {
  forgetBridgeDecision();
  void ensureRawgHandover({ install: true, force: true }).catch(() => {});
}
