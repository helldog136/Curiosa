import { prisma } from "@/core/db";
import { TIMED_OUT, withDeadline } from "@/core/deadline";
import { deleteSetting, getSetting, setSetting } from "@/core/settings";
import { fixFor, noteDoubtful, onFixesChanged, rawgImagePath, rawgImageUrl, type Fix } from "./rawgFixes";
import { isAmbiguous, rank } from "./rawgMatch";

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
 *
 * Choix du jeu (cœur 0.2.10) : RAWG renvoie jusqu'à 8 résultats ; le cœur compare chacun au titre demandé (rawgMatch.ts) et prend le plus ressemblant, pas
 * forcément le premier. Quand le meilleur n'est pas un titre quasi identique, ou qu'un autre est presque aussi bon, la réponse porte `ambiguous: true` et le titre
 * entre dans la liste « Jaquettes à vérifier » (rawgFixes.ts) où la propriétaire choisit le bon jeu. Son choix est une CORRECTION mémorisée, appliquée AVANT le cache.
 */
export type RawgStatus = "found" | "none" | "no-key" | "refused" | "unreachable";
/** `name`, `id`, `ambiguous` sont facultatifs et seulement présents avec `found` : un module qui ne lit que `status` et `url` n'est pas touché. */
export type RawgCover = { status: RawgStatus; url: string | null; name?: string; id?: number; ambiguous?: boolean };
/** Un jeu proposé pour un titre (jaquette présente, adresse https). */
export type RawgCandidate = { id: number; name: string; year: number | null; platforms: string[]; url: string };
export type RawgCandidates = { status: RawgStatus; candidates: RawgCandidate[] };
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
/** Résultats demandés à RAWG et lus (borne dure : jamais plus, quoi que réponde le serveur) ; candidats rendus à un module ou à l'écran de correction. */
const PAGE_SIZE = 8;
export const MAX_CANDIDATES = 6;
const MAX_PLATFORMS = 3;
/**
 * Bornes de TEMPS, quoi qu'il arrive (une attente qui ne se termine jamais, ici, figerait chaque page qui affiche une jaquette) :
 * la requête entière (réponse et lecture du corps) ; l'attente d'une des 2 places ; la demande entière d'une jaquette, base de données comprise.
 */
const LIMITS = { requestMs: TIMEOUT_MS + 2_000, queueMs: 10_000, coverMs: 15_000 };
let limits = { ...LIMITS };
/** Pour les tests : raccourcit les bornes. Sans argument, remet les vraies. */
export function setRawgLimits(l?: Partial<typeof LIMITS>): void { limits = { ...LIMITS, ...l }; }
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
/** Ce que RAWG a répondu pour une recherche (jusqu'à 8 jeux, image absente = null). */
type Raw = { id: number; name: string; year: number | null; platforms: string[]; image: string | null };
type Cached = { list: Raw[]; until: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Looked>>();
export function clearRawgCache(): void { cache.clear(); inflight.clear(); }
// Une correction qui change vide le cache : les listes de candidats reflètent toujours le choix le plus récent.
onFixesChanged(clearRawgCache);

let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    let mine!: () => void;
    const got = await withDeadline(() => new Promise<void>((resolve) => { mine = resolve; waiting.push(resolve); }), limits.queueMs); // la place nous est passée telle quelle
    if (got === TIMED_OUT) {
      const at = waiting.indexOf(mine);
      if (at >= 0) { waiting.splice(at, 1); throw new Error("rawg: no free slot in time"); }   // personne ne nous a passé de place : on renonce
      // sinon la place venait de nous être passée : on la prend
    }
  } else running++;
  try { return await job(); } finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

