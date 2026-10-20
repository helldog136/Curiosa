import { createHash } from "node:crypto";

/**
 * SERVICE « NET » — client réseau NEUTRE et BORNÉ offert aux modules (`ctx.api.net`). Contrat : docs/V2-CONTRACTS.md § 7.
 *
 * Pourquoi : un module qui appelle une API externe sans précaution peut figer une page (pas de délai), marteler un service qui demande une pause
 * (429), épuiser un quota journalier, ou relancer des milliers d'appels vers un hôte en panne. Ce client du cœur fait le travail une fois pour tous,
 * sans connaître AUCUN fournisseur (aucun nom de service, aucune adresse en dur) :
 *  - délai dur sur tout (file d'attente, connexion, lecture du corps) ; dans une page publique, le délai est aussi borné par le temps restant de la page ;
 *  - limitation de débit : 429 (ou 503 avec Retry-After) → pause du seau (`bucket`, sinon l'hôte) jusqu'à `retryAt`, sans aucun appel réseau d'ici là ;
 *    `RateLimit-Remaining: 0` sur une réponse normale → même pause, préventive ;
 *  - quota journalier (403 `quotaExceeded` / `dailyLimitExceeded`) → plus rien avant minuit (heure du Pacifique, celle des quotas journaliers courants) ;
 *  - disjoncteur par hôte, partagé par tout le processus : 5 échecs en 60 s l'ouvrent 30 s, puis UN seul essai (demi-ouverture), durée doublée à chaque
 *    échec jusqu'à 5 min : aucune tempête de reprises ;
 *  - déduplication des GET/HEAD identiques en cours (une seule promesse, qui expire toujours avec le délai) ;
 *  - file d'attente bornée : 4 appels simultanés par hôte, 16 admis par hôte, 32 admis au total ; au-delà, refus IMMÉDIAT (`busy`), jamais d'attente ;
 *  - une seule reprise au plus (GET/HEAD, après une erreur réseau ou un 502/503/504 sans Retry-After), après une attente aléatoire (jitter) ;
 *  - journal d'une ligne, sans en-têtes, sans requête (query string), sans corps, avec les segments de chemin qui ressemblent à un jeton masqués ;
 *  - état de santé par hôte (ok / lent / limité / quota / en panne) pour le bloc d'admin « santé ».
 * Tout est en mémoire (500 entrées au plus par table, les plus anciennes évincées) et perdu au redémarrage. Ne lève JAMAIS.
 *
 * Aucun import du cœur : ce fichier est autonome (testé seul, chargé aussi par le kit de test des modules, testsupport/fakeNet.mjs).
 */

export type NetMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
export type NetRequest = {
  /** https:// uniquement. */
  url: string;
  method?: NetMethod;
  headers?: Record<string, string>;
  /** Objet → JSON (avec `content-type: application/json` si absent). Interdit pour GET/HEAD. */
  body?: string | Record<string, unknown>;
  /** Défaut 8 000 ms, max 20 000 ms. L'attente dans la file compte dans ce délai. */
  timeoutMs?: number;
  /** Défaut 2 Mo, max 10 Mo : au-delà, `too_large`. */
  maxBytes?: number;
  /** Défaut true pour GET/HEAD (sans effet sur les autres méthodes). */
  dedupe?: boolean;
  /** Défaut 1 pour GET/HEAD, 0 sinon (les autres méthodes ne sont jamais reprises). */
  retry?: 0 | 1;
  /** Défaut background ; `interactive` passe devant dans la file. */
  priority?: "interactive" | "background";
  /** Seau de limite partagé (par exemple : une même application chez un fournisseur) ; haché par le cœur, jamais journalisé. */
  bucket?: string;
};
export type NetError = "timeout" | "network" | "rate" | "quota" | "circuit" | "busy" | "too_large" | "invalid";
export type NetResult =
  | { ok: true; status: number; headers: Record<string, string>; json?: unknown; text?: string; shared: boolean }
  | { ok: false; error: NetError; status?: number; retryAt?: number };
