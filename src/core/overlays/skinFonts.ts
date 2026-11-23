import { encodeCssString } from "../skins/valueTokens";

/**
 * FONTS OF AN OVERLAY SKIN (core 0.47.0, skin contract 6, docs/OVERLAY-SKINS.md "Fonts"). Pure: nothing is read, written or fetched here.
 *
 * A skin declares woff2 files in `assets` (kind `font`, each with a `family`, optionally `weight` and `style`). The skin NEVER writes `@font-face` or `url()`:
 * the CORE writes the rules from the declaration (`fontFaceCss`), under a family name of its own making (`scopedFamily`), so that
 *  - the author's words can never reach the sheet as CSS (a family is `[A-Za-z0-9 _-]`, the generated name is `[a-z0-9-]`, every string goes through `encodeCssString`);
 *  - two skins, or a skin and the element page it dresses, never share a family name: the sheet of one skin cannot restyle the text of another.
 * The skin then names its families in `--ov-font`, `--ov-font-heading` and `font-family`; `mapFontStack` checks the list (declared family or known system
 * font, then a generic family as the last entry) and writes the scoped names.
 */

export type OverlayFont = { family: string; weight: string; style: "normal" | "italic"; url: string };
/** What a skin of contract 6 may name in a font list. `families`: the declared family -> its scoped name. `strict`: any other name must be a known system font. */
export type FontCtx = { families: ReadonlyMap<string, string>; strict: boolean };

const WEIGHT_RE = /^(\d{3}( \d{3})?|normal|bold)$/;
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/;
const FILE_RE = /^fonts\/[a-z0-9][a-z0-9._-]{0,63}\.woff2$/;
const SKIN_RE = /^[a-z][a-z0-9-]{1,40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** `font-display` of the generated rules: `fallback` = invisible for 100 ms at most, then the fallback stack, and the face may still swap in during the first 3 s only; never later (no jump under a live alert). */
export const FONT_DISPLAY = "fallback";

export const GENERIC_FAMILIES = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"] as const;

/** Fonts a skin of contract 6 may still name without declaring them: the ones the system stacks of the core and of common desktops already name. They are looked up on the viewer's machine, never loaded. */
export const SYSTEM_FONT_NAMES: ReadonlySet<string> = new Set([
  "arial", "arial black", "arial narrow", "avenir", "avenir next", "american typewriter", "baskerville", "bahnschrift", "bodoni mt", "book antiqua", "brush script mt", "calibri", "cambria", "candara",
  "century gothic", "comic sans ms", "consolas", "constantia", "copperplate", "corbel", "courier", "courier new", "didot", "franklin gothic medium", "futura", "garamond", "geneva", "georgia", "gill sans",
  "helvetica", "helvetica neue", "impact", "lucida console", "lucida grande", "lucida sans", "menlo", "monaco", "nimbus mono ps", "optima", "palatino", "palatino linotype", "papyrus", "playfair display",
  "rockwell", "roboto", "roboto condensed", "segoe ui", "sfmono-regular", "sf pro", "tahoma", "times", "times new roman", "trebuchet mt", "varela round", "verdana", "nunito",
]);

/** The name the generated `@font-face` and the rewritten lists use for a declared family: `ov-<skin id>-<family, lower case, dashes>`. */
export function scopedFamily(skinId: string, family: string): string {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "font";
  return `ov-${skinId}-${slug}`;
}

type FontAsset = { file: string; kind: string; family?: string; weight?: string; style?: string };

/** The fonts of a skin as the loader and the sheet need them (invalid entries are skipped: the validator has already refused them, this is defence in depth). */
export function overlayFonts(skinId: string, version: string, assets: readonly FontAsset[]): OverlayFont[] {
  if (!SKIN_RE.test(skinId) || !VERSION_RE.test(version)) return [];
  const out: OverlayFont[] = [];
  for (const a of assets) {
    if (a.kind !== "font" || !a.family || !FAMILY_RE.test(a.family) || !FILE_RE.test(a.file)) continue;
    const weight = a.weight ?? "400";
    if (!WEIGHT_RE.test(weight)) continue;
    out.push({ family: scopedFamily(skinId, a.family), weight, style: a.style === "italic" ? "italic" : "normal", url: `/skins/${skinId}/${version}/${a.file}` });
  }
  return out;
}

/** The `@font-face` rule of one font. The address is the site's own (`/skins/<id>/<version>/fonts/<file>.woff2`, served by skins/serve.ts), the format is fixed. */
export const fontFaceCss = (f: OverlayFont): string =>
  `@font-face{font-family:${encodeCssString(f.family)};src:url(${encodeCssString(f.url)}) format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:${FONT_DISPLAY}}`;

/** The context a skin's font lists are checked in: only a skin of contract 6 has one (older contracts keep the rules they always had). */
export function fontCtx(skinId: string, assets: readonly FontAsset[], contract: number): FontCtx | undefined {
  if (contract < 6) return undefined;
  const families = new Map<string, string>();
  for (const a of assets) if (a.kind === "font" && a.family && FAMILY_RE.test(a.family)) families.set(a.family, scopedFamily(skinId, a.family));
  return { families, strict: true };
}

export type FontStack = { ok: true; value: string } | { ok: false; reason: "shape" | "fallback" | "undeclared"; family?: string };

/** Splits on commas that are not inside quotes. */
function items(v: string): string[] | null {
  const out: string[] = [];
  let cur = "", q = "";
  for (const ch of v) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (q) return null;
  out.push(cur.trim());
  return out;
}

/** Checks a font list (`"Family", Georgia, serif`) of a skin of contract 6 and writes it with the scoped names. Declared family or known system font, a generic family LAST, 2 to 7 entries. */
export function mapFontStack(v: string, ctx: FontCtx): FontStack {
  const list = items(v);
  if (!list || list.length < 2 || list.length > 7 || list.some((x) => !x)) return { ok: false, reason: list && list.length < 2 ? "fallback" : "shape" };
  const out: string[] = [];
  let last = "";
  for (const raw of list) {
    const quoted = /^"([^"\\]+)"$/.exec(raw) ?? /^'([^'\\]+)'$/.exec(raw);
    const name = quoted ? quoted[1]! : raw;
    const lower = name.toLowerCase();
    if (!quoted && (GENERIC_FAMILIES as readonly string[]).includes(lower)) { out.push(lower); last = lower; continue; }
    if (!/^[A-Za-z][A-Za-z0-9 -]{1,40}$/.test(name) || (GENERIC_FAMILIES as readonly string[]).includes(lower)) return { ok: false, reason: "shape" };
    const scoped = ctx.families.get(name);
    if (scoped) { out.push(`"${scoped}"`); last = ""; continue; }
    if (ctx.strict && !SYSTEM_FONT_NAMES.has(lower)) return { ok: false, reason: "undeclared", family: name };
    out.push(`"${name}"`);
    last = "";
  }
  return last ? { ok: true, value: out.join(", ") } : { ok: false, reason: "fallback" };
}
