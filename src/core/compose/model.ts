/**
 * COMPOSITION OF AN ALERT (core 0.19.0; videos 0.21.0): a backdrop (a picture, a GIF or a video) and 1 to 4 text boxes placed on it, in percent of the frame. Pure: no
 * database, no Next, no browser. The same checker serves the editor (client), the form action (server), the modules (through `ctx.overlay`) and, later, the
 * assistant tools, so every caller refuses the same things with the same codes.
 *
 * The data is closed and bounded: every value comes from a list or has bounds, and an unknown key is refused. A composition describes a PLACEMENT, not a
 * content: a box shows the sentence of the reaction (`content.kind: "phrase"`) unless the person wrote a text of their own, where automatic values are kept as
 * `{token}` (the format the modules already fill). People never see the braces: the editor shows chips ("Pseudo", "Montant").
 *
 * Sizes are in px of a frame 1080 px high (the TV unit of the core, textScale.ts), positions in percent of the frame: the result depends neither on the file
 * resolution, nor on the size of the overlay element.
 */
import { TV_MIN_TEXT_PX } from "@/core/overlays/textScale";
import { ANCHORS } from "@/core/overlays/layout";

export const COMPOSE_VERSION = 1;
export const FORMATS = ["16:9", "9:16", "1:1", "4:3", "21:9", "media"] as const;
export type ComposeFormat = (typeof FORMATS)[number];
/** Width / height of each fixed format ("media" takes the file's own shape). */
export const FORMAT_RATIO: Record<Exclude<ComposeFormat, "media">, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "21:9": 21 / 9 };
export const FITS = ["cover", "contain"] as const;
export const PLAYS = ["loop", "once", "hold"] as const;
export const DURATION_MODES = ["media", "fixed"] as const;
export const BOX_FITS = ["shrink", "wrap", "cut"] as const;
export const ALIGNS = ["start", "center", "end"] as const;
/** "skin": the font of the element's skin (or the system font). The 20 site fonts come later (step 5): the list only grows. */
export const FONTS = ["skin", "system", "system-serif", "system-rounded"] as const;
export const WEIGHTS = [400, 700] as const;
export const CASES = ["none", "upper"] as const;
/** "element": the readability preset of the overlay element that shows the alert (its tokens); the others are the same presets as the appearance kit, fixed by the box. */
export const LOOKS = ["element", "readable", "discreet", "bare", "custom"] as const;
export const OUTLINES = ["none", "thin", "thick"] as const;
export const ANIMS = ["none", "fade", "pop", "rise", "drop", "slideLeft", "slideRight"] as const;
export const GUIDES = ["title", "action", "none"] as const;
/** The text colours "auto" resolves to (measured in the editor, under the box). */
export const RESOLVED = ["#ffffff", "#111111"] as const;
export { ANCHORS };

export const LIMITS = {
  boxes: 4,
  stickers: 0,
  /** Text size, px of a 1080-high frame. */
  size: { min: TV_MIN_TEXT_PX, max: 220 },
  lines: { min: 1, max: 4 },
  /** A box is at least this wide and high (percent). */
  minBox: 4,
  custom: 120,
  /** A filled text (what the page receives) is cut here. */
  filled: 200,
  seconds: { min: 2, max: 60 },
  at: { min: 0, max: 60 },
  dur: { min: 0.1, max: 2 },
  opacity: { min: 0, max: 100, step: 5 },
  radius: { min: 0, max: 48 },
  /** The canonical JSON of one composition. */
  bytes: 4096,
  variables: 20,
} as const;
/** The text sizes the editor offers as buttons (M L XL XXL), px of a 1080 frame: the TV steps md, lg, xl, 2xl. */
export const SIZE_STEPS = [32, 40, 56, 72] as const;
/** Safe margins (percent of the frame) of the two guide kinds. */
export const SAFE_MARGIN: Record<(typeof GUIDES)[number], number> = { title: 5, action: 3.5, none: 0 };