export type NetHealthState = "ok" | "slow" | "rate" | "quota" | "down";
export type NetHealthItem = { host: string; state: NetHealthState; since: number; retryAt?: number };

export const NET_LIMITS = {
  defaultTimeoutMs: 8_000,
  maxTimeoutMs: 20_000,
  defaultMaxBytes: 2 * 1024 * 1024,
  maxMaxBytes: 10 * 1024 * 1024,
  maxRequestBytes: 1024 * 1024,
  perHostActive: 4,
  perHostAdmitted: 16,
  totalAdmitted: 32,
  circuitFailures: 5,
  circuitWindowMs: 60_000,
  circuitOpenMs: 30_000,
  circuitMaxOpenMs: 300_000,
  retryMinMs: 200,
  retryMaxMs: 800,
  retryMinLeftMs: 1_000,
  defaultPauseMs: 60_000,
  maxPauseMs: 3_600_000,
  slowMs: 3_000,
  maxEntries: 500,
  /** Un refus sans réseau (pause, disjoncteur, file pleine) n'est journalisé qu'une fois par minute et par motif. */
  quietLogMs: 60_000,
};
export type NetLimits = typeof NET_LIMITS;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type NetDeps = {
  fetch?: FetchLike;
  now?: () => number;
  random?: () => number;
  log?: (line: string) => void;
  limits?: Partial<NetLimits>;
};
/** Appelant : module (pour le journal) et temps restant de la page publique en cours (null hors page publique). */
export type NetCallContext = { module?: string; budgetMs?: number | null };

export type NetClient = {
  request(req: NetRequest, call?: NetCallContext): Promise<NetResult>;
  health(): NetHealthItem[];
  /** Santé d'un seul hôte (null : jamais contacté depuis le démarrage). */
  hostHealth(host: string): NetHealthItem | null;
};

const METHODS = new Set<NetMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);
const TIMEOUT = Symbol("timeout");

type Limit = { kind: "rate" | "quota"; until: number; since: number; host: string };
type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };
type Host = {
  active: number;
  admitted: number;
  waiting: { interactive: Waiter[]; background: Waiter[] };
  failures: number[];
  openUntil: number;
  openMs: number;
  trial: boolean;
  outcome: "ok" | "slow" | "down" | null;
  since: number;
};
type Valid = {
  url: URL;
  host: string;
  method: NetMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  dedupe: boolean;
  retry: boolean;
  priority: "interactive" | "background";
  bucket?: string;
};
type Raw = { status: number; headers: Record<string, string>; bytes?: Uint8Array; tooLarge?: boolean };

const sha = (s: string, n = 32) => createHash("sha256").update(s).digest("base64url").slice(0, n);

/** Délai lisible d'un en-tête (secondes, ou date HTTP pour Retry-After) → instant absolu, ou null. */
function parseRetryAfter(v: string | undefined, now: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return now + Number(s) * 1000;
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}
/** Remise à zéro d'un en-tête *-Reset : époque si > 10⁹ (secondes ; millisecondes si > 10¹²), sinon délai en secondes. */
function parseReset(v: string | undefined, now: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (n > 1e12) return n;
  if (n > 1e9) return n * 1000;
  return now + n * 1000;
}
/** En-tête combiné (brouillon IETF) : `RateLimit: limit=100, remaining=0, reset=30`. */
function combined(h: Record<string, string>): { remaining?: number; reset?: number } {
  const raw = h["ratelimit"];
  if (!raw) return {};
  const pick = (k: string) => { const m = new RegExp(`(?:^|[,;\\s])${k}=(\\d+(?:\\.\\d+)?)`).exec(raw); return m ? Number(m[1]) : undefined; };
  return { remaining: pick("r(?:emaining)?"), reset: pick("(?:reset|t)") };
}
function resetFromHeaders(h: Record<string, string>, now: number): number | null {
  const fromReset = parseReset(h["ratelimit-reset"] ?? h["x-ratelimit-reset"], now);
  if (fromReset !== null) return fromReset;
  const c = combined(h);
  if (c.reset !== undefined) return now + c.reset * 1000;
  return parseReset(h["x-ratelimit-reset-after"], now) ?? null;
}

