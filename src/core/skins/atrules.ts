/**
 * Conditions des at-règles de skin (docs/SKINS.md §6.2) : `@media`, `@container`, `@supports`.
 * Chaque condition est analysée par une grammaire fermée puis réécrite à partir de ce qui a été compris.
 */
import { ALLOWED_PROPERTIES, BOUNDS, type SkinLimits } from "./allowlist";

export class AtRuleError extends Error {
  readonly code: string;
  readonly params: Record<string, string | number>;
  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

const LEN = /^(\d+(?:\.\d+)?)(px|em|rem)$/;
const RANGE_OPS = ["<=", ">=", "<", ">", "="] as const;

/** Retire les commentaires (équivalent d'une espace) et compacte les espaces. */
function clean(prelude: string): string {
  return prelude.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function lengthIn(raw: string, minEm: number, maxEm: number, what: string): string {
  const m = LEN.exec(raw);
  if (!m) throw new AtRuleError("media-length-bad", { what });
  const v = Number(m[1]);
  const em = m[2] === "px" ? v / 16 : v;
  if (!(em >= minEm && em <= maxEm)) throw new AtRuleError("media-length-range", { what: raw, min: minEm, max: maxEm });
  return `${m[1]}${m[2]}`;
}

/** Sépare à un opérateur de premier niveau (hors parenthèses). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth < 0) throw new AtRuleError("media-syntax");
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  if (depth !== 0) throw new AtRuleError("media-syntax");
  out.push(s.slice(start));
  return out;
}

const KEYWORD_FEATURES: Readonly<Record<string, readonly string[]>> = {
  "prefers-color-scheme": ["light", "dark"],
  "prefers-reduced-motion": ["reduce", "no-preference"],
  "prefers-contrast": ["more", "less", "custom", "no-preference"],
  hover: ["hover", "none"],
  "any-hover": ["hover", "none"],
  pointer: ["none", "coarse", "fine"],
  "any-pointer": ["none", "coarse", "fine"],
  orientation: ["portrait", "landscape"],
};

type Feature = { text: string; motion?: boolean };

/** `(min-width: 40rem)`, `(width >= 40rem)`, `(40rem <= width <= 60rem)` ou une fonction de préférence. */
function feature(inner: string, sizes: readonly string[], minEm: number, maxEm: number, allowKeywords: boolean): Feature {
  const s = inner.trim();
  let m = new RegExp(`^(min|max)-(${sizes.join("|")})\\s*:\\s*([0-9.]+[a-z]+)$`).exec(s);
  if (m) return { text: `(${m[1]}-${m[2]}: ${lengthIn(m[3]!, minEm, maxEm, m[2]!)})` };
  m = new RegExp(`^(${sizes.join("|")})\\s*(<=|>=|<|>|=)\\s*([0-9.]+[a-z]+)$`).exec(s);
  if (m) return { text: `(${m[1]} ${m[2]} ${lengthIn(m[3]!, minEm, maxEm, m[1]!)})` };
  m = new RegExp(`^([0-9.]+[a-z]+)\\s*(<=|>=|<|>|=)\\s*(${sizes.join("|")})$`).exec(s);
  if (m) return { text: `(${lengthIn(m[1]!, minEm, maxEm, m[3]!)} ${m[2]} ${m[3]})` };
  m = new RegExp(`^([0-9.]+[a-z]+)\\s*(<=|<)\\s*(${sizes.join("|")})\\s*(<=|<)\\s*([0-9.]+[a-z]+)$`).exec(s) ?? new RegExp(`^([0-9.]+[a-z]+)\\s*(>=|>)\\s*(${sizes.join("|")})\\s*(>=|>)\\s*([0-9.]+[a-z]+)$`).exec(s);
  if (m) return { text: `(${lengthIn(m[1]!, minEm, maxEm, m[3]!)} ${m[2]} ${m[3]} ${m[4]} ${lengthIn(m[5]!, minEm, maxEm, m[3]!)})` };
  if (allowKeywords) {
    m = /^([a-z-]+)\s*:\s*([a-z-]+)$/.exec(s);
    if (m && KEYWORD_FEATURES[m[1]!]?.includes(m[2]!)) {
      return { text: `(${m[1]}: ${m[2]})`, motion: m[1] === "prefers-reduced-motion" && m[2] === "no-preference" };
    }
  }
  throw new AtRuleError("media-feature-not-allowed", { name: s.slice(0, 40) });
}

function parenInner(part: string): string {
  const t = part.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) throw new AtRuleError("media-syntax");
  const inner = t.slice(1, -1);
  if (inner.includes("(") || inner.includes(")")) throw new AtRuleError("media-syntax");
  return inner;
}

export type ConditionResult = { text: string; motionNoPreference: boolean };

/** `@media` : types `screen`/`all`/`print`, conditions de taille bornées et préférences. */
export function parseMedia(prelude: string, limits: SkinLimits): ConditionResult {
  const s = clean(prelude);
  if (!s) throw new AtRuleError("media-syntax");
  if (!/^[a-z0-9 ().,:<>=-]+$/.test(s)) throw new AtRuleError("media-syntax");
  const queries = splitTop(s, ",");
  if (queries.length > limits.maxQueriesPerCondition) throw new AtRuleError("media-too-many", { max: limits.maxQueriesPerCondition });
  let motion = false;
  const out = queries.map((q) => {
    const parts = splitTop(q.trim(), " and ");
    const texts: string[] = [];
    parts.forEach((part, i) => {
      const t = part.trim();
      if (i === 0 && ["screen", "all", "print"].includes(t)) {
        texts.push(t);
        return;
      }
      const f = feature(parenInner(t), ["width", "height"], BOUNDS.mediaMinEm, BOUNDS.mediaMaxEm, true);
      if (f.motion) motion = true;
      texts.push(f.text);
    });
    if (texts.length > 4) throw new AtRuleError("media-too-many", { max: 4 });
    return texts.join(" and ");
  });
  return { text: out.join(", "), motionNoPreference: motion && queries.length === 1 };
}

/** `@container [nom] (condition) [and (condition)]`. */
export function parseContainer(prelude: string): ConditionResult {
  let s = clean(prelude);
  if (!s || !/^[a-z0-9 ().:<>=-]+$/.test(s)) throw new AtRuleError("media-syntax");
  let name = "";
  const nm = /^([a-z][a-z0-9-]{0,30})\s+(?=\()/.exec(s);
  if (nm && !["not", "and", "or"].includes(nm[1]!)) {
    name = nm[1]! + " ";
    s = s.slice(nm[0].length);
  }
  const parts = splitTop(s, " and ");
  if (parts.length > 3) throw new AtRuleError("media-too-many", { max: 3 });
  const texts = parts.map((p) => feature(parenInner(p), ["width", "height", "inline-size", "block-size"], BOUNDS.containerMinEm, BOUNDS.containerMaxEm, false).text);
  return { text: name + texts.join(" and "), motionNoPreference: false };
}

/** `@supports [not] (propriété: valeur) [and|or (propriété: valeur)]` ; la valeur est vérifiée par `checkDecl`. */
export function parseSupports(prelude: string, checkDecl: (prop: string, value: string) => string | null): ConditionResult {
  let s = prelude.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
  let not = false;
  if (/^not\s/i.test(s)) {
    not = true;
    s = s.slice(3).trim();
  }
  const out: string[] = [];
  let i = 0;
  let expectOp = false;
  let ops = 0;
  let joiner = "";
  while (i < s.length) {
    if (s[i] === " ") {
      i++;
      continue;
    }
    if (expectOp) {
      const m = /^(and|or)\s/i.exec(s.slice(i));
      if (!m) throw new AtRuleError("supports-syntax");
      const op = m[1]!.toLowerCase();
      if (joiner && joiner !== op) throw new AtRuleError("supports-syntax");
      joiner = op;
      i += m[0].length;
      expectOp = false;
      continue;
    }
    if (s[i] !== "(") throw new AtRuleError("supports-syntax");
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new AtRuleError("supports-syntax");
    const inner = s.slice(i + 1, j);
    const m = /^\s*(-?[A-Za-z][A-Za-z0-9-]*)\s*:\s*([\s\S]+?)\s*$/.exec(inner);
    if (!m) throw new AtRuleError("supports-syntax");
    const prop = m[1]!.toLowerCase();
    if (!ALLOWED_PROPERTIES.has(prop)) throw new AtRuleError("supports-property", { name: prop.slice(0, 40) });
    const value = checkDecl(prop, m[2]!);
    if (value === null) throw new AtRuleError("supports-value", { name: prop });
    out.push(`(${prop}: ${value})`);
    if (++ops > 4) throw new AtRuleError("media-too-many", { max: 4 });
    i = j + 1;
    expectOp = true;
  }
  if (!out.length || !expectOp) throw new AtRuleError("supports-syntax");
  return { text: (not ? "not " : "") + out.join(` ${joiner || "and"} `), motionNoPreference: false };
}