export type Anim = { anim: (typeof ANIMS)[number]; at: number; dur: number };
export type OutAnim = { anim: (typeof ANIMS)[number]; at: number | null; dur: number };
export type BoxContent = { kind: "phrase" } | { kind: "custom"; text: string };
export type Box = {
  id: string;
  content: BoxContent;
  x: number; y: number; w: number; h: number;
  anchor: (typeof ANCHORS)[number];
  align: (typeof ALIGNS)[number];
  size: number;
  fit: (typeof BOX_FITS)[number];
  minSize: number;
  maxLines: number;
  font: (typeof FONTS)[number];
  weight: (typeof WEIGHTS)[number];
  case: (typeof CASES)[number];
  color: "auto" | string;
  /** What "auto" gave in the editor (measured under the box). Absent: the engine decides from the look. */
  resolved?: (typeof RESOLVED)[number];
  look: (typeof LOOKS)[number];
  pill?: { color: string; opacity: number; radius: number };
  outline: (typeof OUTLINES)[number];
  in: Anim;
  out: OutAnim;
};
export type Backdrop = { src: string; fit: (typeof FITS)[number]; focus: [number, number]; play?: (typeof PLAYS)[number]; sound?: boolean; poster?: string };
export type Composition = {
  v: 1;
  format: ComposeFormat;
  backdrop: Backdrop;
  duration?: { mode: (typeof DURATION_MODES)[number]; seconds: number };
  boxes: Box[];
  stickers: [];
  guides: (typeof GUIDES)[number];
};

/** What can go wrong, by path ("boxes[0].size"). The caller writes the sentence in its own words and language. */
export type ComposeCode = "json" | "format" | "version" | "unknown_key" | "range" | "choice" | "boxes" | "variable" | "file" | "size" | "required";
export type ComposeError = { path: string; code: ComposeCode; detail?: Record<string, string | number> };
export type ComposeCheck = { ok: true; value: Composition } | { ok: false; errors: ComposeError[] };
export type ComposeCheckOptions = {
  /** The automatic values this place knows (`name`, `amount`…): a `{token}` outside this list is refused. Absent: none are allowed. */
  variables?: readonly string[];
  /** The address of the file the composition belongs to: the backdrop must be this one. */
  src?: string;
  /** Fewer boxes than 4 (a field option). */
  maxBoxes?: number;
  /** The formats a field allows (subset). */
  formats?: readonly ComposeFormat[];
};

export const IMAGE_SRC = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
export const VIDEO_SRC = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9]{1,8}$/;
const TOKEN = /^[a-z][a-zA-Z0-9_]{0,23}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** The `{token}` words of a text. */
export const tokensOf = (text: string): string[] => [...String(text).matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!);
/** A text written by a person, cleaned: no control or direction characters, spaces reduced, bounded. */
export const cleanText = (v: unknown, max: number): string => String(v ?? "").normalize("NFKC").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** A new box, at the bottom centre inside the 5 % margin, 56 px TV, "like the element": the example the editor starts with. */
export function defaultBox(id = "t1", over: Partial<Box> = {}): Box {
  return {
    id, content: { kind: "phrase" }, x: 10, y: 73, w: 80, h: 22, anchor: "bc", align: "center", size: 56, fit: "shrink", minSize: 32, maxLines: 2,
    font: "skin", weight: 700, case: "none", color: "auto", look: "element", outline: "thin",
    in: { anim: "pop", at: 0.2, dur: 0.4 }, out: { anim: "fade", at: null, dur: 0.4 }, ...over,
  };
}
/** A new composition for a file: its own shape for a picture, one box with the sentence. */
export function defaultComposition(src: string, opts: { format?: ComposeFormat } = {}): Composition {
  return { v: 1, format: opts.format ?? "media", backdrop: { src, fit: "cover", focus: [50, 50] }, boxes: [defaultBox()], stickers: [], guides: "title" };
}

/** Ready-made placements (the "⋯" menu of the editor): a band at the bottom, a title at the top, very big in the centre. */
export const PLACEMENTS = {
  band: { x: 5, y: 76, w: 90, h: 19, anchor: "bc", align: "center", size: 56 },
  title: { x: 5, y: 5, w: 90, h: 19, anchor: "tc", align: "center", size: 56 },
  centre: { x: 8, y: 30, w: 84, h: 40, anchor: "c", align: "center", size: 120 },
} as const satisfies Record<string, Partial<Box>>;
export type PlacementId = keyof typeof PLACEMENTS;

/**
 * Checks a composition (an object, or its JSON text) and returns it in canonical form, or EVERY problem found (not only the first one: an assistant fixes all at once).
 * Missing optional keys take their defaults; unknown keys are refused. Never throws.
 */
