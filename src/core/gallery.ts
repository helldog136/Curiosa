import { AUDIO_URL_RE } from "@/core/audioTypes";
import { MAX_AUDIO_BYTES, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES } from "@/core/uploadLimits";
import { FORMATS, LIMITS as COMPOSE_LIMITS, canonicalComposition, checkComposition, type ComposeFormat, type Composition } from "@/core/compose/model";

/**
 * Field `kind: "gallery"` of an `adminForm` (core 0.14.0): an ordered list of files sent to the site (pure, no disk, no server: safe in client code, in the form
 * action and in tests).
 *
 * The value the module receives in `values[name]` is a JSON text, canonical, rebuilt by the core from the posted value:
 *   `[{"src":"/uploads/<uuid>.<ext>","label":"Caption"}, …]`   (`label` only when the person wrote one, 120 characters at most)
 * The same text is what the module gives as `value` to show the items already saved (an array of strings or of `{ src, label }` is read too).
 * An address is one of the core's own uploads, of a kind the field accepts: external addresses, `?…` crops, other folders and `..` are refused.
 */
export const GALLERY_KINDS = ["image", "video", "audio"] as const;
export type GalleryKind = (typeof GALLERY_KINDS)[number];
/** `compose` (core 0.19.0): the text placed on this file (a checked composition), only in a field that declares the `compose` option. */
export type GalleryItem = { src: string; label?: string; compose?: Composition };
/** An item of the optional "already on the site" list (`library`): a name, an address and its kind. */
export type GalleryChoice = { label: string; value: string; kind: GalleryKind };

export const GALLERY_DEFAULT_MAX = 12;
/** Whatever a module asks for, a gallery never holds more than this (the value must fit in the 20 000 characters the core reads per field). */
export const GALLERY_HARD_MAX = 60;
export const GALLERY_LABEL_MAX = 120;
/** At most this many entries of `library` are read (the picker has a search box, but the page stays light). */
export const GALLERY_LIBRARY_MAX = 500;
/** Name of the hidden field that tells the server which rules to re-check: `<name>__gallery` = `<kinds>|<max>|<min>`. */
export const GALLERY_MARK = "__gallery";

/** One address shape per kind, the same as single `image` / `audio` fields (no query, no crop). */
export const GALLERY_URL_RE: Record<GalleryKind, RegExp> = {
  image: /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/,
  video: /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/,
  audio: AUDIO_URL_RE,
};
/** The largest file of each kind, in bytes (same caps as the single upload fields). */
export const GALLERY_MAX_BYTES: Record<GalleryKind, number> = { image: MAX_UPLOAD_BYTES, video: MAX_VIDEO_BYTES, audio: MAX_AUDIO_BYTES };
/** File extensions the picker offers, per kind (the server re-checks the bytes). */
export const GALLERY_EXTENSIONS: Record<GalleryKind, readonly string[]> = { image: ["png", "jpg", "jpeg", "webp", "gif"], video: ["mp4", "webm"], audio: ["mp3", "ogg", "wav", "m4a", "aac"] };

export const galleryKindOf = (src: unknown): GalleryKind | null => (typeof src === "string" ? GALLERY_KINDS.find((k) => GALLERY_URL_RE[k].test(src)) ?? null : null);

/** The kinds a field accepts: the listed ones, in a fixed order, without duplicates; absent or empty: images only. Unknown names are ignored. */
export function galleryAccept(accept: unknown): GalleryKind[] {
  const list = Array.isArray(accept) ? accept : typeof accept === "string" ? accept.split(",") : [];
  const picked = GALLERY_KINDS.filter((k) => list.some((x) => typeof x === "string" && x.trim() === k));
  return picked.length ? picked : ["image"];
}
/** The maximum number of items: an integer from 1 to `GALLERY_HARD_MAX`, 12 by default. */
export function galleryMax(max: unknown): number {
  const n = typeof max === "number" ? max : typeof max === "string" ? Number(max) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, GALLERY_HARD_MAX) : GALLERY_DEFAULT_MAX;
}
/** The minimum number of items: an integer from 0 up to the maximum, 0 by default. */
export function galleryMin(min: unknown, max: number): number {
  const n = typeof min === "number" ? min : typeof min === "string" ? Number(min) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : 0;
}

const cleanLabel = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, GALLERY_LABEL_MAX);
  return t === "" ? undefined : t;
};

