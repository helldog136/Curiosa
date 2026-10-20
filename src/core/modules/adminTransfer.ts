/**
 * Téléchargements et champ fichier de l'ADMINISTRATION des modules (contrat 8) : les briques pures et bornées, sans accès à la base ni à Next.
 * - un fichier produit par un générateur est servi par MORCEAUX (jamais construit en entier), avec des limites dures (octets, durée, silence du générateur) ;
 * - un envoi de fichier est lu AVEC UNE BORNE (le flux est compté et coupé), puis décodé en UTF-8 strict.
 * Les décisions d'accès et l'audit sont dans adminTransferHandlers.ts.
 */
import { actionRight } from "@/core/auth/rights";
import { can, hasRole, type AdminUser } from "@/core/auth/access";
import type { AdminDownloadSpec, ModuleDefinition } from "./types";

// ── Limites ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DownloadLimits = {
  /** Octets au plus dans un fichier (au-delà le flux est coupé). */
  maxBytes: number;
  /** Durée totale au plus (ms). */
  maxMs: number;
  /** Silence au plus du générateur entre deux morceaux (ms) : un générateur « trou noir » est coupé. */
  idleMs: number;
  /** Taille au plus d'un morceau envoyé au navigateur. */
  chunkBytes: number;
  /** Téléchargements en même temps, par personne et au total. */
  perUser: number;
  global: number;
};
export const DOWNLOAD_LIMITS: DownloadLimits = { maxBytes: 512 * 1024 * 1024, maxMs: 10 * 60_000, idleMs: 60_000, chunkBytes: 1024 * 1024, perUser: 2, global: 4 };

/** Un champ fichier : 5 Mo au plus, quoi qu'en dise le formulaire. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Place laissée aux champs texte et à l'enveloppe multipart autour du fichier. */
export const FORM_OVERHEAD_BYTES = 256 * 1024;
/** Corps d'une demande de téléchargement (paramètres seulement). */
export const MAX_PARAMS_BYTES = 16 * 1024;

// ── Nom de fichier ────────────────────────────────────────────────────────────────────────────────────────────────────

const EXT: Record<AdminDownloadSpec["contentType"], string[]> = { "text/csv": [".csv"], "application/json": [".json"], "text/plain": [".txt"] };
const DEFAULT_EXT: Record<AdminDownloadSpec["contentType"], string> = { "text/csv": ".csv", "application/json": ".json", "text/plain": ".txt" };
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Nom de fichier sûr, tiré d'un texte quelconque (souvent construit à partir de données saisies) : pas de chemin, pas de caractère de contrôle, de guillemet,
 * de retour à la ligne ni de caractère qui inverse le sens d'écriture, pas de nom réservé de Windows, 100 caractères au plus, et TOUJOURS l'extension du type
 * (« rapport.exe » devient « rapport.exe.csv » : le fichier ne se fait jamais passer pour un programme ou une page web).
 */