/** Fin de pause après un 429 (ordre du contrat), bornée entre 1 s et 1 h. */
export function rateRetryAt(h: Record<string, string>, json: unknown, now: number, limits: Pick<NetLimits, "defaultPauseMs" | "maxPauseMs"> = NET_LIMITS): number {
  let at = parseRetryAfter(h["retry-after"], now) ?? resetFromHeaders(h, now);
  if (at === null && json && typeof json === "object") {
    const ra = (json as Record<string, unknown>).retry_after;
    const n = typeof ra === "number" ? ra : typeof ra === "string" && /^\d+(\.\d+)?$/.test(ra.trim()) ? Number(ra) : NaN;
    if (Number.isFinite(n) && n >= 0) at = now + n * 1000;
  }
  if (at === null) at = now + limits.defaultPauseMs;
  return Math.min(now + limits.maxPauseMs, Math.max(now + 1000, at));
}

/** Prochain minuit à Los Angeles (heure des remises à zéro des quotas journaliers courants). Les changements d'heure ont lieu à 2 h : sans effet sur minuit. */
export function nextPacificMidnight(now: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = (t: number) => Object.fromEntries(fmt.formatToParts(new Date(t)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])) as Record<string, number>;
  const p = parts(now);
  const wallAsUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  const offset = wallAsUtc - Math.floor(now / 1000) * 1000; // heure murale − instant réel
  let at = Date.UTC(p.year!, p.month! - 1, p.day! + 1, 0, 0, 0) - offset;
  const q = parts(at);
  if (q.hour !== 0) at -= (q.hour! > 12 ? q.hour! - 24 : q.hour!) * 3_600_000; // filet de sécurité (décalage différent à minuit)
  return at;
}

/** Quota journalier épuisé ? (403 dont le JSON porte `error.errors[].reason`.) */
function isQuota(status: number, json: unknown): boolean {
  if (status !== 403 || !json || typeof json !== "object") return false;
  const errors = ((json as { error?: { errors?: unknown } }).error)?.errors;
  return Array.isArray(errors) && errors.some((e) => e && typeof e === "object" && QUOTA_REASONS.has(String((e as { reason?: unknown }).reason)));
}

/** Chemin pour le journal : sans requête ni fragment ; un segment qui ressemble à un jeton (long, lettres + chiffres) est masqué ; 120 caractères au plus. */
export function logPath(url: URL): string {
  const segs = url.pathname.split("/").map((s) => (s.length >= 20 && /[0-9]/.test(s) && /[A-Za-z]/.test(s)) || s.length > 48 ? "…" : s);
  const p = segs.join("/") || "/";
  return p.length > 120 ? `${p.slice(0, 119)}…` : p;
}
const cleanModule = (m: string | undefined) => (m ?? "core").replace(/[^\w.-]/g, "").slice(0, 60) || "core";