export function checkComposition(raw: unknown, opts: ComposeCheckOptions = {}): ComposeCheck {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > LIMITS.bytes * 4) return { ok: false, errors: [{ path: "", code: "size", detail: { length: raw.length, max: LIMITS.bytes } }] };
    try { data = JSON.parse(raw); } catch { return { ok: false, errors: [{ path: "", code: "json" }] }; }
  }
  const errors: ComposeError[] = [];
  const fail = (path: string, code: ComposeCode, detail?: ComposeError["detail"]) => { errors.push(detail ? { path, code, detail } : { path, code }); };
  if (!isPlain(data)) return { ok: false, errors: [{ path: "", code: "format" }] };
  const known = (obj: Record<string, unknown>, path: string, keys: readonly string[]) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(path ? `${path}.${k}` : k, "unknown_key", { known: keys.join(", ") });
  };
  const choice = <T>(v: unknown, list: readonly T[], path: string, def: T): T => {
    if (v === undefined) return def;
    if ((list as readonly unknown[]).includes(v)) return v as T;
    fail(path, "choice", { allowed: list.join(", ") });
    return def;
  };
  const num = (v: unknown, path: string, min: number, max: number, def: number, round: (n: number) => number = r2, integer = false): number => {
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < min || v > max) { fail(path, "range", { min, max }); return def; }
    return round(v);
  };
  const obj = (v: unknown, path: string): Record<string, unknown> | null => {
    if (v === undefined) return null;
    if (!isPlain(v)) { fail(path, "format"); return null; }
    return v;
  };

  known(data, "", ["v", "format", "backdrop", "duration", "boxes", "stickers", "guides"]);
  if (data.v !== COMPOSE_VERSION) fail("v", "version", { expected: COMPOSE_VERSION });
  const formats = opts.formats?.length ? opts.formats : FORMATS;
  const format = choice(data.format, formats, "format", formats.includes("media") ? "media" : formats[0]!);

  // The backdrop: a file of the site, the one the composition belongs to.
  const b = obj(data.backdrop, "backdrop");
  let backdrop: Backdrop = { src: "", fit: "cover", focus: [50, 50] };
  let isVideo = false;
  if (!b) { if (data.backdrop === undefined) fail("backdrop", "required"); }
  else {
    known(b, "backdrop", ["src", "fit", "focus", "play", "sound", "poster"]);
    const src = typeof b.src === "string" ? b.src : "";
    const video = VIDEO_SRC.test(src);
    if (!src) fail("backdrop.src", "required");
    else if (!(IMAGE_SRC.test(src) || video) || (opts.src !== undefined && src !== opts.src)) fail("backdrop.src", "file");
    let focus: [number, number] = [50, 50];
    if (b.focus !== undefined) {
      if (!Array.isArray(b.focus) || b.focus.length !== 2) fail("backdrop.focus", "format");
      else focus = [num(b.focus[0], "backdrop.focus[0]", 0, 100, 50), num(b.focus[1], "backdrop.focus[1]", 0, 100, 50)];
    }
    backdrop = { src, fit: choice(b.fit, FITS, "backdrop.fit", "cover"), focus };
    isVideo = video;
    // (0.21.0) How a video plays, its sound and its still picture: a video only (a GIF always loops, a picture does not play).
    if (b.play !== undefined) { if (src && !video) fail("backdrop.play", "choice", { videoOnly: 1 }); else backdrop.play = choice(b.play, PLAYS, "backdrop.play", "loop"); }
    if (b.sound !== undefined) { if (typeof b.sound !== "boolean") fail("backdrop.sound", "format"); else if (b.sound && src && !video) fail("backdrop.sound", "choice", { videoOnly: 1 }); else if (b.sound) backdrop.sound = true; }
    if (b.poster !== undefined) { if (typeof b.poster !== "string" || !IMAGE_SRC.test(b.poster)) fail("backdrop.poster", "file"); else if (src && !video) fail("backdrop.poster", "choice", { videoOnly: 1 }); else backdrop.poster = b.poster; }
  }

  let duration: Composition["duration"];
  const d = obj(data.duration, "duration");
  if (d) {
    known(d, "duration", ["mode", "seconds"]);
    duration = { mode: choice(d.mode, DURATION_MODES, "duration.mode", "fixed"), seconds: num(d.seconds, "duration.seconds", LIMITS.seconds.min, LIMITS.seconds.max, 6, Math.round, true) };
    // "The video's own length" needs a video; for a picture or a GIF the length is chosen ("fixed").
    if (duration.mode === "media" && b && !isVideo) fail("duration.mode", "choice", { allowed: "fixed" });
  }

  if (data.stickers !== undefined && (!Array.isArray(data.stickers) || data.stickers.length > LIMITS.stickers)) fail("stickers", "range", { max: LIMITS.stickers });

  const maxBoxes = Math.min(LIMITS.boxes, Math.max(1, Math.trunc(opts.maxBoxes ?? LIMITS.boxes)));
  const boxes: Box[] = [];
  if (!Array.isArray(data.boxes)) fail("boxes", data.boxes === undefined ? "required" : "format");
  else if (data.boxes.length < 1 || data.boxes.length > maxBoxes) fail("boxes", "boxes", { min: 1, max: maxBoxes, given: data.boxes.length });
  else {
    const ids = new Set<string>();
    const vars = new Set(opts.variables ?? []);
    data.boxes.forEach((raw, i) => {
      const p = `boxes[${i}]`;
      if (!isPlain(raw)) { fail(p, "format"); return; }
      known(raw, p, ["id", "content", "x", "y", "w", "h", "anchor", "align", "size", "fit", "minSize", "maxLines", "font", "weight", "case", "color", "resolved", "look", "pill", "outline", "in", "out"]);
      const base = defaultBox();
      const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : "";
      if (!id) fail(`${p}.id`, raw.id === undefined ? "required" : "format");
      else if (ids.has(id)) fail(`${p}.id`, "choice", { duplicate: id });
      ids.add(id);
      let content: BoxContent = { kind: "phrase" };
      const c = obj(raw.content, `${p}.content`);
      if (c) {
        known(c, `${p}.content`, ["kind", "text"]);
        if (c.kind === "phrase") { if (c.text !== undefined) fail(`${p}.content.text`, "unknown_key", { known: "kind" }); }
        else if (c.kind === "custom") {
          const text = typeof c.text === "string" ? cleanText(c.text, 10_000) : "";
          if (!text) fail(`${p}.content.text`, "required");
          else if (text.length > LIMITS.custom) fail(`${p}.content.text`, "range", { max: LIMITS.custom, length: text.length });
          else {
            const bad = tokensOf(text).filter((w) => !TOKEN.test(w) || !vars.has(w));
            if (bad.length) fail(`${p}.content.text`, "variable", { unknown: bad.join(", "), known: [...vars].join(", ") });
            content = { kind: "custom", text };
          }
        } else fail(`${p}.content.kind`, "choice", { allowed: "phrase, custom" });
      }
      const x = num(raw.x, `${p}.x`, 0, 100 - LIMITS.minBox, base.x), y = num(raw.y, `${p}.y`, 0, 100 - LIMITS.minBox, base.y);
      const w = num(raw.w, `${p}.w`, LIMITS.minBox, 100, base.w), h = num(raw.h, `${p}.h`, LIMITS.minBox, 100, base.h);
      if (x + w > 100.005) fail(`${p}.w`, "range", { min: LIMITS.minBox, max: r2(100 - x) });
      if (y + h > 100.005) fail(`${p}.h`, "range", { min: LIMITS.minBox, max: r2(100 - y) });
      const size = num(raw.size, `${p}.size`, LIMITS.size.min, LIMITS.size.max, base.size, Math.round, true);
      const minSize = num(raw.minSize, `${p}.minSize`, LIMITS.size.min, size, Math.min(base.minSize, size), Math.round, true);
      const look = choice(raw.look, LOOKS, `${p}.look`, base.look);
      const box: Box = {
        id, content, x, y, w, h,
        anchor: choice(raw.anchor, ANCHORS, `${p}.anchor`, base.anchor),
        align: choice(raw.align, ALIGNS, `${p}.align`, base.align),
        size, fit: choice(raw.fit, BOX_FITS, `${p}.fit`, base.fit), minSize,
        maxLines: num(raw.maxLines, `${p}.maxLines`, LIMITS.lines.min, LIMITS.lines.max, base.maxLines, Math.round, true),
        font: choice(raw.font, FONTS, `${p}.font`, base.font),
        weight: choice(raw.weight, WEIGHTS, `${p}.weight`, base.weight),
        case: choice(raw.case, CASES, `${p}.case`, base.case),
        color: "auto", look,
        outline: choice(raw.outline, OUTLINES, `${p}.outline`, base.outline),
        in: base.in, out: base.out,
      };
      if (raw.color !== undefined && raw.color !== "auto") { if (typeof raw.color === "string" && HEX.test(raw.color)) box.color = raw.color.toLowerCase(); else fail(`${p}.color`, "choice", { allowed: "auto, #rrggbb" }); }
      if (raw.resolved !== undefined) box.resolved = choice(raw.resolved, RESOLVED, `${p}.resolved`, RESOLVED[0]);
      const pill = obj(raw.pill, `${p}.pill`);
      if (pill) {
        known(pill, `${p}.pill`, ["color", "opacity", "radius"]);
        const color = typeof pill.color === "string" && HEX.test(pill.color) ? pill.color.toLowerCase() : (pill.color === undefined ? "#14171c" : (fail(`${p}.pill.color`, "choice", { allowed: "#rrggbb" }), "#14171c"));
        const opacity = num(pill.opacity, `${p}.pill.opacity`, LIMITS.opacity.min, LIMITS.opacity.max, 85, Math.round, true);
        if (opacity % LIMITS.opacity.step !== 0) fail(`${p}.pill.opacity`, "range", { step: LIMITS.opacity.step });
        if (look === "custom") box.pill = { color, opacity, radius: num(pill.radius, `${p}.pill.radius`, LIMITS.radius.min, LIMITS.radius.max, 12, Math.round, true) };
      } else if (look === "custom") box.pill = { color: "#14171c", opacity: 85, radius: 12 };
      const inn = obj(raw.in, `${p}.in`);
      if (inn) { known(inn, `${p}.in`, ["anim", "at", "dur"]); box.in = { anim: choice(inn.anim, ANIMS, `${p}.in.anim`, base.in.anim), at: num(inn.at, `${p}.in.at`, LIMITS.at.min, LIMITS.at.max, base.in.at, r1), dur: num(inn.dur, `${p}.in.dur`, LIMITS.dur.min, LIMITS.dur.max, base.in.dur, r1) }; }
      const out = obj(raw.out, `${p}.out`);
      if (out) {
        known(out, `${p}.out`, ["anim", "at", "dur"]);
        box.out = { anim: choice(out.anim, ANIMS, `${p}.out.anim`, base.out.anim), at: out.at === null || out.at === undefined ? null : num(out.at, `${p}.out.at`, LIMITS.at.min, LIMITS.at.max, 0, r1), dur: num(out.dur, `${p}.out.dur`, LIMITS.dur.min, LIMITS.dur.max, base.out.dur, r1) };
      }
      boxes.push(box);
    });
  }
  const guides = choice(data.guides, GUIDES, "guides", "title");
  if (errors.length) return { ok: false, errors };
  const value: Composition = { v: 1, format, backdrop, ...(duration ? { duration } : {}), boxes, stickers: [], guides };
  const length = canonicalComposition(value).length;
  if (length > LIMITS.bytes) return { ok: false, errors: [{ path: "", code: "size", detail: { length, max: LIMITS.bytes } }] };
  return { ok: true, value };
}