export function sanitizeFilename(raw: unknown, contentType: AdminDownloadSpec["contentType"] = "text/plain", fallback = "export"): string {
  let s = typeof raw === "string" ? raw : "";
  try { s = s.normalize("NFC"); } catch { /* texte mal formé : on continue avec la valeur brute */ }
  s = s
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g, "") // espaces de largeur nulle, inversions du sens d'écriture
    .replace(/[\\/:*?"<>|%;,`'$&!#{}[\]=+~^]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/_{2,}/g, "_").replace(/^[.\s_-]+/, "").replace(/[.\s]+$/, "");
  const exts = EXT[contentType] ?? [".txt"];
  const dot = s.lastIndexOf(".");
  const ext = dot > 0 ? s.slice(dot).toLowerCase() : "";
  let base = exts.includes(ext) ? s.slice(0, dot) : s;
  base = base.replace(/\.+$/, "").trim();
  if (base.length > 100) base = base.slice(0, 100).trim();
  if (!base || WINDOWS_RESERVED.test(base)) base = base ? `_${base}` : fallback;
  return base + (DEFAULT_EXT[contentType] ?? ".txt");
}

/** En-tête `Content-Disposition` : toujours « attachment » ; version ASCII pour les vieux navigateurs, version UTF-8 (RFC 5987) pour les autres. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ── Droit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DownloadDecision = { spec: AdminDownloadSpec } | { denied: string } | null;

/**
 * Qui peut télécharger (décision pure, la personne est celle relue en base à cette requête) : `<module>:open` ET le droit déclaré
 * (préfixe imposé : le droit d'un autre module ou un identifiant invalide est toujours refusé) ; sans `right`, administrateurs seulement.
 * `null` : pas de téléchargement de ce nom.
 */
export function decideDownload(user: AdminUser | null, moduleId: string, downloads: ModuleDefinition["adminDownloads"], name: string): DownloadDecision {
  const spec = downloads && Object.hasOwn(downloads, name) ? downloads[name] : undefined;
  if (!spec || typeof spec !== "object" || typeof spec.generate !== "function" || typeof spec.filename !== "function") return null;
  if (!Object.hasOwn(EXT, spec.contentType)) return { denied: `module:${moduleId}:download.${name}` };
  if (spec.right === undefined) return hasRole(user, "admin") && can(user, `${moduleId}:open`) ? { spec } : { denied: `module:${moduleId}:download.${name}` };
  const right = actionRight(moduleId, spec.right);
  if (right && can(user, `${moduleId}:open`) && can(user, right)) return { spec };
  return { denied: right ?? `module:${moduleId}:download.${name}` };
}

/** Faut-il MONTRER le bouton « Télécharger » à cette personne ? Oui seulement si la route le lui permettrait (même décision). */
export function canShowDownload(user: AdminUser | null, moduleId: string, downloads: ModuleDefinition["adminDownloads"], name: string): boolean {
  const decision = decideDownload(user, moduleId, downloads, name);
  return !!decision && "spec" in decision;
}

// ── Téléchargements simultanés ────────────────────────────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __curiosaDownloads?: { byUser: Map<string, number>; total: number } };
const state = (g.__curiosaDownloads ??= { byUser: new Map(), total: 0 });

/** Réserve une place de téléchargement ; renvoie sa libération (à appeler une seule fois, sans danger si répétée), ou null si la personne (ou le site) en a déjà trop. */
export function claimDownloadSlot(userId: string, limits: Pick<DownloadLimits, "perUser" | "global"> = DOWNLOAD_LIMITS): (() => void) | null {
  const mine = state.byUser.get(userId) ?? 0;
  if (mine >= limits.perUser || state.total >= limits.global) return null;
  state.byUser.set(userId, mine + 1);
  state.total += 1;
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    state.total = Math.max(0, state.total - 1);
    const n = (state.byUser.get(userId) ?? 1) - 1;
    if (n <= 0) state.byUser.delete(userId); else state.byUser.set(userId, n);
  };
}
/** Pour les tests. */
export function downloadSlotsInUse(): number { return state.total; }

// ── Flux ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DownloadEnd = { bytes: number; reason: "done" | "client" | "bytes" | "time" | "idle" | "error"; error?: string };

const enc = new TextEncoder();

/** Attend `p` au plus `ms` ; sinon rejette avec `reason`. Le minuteur est toujours libéré. */
function within<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(reason)), Math.max(1, ms)); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
const TICK = Symbol("tick");
/** Un seul « tour de boucle » par tirage (jamais un par morceau : des milliers de minuteurs en attente grossiraient la mémoire). */
function oneTick(): { promise: Promise<typeof TICK>; stop(): void } {
  let handle: ReturnType<typeof setImmediate>;
  const promise = new Promise<typeof TICK>((r) => { handle = setImmediate(() => r(TICK)); });
  return { promise, stop: () => clearImmediate(handle) };
}

type Ended = Error & { end?: DownloadEnd["reason"] };

/**
 * Transforme un générateur de texte en flux d'octets, TIRÉ à la demande du client (un client lent ne fait jamais grossir la mémoire : rien n'est produit
 * d'avance au-delà du morceau en cours). Morceaux de `chunkBytes` au plus ; les petits morceaux déjà prêts sont regroupés (64 Ko), mais on n'attend jamais le suivant
 * pour envoyer ce qu'on a. Le flux est COUPÉ EN ERREUR (le navigateur affiche « échec » au lieu d'un fichier tronqué qui aurait l'air complet) quand :
 * le fichier dépasse `maxBytes` ; la durée `maxMs` est écoulée ; le générateur reste muet `idleMs` ; le générateur lève une erreur ; un morceau n'est pas du texte.
 * Si le client coupe (`cancel`, ou `signal`), le générateur est fermé (`return()`, sans jamais l'attendre : un générateur bloqué ne retient rien).
 * `onEnd` est appelé UNE fois, quelle que soit la fin.
 */
