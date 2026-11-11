import { parseColor } from "../skins/colorParse";

/**
 * EXTENDED `--ov-*` TOKEN VOCABULARY (core 0.8.0), used by overlay skins (docs/OVERLAY-SKINS.md).
 *
 * The four tokens of 0.5.0 (`--ov-fg`, `--ov-surface`, `--ov-radius`, `--ov-border`) keep their meaning and their values: they are what the common style
 * emits and what every element already reads. The new tokens are ONLY emitted when an overlay skin is active; an element that does not know them is
 * not affected (the core maps them onto the reserved parts, see skinSheet.ts). Every element should still read them with a fallback
 * (`var(--ov-font, system-ui)`), exactly like the first four.
 *
 * Pure (no database, no Next). A skin's token is DATA: a value is checked here, one by one, and re-written from what was understood.
 */
export type OvTokenType = "color" | "length" | "font" | "weight" | "shadow" | "gradient" | "transform" | "anim" | "duration";
export type OvTokenGroup = "color" | "shape" | "typography" | "motion";

export type OvTokenDef = {
  name: string;
  type: OvTokenType;
  group: OvTokenGroup;
  /** Bounds for a length, in px (1em counts as 16px). */
  min?: number;
  max?: number;
  /** What an element sees when the token is not defined (documentation: the skin does not have to set it). */
  fallback: string;
  doc: string;
};

export const OV_TOKEN_DEFS: readonly OvTokenDef[] = [
  { name: "--ov-fg", type: "color", group: "color", fallback: "#ffffff", doc: "Text colour." },
  { name: "--ov-surface", type: "color", group: "color", fallback: "transparent", doc: "Background of panels (may be translucent)." },
  { name: "--ov-surface-image", type: "gradient", group: "color", fallback: "none", doc: "Decorative gradient drawn over the surface colour." },
  { name: "--ov-border", type: "color", group: "color", fallback: "transparent", doc: "Border colour." },
  { name: "--ov-accent", type: "color", group: "color", fallback: "module accent", doc: "Accent colour (bars, dots, badges, highlights)." },
  { name: "--ov-accent-fg", type: "color", group: "color", fallback: "#111111", doc: "Text colour on the accent." },
  { name: "--ov-muted", type: "color", group: "color", fallback: "fg at 78 %", doc: "Secondary text colour." },
  { name: "--ov-radius", type: "length", group: "shape", min: 0, max: 64, fallback: "12px", doc: "Corner radius of panels." },
  { name: "--ov-border-width", type: "length", group: "shape", min: 0, max: 12, fallback: "0", doc: "Border width of panels." },
  { name: "--ov-shadow", type: "shadow", group: "shape", fallback: "none", doc: "Shadow or glow of panels." },
  { name: "--ov-space", type: "length", group: "shape", min: 3, max: 40, fallback: "0.7em", doc: "Inner spacing unit for skin rules." },
  { name: "--ov-font", type: "font", group: "typography", fallback: "system-ui", doc: "Body font stack (system fonts only)." },
  { name: "--ov-font-heading", type: "font", group: "typography", fallback: "--ov-font", doc: "Heading font stack (system fonts only)." },
  { name: "--ov-weight", type: "weight", group: "typography", fallback: "400", doc: "Body font weight." },
  { name: "--ov-weight-heading", type: "weight", group: "typography", fallback: "600", doc: "Heading font weight." },
  { name: "--ov-tracking", type: "length", group: "typography", min: -2, max: 6, fallback: "0", doc: "Letter spacing." },
  { name: "--ov-heading-transform", type: "transform", group: "typography", fallback: "none", doc: "Case of headings and badges." },
  { name: "--ov-text-shadow", type: "shadow", group: "typography", fallback: "none", doc: "Text shadow (keeps text readable on a transparent surface)." },
  { name: "--ov-anim", type: "anim", group: "motion", fallback: "none", doc: "Entrance preset: none, fade, rise, pop or glow. Switched off for people who prefer reduced motion." },
  { name: "--ov-anim-duration", type: "duration", group: "motion", fallback: "0.6s", doc: "Duration of the entrance preset." },
] as const;

export const OV_TOKEN_BY_NAME: ReadonlyMap<string, OvTokenDef> = new Map(OV_TOKEN_DEFS.map((d) => [d.name, d]));
/** The four tokens of the common style (0.5.0): unchanged. */
export const OV_BASE_TOKEN_NAMES = ["--ov-fg", "--ov-surface", "--ov-radius", "--ov-border"] as const;
export const OV_ANIM_PRESETS = ["none", "fade", "rise", "pop", "glow"] as const;
export const OV_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
export const MAX_TOKEN_VALUE = 240;

export type TokenCheck = { ok: true; value: string } | { ok: false; code: "unknown" | "value"; type?: OvTokenType };
const bad = (type: OvTokenType): TokenCheck => ({ ok: false, code: "value", type });

const GENERIC_FONTS = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"];
const FONT_NAME_RE = /^[A-Za-z][A-Za-z0-9 -]{1,40}$/;
const LENGTH_RE = /^(-?\d{1,3}(?:\.\d{1,3})?|-?\.\d{1,3})(px|em|rem)?$/;

/** Splits on commas / spaces that are not inside parentheses. */
function splitTop(s: string, sep: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (sep === "," ? ch === "," : /\s/.test(ch))) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Length in px (1em = 16px), or null. A bare `0` is accepted. */
export function lengthPx(v: string): number | null {
  const m = LENGTH_RE.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "em" || m[2] === "rem" ? n * 16 : n;
}