/** The canonical text of a checked composition (fixed key order: the same composition always gives the same text). */
export function canonicalComposition(c: Composition): string {
  const box = (b: Box) => ({
    id: b.id, content: b.content.kind === "custom" ? { kind: "custom", text: b.content.text } : { kind: "phrase" }, x: b.x, y: b.y, w: b.w, h: b.h, anchor: b.anchor, align: b.align,
    size: b.size, fit: b.fit, minSize: b.minSize, maxLines: b.maxLines, font: b.font, weight: b.weight, case: b.case, color: b.color, ...(b.resolved ? { resolved: b.resolved } : {}),
    look: b.look, ...(b.pill ? { pill: { color: b.pill.color, opacity: b.pill.opacity, radius: b.pill.radius } } : {}), outline: b.outline,
    in: { anim: b.in.anim, at: b.in.at, dur: b.in.dur }, out: { anim: b.out.anim, at: b.out.at, dur: b.out.dur },
  });
  const bd = c.backdrop;
  return JSON.stringify({
    v: 1, format: c.format,
    backdrop: { src: bd.src, fit: bd.fit, focus: [bd.focus[0], bd.focus[1]], ...(bd.play ? { play: bd.play } : {}), ...(bd.sound ? { sound: true } : {}), ...(bd.poster ? { poster: bd.poster } : {}) },
    ...(c.duration ? { duration: { mode: c.duration.mode, seconds: c.duration.seconds } } : {}),
    boxes: c.boxes.map(box), stickers: [], guides: c.guides,
  });
}

