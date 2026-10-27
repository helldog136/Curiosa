import { callProvider, providerInstance } from "@/core/modules/dependencies";
import { COVERS_MODULE, COVERS_SERVICE, ensureRawgHandover, handoverState } from "./rawgHandover";
import { trackRawgJob } from "./rawgNote";

/**
 * `ctx.api.rawg` (permission « rawg », DÉPRÉCIÉE depuis la 0.3.0) — un relais minimal pour les modules d'avant, qui ne connaissent pas encore le service `game.cover`.
 * Le cœur n'a plus aucun service RAWG : ce fichier ne parle jamais à RAWG, ne garde ni clé ni correction, et n'a aucun repli sur l'ancien code. Il transmet la demande au module
 * « Jaquettes de jeux » s'il est là et rend, sans exception, l'une des formes que ces modules connaissent :
 *   - module absent, en panne, ou qui répond n'importe quoi : `no-key` / `unreachable` / `none` (jamais une exception, jamais une adresse qui ne soit pas en https) ;
 *   - la clé et les corrections ne traversent jamais ce relais (le module les détient ; rien n'en sort).
 * Les modules récents (game-suggestions ≥ 1.4, planning ≥ 2.4, stream-story ≥ 2.4) appellent `game.cover` eux-mêmes et ne passent par ici que si le module répond « no-key » ou est absent.
 * Retrait envisagé : quand plus aucun module du catalogue ne déclare la permission « rawg ».
 */
export type RawgStatus = "found" | "none" | "no-key" | "refused" | "unreachable";
export type RawgCover = { status: RawgStatus; url: string | null; name?: string; id?: number; ambiguous?: boolean };
export type RawgCandidate = { id: number; name: string; year: number | null; platforms: string[]; url: string };
export type RawgCandidates = { status: RawgStatus; candidates: RawgCandidate[] };

const STATUSES: RawgStatus[] = ["found", "none", "no-key", "refused", "unreachable"];
const ADOPT_WAIT_MS = 4_000;
const SETTLED_MS = 60_000;
let settledUntil = 0;
/** Pour les tests. */
export function resetRelay(): void { settledUntil = 0; }

const httpsUrl = (v: unknown): string | null => { if (typeof v !== "string" || v.length > 2000) return null; try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; } };
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/** La réponse d'un fournisseur, relue avec méfiance : le cœur ne rend à un ancien module que la forme qu'il connaît. */
export function coverOf(v: unknown): RawgCover {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const status = STATUSES.includes(o.status as RawgStatus) ? (o.status as RawgStatus) : "unreachable";
  if (status !== "found") return { status, url: null };
  const url = httpsUrl(o.url);
  if (!url) return { status: "none", url: null };
  const name = text(o.name, 150);
  return { status, url, ...(name ? { name } : {}), ...(typeof o.id === "number" && Number.isSafeInteger(o.id) && o.id > 0 ? { id: o.id } : {}), ...(typeof o.ambiguous === "boolean" ? { ambiguous: o.ambiguous } : {}) };
}
export function candidatesOf(v: unknown): RawgCandidates {
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

/**
 * Le module est-il là ? Absent : une reprise est tentée en arrière-plan (espacée, elle ne fait rien si le site n'utilisait pas RAWG). Présent mais reprise pas faite : on la
 * termine d'abord (4 s au plus), pour que le tout premier appel ne réponde pas « no-key » à tort.
 */
async function available(): Promise<boolean> {
  try {
    const provider = await providerInstance(COVERS_SERVICE);
    if (!provider) { trackRawgJob(ensureRawgHandover({ install: true })); return false; }
    if (provider.mod.manifest.id === COVERS_MODULE && Date.now() >= settledUntil && !(await handoverState()).doneAt) {
      settledUntil = Date.now() + SETTLED_MS;   // quel qu'en soit le résultat : au plus une tentative par minute, jamais une attente à chaque demande
      await Promise.race([ensureRawgHandover({ install: false }), new Promise<string>((r) => { const t = setTimeout(() => r("late"), ADOPT_WAIT_MS); t.unref?.(); })]);
    }
    return true;
  } catch (error) {
    console.error("[rawg] relay failed:", (error as Error)?.name);
    return false;
  }
}

export async function relayedCover(title: string): Promise<RawgCover> {
  if (!(await available())) return { status: "no-key", url: null };
  const r = await callProvider(COVERS_SERVICE, "cover", { title });
  return r.ok ? coverOf(r.value) : r.reason === "unavailable" ? { status: "no-key", url: null } : { status: "unreachable", url: null };
}
export async function relayedCandidates(title: string): Promise<RawgCandidates> {
  if (!(await available())) return { status: "no-key", candidates: [] };
  const r = await callProvider(COVERS_SERVICE, "candidates", { title });
  return r.ok ? candidatesOf(r.value) : r.reason === "unavailable" ? { status: "no-key", candidates: [] } : { status: "unreachable", candidates: [] };
}
export async function relayedConfigured(): Promise<boolean> {
  if (!(await available())) return false;
  const r = await callProvider(COVERS_SERVICE, "status", {});
  return r.ok && (r.value as { configured?: unknown } | null)?.configured === true;
}
