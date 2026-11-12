import postcss from "postcss";
import { parseColor } from "../skins/colorParse";
import { composite, contrastRatio } from "../skins/readability";
import { lengthPx } from "./skinTokens";
import { PRESET_PROPS, MOTION_TIMING, emptyExpansion, expandPreset, layerDecls, type PresetProp } from "./skinPresets";

/**
 * SANITISER FOR THE STYLE SHEET OF AN OVERLAY SKIN (core 0.8.0). Pure: no database, no Next, no network.
 *
 * An overlay skin sheet is DATA: only flat style rules whose selectors are `[data-ov-part="x"]` / `[data-ov-region="x"]` (up to three, with a descendant
 * combinator, an optional `:first-child` / `:last-child` and an optional decorative `::before` / `::after`), and declarations from a closed list with checked
 * values. No at-rule (the motion presets are the core's), no `url()`, no `!important`, no class, id or tag selector, nothing that hides content.
 * Every selector is RE-WRITTEN from what was understood under `html[data-ov-skin="<id>"]`: nothing is copied as is.
 */
export type OverlayCssIssue = { code: string; line?: number; detail?: string };
export type OverlayCssResult = { ok: boolean; css: string; issues: OverlayCssIssue[]; rules: number; /** (0.11.0) Number of `font-size` declarations that make text smaller than the element's own (below 100 % / 1em): a warning, because overlays are watched like TV (docs/OVERLAY-SKINS.md). */ shrinks?: number; /** The sheet uses contract-3 vocabulary (presets or layout properties): the skin must declare `skinContract: 3`. */ v3?: boolean };

export const OVERLAY_CSS_LIMITS = { maxBytes: 24 * 1024, maxRules: 90, maxDeclarations: 18, maxSelectors: 8 } as const;
const NAME = "[a-z][a-z0-9-]{0,30}";
const COMPOUND_RE = new RegExp(`^\\[data-ov-(part|region)="(${NAME})"\\](:first-child|:last-child)?$`);
const SELECTOR_RE = new RegExp(`^\\[data-ov-(?:part|region)="${NAME}"\\](?::first-child|:last-child)?(?: \\[data-ov-(?:part|region)="${NAME}"\\](?::first-child|:last-child)?){0,2}(::before|::after)?$`);
export const ANIM_NAMES = ["ov-fade", "ov-rise", "ov-pop", "ov-glow"] as const;

type Kind = "color" | "bg" | "len" | "shadow" | "font" | "weight" | "num" | "transform" | "anim-name" | "time" | "style" | "content" | "deco-len" | "align" | "radius" | "pos" | "enum" | "margin" | "xform" | "maxw" | "stretch";

const PROPS: Record<string, Kind> = {
  color: "color", "background-color": "color", "border-color": "color", "border-top-color": "color", "border-bottom-color": "color", "border-left-color": "color", "border-right-color": "color",
  "text-decoration-color": "color", background: "bg", "background-image": "bg",
  "border-width": "len", "border-top-width": "len", "border-bottom-width": "len", "border-left-width": "len", "border-right-width": "len",
  "border-style": "style", "border-top-style": "style", "border-bottom-style": "style", "border-left-style": "style", "border-right-style": "style",
  border: "len", "border-top": "len", "border-bottom": "len", "border-left": "len", "border-right": "len",
  "border-radius": "radius", "box-shadow": "shadow", "text-shadow": "shadow", "font-family": "font", "font-weight": "weight", "font-style": "style", "font-size": "len",
  "letter-spacing": "len", "line-height": "num", "text-transform": "transform", "text-decoration": "style", padding: "len", "padding-top": "len", "padding-bottom": "len", "padding-left": "len", "padding-right": "len",
  opacity: "num", "animation-name": "anim-name", "animation-duration": "time", "animation-delay": "time", "text-align": "align", "backdrop-filter": "len",
  "flex-direction": "enum", order: "num", "align-items": "enum", "justify-content": "enum", gap: "len", margin: "margin", "margin-top": "margin", "margin-bottom": "margin", "margin-left": "margin", "margin-right": "margin", "max-width": "maxw", transform: "xform", "font-variant-caps": "enum", "word-spacing": "len",
  width: "deco-len", height: "deco-len", position: "pos", top: "deco-len", bottom: "deco-len", left: "deco-len", right: "deco-len", inset: "deco-len", "z-index": "num", content: "content", "pointer-events": "style",
};
const V3_PROPS = new Set(["flex-direction", "order", "align-items", "justify-content", "gap", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "max-width", "transform", "font-variant-caps", "word-spacing"]);
const ENUMS: Record<string, readonly string[]> = { "flex-direction": ["row", "column", "row-reverse", "column-reverse"], "align-items": ["flex-start", "center", "flex-end", "stretch", "baseline"], "justify-content": ["flex-start", "center", "flex-end", "space-between", "space-around"], "font-variant-caps": ["normal", "small-caps", "all-small-caps"] };
const DECO_ONLY = new Set(["width", "height", "position", "top", "bottom", "left", "right", "inset", "z-index", "content", "pointer-events"]);