export function streamGenerator(source: AsyncIterable<string>, opts: { limits?: Partial<DownloadLimits>; signal?: AbortSignal; onEnd?: (end: DownloadEnd) => void } = {}): ReadableStream<Uint8Array> {
  const limits = { ...DOWNLOAD_LIMITS, ...opts.limits };
  const it = source[Symbol.asyncIterator]();
  const started = Date.now();
  let bytes = 0;
  let pending: Uint8Array | null = null;
  let ended = false;
  let finished = false;
  let failure: Ended | null = null;
  let inflight: Promise<IteratorResult<string>> | null = null;
  const COALESCE = 64 * 1024;
  const nextStep = () => {
    if (!inflight) { inflight = it.next(); inflight.catch(() => {}); } // une erreur est traitée quand on l'attend ; jamais « non gérée »
    return inflight;
  };

  const finish = (reason: DownloadEnd["reason"], error?: string) => {
    if (ended) return;
    ended = true;
    opts.signal?.removeEventListener("abort", onAbort);
    try { void Promise.resolve(it.return?.()).catch(() => {}); } catch { /* déjà fermé */ }
    opts.onEnd?.({ bytes, reason, ...(error ? { error } : {}) });
  };
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  function onAbort() {
    if (ended) return;
    finish("client");
    try { controllerRef?.error(new Error("client")); } catch { /* flux déjà fermé */ }
  }
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.signal?.aborted) queueMicrotask(onAbort);

  return new ReadableStream<Uint8Array>({
    start(controller) { controllerRef = controller; },
    async pull(controller) {
      if (ended) return;
      try {
        // Un reste d'un morceau trop gros, ou une erreur survenue après des morceaux déjà prêts, passe d'abord.
        if (pending) {
          const part = pending.subarray(0, limits.chunkBytes);
          pending = pending.length > part.length ? pending.subarray(part.length) : null;
          controller.enqueue(part);
          return;
        }
        if (failure) throw failure;
        if (finished) { finish("done"); controller.close(); return; }
        const out: Uint8Array[] = [];
        let size = 0;
        const turn = oneTick();
        try {
          for (;;) {
            const left = limits.maxMs - (Date.now() - started);
            if (left <= 0) throw Object.assign(new Error("time"), { end: "time" });
            let step: IteratorResult<string>;
            if (out.length === 0) {
              const idle = left <= limits.idleMs ? "time" : "idle";
              try { step = await within(nextStep(), Math.min(left, limits.idleMs), idle); } catch (e) { const m = (e as Error).message; throw m === "time" || m === "idle" ? Object.assign(e as Error, { end: m }) : e; }
            } else {
              const r = await Promise.race([nextStep(), turn.promise]);
              if (r === TICK) break; // le morceau suivant n'est pas prêt : on envoie ce qu'on a
              step = r;
            }
            inflight = null;
            if (step.done) { finished = true; break; }
            if (typeof step.value !== "string") throw Object.assign(new Error("not-text"), { end: "error" });
            if (step.value === "") continue;
            const piece = enc.encode(step.value);
            if (bytes + size + piece.length > limits.maxBytes) throw Object.assign(new Error("bytes"), { end: "bytes" });
            out.push(piece);
            size += piece.length;
            if (size >= COALESCE) break;
          }
        } catch (e) {
          inflight = null;
          if (!out.length) throw e;
          failure = e as Ended; // on envoie d'abord ce qui est prêt, l'erreur suit au prochain tirage
        } finally {
          turn.stop();
        }
        if (size === 0) { finish("done"); controller.close(); return; }
        const all = out.length === 1 ? out[0]! : (() => { const b = new Uint8Array(size); let o = 0; for (const p of out) { b.set(p, o); o += p.length; } return b; })();
        bytes += all.length;
        const first = all.subarray(0, limits.chunkBytes);
        pending = all.length > first.length ? all.subarray(first.length) : null;
        controller.enqueue(first);
      } catch (e) {
        const end = (e as Ended).end ?? "error";
        finish(end, end === "error" ? String((e as Error)?.message ?? e).slice(0, 200) : undefined);
        try { controller.error(e); } catch { /* flux déjà fermé */ }
      }
    },
    cancel() { finish("client"); },
  }, { highWaterMark: 0 });
}