function validate(req: NetRequest, L: NetLimits): Valid | null {
  if (!req || typeof req !== "object" || typeof req.url !== "string" || req.url.length > 4096) return null;
  let url: URL;
  try { url = new URL(req.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  const method = (req.method ?? "GET").toUpperCase() as NetMethod;
  if (!METHODS.has(method)) return null;
  const headers: Record<string, string> = {};
  if (req.headers !== undefined) {
    if (!req.headers || typeof req.headers !== "object" || Array.isArray(req.headers)) return null;
    const entries = Object.entries(req.headers);
    if (entries.length > 50) return null;
    for (const [k, v] of entries) {
      if (!HEADER_NAME.test(k) || typeof v !== "string" || /[\r\n\0]/.test(v) || v.length > 8192) return null;
      headers[k.toLowerCase()] = v;
    }
  }
  let body: string | undefined;
  if (req.body !== undefined && req.body !== null) {
    if (method === "GET" || method === "HEAD") return null;
    if (typeof req.body === "string") body = req.body;
    else if (typeof req.body === "object" && !Array.isArray(req.body)) {
      try { body = JSON.stringify(req.body); } catch { return null; }
      headers["content-type"] ??= "application/json";
    } else return null;
    if (Buffer.byteLength(body) > L.maxRequestBytes) return null;
  }
  const num = (v: unknown, def: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : def);
  const idempotent = method === "GET" || method === "HEAD";
  if (req.bucket !== undefined && (typeof req.bucket !== "string" || req.bucket.length > 200)) return null;
  return {
    url, host: url.host.toLowerCase(), method, headers, body,
    timeoutMs: num(req.timeoutMs, L.defaultTimeoutMs, L.maxTimeoutMs),
    maxBytes: num(req.maxBytes, L.defaultMaxBytes, L.maxMaxBytes),
    dedupe: idempotent && req.dedupe !== false,
    retry: idempotent && (req.retry ?? 1) === 1,
    priority: req.priority === "interactive" ? "interactive" : "background",
    bucket: req.bucket || undefined,
  };
}

/** Met `p` en course contre l'instant `deadline` ; l'échec tardif de `p` est absorbé. Le minuteur n'est PAS « unref » : il garantit la réponse. */
function untilDeadline<T>(p: Promise<T>, deadline: number, now: () => number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, deadline - now()));
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fabrique un client (un état par client). Le cœur n'en a qu'un, partagé : `sharedNet()`. */
export function createNetClient(deps: NetDeps = {}): NetClient {
  const L: NetLimits = { ...NET_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const doFetch: FetchLike = deps.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const say = deps.log ?? ((line: string) => console.log(line));
  const limits = new Map<string, Limit>();
  const hosts = new Map<string, Host>();
  const inflight = new Map<string, { promise: Promise<NetResult>; expires: number }>();
  const quiet = new Map<string, number>();
  let admittedTotal = 0;

  const cap = <K, V>(m: Map<K, V>, keep?: (v: V) => boolean) => {
    if (m.size <= L.maxEntries) return;
    for (const [k, v] of m) { if (m.size <= L.maxEntries) break; if (!keep?.(v)) m.delete(k); }
  };
  const hostOf = (name: string): Host => {
    let h = hosts.get(name);
    if (!h) {
      h = { active: 0, admitted: 0, waiting: { interactive: [], background: [] }, failures: [], openUntil: 0, openMs: 0, trial: false, outcome: null, since: now() };
      hosts.set(name, h);
      cap(hosts, (x) => x.admitted > 0 || x.trial); // un hôte en cours d'usage n'est jamais évincé (ses compteurs resteraient faux)
    }
    return h;
  };
  const log = (module: string | undefined, v: Valid, what: string | number, ms: number) =>
    say(`[net] ${cleanModule(module)} ${v.host} ${v.method} ${logPath(v.url)} ${what} ${Math.max(0, Math.round(ms))}ms`);
  const logQuietly = (key: string, module: string | undefined, v: Valid, what: string) => {
    const t = now();
    if ((quiet.get(key) ?? -Infinity) > t - L.quietLogMs) return;
    quiet.set(key, t);
    cap(quiet);
    log(module, v, what, 0);
  };
  const setOutcome = (h: Host, o: "ok" | "slow" | "down") => { if (h.outcome !== o) { h.outcome = o; h.since = now(); } };
  const pause = (key: string, kind: "rate" | "quota", until: number, host: string) => {
    const prev = limits.get(key);
    limits.delete(key);
    limits.set(key, { kind, until, host, since: prev && prev.until > now() && prev.kind === kind ? prev.since : now() });
    cap(limits);
  };
  const activeLimit = (key: string): Limit | null => {
    const l = limits.get(key);
    if (!l) return null;
    if (l.until > now()) return l;
    limits.delete(key);
    return null;
  };

  // ── Disjoncteur ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** Refus du disjoncteur à l'admission (sans prendre l'essai de demi-ouverture). */
  const circuitRefusal = (h: Host): NetResult | null => {
    if (h.openUntil > now()) return { ok: false, error: "circuit", retryAt: h.openUntil };
    if (h.openMs > 0 && h.trial) return { ok: false, error: "circuit" };
    return null;
  };
  /** Au moment d'appeler le réseau : refus, ou feu vert (en demi-ouverture, cet appel devient l'UNIQUE essai). */
  const circuitGate = (h: Host): { refused: NetResult } | { trial: boolean } => {
    const r = circuitRefusal(h);
    if (r) return { refused: r };
    if (h.openMs > 0) { h.trial = true; return { trial: true }; }
    return { trial: false };
  };
  const failed = (h: Host, trial: boolean) => {
    const t = now();
    setOutcome(h, "down");
    if (trial) { h.trial = false; h.openMs = Math.min(h.openMs * 2, L.circuitMaxOpenMs); h.openUntil = t + h.openMs; h.failures = []; return; }
    h.failures = h.failures.filter((x) => t - x < L.circuitWindowMs);
    h.failures.push(t);
    if (h.failures.length >= L.circuitFailures && h.openUntil <= t) { h.openMs = L.circuitOpenMs; h.openUntil = t + h.openMs; h.failures = []; }
  };
  const answered = (h: Host, trial: boolean, ms: number) => {
    h.failures = [];
    if (trial || h.openMs > 0) { h.trial = false; h.openMs = 0; h.openUntil = 0; }
    setOutcome(h, ms >= L.slowMs ? "slow" : "ok");
  };

  // ── File d'attente ────────────────────────────────────────────────────────────────────────────────────────────────
  const acquire = (h: Host, priority: "interactive" | "background", deadline: number): Promise<boolean> => {
    if (h.active < L.perHostActive) { h.active++; return Promise.resolve(true); }
    return new Promise((resolve) => {
      const list = h.waiting[priority];
      const w: Waiter = {
        grant: () => { clearTimeout(w.timer); h.active++; resolve(true); },
        timer: setTimeout(() => { const i = list.indexOf(w); if (i >= 0) list.splice(i, 1); resolve(false); }, Math.max(0, deadline - now())),
      };
      list.push(w);
    });
  };
  const release = (h: Host) => {
    h.active--;
    const next = h.waiting.interactive.shift() ?? h.waiting.background.shift();
    next?.grant();
  };

  // ── Un appel réseau ───────────────────────────────────────────────────────────────────────────────────────────────
  async function fetchOnce(v: Valid, signal: AbortSignal): Promise<Raw> {
    const res = await doFetch(v.url.href, { method: v.method, headers: v.headers, body: v.body, signal, redirect: "manual", cache: "no-store" });
    const headers: Record<string, string> = {};
    res.headers?.forEach?.((value, key) => { headers[key.toLowerCase()] = value; });
    if (v.method === "HEAD") { try { await res.body?.cancel(); } catch { /* déjà fermé */ } return { status: res.status, headers }; }
    const declared = Number(headers["content-length"]);
    if (Number.isFinite(declared) && declared > v.maxBytes) { try { await res.body?.cancel(); } catch { /* déjà fermé */ } return { status: res.status, headers, tooLarge: true }; }
    if (!res.body || typeof res.body.getReader !== "function") {
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.byteLength > v.maxBytes ? { status: res.status, headers, tooLarge: true } : { status: res.status, headers, bytes: buf };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > v.maxBytes) { try { await reader.cancel(); } catch { /* déjà fermé */ } return { status: res.status, headers, tooLarge: true }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
    return { status: res.status, headers, bytes };
  }

  async function attempts(v: Valid, call: NetCallContext, deadline: number, limitKey: string): Promise<NetResult> {
    const h = hostOf(v.host);
    let mine = false; // cet appel tient l'essai de demi-ouverture
    try { return await attemptLoop(v, call, deadline, limitKey, h, (x) => { mine = x; }); } finally {
      if (mine && h.trial) failed(h, true); // fin imprévue pendant l'essai : il compte comme un échec, et l'essai est rendu
    }
  }

  async function attemptLoop(v: Valid, call: NetCallContext, deadline: number, limitKey: string, h: Host, holdTrial: (x: boolean) => void): Promise<NetResult> {
    for (let attempt = 0; ; attempt++) {
      const gate = circuitGate(h);
      if ("refused" in gate) { logQuietly(`c:${v.host}`, call.module, v, "circuit"); return gate.refused; }
      const trial = gate.trial;
      holdTrial(trial);
      const t0 = now();
      const ctrl = new AbortController();
      const work = fetchOnce(v, ctrl.signal);
      let raw: Raw | typeof TIMEOUT | null;
      try { raw = await untilDeadline(work, deadline, now); } catch { raw = null; }
      const ms = now() - t0;
      if (raw === TIMEOUT) {
        ctrl.abort();
        work.catch(() => {});
        failed(h, trial);
        log(call.module, v, "timeout", ms);
        return { ok: false, error: "timeout" };
      }
      const canRetry = () => {
        if (attempt > 0 || !v.retry) return null;
        const wait = Math.round(L.retryMinMs + random() * (L.retryMaxMs - L.retryMinMs));
        return deadline - now() - wait >= L.retryMinLeftMs && !circuitRefusal(h) ? wait : null;
      };
      if (raw === null) {
        failed(h, trial);
        log(call.module, v, "network", ms);
        const wait = canRetry();
        if (wait === null) return { ok: false, error: "network" };
        await sleep(wait);
        continue;
      }
      if (raw.tooLarge) {
        answered(h, trial, ms);
        log(call.module, v, "too_large", ms);
        return { ok: false, error: "too_large", status: raw.status };
      }
      const text = raw.bytes && raw.bytes.byteLength ? new TextDecoder("utf-8").decode(raw.bytes) : raw.bytes ? "" : undefined;
      let json: unknown;
      if (text) {
        const trimmed = text.trimStart();
        if (/json/i.test(raw.headers["content-type"] ?? "") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try { json = JSON.parse(text); } catch { json = undefined; }
        }
      }
      const status = raw.status;
      const t = now();
      if (status === 429 || (status === 503 && raw.headers["retry-after"])) {
        answered(h, trial, ms); // l'hôte répond : ce n'est pas une panne
        const retryAt = rateRetryAt(raw.headers, json, t, L);
        pause(limitKey, "rate", retryAt, v.host);
        log(call.module, v, status, ms);
        return { ok: false, error: "rate", status, retryAt };
      }
      if (isQuota(status, json)) {
        answered(h, trial, ms);
        const retryAt = nextPacificMidnight(t);
        pause(limitKey, "quota", retryAt, v.host);
        log(call.module, v, status, ms);
        return { ok: false, error: "quota", status, retryAt };
      }
      log(call.module, v, status, ms);
      if (status >= 500) {
        failed(h, trial);
        if (status === 502 || status === 503 || status === 504) {
          const wait = canRetry();
          if (wait !== null) { await sleep(wait); continue; }
        }
      } else {
        answered(h, trial, ms);
        // pause préventive : le fournisseur annonce qu'il ne reste plus aucune demande avant la remise à zéro
        const c = combined(raw.headers);
        const remaining = raw.headers["ratelimit-remaining"] ?? raw.headers["x-ratelimit-remaining"] ?? (c.remaining !== undefined ? String(c.remaining) : undefined);
        if (remaining !== undefined && Number(remaining.trim()) === 0) {
          const reset = resetFromHeaders(raw.headers, t);
          if (reset !== null && reset > t) pause(limitKey, "rate", Math.min(t + L.maxPauseMs, reset), v.host);
        }
      }
      const out: NetResult = { ok: true, status, headers: raw.headers, shared: false };
      if (json !== undefined) out.json = json;
      else if (text !== undefined) out.text = text;
      return out;
    }
  }

  async function lead(v: Valid, call: NetCallContext, deadline: number, limitKey: string): Promise<NetResult> {
    const h = hostOf(v.host);
    if (h.admitted >= L.perHostAdmitted || admittedTotal >= L.totalAdmitted) {
      logQuietly(`b:${v.host}`, call.module, v, "busy");
      return { ok: false, error: "busy" };
    }
    h.admitted++;
    admittedTotal++;
    try {
      if (!(await acquire(h, v.priority, deadline))) { log(call.module, v, "timeout", 0); return { ok: false, error: "timeout" }; }
      try { return await attempts(v, call, deadline, limitKey); } finally { release(h); }
    } finally {
      h.admitted--;
      admittedTotal--;
    }
  }

  async function run(req: NetRequest, call: NetCallContext): Promise<NetResult> {
    const v = validate(req, L);
    if (!v) return { ok: false, error: "invalid" };
    const start = now();
    const budget = typeof call.budgetMs === "number" && Number.isFinite(call.budgetMs) ? call.budgetMs : null;
    const ms = budget === null ? v.timeoutMs : Math.min(v.timeoutMs, budget);
    if (ms <= 0) return { ok: false, error: "timeout" };
    const deadline = start + ms;
    const limitKey = v.bucket ? `b:${sha(v.bucket, 16)}` : `h:${v.host}`;
    const limit = activeLimit(limitKey);
    if (limit) { logQuietly(`l:${limitKey}`, call.module, v, limit.kind); return { ok: false, error: limit.kind, retryAt: limit.until }; }
    const refused = circuitRefusal(hostOf(v.host));
    if (refused) { logQuietly(`c:${v.host}`, call.module, v, "circuit"); return refused; }
    if (!v.dedupe) return lead(v, call, deadline, limitKey);

    const key = sha(JSON.stringify([v.method, v.url.href, Object.entries(v.headers).sort(), v.bucket ?? "", v.maxBytes]));
    const existing = inflight.get(key);
    if (existing && existing.expires > now()) {
      const r = await untilDeadline(existing.promise, deadline, now).catch((): NetResult => ({ ok: false, error: "network" }));
      if (r === TIMEOUT) return { ok: false, error: "timeout" };
      // copie pour chaque suiveur : un module qui modifie sa réponse ne touche pas celle d'un autre
      return r.ok ? { ...r, headers: { ...r.headers }, ...(r.json !== undefined ? { json: structuredClone(r.json) } : {}), shared: true } : { ...r };
    }
    if (existing) inflight.delete(key);
    const promise = lead(v, call, deadline, limitKey);
    const entry = { promise, expires: deadline + 1000 };
    inflight.set(key, entry);
    for (const [k, e] of inflight) { if (inflight.size <= L.maxEntries) break; if (e.expires <= now()) inflight.delete(k); }
    try {
      const r = await promise;
      return r.ok ? { ...r, ...(r.json !== undefined ? { json: structuredClone(r.json) } : {}) } : r;
    } finally {
      if (inflight.get(key) === entry) inflight.delete(key);
    }
  }

  const hostHealth = (name: string): NetHealthItem | null => {
    const h = hosts.get(name.toLowerCase());
    let lim: Limit | null = null;
    const t = now();
    for (const l of limits.values()) if (l.host === name.toLowerCase() && l.until > t && (!lim || (l.kind === "quota" && lim.kind !== "quota") || (l.kind === lim.kind && l.until > lim.until))) lim = l;
    if (lim) return { host: lim.host, state: lim.kind, since: lim.since, retryAt: lim.until };
    if (!h || h.outcome === null) return null;
    if (h.openUntil > t || h.trial) return { host: name.toLowerCase(), state: "down", since: h.since, retryAt: h.openUntil > t ? h.openUntil : undefined };
    return { host: name.toLowerCase(), state: h.outcome, since: h.since };
  };

  return {
    async request(req, call = {}) {
      try { return await run(req, call); } catch { return { ok: false, error: "network" }; }
    },
    health() {
      const names = new Set<string>([...hosts.keys(), ...[...limits.values()].map((l) => l.host)]);
      return [...names].map(hostHealth).filter((x): x is NetHealthItem => x !== null);
    },
    hostHealth,
  };
}

// Sur `globalThis` : Next peut charger ce fichier dans plusieurs paquets ; le disjoncteur et les pauses doivent être UNS pour tout le processus.
const holder = globalThis as unknown as { curiosaNet?: NetClient };
/** Le client du processus, partagé par tous les modules. */
export function sharedNet(): NetClient { return (holder.curiosaNet ??= createNetClient()); }
/** Pour les tests : oublie tout l'état (pauses, disjoncteurs, santé). */
export function resetSharedNet(): void { delete holder.curiosaNet; }