export type GalleryProblem =
  /** Not a list the field can read. */
  | "format"
  /** An address that is not one of the site's uploads of an accepted kind (external address, crop, other folder…). */
  | "address"
  /** More items than `max`. */
  | "many"
  /** Fewer items than `min`. */
  | "few"
  /** (0.19.0) The placed text of an item is not valid (see `compose/model.ts`); `index` says which item. */
  | "compose";
export type GalleryRead = { ok: true; items: GalleryItem[] } | { ok: false; reason: GalleryProblem; index?: number };

/**
 * (core 0.19.0) The `compose` option of a gallery: "Place the text" on its pictures. The automatic values a text may use (shown as chips, never braces),
 * the formats offered, the number of text boxes, and the module action "Test on the overlay" calls. The server checks every composition again.
 */
export type ComposeRules = { variables: string[]; maxBoxes: number; formats: ComposeFormat[] };
/** A gallery that places text holds at most this many files (12 compositions of 4 KB fit in the 64 000 characters such a field may post). */
export const COMPOSE_GALLERY_MAX = 12;
/** The posted length of a gallery field that places text (other fields keep 20 000). */
export const COMPOSE_FIELD_MAX = 64_000;
export const FIELD_MAX = 20_000;
/** Read by the module after the check: "1" when the field could place text (so an item without `compose` means "no text" and not "older core"). */
export const COMPOSE_MARK = "__compose";
const TOKEN = /^[a-z][a-zA-Z0-9_]{0,23}$/;
/** The rules of a `compose` option as the core keeps them (unknown or bad parts dropped). Null: no option. */
export function composeRules(raw: unknown): ComposeRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as { variables?: unknown; maxBoxes?: unknown; formats?: unknown };
  const variables = (Array.isArray(o.variables) ? o.variables : []).map((v) => (v && typeof v === "object" ? (v as { token?: unknown }).token : v)).filter((t): t is string => typeof t === "string" && TOKEN.test(t)).slice(0, COMPOSE_LIMITS.variables);
  const n = Number(o.maxBoxes);
  const formats = (Array.isArray(o.formats) ? o.formats : []).filter((f): f is ComposeFormat => (FORMATS as readonly unknown[]).includes(f));
  return { variables: [...new Set(variables)], maxBoxes: Number.isInteger(n) && n >= 1 ? Math.min(n, COMPOSE_LIMITS.boxes) : COMPOSE_LIMITS.boxes, formats: formats.length ? [...new Set(formats)] : [...FORMATS] };
}
const composeMarkText = (r: ComposeRules) => `compose:${r.variables.join(",")};${r.maxBoxes};${r.formats.join(",")}`;
function parseComposeMark(text: string | undefined): ComposeRules | null {
  if (!text?.startsWith("compose:")) return null;
  const [vars = "", boxes = "", formats = ""] = text.slice(8).split(";");
  return composeRules({ variables: vars.split(",").filter(Boolean), maxBoxes: Number(boxes), formats: formats.split(",").filter(Boolean) });
}

/**
 * Reads a gallery value (a JSON text, an array, or addresses one per line) and checks every address against the accepted kinds. Duplicated addresses are kept once (first
 * place). An empty value is an empty list. Never throws.
 */
export function readGallery(raw: unknown, opts: { accept?: unknown; max?: unknown; min?: unknown; compose?: ComposeRules | null } = {}): GalleryRead {
  const accept = galleryAccept(opts.accept);
  const max = galleryMax(opts.max);
  const min = galleryMin(opts.min, max);
  let list: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") list = [];
    else if (text.startsWith("[") || text.startsWith("{")) { try { list = JSON.parse(text); } catch { return { ok: false, reason: "format" }; } }
    else list = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  if (!Array.isArray(list)) return { ok: false, reason: "format" };
  const items: GalleryItem[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const src = typeof entry === "string" ? entry : entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as { src?: unknown }).src : undefined;
    if (typeof src !== "string") return { ok: false, reason: "format" };
    const kind = galleryKindOf(src);
    if (!kind || !accept.includes(kind)) return { ok: false, reason: "address" };
    if (seen.has(src)) continue;
    seen.add(src);
    const label = typeof entry === "object" ? cleanLabel((entry as { label?: unknown }).label) : undefined;
    const item: GalleryItem = label === undefined ? { src } : { src, label };
    // A placed text is kept only in a field that declares `compose`, and only when it checks out for THIS file (elsewhere it is dropped, as before 0.19.0).
    const placed = typeof entry === "object" ? (entry as { compose?: unknown }).compose : undefined;
    if (opts.compose && placed !== undefined && placed !== null) {
      const c = checkComposition(placed, { src, variables: opts.compose.variables, maxBoxes: opts.compose.maxBoxes, formats: opts.compose.formats });
      if (!c.ok) return { ok: false, reason: "compose", index: items.length };
      item.compose = c.value;
    }
    items.push(item);
    if (items.length > max) return { ok: false, reason: "many" };
  }
  if (items.length < min) return { ok: false, reason: "few" };
  return { ok: true, items };
}