const GENERIC = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"];
/** A value may read a token of the vocabulary, with a literal fallback: `var(--ov-accent, #fff)`. */
const VAR_RE = /var\(\s*(--ov-[a-z-]+)\s*(?:,\s*([^()]*))?\)/g;

function split(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && sep.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const okColor = (w: string): boolean => /^var\(--ov-[a-z-]+(\s*,\s*[^()]+)?\)$/.test(w) || !!parseColor(w) || w === "currentcolor";
const okLen = (w: string, max = 64): boolean => w === "auto" ? false : /^var\(--ov-(space|radius|border-width|tracking)(\s*,\s*[^()]+)?\)$/.test(w) || (lengthPx(w) !== null && Math.abs(lengthPx(w)!) <= max) || /^-?\d{1,3}(\.\d+)?%$/.test(w) && Math.abs(parseFloat(w)) <= 100;

function gradientOk(v: string): boolean {
  if (!/^(linear|radial|repeating-linear)-gradient\(.*\)$/.test(v) || v.length > 220) return false;
  const args = split(v.slice(v.indexOf("(") + 1, -1), /,/);
  if (args.length < 2 || args.length > 8) return false;
  let colors = 0;
  for (const a of args) for (const w of split(a, /\s/)) {
    if (/^-?\d{1,4}(\.\d{1,3})?(deg|%|px|em|turn)$/.test(w) || /^(to|top|left|right|bottom|center|circle|ellipse|at|closest-side|farthest-side)$/.test(w)) continue;
    if (okColor(w)) { colors++; continue; }
    return false;
  }
  return colors >= 2;
}

function shadowOk(v: string, text: boolean): boolean {
  if (v === "none" || /^var\(--ov-(text-)?shadow(\s*,\s*none)?\)$/.test(v)) return true;
  const layers = split(v, /,/);
  if (layers.length < 1 || layers.length > 4) return false;
  return layers.every((layer) => {
    const words = split(layer, /\s/);
    let colors = 0, lens = 0;
    for (const w of words) {
      if (w === "inset" && !text) continue;
      if (lengthPx(w) !== null) { lens++; if (Math.abs(lengthPx(w)!) > 60) return false; continue; }
      if (okColor(w)) { colors++; continue; }
      return false;
    }
    return colors === 1 && lens >= 2 && lens <= (text ? 3 : 4);
  });
}

function fontOk(v: string): boolean {
  if (/^var\(--ov-font(-heading)?(\s*,\s*[^()]+)?\)$/.test(v)) return true;
  const items = split(v, /,/);
  if (items.length < 2 || items.length > 7) return false;
  const names = items.map((raw) => { const q = /^"([^"\\]+)"$/.exec(raw) ?? /^'([^'\\]+)'$/.exec(raw); return { name: q ? q[1]! : raw, quoted: !!q }; });
  return names.every((n) => (GENERIC.includes(n.name.toLowerCase()) && !n.quoted) || /^[A-Za-z][A-Za-z0-9 -]{1,40}$/.test(n.name)) && GENERIC.includes(names[names.length - 1]!.name.toLowerCase());
}

/** Is this declaration allowed? Returns the value to write or a code. */
function checkValue(prop: string, kind: Kind, value: string, deco: boolean): string | { code: string } {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v || v.length > 300) return { code: "value-empty" };
  if (/[;{}<>\\\u0000-\u001f\u007f]|(^|[^a-z-])(url|expression|attr|image-set|element|paint)\s*\(|!important|@/i.test(v)) return { code: "value-forbidden" };
  // Every `var()` must read a token of the vocabulary.
  const vars = [...v.matchAll(/var\(/g)].length;
  const good = [...v.matchAll(VAR_RE)].length;
  if (vars !== good) return { code: "var-forbidden" };
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v)) return { code: "value-keyword" };
  const bad = { code: "value-bad" };
  switch (kind) {
    case "color": return okColor(v) ? v : bad;
    case "bg": {
      if (prop === "background" || prop === "background-image") {
        if (v === "none") return v;
        if (/^var\(--ov-surface-image/.test(v)) return v;
        if (gradientOk(v)) return v;
        if (prop === "background" && okColor(v)) return v;
        return bad;
      }
      return bad;
    }
    case "len": {
      if (prop === "gap") return okLen(v, 24) && !v.startsWith("-") ? v : bad;
      if (prop === "backdrop-filter") return /^blur\(\d{1,2}(\.\d)?px\)$/.test(v) && parseFloat(v.slice(5)) <= 24 ? v : bad;
      if (prop === "font-size") return /^\d{2,3}(\.\d+)?%$/.test(v) && parseFloat(v) >= 60 && parseFloat(v) <= 160 || (/^\d(\.\d+)?em$/.test(v) && parseFloat(v) >= 0.6 && parseFloat(v) <= 1.6) ? v : bad;
      if (prop === "letter-spacing") return okLen(v, 6) ? v : bad;
      if (prop.startsWith("border")) {
        const words = split(v, /\s/);
        let width = 0, colors = 0;
        for (const w of words) {
          if (/^(solid|dashed|dotted|double|none)$/.test(w)) continue;
          if (lengthPx(w) !== null || /^var\(--ov-border-width/.test(w)) { width++; if (lengthPx(w) !== null && (lengthPx(w)! < 0 || lengthPx(w)! > 12)) return bad; continue; }
          if (okColor(w)) { colors++; continue; }
          return bad;
        }
        return prop.endsWith("width") ? (words.length === 1 && width === 1 ? v : bad) : width <= 1 && colors <= 1 ? v : bad;
      }
      if (prop.startsWith("padding")) { const ws = split(v, /\s/); return ws.length <= 4 && ws.every((w) => okLen(w, 40) && !w.startsWith("-") && !/%$/.test(w)) ? v : bad; }
      return bad;
    }
    case "style": {
      if (prop === "border-style" || /^border-(top|bottom|left|right)-style$/.test(prop)) return /^(solid|dashed|dotted|double|none)$/.test(v) ? v : bad;
      if (prop === "font-style") return /^(normal|italic)$/.test(v) ? v : bad;
      if (prop === "text-decoration") return /^(none|underline|overline)$/.test(v) ? v : bad;
      if (prop === "pointer-events") return v === "none" ? v : bad;
      return bad;
    }
    case "radius": { const ws = split(v, /\s/); return ws.length <= 4 && ws.every((w) => /^var\(--ov-radius/.test(w) || (lengthPx(w) !== null && lengthPx(w)! >= 0 && lengthPx(w)! <= 64) || /^\d{1,3}%$/.test(w)) ? v : bad; }
    case "shadow": return shadowOk(v, prop === "text-shadow") ? v : bad;
    case "font": return fontOk(v) ? v : bad;
    case "weight": return /^([1-9]00|normal|bold|var\(--ov-weight(-heading)?(\s*,\s*[^()]+)?\))$/.test(v) ? v : bad;
    case "num": {
      const n = Number(v);
      if (prop === "opacity") return Number.isFinite(n) && n >= 0.4 && n <= 1 ? v : bad;
      if (prop === "line-height") return Number.isFinite(n) && n >= 1 && n <= 2 ? v : bad;
      if (prop === "z-index") return Number.isInteger(n) && n >= -2 && n <= 2 ? v : bad;
      return bad;
    }
    case "transform": return /^(none|uppercase|lowercase|capitalize|var\(--ov-heading-transform(\s*,\s*[^()]+)?\))$/.test(v) ? v : bad;
    case "anim-name": return (ANIM_NAMES as readonly string[]).includes(v) || v === "none" ? v : bad;
    case "time": { const m = /^(\d{1,4}(?:\.\d{1,3})?)(ms|s)$/.exec(v); const ms = m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : NaN; return ms >= 0 && ms <= 5000 ? v : bad; }
    case "align": return /^(left|center|right|start|end)$/.test(v) ? v : bad;
    case "pos": return deco && /^(absolute|relative)$/.test(v) ? v : bad;
    case "enum": return (ENUMS[prop] ?? []).includes(v) ? v : bad;
    case "margin": { const ws = split(v, /\s/); return ws.length <= 4 && ws.every((w) => w === "0" || (lengthPx(w) !== null && /(px|em|rem)$/.test(w) && lengthPx(w)! >= -4 && lengthPx(w)! <= 32)) ? v : bad; }
    case "maxw": return /^\d{2,3}%$/.test(v) && parseFloat(v) >= 50 && parseFloat(v) <= 100 ? v : bad;
    case "xform": { const ws = v.match(/^(rotate|skewX|skewY)\((-?\d{1,2}(\.\d)?)deg\)$/); return ws && Math.abs(parseFloat(ws[2]!)) <= (ws[1] === "rotate" ? 8 : 10) ? v : bad; }
    case "deco-len": return deco && (prop === "inset" ? split(v, /\s/).every((w) => okLen(w, 400)) : okLen(v, 400)) ? v : bad;
    case "content": return deco && (v === '""' || /^"[·—»«/|•◆◇★☆✦✧▪▫]"$/.test(v)) ? v : bad;
  }
  return bad;
}

/** Parses a selector list and re-writes it under the skin root. Returns null for any selector outside the closed grammar. */
export function rewriteSelectors(list: string, skinId: string): { selectors: string[]; deco: boolean } | null {
  const parts = split(list, /,/);
  if (parts.length < 1 || parts.length > OVERLAY_CSS_LIMITS.maxSelectors) return null;
  const out: string[] = [];
  let deco = false;
  for (const raw of parts) {
    const s = raw.replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();
    if (s.includes(">")) return null;
    if (!SELECTOR_RE.test(s)) return null;
    const pseudo = /::(before|after)$/.exec(s);
    if (pseudo) deco = true;
    const base = pseudo ? s.slice(0, -pseudo[0].length) : s;
    const compounds = base.split(" ");
    if (!compounds.every((c) => COMPOUND_RE.test(c))) return null;
    out.push(`html[data-ov-skin="${skinId}"] ${compounds.join(" ")}${pseudo ? pseudo[0] : ""}`);
  }
  return { selectors: out, deco };
}

export function sanitizeOverlayCss(css: unknown, skinId: string): OverlayCssResult {
  const issues: OverlayCssIssue[] = [];
  const fail = (code: string, line?: number, detail?: string) => { if (issues.length < 60) issues.push({ code, line, detail }); };
  if (typeof css !== "string") return { ok: false, css: "", issues: [{ code: "not-text" }], rules: 0 };
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(skinId)) return { ok: false, css: "", issues: [{ code: "bad-id" }], rules: 0 };
  const source = (css.charCodeAt(0) === 0xfeff ? css.slice(1) : css).replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(source, "utf8") > OVERLAY_CSS_LIMITS.maxBytes) return { ok: false, css: "", issues: [{ code: "too-large" }], rules: 0 };
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(source)) return { ok: false, css: "", issues: [{ code: "invalid-character" }], rules: 0 };
  let root;
  try { root = postcss.parse(source, { from: undefined }); } catch { return { ok: false, css: "", issues: [{ code: "syntax" }], rules: 0 }; }
  const out: string[] = [];
  let rules = 0, v3 = false, shrinks = 0;
  for (const node of root.nodes) {
    const line = node.source?.start?.line;
    if (node.type === "comment") continue;
    if (node.type === "atrule") { fail(node.name === "import" ? "import-forbidden" : "at-rule-forbidden", line, node.name); continue; }
    if (node.type !== "rule") { fail("outside-rule", line); continue; }
    if (++rules > OVERLAY_CSS_LIMITS.maxRules) { fail("too-many-rules", line); break; }
    const sel = rewriteSelectors(node.selector, skinId);
    if (!sel) { fail("selector", line, node.selector.slice(0, 60)); continue; }
    const decls: string[] = [];
    const exp = emptyExpansion();
    const seen = new Map<string, string>();
    for (const d of node.nodes ?? []) {
      if (d.type === "comment") continue;
      if (d.type !== "decl") { fail("nested", line); continue; }
      const prop = d.prop.toLowerCase();
      if (decls.length >= OVERLAY_CSS_LIMITS.maxDeclarations) { fail("too-many-declarations", d.source?.start?.line); break; }
      if (d.important) { fail("important-forbidden", d.source?.start?.line); continue; }
      if ((PRESET_PROPS as readonly string[]).includes(prop)) {
        if (sel.deco) fail("preset-on-pseudo", d.source?.start?.line, prop);
        else if (!expandPreset(prop as PresetProp, d.value, exp)) fail("preset-value", d.source?.start?.line, prop);
        else v3 = true;
        continue;
      }
      if (V3_PROPS.has(prop)) v3 = true;
      const kind = PROPS[prop];
      if (!kind) { fail(/^(display|visibility|clip|clip-path|filter|transform|margin|float|overflow|animation)/.test(prop) ? "property-forbidden" : "property-unknown", d.source?.start?.line, prop); continue; }
      if (DECO_ONLY.has(prop) && !sel.deco) { fail("deco-only", d.source?.start?.line, prop); continue; }
      const r = checkValue(prop, kind, d.value, sel.deco);
      if (typeof r !== "string") { fail(r.code, d.source?.start?.line, prop); continue; }
      decls.push(`${prop}:${r}`);
      seen.set(prop, r);
      if (prop === "font-size" && (/%$/.test(r) ? parseFloat(r) < 100 : /em$/.test(r) && parseFloat(r) < 1)) shrinks++;
    }
    // A rule that sets text and background colours together must keep them readable (4.5:1).
    const fg = seen.get("color"), bg = seen.get("background-color") ?? (seen.get("background") && parseColor(seen.get("background")!) ? seen.get("background") : undefined);
    const f = fg ? parseColor(fg) : null, b = bg ? parseColor(bg) : null;
    if (f && b && f.a >= 0.7 && b.a > 0.5) {
      const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 };
      const worst = Math.min(...[white, black].map((base) => { const back = composite(b, base); return contrastRatio(composite(f, back), back); }));
      if (worst < 4.5) fail("rule-contrast", line, `${worst.toFixed(1)}`);
    }
    if (f && f.a < 0.7) fail("text-too-faint", line);
    if (sel.deco && !seen.has("content")) fail("deco-needs-content", line);
    if (sel.deco) { decls.push("pointer-events:none"); }
    if (new Set(exp.motion).size !== exp.motion.length) fail("preset-conflict", line);
    decls.push(...exp.decls, ...layerDecls(exp.layers));
    if (decls.length) out.push(`${sel.selectors.join(",")}{${decls.join(";")}}`);
    // Idle motion only when the person has not asked for reduced motion.
    if (exp.motion.length) out.push(`@media (prefers-reduced-motion:no-preference){${sel.selectors.join(",")}{animation:${exp.motion.map((m) => `ov-${m} ${MOTION_TIMING[m]}`).join(",")}}}`);
  }
  return { ok: issues.length === 0, css: issues.length ? "" : out.join("\n"), issues, rules, v3, shrinks };
}