/** One box as the page receives it: its style, and its text already filled (plain text, set with textContent). */
export type ResolvedBox = Omit<Box, "content"> & { text: string };
export type ResolvedComposition = Omit<Composition, "boxes" | "stickers" | "guides"> & { boxes: ResolvedBox[] };

/**
 * Fills the texts (server side): a "phrase" box shows `phrase`, a box of the person's own text gets its `{token}` replaced by `values` (a word without a value gives
 * nothing, never a leftover `{name}`). Texts are cleaned and cut at 200 characters. A box left empty is dropped (a moderated viewer text leaves no empty band).
 */
export function resolveComposition(c: Composition, fill: { phrase?: string; values?: Record<string, unknown> } = {}): ResolvedComposition {
  const values = fill.values ?? {};
  const boxes: ResolvedBox[] = [];
  for (const b of c.boxes) {
    const raw = b.content.kind === "phrase" ? String(fill.phrase ?? "") : b.content.text.replace(/\{([^{}]*)\}/g, (_, w: string) => (values[w] !== undefined && values[w] !== null ? String(values[w]) : ""));
    const text = cleanText(raw.replace(/(?:\s*·\s*){2,}/g, " · ").replace(/^[\s·,:;]+|[\s·,:;]+$/g, ""), LIMITS.filled);
    if (!text) continue;
    const style: Partial<Box> = { ...b };
    delete style.content;
    boxes.push({ ...(style as Omit<Box, "content">), text });
  }
  return { v: 1, format: c.format, backdrop: { ...c.backdrop, focus: [c.backdrop.focus[0], c.backdrop.focus[1]] }, ...(c.duration ? { duration: c.duration } : {}), boxes };
}