// ── Lecture bornée d'un envoi ─────────────────────────────────────────────────────────────────────────────────────────

export class BodyTooLarge extends Error {
  max: number;
  constructor(max: number) { super("too-large"); this.max = max; }
}

/**
 * Lit le corps d'une requête EN LE COMPTANT : dès qu'il dépasse `max` octets, la lecture s'arrête et le flux est annulé (jamais lu en entier). Un `content-length`
 * déjà trop grand est refusé sans rien lire. `idleMs` : un client qui n'envoie plus rien est abandonné (lecture lente).
 */
export async function readBodyBounded(request: Request, max: number, opts: { idleMs?: number; totalMs?: number } = {}): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) { try { await request.body?.cancel(); } catch { /* ignoré */ } throw new BodyTooLarge(max); }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const idle = opts.idleMs ?? 20_000;
  const deadline = Date.now() + (opts.totalMs ?? 60_000);
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("slow");
      const { done, value } = await within(reader.read(), Math.min(idle, left), "slow");
      if (done) break;
      total += value.length;
      if (total > max) throw new BodyTooLarge(max);
      chunks.push(value);
    }
  } catch (e) {
    void reader.cancel().catch(() => {}); // sans l'attendre : un client muet ne doit rien retenir
    throw e;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ── Fichier texte ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type FileProblem = "empty" | "too-large" | "type" | "binary" | "encoding";
export type FileResult = { ok: true; text: string } | { ok: false; problem: FileProblem };

const TEXT_EXT = new Set([".csv", ".tsv", ".txt", ".json", ".vcf", ".ics", ".md"]);
const TEXT_MIME = /^(text\/[a-z0-9.+-]+|application\/(json|csv|vnd\.ms-excel|x-csv|vcard)|text\/x-vcard)$/i;

/** Extensions d'un attribut `accept` (« .csv,.txt,text/csv »), en minuscules ; vide = pas de restriction supplémentaire. */
function acceptList(accept: string | undefined): string[] {
  return String(accept ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x && x.length <= 60);
}

/**
 * Contrôle un fichier reçu et le lit en texte : taille (`maxBytes`, 5 Mo au plus), type (extension de texte connue OU type MIME de texte ; un `accept` ne fait que
 * RESTREINDRE), pas d'octet nul (binaire), UTF-8 STRICT (un octet invalide est refusé, jamais remplacé en silence), BOM retiré. Le résultat est borné par `maxBytes`.
 */
export function readTextFile(file: { name: string; type: string; bytes: Uint8Array }, opts: { maxBytes?: number; accept?: string } = {}): FileResult {
  const max = Math.min(Math.max(1, Math.floor(opts.maxBytes ?? MAX_FILE_BYTES)), MAX_FILE_BYTES);
  if (file.bytes.length === 0) return { ok: false, problem: "empty" };
  if (file.bytes.length > max) return { ok: false, problem: "too-large" };
  const name = String(file.name ?? "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  const mime = String(file.type ?? "").split(";")[0]!.trim().toLowerCase();
  // Une extension, quand il y en a une, doit être celle d'un texte (« liste.exe » n'est jamais accepté, même annoncé « text/csv ») ; sans extension, le type MIME décide.
  const textual = ext ? TEXT_EXT.has(ext) : TEXT_MIME.test(mime);
  if (!textual) return { ok: false, problem: "type" };
  const accepted = acceptList(opts.accept);
  if (accepted.length && !accepted.some((a) => (a.startsWith(".") ? a === ext : a.endsWith("/*") ? mime.startsWith(a.slice(0, -1)) : a === mime))) return { ok: false, problem: "type" };
  if (file.bytes.includes(0)) return { ok: false, problem: "binary" };
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes); } catch { return { ok: false, problem: "encoding" }; }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { ok: true, text };
}

/** Le champ `name` est-il un champ fichier d'un formulaire d'admin ? (les champs `$max_<nom>` et `$accept_<nom>` sont des indications de l'interface, jamais des droits.) */
export const FILE_META = { max: (name: string) => `$max_${name}`, accept: (name: string) => `$accept_${name}` };