function checkShadow(v: string, text: boolean): string | null {
  if (v === "none") return "none";
  const layers = splitTop(v, ",");
  if (layers.length < 1 || layers.length > 4) return null;
  const out: string[] = [];
  for (const layer of layers) {
    const parts = splitTop(layer, " ");
    let inset = false;
    const lens: string[] = [];
    let color: string | null = null;
    for (const p of parts) {
      if (p === "inset" && !text && !inset && lens.length === 0) { inset = true; continue; }
      const px = lengthPx(p);
      if (px !== null) { if (color !== null && lens.length === 0) return null; lens.push(p); continue; }
      if (color === null && parseColor(p)) { color = p; continue; }
      return null;
    }
    if (!color || lens.length < 2 || lens.length > (text ? 3 : 4)) return null;
    const px = lens.map((l) => lengthPx(l)!);
    if (px.slice(0, 2).some((n) => Math.abs(n) > 40)) return null;
    if (px[2] !== undefined && (px[2] < 0 || px[2] > 60)) return null;
    if (px[3] !== undefined && Math.abs(px[3]) > 30) return null;
    out.push(`${inset ? "inset " : ""}${lens.join(" ")} ${color}`);
  }
  return out.join(", ");
}

function checkFont(v: string): string | null {
  const items = splitTop(v, ",");
  if (items.length < 2 || items.length > 7) return null;
  const out: string[] = [];
  for (const raw of items) {
    const quoted = /^"([^"\\]+)"$/.exec(raw) ?? /^'([^'\\]+)'$/.exec(raw);
    const name = quoted ? quoted[1]! : raw;
    if (GENERIC_FONTS.includes(name.toLowerCase()) && !quoted) { out.push(name.toLowerCase()); continue; }
    if (!FONT_NAME_RE.test(name)) return null;
    if (GENERIC_FONTS.includes(name.toLowerCase())) return null;
    out.push(`"${name}"`);
  }
  // A fallback must exist: the last entry is a generic family.
  return GENERIC_FONTS.includes(out[out.length - 1]!) ? out.join(", ") : null;
}

function checkGradient(v: string): string | null {
  if (v === "none") return "none";
  if (!/^(linear|radial|repeating-linear)-gradient\(.*\)$/.test(v) || v.length > 200) return null;
  if (/url|var\(|expression|\\|[;{}<>"']/i.test(v)) return null;
  const inner = v.slice(v.indexOf("(") + 1, -1);
  const args = splitTop(inner, ",");
  if (args.length < 2 || args.length > 8) return null;
  let colors = 0;
  for (const a of args) {
    const words = splitTop(a, " ");
    for (const w of words) {
      if (/^-?\d{1,4}(\.\d{1,3})?(deg|%|px|em|turn)$/.test(w) || /^(to|top|left|right|bottom|center|circle|ellipse|at|closest-side|farthest-side)$/.test(w)) continue;
      if (parseColor(w)) { colors++; continue; }
      return null;
    }
  }
  return colors >= 2 ? v.replace(/\s+/g, " ") : null;
}

/** Checks one token value of a skin. The returned value is the one to write (trimmed, normalised for fonts). */
export function checkToken(name: string, raw: unknown): TokenCheck {
  const def = OV_TOKEN_BY_NAME.get(name);
  if (!def) return { ok: false, code: "unknown" };
  if (typeof raw !== "string") return bad(def.type);
  const v = raw.trim();
  if (!v || v.length > MAX_TOKEN_VALUE || /[;{}<>\\\u0000-\u001f\u007f]/.test(v) || /(^|[^a-z-])(url|var|expression|attr|image-set)\s*\(/i.test(v) || /!important|@import/i.test(v)) return bad(def.type);
  switch (def.type) {
    case "color": return parseColor(v) ? { ok: true, value: v } : bad("color");
    case "length": {
      const px = lengthPx(v);
      if (px === null || px < (def.min ?? -Infinity) || px > (def.max ?? Infinity)) return bad("length");
      return { ok: true, value: v };
    }
    case "font": { const f = checkFont(v); return f ? { ok: true, value: f } : bad("font"); }
    case "weight": return /^([1-9]00|normal|bold)$/.test(v) ? { ok: true, value: v } : bad("weight");
    case "shadow": { const s = checkShadow(v, name === "--ov-text-shadow"); return s ? { ok: true, value: s } : bad("shadow"); }
    case "gradient": { const g = checkGradient(v); return g ? { ok: true, value: g } : bad("gradient"); }
    case "transform": return (OV_TRANSFORMS as readonly string[]).includes(v) ? { ok: true, value: v } : bad("transform");
    case "anim": return (OV_ANIM_PRESETS as readonly string[]).includes(v) ? { ok: true, value: v } : bad("anim");
    case "duration": {
      const m = /^(\d{1,4}(?:\.\d{1,3})?)(ms|s)$/.exec(v);
      const ms = m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : NaN;
      return ms >= 100 && ms <= 4000 ? { ok: true, value: v } : bad("duration");
    }
  }
}

/** Alpha-aware luminance helpers for the contrast check live in skinReadability.ts. */
export function isTransparentColor(v: string | undefined): boolean {
  const c = v ? parseColor(v) : null;
  return !c || c.a < 0.2;
}