/**
 * Copies the placement of one composition onto another file: the boxes and their settings, never the backdrop (each file keeps its own). (0.21.0) Between two
 * videos, the way it plays and its sound go along; a picture or a GIF takes neither, nor "the video's own length". `seconds`: the length of the target video,
 * when known, for "the video's own length".
 */
export function copyPlacement(from: Composition, toSrc: string, opts: { seconds?: number | null } = {}): Composition {
  const toVideo = VIDEO_SRC.test(toSrc), fromVideo = VIDEO_SRC.test(from.backdrop.src);
  const backdrop: Backdrop = { src: toSrc, fit: from.backdrop.fit, focus: [50, 50] };
  if (toVideo && fromVideo) { if (from.backdrop.play) backdrop.play = from.backdrop.play; if (from.backdrop.sound) backdrop.sound = true; }
  let duration: Composition["duration"];
  if (from.duration) {
    if (from.duration.mode === "fixed") duration = { ...from.duration };
    else if (toVideo) duration = { mode: "media", seconds: opts.seconds && opts.seconds > 0 ? mediaSeconds(opts.seconds) : from.duration.seconds };
  }
  const out: Composition = { ...from, backdrop, boxes: from.boxes.map((b) => ({ ...b, content: { ...b.content }, in: { ...b.in }, out: { ...b.out }, ...(b.pill ? { pill: { ...b.pill } } : {}) })) };
  if (duration) out.duration = duration; else delete out.duration;
  return out;
}

/** (0.21.0) Whether a file address is a video (mp4, webm). */
export const isVideoSrc = (src: string): boolean => VIDEO_SRC.test(String(src ?? ""));
/** (0.21.0) The seconds an alert lasts for "the video's own length": the length rounded up (a 7.2 s video gives 8), kept between 2 and 60. */
export const mediaSeconds = (length: number): number => Math.min(LIMITS.seconds.max, Math.max(LIMITS.seconds.min, Math.ceil((Number(length) || 0) - 0.05)));
/** (0.21.0) A new composition for a video: it plays once and the alert lasts as long as the video (what an alert with a video did before). */
export function defaultVideoComposition(src: string, opts: { format?: ComposeFormat; seconds?: number | null } = {}): Composition {
  return { ...defaultComposition(src, opts), backdrop: { src, fit: "cover", focus: [50, 50], play: "once" }, duration: { mode: "media", seconds: mediaSeconds(opts.seconds ?? 6) } };
}
/** (0.21.0) How many seconds the alert of a composition lasts, when the composition says so (null: the place decides, as before). */
export const alertSeconds = (c: Pick<Composition, "duration"> | null | undefined): number | null => (c?.duration ? Math.min(LIMITS.seconds.max, Math.max(LIMITS.seconds.min, Math.round(c.duration.seconds))) : null);

/** The ratio (width / height) of a composition's frame; "media" needs the file's own size (16:9 until it is known). */
export function frameRatio(format: ComposeFormat, media?: { width: number; height: number } | null): number {
  if (format !== "media") return FORMAT_RATIO[format];
  return media && media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
}