/** The canonical text a module receives (and gives back as `value`). */
export const writeGallery = (items: readonly GalleryItem[]): string =>
  `[${items.map((i) => { const head = JSON.stringify(i.label ? { src: i.src, label: i.label } : { src: i.src }); return i.compose ? `${head.slice(0, -1)},"compose":${canonicalComposition(i.compose)}}` : head; }).join(",")}]`;

/** The entries of `library` the core accepts: a name, an address of an accepted kind. The rest is dropped; at most `GALLERY_LIBRARY_MAX`. */
export function galleryLibrary(raw: unknown, accept: unknown): GalleryChoice[] {
  if (!Array.isArray(raw)) return [];
  const kinds = galleryAccept(accept);
  const out: GalleryChoice[] = [];
  for (const c of raw) {
    if (out.length >= GALLERY_LIBRARY_MAX) break;
    if (!c || typeof c !== "object") continue;
    const { label, value } = c as { label?: unknown; value?: unknown };
    const kind = galleryKindOf(value);
    const text = cleanLabel(label);
    if (typeof value === "string" && kind && kinds.includes(kind) && text) out.push({ label: text, value, kind });
  }
  return out;
}

/** The text of the hidden `<name>__gallery` field, and its reading. */
export const galleryMark = (accept: unknown, max: unknown, min: unknown, compose?: ComposeRules | null): string => {
  const m = compose ? Math.min(galleryMax(max), COMPOSE_GALLERY_MAX) : galleryMax(max);
  return `${galleryAccept(accept).join(",")}|${m}|${galleryMin(min, m)}${compose ? `|${composeMarkText(compose)}` : ""}`;
};
export function parseGalleryMark(text: string): { accept: GalleryKind[]; max: number; min: number; compose?: ComposeRules } {
  const [kinds = "", max = "", min = "", compose] = text.split("|");
  const rules = parseComposeMark(compose);
  const m = rules ? Math.min(galleryMax(max), COMPOSE_GALLERY_MAX) : galleryMax(max);
  return { accept: galleryAccept(kinds), max: m, min: galleryMin(min, m), ...(rules ? { compose: rules } : {}) };
}

/**
 * The text values of a posted form, each cut at 20 000 characters, except a gallery that places text (its mark says `compose:`): 64 000 (core 0.19.0).
 * Internal fields of React (`$ACTION…`) are left out.
 */
export function boundFormValues(entries: Iterable<[string, FormDataEntryValue | string]>): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [k, v] of entries) if (typeof v === "string" && !k.startsWith("$ACTION")) raw[k] = v;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const mark = raw[`${k}${GALLERY_MARK}`];
    values[k] = v.slice(0, mark !== undefined && parseGalleryMark(mark).compose ? COMPOSE_FIELD_MAX : FIELD_MAX);
  }
  return values;
}

/**
 * Checks (and rewrites in canonical form) every gallery value of a posted form: a field is a gallery when the form also posted `<name>__gallery`. Removes those marks from
 * `values`. Returns the problems by field name (`key` is a text key of the locale files; `max` and `min` fill its `{max}` / `{min}`). A form that does not post the mark
 * is not checked here: the module must still check what it keeps (`ctx.api.files.claim` refuses anything that is not an upload the person sent).
 */
export function checkGalleryValues(values: Record<string, string>): Record<string, { key: string; vars: { max: number; min: number; n?: number } }> {
  const problems: Record<string, { key: string; vars: { max: number; min: number; n?: number } }> = {};
  for (const mark of Object.keys(values)) {
    if (!mark.endsWith(GALLERY_MARK) || mark.length === GALLERY_MARK.length) continue;
    const name = mark.slice(0, -GALLERY_MARK.length);
    const rules = parseGalleryMark(values[mark] ?? "");
    delete values[mark];
    delete values[`${name}${COMPOSE_MARK}`];
    const read = readGallery(values[name] ?? "", rules);
    if (read.ok) { values[name] = writeGallery(read.items); if (rules.compose) values[`${name}${COMPOSE_MARK}`] = "1"; }
    else problems[name] = { key: `gallery.error.${read.reason}`, vars: { max: rules.max, min: rules.min, ...(read.index !== undefined ? { n: read.index + 1 } : {}) } };
  }
  return problems;
}
