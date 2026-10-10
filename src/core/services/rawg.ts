import { prisma } from "@/core/db";
import { deleteSetting, getSetting, setSetting } from "@/core/settings";

/**
 * SERVICE « RAWG » (jaquettes de jeux) — offert aux modules par le cœur (`ctx.api.rawg`).
 *
 * La clé d'API RAWG est un réglage du CŒUR (Admin → Réglages → Services externes), saisie une seule fois, comme le serveur d'e-mail.
 * Un module ne la voit jamais : il demande « la jaquette de ce titre » et reçoit une adresse d'image. Garde-fous, quel que soit l'appelant :
 *  - https uniquement (requête et adresse de l'image) ; délai court ; titre nettoyé et borné ;
 *  - petit cache en mémoire (trouvé ~24 h, « aucun résultat » ~1 h) pour ne pas réinterroger RAWG ;
 *  - au plus 2 requêtes simultanées pour tout le site ;
 *  - dernier état de la clé (ok / refusée / injoignable + date) gardé dans les réglages, donc dans la sauvegarde ;
 *  - jamais d'exception, jamais la clé dans une valeur renvoyée, un journal ou une erreur.
 */
export type RawgStatus = "found" | "none" | "no-key" | "refused" | "unreachable";
export type RawgCover = { status: RawgStatus; url: string | null };
export type RawgKeyState = "ok" | "refused" | "unreachable";
export type RawgCheck = "ok" | "refused" | "unreachable" | "no-key";

export const RAWG_KEY_SETTING = "rawg.key";
export const RAWG_STATE_SETTING = "rawg.status";
const IMPORTED_SETTING = "rawg.keyImported";
/** Modules dont une instance peut avoir (anciennement) sa propre clé, reprise une fois dans le cœur. */
const LEGACY_MODULES = ["game-suggestions", "planning"];
const LEGACY_SETTING = "rawgApiKey";

const ENDPOINT = "https://api.rawg.io/api/games";
const TIMEOUT_MS = 5_000;
const FOUND_TTL = 24 * 3_600_000;
const NONE_TTL = 3_600_000;
const MAX_CACHE = 500;
const MAX_PARALLEL = 2;
const MAX_TITLE = 100;
/** On ne réécrit l'état de la clé que s'il change, ou s'il date de plus de ça. */
const STATE_REFRESH = 10 * 60_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
let doFetch: FetchLike = (url, init) => fetch(url, { ...init, redirect: "error", cache: "no-store" }) as unknown as ReturnType<FetchLike>;
/** Pour les tests : remplace `fetch`. Sans argument, remet le vrai. */
export function setRawgFetch(f?: FetchLike): void {
  doFetch = f ?? ((url, init) => fetch(url, { ...init, redirect: "error", cache: "no-store" }) as unknown as ReturnType<FetchLike>);
}

// ── Clé (réglage du cœur) ─────────────────────────────────────────────────────────────────────────────────────────────
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
export const isValidRawgKey = (key: string): boolean => KEY_RE.test(key);

export async function getRawgKey(): Promise<string> {
  await importRawgKeyFromModules();
  const key = await getSetting<string>(RAWG_KEY_SETTING);
  return typeof key === "string" ? key.trim() : "";
}

export async function isRawgConfigured(): Promise<boolean> {
  try { return (await getRawgKey()) !== ""; } catch { return false; }
}

/** Enregistre la clé (déjà validée) ; efface l'ancien état et le cache, puisqu'ils concernaient une autre clé. */
export async function saveRawgKey(key: string): Promise<void> {
  await setSetting(RAWG_KEY_SETTING, key.trim());
  await setSetting(IMPORTED_SETTING, true);
  await deleteSetting(RAWG_STATE_SETTING);
  clearRawgCache();
}

/** Retire la clé du cœur (et ne la reprendra plus d'un module). */
export async function clearRawgKey(): Promise<void> {
  await deleteSetting(RAWG_KEY_SETTING);
  await setSetting(IMPORTED_SETTING, true);
  await deleteSetting(RAWG_STATE_SETTING);
  clearRawgCache();
}

export type RawgStateView = { state: RawgKeyState; at: string } | null;
export async function getRawgState(): Promise<RawgStateView> {
  const raw = await getSetting<{ state?: string; at?: string }>(RAWG_STATE_SETTING);
  if (!raw || (raw.state !== "ok" && raw.state !== "refused" && raw.state !== "unreachable") || typeof raw.at !== "string") return null;
  return { state: raw.state, at: raw.at };
}

async function rememberState(state: RawgKeyState, force = false): Promise<void> {
  try {
    const current = await getRawgState();
    if (!force && current?.state === state && Date.now() - Date.parse(current.at) < STATE_REFRESH) return;
    await setSetting(RAWG_STATE_SETTING, { state, at: new Date().toISOString() });
  } catch { /* l'état est une information : jamais bloquant */ }
}