/** Titre nettoyé : sans caractères de contrôle, espaces réduits, longueur bornée. */
export function cleanTitle(title: unknown, max = MAX_TITLE): string {
  return String(title ?? "").slice(0, max * 4).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try { const u = new URL(value); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

const shortText = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Un résultat de RAWG, lu avec méfiance (types, longueurs). Un résultat sans nom ni numéro reste utilisable comme avant (id 0 = inconnu). */
function parseResult(r: unknown): Raw | null {
  if (!r || typeof r !== "object") return null;
  const o = r as { id?: unknown; name?: unknown; released?: unknown; platforms?: unknown; background_image?: unknown };
  const year = typeof o.released === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.released) ? Number(o.released.slice(0, 4)) : null;
  const platforms = Array.isArray(o.platforms)
    ? o.platforms.slice(0, 12).map((p) => shortText((p as { platform?: { name?: unknown } } | null)?.platform?.name, 40)).filter(Boolean).slice(0, MAX_PLATFORMS)
    : [];
  return { id: typeof o.id === "number" && Number.isSafeInteger(o.id) && o.id > 0 ? o.id : 0, name: shortText(o.name, 150), year, platforms, image: httpsUrl(o.background_image) };
}

type Outcome = { kind: "ok"; list: Raw[] } | { kind: "refused" } | { kind: "unreachable" };

/** Une requête RAWG (sans cache). Ne lève jamais ; la clé n'apparaît dans aucun résultat ni message. */
async function query(key: string, search: string): Promise<Outcome> {
  const url = `${ENDPOINT}?${new URLSearchParams({ key, search, page_size: String(PAGE_SIZE), search_precise: "true" })}`;
  try {
    // La place est gardée pendant la requête ET la lecture de la réponse, et la requête entière a une borne dure même si `fetch` ignorait son signal d'abandon.
    const got = await limited(async () => {
      const done = await withDeadline(async () => {
        const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
        return { status: res.status, ok: res.ok, body: res.status === 401 || res.status === 403 || !res.ok ? null : ((await res.json()) as { results?: unknown[] }) };
      }, limits.requestMs);
      if (done === TIMED_OUT) throw new Error("rawg: request timed out");
      return done;
    });
    if (got.status === 401 || got.status === 403) return { kind: "refused" };
    if (!got.ok) return { kind: "unreachable" };
    const results = Array.isArray(got.body?.results) ? got.body.results.slice(0, PAGE_SIZE) : [];
    return { kind: "ok", list: results.map(parseResult).filter((r): r is Raw => r !== null) };
  } catch (error) {
    // Seulement le type de l'erreur : un message de réseau pourrait contenir l'adresse demandée, donc la clé.
    console.error("[rawg] request failed:", (error as Error)?.name);
    return { kind: "unreachable" };
  }
}

/** `fresh` : la réponse vient d'être demandée à RAWG (et non relue du cache). */
type Looked = { kind: "ok"; list: Raw[]; fresh: boolean } | { kind: "refused" } | { kind: "unreachable" };

/** Les résultats de RAWG pour cette recherche : cache (trouvé ~24 h, « aucun résultat » ~1 h), demande partagée, état de la clé mémorisé. Ne lève jamais. */
async function lookup(key: string, search: string): Promise<Looked> {
  const id = search.toLowerCase();
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return { kind: "ok", list: hit.list, fresh: false };
  const pending = inflight.get(id);
  if (pending) return await sharedLook(pending);

  const job = (async (): Promise<Looked> => {
    const outcome = await query(key, search);
    if (outcome.kind === "ok") {
      await rememberState("ok");
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(id, { list: outcome.list, until: Date.now() + (outcome.list.some((r) => r.image) ? FOUND_TTL : NONE_TTL) });
      return { kind: "ok", list: outcome.list, fresh: true };
    }
    await rememberState(outcome.kind);
    return outcome;
  })();
  inflight.set(id, job);
  // Même si `job` ne se terminait jamais (base de données figée…), la demande rend la main à temps ET l'entrée « en cours » est retirée : la demande suivante repart de zéro.
  try { return await sharedLook(job); } finally { if (inflight.get(id) === job) inflight.delete(id); }
}

/** Attend une demande en cours (la sienne ou celle d'un autre), au plus `coverMs`. */
async function sharedLook(job: Promise<Looked>): Promise<Looked> {
  const done = await withDeadline(() => job, limits.coverMs);
  return done === TIMED_OUT ? { kind: "unreachable" } : done;
}

/** La réponse « jaquette » qui correspond à une correction mémorisée. */
function coverOfFix(fix: Fix): RawgCover {
  if (fix.kind === "none" || !fix.img) return { status: "none", url: null };
  return { status: "found", url: rawgImageUrl(fix.img), ...(fix.name ? { name: fix.name } : {}), ...(fix.rawgId ? { id: fix.rawgId } : {}), ambiguous: false };
}

/** Jaquette d'un jeu. Ne lève jamais. La correction de la propriétaire (s'il y en a une) passe AVANT le cache et avant RAWG. */
export async function rawgCover(title: string): Promise<RawgCover> {
  try {
    // Le titre complet (120 caractères au plus) sert à retrouver une correction ; RAWG n'en reçoit que les 100 premiers.
    const asked = cleanTitle(title, 120);
    const search = asked.slice(0, MAX_TITLE).trim();
    const key = await getRawgKey();
    if (!key) return { status: "no-key", url: null };
    if (!search) return { status: "none", url: null };

    const fix = await fixFor(asked);
    if (fix) return coverOfFix(fix);

    const looked = await lookup(key, search);
    if (looked.kind !== "ok") return { status: looked.kind, url: null };
    const ranked = rank(search, looked.list);
    const best = ranked[0];
    if (!best || !best.image) return { status: "none", url: null };
    // Sans nom, rien à comparer : `ambiguous` est alors absent (inconnu), et le titre n'entre pas dans la liste.
    const ambiguous = best.name ? isAmbiguous(ranked) : undefined;
    // Un titre douteux entre dans « Jaquettes à vérifier », seulement quand RAWG vient d'être interrogé (jamais à chaque lecture du cache) ; une même entrée est mise à jour, pas doublée.
    if (ambiguous && looked.fresh) void noteDoubtful({ title: asked, name: best.name, rawgId: best.id || undefined, url: best.image, candidates: ranked.length });
    return { status: "found", url: best.image, ...(best.name ? { name: best.name } : {}), ...(best.id ? { id: best.id } : {}), ...(ambiguous !== undefined ? { ambiguous } : {}) };
  } catch {
    return { status: "unreachable", url: null };
  }
}

/**
 * Les jeux que RAWG propose pour ce titre (6 au plus, jaquette obligatoire, du plus ressemblant au moins ressemblant). `search` : une autre recherche
 * (l'écran de correction laisse la propriétaire taper le vrai nom) ; ce texte n'est qu'un mot de recherche envoyé à l'API RAWG, jamais une adresse.
 * Ne lève jamais ; même cache, même limite de 2 requêtes et mêmes délais que `rawgCover`.
 */
export async function rawgCandidates(title: string, search?: string): Promise<RawgCandidates> {
  try {
    const asked = cleanTitle(title);
    const words = cleanTitle(search) || asked;
    const key = await getRawgKey();
    if (!key) return { status: "no-key", candidates: [] };
    if (!words) return { status: "none", candidates: [] };
    const looked = await lookup(key, words);
    if (looked.kind !== "ok") return { status: looked.kind, candidates: [] };
    const out: RawgCandidate[] = [];
    for (const c of rank(words, looked.list)) {
      // Seules les images de RAWG (media.rawg.io) sont proposées : l'écran n'affiche, et le cœur ne garde, rien d'autre.
      if (!c.image || !rawgImagePath(c.image) || !c.id || !c.name || out.some((o) => o.id === c.id)) continue;
      out.push({ id: c.id, name: c.name, year: c.year, platforms: c.platforms, url: c.image });
      if (out.length >= MAX_CANDIDATES) break;
    }
    return { status: out.length ? "found" : "none", candidates: out };
  } catch {
    return { status: "unreachable", candidates: [] };
  }
}

/** Bouton « Tester la clé » : interroge RAWG avec la clé enregistrée et mémorise le résultat. Ne lève jamais. */
export async function checkRawgKey(): Promise<RawgCheck> {
  try {
    const key = await getRawgKey();
    if (!key) return "no-key";
    const outcome = await query(key, "portal");
    const state: RawgKeyState = outcome.kind === "ok" ? "ok" : outcome.kind;
    await rememberState(state, true);
    return state;
  } catch {
    return "unreachable";
  }
}