// ── Reprise des clés existantes ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Avant le service du cœur, chaque instance de module avait sa propre clé (`instance.<id>.rawgApiKey`). Si le réglage du cœur est vide,
 * on copie UNE fois la première clé trouvée (la valeur du module reste en place pour les modules plus anciens). Idempotent : un repère
 * « déjà repris » est posé ; il est aussi posé quand le cœur a déjà sa clé, ou quand le propriétaire la retire. Ne lève jamais.
 */
export async function importRawgKeyFromModules(): Promise<"imported" | "done" | "none"> {
  try {
    if (await getSetting<boolean>(IMPORTED_SETTING)) return "done";
    const current = await getSetting<string>(RAWG_KEY_SETTING);
    if (typeof current === "string" && current.trim() !== "") {
      await setSetting(IMPORTED_SETTING, true);
      return "done";
    }
    const instances = await prisma.moduleInstance.findMany({ where: { moduleId: { in: LEGACY_MODULES } }, orderBy: { createdAt: "asc" } });
    for (const instance of instances) {
      const row = await prisma.setting.findUnique({ where: { key_locale: { key: `instance.${instance.id}.${LEGACY_SETTING}`, locale: "" } } });
      let value: unknown;
      try { value = row ? JSON.parse(row.value) : undefined; } catch { value = undefined; }
      if (typeof value !== "string" || value.trim() === "") continue;
      await setSetting(RAWG_KEY_SETTING, value.trim());
      await setSetting(IMPORTED_SETTING, true);
      // Le journal dit d'où elle vient, jamais sa valeur.
      await prisma.auditLog.create({ data: { actor: "core", action: "settings.rawg.import", target: instance.moduleId } }).catch(() => {});
      clearRawgCache();
      return "imported";
    }
    return "none";
  } catch (error) {
    console.error("[rawg] import failed:", (error as Error)?.name);
    return "none";
  }
}

// ── Cache et concurrence (partagés par tous les modules) ─────────────────────────────────────────────────────────────
type Cached = { value: RawgCover; until: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<RawgCover>>();
export function clearRawgCache(): void { cache.clear(); inflight.clear(); }

let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve)); // la place nous est passée telle quelle
  else running++;
  try { return await job(); } finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

/** Titre nettoyé : sans caractères de contrôle, espaces réduits, longueur bornée. */
export function cleanTitle(title: unknown): string {
  return String(title ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try { const u = new URL(value); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

type Outcome = { kind: "found"; url: string } | { kind: "none" } | { kind: "refused" } | { kind: "unreachable" };

/** Une requête RAWG (sans cache). Ne lève jamais ; la clé n'apparaît dans aucun résultat ni message. */
async function query(key: string, search: string): Promise<Outcome> {
  const url = `${ENDPOINT}?${new URLSearchParams({ key, search, page_size: "1", search_precise: "true" })}`;
  try {
    const res = await limited(() => doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } }));
    if (res.status === 401 || res.status === 403) return { kind: "refused" };
    if (!res.ok) return { kind: "unreachable" };
    const body = (await res.json()) as { results?: { background_image?: unknown }[] };
    const first = Array.isArray(body?.results) ? body.results[0] : undefined;
    const image = httpsUrl(first?.background_image);
    return image ? { kind: "found", url: image } : { kind: "none" };
  } catch (error) {
    // Seulement le type de l'erreur : un message de réseau pourrait contenir l'adresse demandée, donc la clé.
    console.error("[rawg] request failed:", (error as Error)?.name);
    return { kind: "unreachable" };
  }
}

/** Jaquette d'un jeu. Ne lève jamais. */
export async function rawgCover(title: string): Promise<RawgCover> {
  try {
    const search = cleanTitle(title);
    const key = await getRawgKey();
    if (!key) return { status: "no-key", url: null };
    if (!search) return { status: "none", url: null };

    const id = search.toLowerCase();
    const hit = cache.get(id);
    if (hit && hit.until > Date.now()) return { ...hit.value };
    const pending = inflight.get(id);
    if (pending) return { ...(await pending) };

    const job = (async (): Promise<RawgCover> => {
      const outcome = await query(key, search);
      if (outcome.kind === "found" || outcome.kind === "none") {
        await rememberState("ok");
        const value: RawgCover = outcome.kind === "found" ? { status: "found", url: outcome.url } : { status: "none", url: null };
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(id, { value, until: Date.now() + (outcome.kind === "found" ? FOUND_TTL : NONE_TTL) });
        return value;
      }
      await rememberState(outcome.kind);
      return { status: outcome.kind, url: null };
    })();
    inflight.set(id, job);
    try { return { ...(await job) }; } finally { inflight.delete(id); }
  } catch {
    return { status: "unreachable", url: null };
  }
}

/** Bouton « Tester la clé » : interroge RAWG avec la clé enregistrée et mémorise le résultat. Ne lève jamais. */
export async function checkRawgKey(): Promise<RawgCheck> {
  try {
    const key = await getRawgKey();
    if (!key) return "no-key";
    const outcome = await query(key, "portal");
    const state: RawgKeyState = outcome.kind === "found" || outcome.kind === "none" ? "ok" : outcome.kind;
    await rememberState(state, true);
    return state;
  } catch {
    return "unreachable";
  }
}
