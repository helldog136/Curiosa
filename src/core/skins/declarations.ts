/**
 * Vérification d'UNE déclaration CSS de skin (docs/SKINS.md §6.3) : propriété sur liste blanche, valeur analysée en jetons
 * puis réécrite, bornes propres à chaque propriété. Les règles « on ne masque pas, on ne sort pas de l'écran, on n'injecte
 * pas de texte » sont ici.
 */
import {
  ALLOWED_FUNCTIONS, ALLOWED_PROPERTIES, ANIMATION_KEYWORDS, ASSET_BASE_RE, BOUNDS, CLIP_PATH_PARTS, CONTENT_MAX_CHARS, CSS_WIDE_KEYWORDS,
  CURSOR_VALUES, DISPLAY_VALUES, FORBIDDEN_FUNCTION_CODES, HIDING_PROPERTIES, IMAGE_PATH_RE, IMAGE_URL_PROPERTIES,
  OVERFLOW_VALUES, POSITION_VALUES, SAFE_AREA_ENV, STRING_PROPERTIES, TINY_FONT_SIZE_KEYWORDS, VAR_NAME_RE, type SkinLimits,
} from "./allowlist";
import { parseColor } from "./colorParse";
import type { Subject } from "./selectors";
import { serializeTokens, tokenizeValue, type Tok } from "./valueTokens";

export type Params = Record<string, string | number>;
export type Report = (code: string, params?: Params, severity?: "error" | "warning") => void;

export type DeclContext = {
  skinId: string;
  limits: SkinLimits;
  /** Base d'URL servie (`/skins/<id>/<version>/`). Absente : `url(skin:chemin)` est conservé tel quel. */
  assetBase?: string;
  /** Ressources déclarées (`fonts/a.woff2`, `images/b.png`). Absent : tout chemin bien formé est accepté. */
  assets?: ReadonlySet<string>;
  /** Où se trouve la déclaration. `supports` : simple test de prise en charge, sans sujet. */
  where: "rule" | "keyframes" | "supports";
  /** Sujets des sélecteurs de la règle (vide hors règle). */
  subjects: readonly Subject[];
  /** Dans une image de `@keyframes`, la dernière (`to`, `100%`). */
  finalFrame?: boolean;
  /** À l'intérieur de `@media (prefers-reduced-motion: no-preference)`. */
  motionOk: boolean;
  /** Noms de `@keyframes` déclarés → nom écrit en sortie. */
  keyframes: ReadonlyMap<string, string>;
  /** Définitions de variables de la feuille (nom → valeurs littérales), pour suivre `display: var(--x)`. */
  defs?: ReadonlyMap<string, readonly string[]>;
  used: { assets: Set<string> };
  counters: { fixedBackgrounds: number };
};

export type DeclResult = {
  prop: string;
  value: string;
  /** Variables appelées par la valeur (détection de cycles). */
  refs: string[];
  /** Pour la vérification de boucle rapide au niveau de la règle. */
  infinite: boolean;
  durationsMs: number[];
};

const WIDE = new Set(CSS_WIDE_KEYWORDS);
const px = (t: Tok): number | null => {
  if (t.k === "num") return t.n === 0 ? 0 : null;
  if (t.k !== "dim") return null;
  if (t.unit === "px") return t.n;
  if (t.unit === "rem" || t.unit === "em") return t.n * 16;
  if (t.unit === "pt") return (t.n * 4) / 3;
  return null;
};
const meaningful = (toks: readonly Tok[]) => toks.filter((t) => t.k !== "ws");
const idents = (toks: readonly Tok[]) => meaningful(toks).filter((t): t is Extract<Tok, { k: "ident" }> => t.k === "ident").map((t) => t.v.toLowerCase());
const hasVar = (toks: readonly Tok[]) => toks.some((t) => t.k === "fn" && t.v === "var");

/** Découpe les jetons au niveau de profondeur 0 sur les virgules. */
function splitCommas(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "fn") depth++;
    else if (t.k === "close") depth--;
    if (t.k === "comma" && depth === 0) out.push([]);
    else out[out.length - 1]!.push(t);
  }
  return out;
}

/** Jetons « à plat » d'un niveau de profondeur donné (hors contenu des fonctions). */
function topLevel(toks: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "fn") {
      if (depth === 0) out.push(t);
      depth++;
    } else if (t.k === "close") {
      depth--;
    } else if (depth === 0) out.push(t);
  }
  return out;
}

/** Arguments (jetons) du premier niveau de la fonction qui commence à l'indice `i`. */
function fnArgs(toks: readonly Tok[], i: number): Tok[] {
  let depth = 0;
  const out: Tok[] = [];
  for (let j = i; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.k === "fn") {
      depth++;
      if (depth > 1) out.push(t);
    } else if (t.k === "close") {
      depth--;
      if (depth === 0) break;
      out.push(t);
    } else out.push(t);
  }
  return out;
}

const timeMs = (t: Tok): number | null => (t.k === "dim" && t.unit === "s" ? t.n * 1000 : t.k === "dim" && t.unit === "ms" ? t.n : null);
const angleDeg = (t: Tok): number | null => {
  if (t.k === "num" && t.n === 0) return 0;
  if (t.k !== "dim") return null;
  return t.unit === "deg" ? t.n : t.unit === "turn" ? t.n * 360 : t.unit === "rad" ? (t.n * 180) / Math.PI : t.unit === "grad" ? t.n * 0.9 : null;
};

/** Propriétés autorisées dans une image de `@keyframes` (apparence seulement, rien qui change la mise en page). */
const KEYFRAME_PROPERTIES: ReadonlySet<string> = new Set([
  "color", "background", "background-color", "background-position", "background-size", "background-image", "opacity", "transform", "transform-origin",
  "filter", "box-shadow", "text-shadow", "border-color", "outline-color", "outline-offset", "fill", "stroke", "stroke-width", "letter-spacing",
  "word-spacing", "accent-color", "caret-color", "text-decoration-color",
]);

const OFFSET_PROPS = new Set(["top", "right", "bottom", "left", "inset", "inset-block", "inset-inline", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end"]);
const BOX_PROPS = new Set(["width", "height", "max-width", "max-height"]);

export function lexErrorCode(error: string): string {
  switch (error) {
    case "too-long": case "too-many-tokens": return "value-too-long";
    case "nesting-too-deep": return "value-too-nested";
    case "hash-bad": return "color-bad";
    case "number-bad": case "unterminated": return "value-syntax";
    default: return error;
  }
}

/** Valeur candidate d'une variable (littérale), pour suivre les contournements `display: var(--x)`. */
function candidates(name: string, defs: ReadonlyMap<string, readonly string[]>, ctx: DeclContext, depth = 0): Tok[][] {
  const out: Tok[][] = [];
  for (const raw of defs.get(name) ?? []) {
    if (out.length >= 16) break;
    const lex = tokenizeValue(raw, { maxLength: ctx.limits.maxCustomValueLength, maxTokens: ctx.limits.maxValueTokens, maxNesting: ctx.limits.maxValueNesting });
    if ("error" in lex) continue;
    const toks = lex.tokens;
    const i = toks.findIndex((t) => t.k === "fn" && t.v === "var");
    if (i < 0) out.push(toks);
    else if (depth < 4) {
      const inner = varName(toks, i);
      for (const sub of candidates(inner ?? "", defs, ctx, depth + 1)) out.push(substitute(toks, i, sub));
    }
  }
  return out;
}

function varName(toks: readonly Tok[], i: number): string | null {
  const n = toks.slice(i + 1).find((t) => t.k !== "ws");
  return n && n.k === "ident" ? n.v : null;
}

/** Remplace l'appel `var(…)` commençant à `i` par `sub`. */
function substitute(toks: readonly Tok[], i: number, sub: readonly Tok[]): Tok[] {
  let depth = 0;
  let end = i;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.k === "fn") depth++;
    else if (t.k === "close") {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  return [...toks.slice(0, i), ...sub, ...toks.slice(end + 1)];
}

/** Valeur littérale d'une expression de calcul : nombre sans unité, pourcentage ou longueur en px (rem/em = 16 px). */
type Q = { v: number; u: "px" | "pct" | "num" };

/** Évalue `calc()/min()/max()/clamp()` quand tous les termes sont littéraux ; `null` sinon (variables, unités relatives…). */
function evalMath(toks: readonly Tok[], depth = 0): Q | null {
  let i = 0;
  const peek = () => {
    while (i < toks.length && toks[i]!.k === "ws") i++;
    return toks[i];
  };
  const add = (a: Q, b: Q, sign: number): Q | null => (a.u === b.u ? { v: a.v + sign * b.v, u: a.u } : null);
  const atom = (): Q | null => {
    const t = peek();
    if (!t || depth > 6) return null;
    i++;
    if (t.k === "num") return { v: t.n, u: "num" };
    if (t.k === "dim") {
      if (t.unit === "%") return { v: t.n, u: "pct" };
      const p = px(t);
      return p === null ? null : { v: p, u: "px" };
    }
    if (t.k === "fn") {
      // sous-expression : lit jusqu'à la parenthèse fermante correspondante
      let d = 1;
      const start = i;
      while (i < toks.length && d > 0) {
        const x = toks[i++]!;
        if (x.k === "fn") d++;
        else if (x.k === "close") d--;
      }
      if (d !== 0) return null;
      const inner = toks.slice(start, i - 1);
      if (t.v === "" || t.v === "calc") return evalMath(inner, depth + 1);
      if (t.v === "min" || t.v === "max" || t.v === "clamp") {
        const args = splitCommas(inner).map((a) => evalMath(a, depth + 1));
        if (args.some((a) => a === null) || args.length === 0) return null;
        const list = args as Q[];
        if (list.some((a) => a.u !== list[0]!.u)) return null;
        const vs = list.map((a) => a.v);
        if (t.v === "clamp") return vs.length === 3 ? { v: Math.min(Math.max(vs[1]!, vs[0]!), vs[2]!), u: list[0]!.u } : null;
        return { v: t.v === "min" ? Math.min(...vs) : Math.max(...vs), u: list[0]!.u };
      }
      return null;
    }
    return null;
  };
  const term = (): Q | null => {
    let a = atom();
    for (;;) {
      const t = peek();
      if (a === null || !t || (t.k !== "op" && t.k !== "slash") || (t.k === "op" && t.v !== "*")) return a;
      i++;
      const b = atom();
      if (b === null) return null;
      if (t.k === "slash") a = b.u === "num" && b.v !== 0 ? { v: a.v / b.v, u: a.u } : null;
      else a = a.u === "num" ? { v: a.v * b.v, u: b.u } : b.u === "num" ? { v: a.v * b.v, u: a.u } : null;
    }
  };
  let acc = term();
  for (;;) {
    const t = peek();
    if (acc === null) return null;
    if (!t) return Number.isFinite(acc.v) ? acc : null;
    if (t.k !== "op" || t.v === "*") return null;
    i++;
    const b = term();
    if (b === null) return null;
    acc = add(acc, b, t.v === "+" ? 1 : -1);
  }
}

/** Remplace chaque `calc()/min()/max()/clamp()` entièrement littéral par sa valeur, pour que les bornes (`calc(0px)` = zéro) s'y appliquent. */
function foldMath(toks: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === "fn" && ["calc", "min", "max", "clamp"].includes(t.v)) {
      let d = 0;
      let end = -1;
      for (let j = i; j < toks.length; j++) {
        const x = toks[j]!;
        if (x.k === "fn") d++;
        else if (x.k === "close" && --d === 0) {
          end = j;
          break;
        }
      }
      if (end > 0) {
        const q = evalMath(toks.slice(i, end + 1));
        if (q) {
          const raw = String(Math.round(q.v * 1000) / 1000);
          out.push(q.u === "num" ? { k: "num", n: q.v, raw } : { k: "dim", n: q.v, unit: q.u === "pct" ? "%" : "px", raw: raw + (q.u === "pct" ? "%" : "px") });
          i = end;
          continue;
        }
      }
    }
    out.push(t);
  }
  return out;
}

type Check = { prop: string; toks: readonly Tok[]; ctx: DeclContext; report: Report; meta: { infinite: boolean; durationsMs: number[] } };

const decorOnly = (ctx: DeclContext) => ctx.subjects.length > 0 && ctx.subjects.every((s) => s.decor);
const strictness = (ctx: DeclContext) => ctx.where !== "supports" && !decorOnly(ctx);

function checkProperty({ prop, toks: original, ctx, report, meta }: Check): void {
  const toks = foldMath(original);
  const strict = strictness(ctx);
  const decor = decorOnly(ctx);
  const m = meaningful(toks);
  const one = m.length === 1 ? m[0]! : null;
  const ids = idents(toks);
  const bad = (value?: string) => report("value-not-allowed", { prop, value: (value ?? serializeTokens(toks, (p) => `url(${p})`)).slice(0, 40) });

  switch (prop) {
    case "display": {
      if (!one || one.k !== "ident") {
        if (!hasVar(toks)) bad();
        return;
      }
      const v = one.v.toLowerCase();
      if (WIDE.has(v) || DISPLAY_VALUES.includes(v)) return;
      if (v !== "none") return bad(v);
      if (ctx.where !== "rule") return report("hide-forbidden", { prop });
      for (const s of ctx.subjects) {
        if (s.decor) continue;
        if (s.part === "menu-toggle" && !s.pseudoElement) {
          report("menu-toggle-hidden", {}, "warning");
          continue;
        }
        if ((s.part === "nav-list" || s.part === "submenu") && s.closed && !s.pseudoElement) continue;
        return report("hide-forbidden", { prop });
      }
      return;
    }
    case "position": {
      if (!one || one.k !== "ident") {
        if (!hasVar(toks)) bad();
        return;
      }
      const v = one.v.toLowerCase();
      if (WIDE.has(v)) return;
      if (!POSITION_VALUES.includes(v)) return bad(v);
      if (v === "fixed") {
        const ok = ctx.where === "rule" && ctx.subjects.length > 0 && ctx.subjects.every((s) => !s.pseudoElement && (s.region === "header" || s.region === "nav"));
        if (!ok) report("position-fixed-forbidden");
      }
      return;
    }
    case "opacity": {
      if (one && (one.k === "num" || (one.k === "dim" && one.unit === "%"))) {
        const v = one.k === "num" ? one.n : one.n / 100;
        const min = ctx.where === "keyframes" || strict ? BOUNDS.minContentOpacity : 0;
        if (v < min) report("opacity-too-low", { min: BOUNDS.minContentOpacity });
      }
      return;
    }
    case "z-index": {
      if (one && one.k === "num" && (!Number.isInteger(one.n) || one.n < 0 || one.n > BOUNDS.maxZIndex)) report("z-index-range", { max: BOUNDS.maxZIndex });
      return;
    }
    case "order": {
      if (one && one.k === "num" && (!Number.isInteger(one.n) || Math.abs(one.n) > BOUNDS.maxOrder)) report("order-range", { max: BOUNDS.maxOrder });
      return;
    }
    case "float": {
      if (one && one.k === "ident" && one.v.toLowerCase() !== "none" && !WIDE.has(one.v.toLowerCase())) report("float-not-none");
      else if (!one && !hasVar(toks)) report("float-not-none");
      return;
    }
    case "overflow": case "overflow-x": case "overflow-y": {
      for (const t of m) if (t.k !== "ident" || !(OVERFLOW_VALUES.includes(t.v.toLowerCase()) || WIDE.has(t.v.toLowerCase()))) if (t.k !== "fn" && t.k !== "close") bad();
      return;
    }
    case "cursor": {
      for (const t of m) if (t.k === "ident" && !(CURSOR_VALUES.includes(t.v.toLowerCase()) || WIDE.has(t.v.toLowerCase()))) bad(t.v);
      return;
    }
    case "pointer-events": case "user-select": {
      for (const v of ids) {
        if (WIDE.has(v) || v === "auto") continue;
        if (prop === "user-select" && (v === "text" || v === "all" || v === "contain")) continue;
        if (v === "none" && decor) continue;
        report(prop === "pointer-events" ? "pointer-events-content" : "pointer-events-content", { prop });
      }
      return;
    }
    case "mix-blend-mode": {
      if (ids.some((v) => v !== "normal" && !WIDE.has(v)) && strict) report("blend-mode-content");
      return;
    }
    case "font-size": {
      checkFontSize(topLevel(toks).filter((t) => t.k !== "ws"), report);
      return;
    }
    case "font": {
      // taille = le jeton qui précède « / », sinon la première dimension ; un `0` nu n'est jamais une graisse
      const slash = m.findIndex((t) => t.k === "slash");
      const sizes: Tok[] = [];
      if (slash > 0) sizes.push(m[slash - 1]!);
      const dim = m.find((t) => t.k === "dim");
      if (dim) sizes.push(dim);
      for (const t of m) if (t.k === "num" && t.n === 0) sizes.push(t);
      checkFontSize(sizes, report);
      const lh = slash >= 0 ? m[slash + 1] : undefined;
      if (lh) checkLineHeight([lh], report);
      return;
    }
    case "line-height": {
      checkLineHeight(topLevel(toks).filter((t) => t.k !== "ws"), report);
      return;
    }
    case "letter-spacing": case "word-spacing": {
      for (const t of topLevel(toks)) {
        const v = px(t);
        if (v !== null && Math.abs(v) > BOUNDS.maxLetterSpacingPx) report("spacing-too-large", { prop });
      }
      return;
    }
    case "text-indent": {
      for (const t of topLevel(toks)) {
        const v = px(t);
        if (v !== null && (v < BOUNDS.minTextIndentEm * 16 || v > BOUNDS.maxTextIndentRem * 16)) report("text-indent-bad");
      }
      return;
    }
    case "color": {
      if (strict && ctx.where !== "keyframes") {
        const col = parseColor(serializeTokens(toks, () => "x"));
        if (col && col.a < 0.5) report("text-transparent");
      }
      return;
    }
    case "scroll-behavior": {
      if (ids.includes("smooth") && !ctx.motionOk) report("smooth-scroll-needs-motion-query");
      return;
    }
    case "background-attachment": case "background": {
      if (ids.includes("fixed")) {
        ctx.counters.fixedBackgrounds++;
        if (ctx.counters.fixedBackgrounds > ctx.limits.maxFixedBackgrounds) report("fixed-background-limit", { max: ctx.limits.maxFixedBackgrounds });
      }
      return;
    }
    case "background-clip": {
      for (const v of ids) if (!["border-box", "padding-box", "content-box"].includes(v) && !WIDE.has(v)) bad(v);
      return;
    }
    case "transform": {
      checkTransform(toks, ctx, report, decor);
      return;
    }
    case "filter": case "backdrop-filter": case "-webkit-backdrop-filter": {
      checkFilter(prop, toks, strict, report);
      return;
    }
    case "clip-path": {
      if (one && one.k === "ident" && (one.v.toLowerCase() === "none" || WIDE.has(one.v.toLowerCase()))) return;
      const subjectOk = decor || (ctx.subjects.length > 0 && ctx.subjects.every((s) => s.part !== null && CLIP_PATH_PARTS.includes(s.part) && !s.pseudoElement));
      if (!subjectOk) return report("clip-path-subject");
      if (!clipShapeOk(toks)) report("clip-path-bad");
      return;
    }
    case "mask-image": {
      if (one && one.k === "ident" && (one.v.toLowerCase() === "none" || WIDE.has(one.v.toLowerCase()))) return;
      if (strict) report("mask-needs-decor");
      return;
    }
    case "transition": case "transition-duration": case "transition-delay": {
      for (const t of topLevel(toks)) {
        const ms = timeMs(t);
        if (ms !== null && ms > BOUNDS.maxTransitionMs) report("transition-too-long", { max: BOUNDS.maxTransitionMs });
      }
      return;
    }
    case "content": case "quotes": return;
    default:
      break;
  }
  if (OFFSET_PROPS.has(prop)) {
    for (const t of m) {
      if (t.k === "dim" && t.unit === "%") {
        // les pourcentages dans calc() sont libres ; seuls les décalages directs sont bornés
      }
      const v = px(t);
      if (v !== null && (v < BOUNDS.minOffsetPx || v > BOUNDS.maxOffsetPx)) report("offset-out-of-range");
      if (t.k === "dim" && (t.unit === "vw" || t.unit === "vh") && (t.n < 0 || t.n > 100)) report("offset-out-of-range");
    }
    for (const t of topLevel(toks)) if (t.k === "dim" && t.unit === "%" && (t.n < 0 || t.n > 100)) report("offset-out-of-range");
    return;
  }
  if (BOX_PROPS.has(prop) && strict && ctx.where === "rule") {
    for (const t of topLevel(toks)) {
      const v = px(t);
      if (v !== null && v < BOUNDS.minBoxPx) report("box-collapsed", { prop });
      if (t.k === "dim" && t.unit === "%" && t.n === 0) report("box-collapsed", { prop });
      if (t.k === "dim" && ["vw", "vh", "ch", "ex"].includes(t.unit) && t.n === 0) report("box-collapsed", { prop });
    }
    return;
  }
  if (prop === "margin" || prop.startsWith("margin-")) {
    for (const t of m) {
      const v = px(t);
      if (v !== null && v < BOUNDS.minMarginPx) report("margin-too-negative", { min: 4 });
    }
    return;
  }
  if (prop.startsWith("animation")) {
    checkAnimation(prop, toks, ctx, report, meta);
    return;
  }
}

function checkFontSize(m: readonly Tok[], report: Report) {
  for (const t of m) {
    if (t.k === "ident") {
      if (TINY_FONT_SIZE_KEYWORDS.includes(t.v.toLowerCase())) report("font-size-too-small");
    } else if (t.k === "num") {
      if (t.n === 0) report("font-size-too-small");
    } else if (t.k === "dim") {
      if (t.unit === "%") {
        if (t.n < (BOUNDS.minFontSizePx / 16) * 100) report("font-size-too-small");
      } else {
        const v = px(t);
        if (v !== null && v < BOUNDS.minFontSizePx) report("font-size-too-small");
      }
    }
  }
}

function checkLineHeight(m: readonly Tok[], report: Report) {
  for (const t of m) {
    if (t.k === "num" && t.n < BOUNDS.minLineHeight) report("line-height-too-small");
    else if (t.k === "dim" && t.unit === "%" && t.n < BOUNDS.minLineHeight * 100) report("line-height-too-small");
    else if (t.k === "dim") {
      const v = px(t);
      if (v !== null && v < 8) report("line-height-too-small");
      else if (v === null && (t.unit === "em" || t.unit === "lh") && t.n < BOUNDS.minLineHeight) report("line-height-too-small");
    }
  }
}

function checkTransform(toks: readonly Tok[], ctx: DeclContext, report: Report, decor: boolean) {
  const strict = strictness(ctx);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === "ident") {
      if (t.v.toLowerCase() !== "none" && !WIDE.has(t.v.toLowerCase())) report("value-not-allowed", { prop: "transform", value: t.v.slice(0, 40) });
      continue;
    }
    if (t.k !== "fn" || t.v === "" || t.v === "var" || t.v === "calc" || t.v === "min" || t.v === "max" || t.v === "clamp") continue;
    const args = meaningful(fnArgs(toks, i));
    const name = t.v;
    if (["translate", "translatex", "translatey"].includes(name)) {
      if (decor) continue;
      for (const a of args) {
        const v = px(a);
        if (v !== null && Math.abs(v) > BOUNDS.maxTranslatePx) report("transform-too-large");
        if (a.k === "dim" && a.unit === "%" && Math.abs(a.n) > BOUNDS.maxTranslatePercent) report("transform-too-large");
        if (a.k === "dim" && ["vw", "vh"].includes(a.unit)) report("transform-too-large");
      }
    } else if (name === "rotate") {
      for (const a of args) {
        const d = angleDeg(a);
        if (d !== null && strict && Math.abs(d) > BOUNDS.maxRotateDeg) report("transform-too-large");
      }
    } else if (["scale", "scalex", "scaley"].includes(name)) {
      for (const a of args) {
        if (a.k === "num" && strict && (a.n < BOUNDS.minScale || a.n > BOUNDS.maxScale)) report("transform-too-large");
        if (a.k === "dim" && a.unit === "%" && strict && (a.n < BOUNDS.minScale * 100 || a.n > BOUNDS.maxScale * 100)) report("transform-too-large");
      }
    } else if (!["calc", "var", "min", "max", "clamp"].includes(name)) {
      report("transform-not-allowed", { name });
    }
  }
}

function checkFilter(prop: string, toks: readonly Tok[], strict: boolean, report: Report) {
  const allowed = ["blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia"];
  const isBackdrop = prop !== "filter";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k !== "fn" || t.v === "" || ["var", "calc", "min", "max", "clamp"].includes(t.v)) continue;
    if (!allowed.includes(t.v)) {
      // fonctions de couleur à l'intérieur de drop-shadow : déjà autorisées globalement ; ici seulement les noms de filtres
      if (["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color-mix"].includes(t.v)) continue;
      report("filter-not-allowed", { name: t.v });
      continue;
    }
    const args = meaningful(fnArgs(toks, i));
    const first = args[0];
    if (!first) continue;
    if (t.v === "blur") {
      const v = px(first);
      const max = isBackdrop ? BOUNDS.maxBackdropBlurPx : strict ? BOUNDS.maxContentBlurPx : BOUNDS.maxDecorBlurPx;
      if (v !== null && v > max) report("filter-too-strong", { name: "blur", max });
    } else if (!isBackdrop && strict && (t.v === "brightness" || t.v === "contrast")) {
      const v = first.k === "num" ? first.n : first.k === "dim" && first.unit === "%" ? first.n / 100 : null;
      if (v !== null && (v < BOUNDS.minFilterFactor || v > BOUNDS.maxFilterFactor)) report("filter-too-strong", { name: t.v, max: BOUNDS.maxFilterFactor });
    } else if (!isBackdrop && strict && t.v === "opacity") {
      const v = first.k === "num" ? first.n : first.k === "dim" && first.unit === "%" ? first.n / 100 : null;
      if (v !== null && v < BOUNDS.minContentOpacity) report("opacity-too-low", { min: BOUNDS.minContentOpacity });
    }
  }
}

/** `inset(0 … round …)`, `circle(50%)`, `ellipse(50% 50%)` : formes qui découpent les coins sans cacher de contenu. */
function clipShapeOk(toks: readonly Tok[]): boolean {
  const m = meaningful(toks);
  const f = m[0];
  if (!f || f.k !== "fn" || m[m.length - 1]!.k !== "close") return false;
  const args = m.slice(1, -1);
  const zero = (t: Tok) => (t.k === "num" && t.n === 0) || (t.k === "dim" && t.n === 0);
  if (f.v === "circle") return args.length === 1 && args[0]!.k === "dim" && args[0]!.unit === "%" && args[0]!.n === 50;
  if (f.v === "ellipse") return args.length === 2 && args.every((a) => a.k === "dim" && a.unit === "%" && a.n === 50);
  if (f.v === "inset") {
    const r = args.findIndex((a) => a.k === "ident" && a.v.toLowerCase() === "round");
    const before = r < 0 ? args : args.slice(0, r);
    const after = r < 0 ? [] : args.slice(r + 1);
    if (before.length < 1 || before.length > 4 || !before.every(zero)) return false;
    if (r >= 0 && (after.length < 1 || !after.every((a) => a.k === "dim" || a.k === "num" || a.k === "slash"))) return false;
    return true;
  }
  return false;
}

function checkAnimation(prop: string, toks: readonly Tok[], ctx: DeclContext, report: Report, meta: { infinite: boolean; durationsMs: number[] }) {
  if (ctx.where === "rule" && !ctx.motionOk) report("animation-needs-motion-query");
  const maxMs = BOUNDS.maxAnimationMs;
  const segments = splitCommas(toks);
  for (const seg of segments) {
    const flat = topLevel(seg).filter((t) => t.k !== "ws");
    let times = 0;
    for (const t of flat) {
      const ms = timeMs(t);
      if (ms !== null) {
        if (ms > maxMs) report("animation-too-long", { max: maxMs / 1000 });
        if ((prop === "animation" && times === 0) || prop === "animation-duration") meta.durationsMs.push(ms);
        times++;
      } else if (t.k === "num" && (prop === "animation" || prop === "animation-iteration-count")) {
        if (t.n > BOUNDS.maxAnimationIterations || t.n < 0) report("animation-iterations", { max: BOUNDS.maxAnimationIterations });
      } else if (t.k === "ident") {
        const v = t.v.toLowerCase();
        if (v === "infinite") meta.infinite = true;
        const isName = prop === "animation-name" || (prop === "animation" && !ANIMATION_KEYWORDS.includes(v) && !WIDE.has(v));
        if (isName && v !== "none" && !WIDE.has(v)) {
          const out = ctx.keyframes.get(t.v);
          if (!out) report("animation-name-unknown", { name: t.v.slice(0, 40) });
          else t.v = out;
        }
      }
    }
  }
}

/**
 * Vérifie une déclaration. Rend la propriété et la valeur RÉÉCRITES, ou `null` si la déclaration est refusée
 * (les raisons ont été signalées par `report`).
 */
export function checkDeclaration(propRaw: string, valueRaw: string, important: boolean, ctx: DeclContext, report: Report): DeclResult | null {
  const isCustom = propRaw.startsWith("--");
  const prop = isCustom ? propRaw : propRaw.toLowerCase();
  let failed = false;
  const fail: Report = (code, params, severity) => {
    if ((severity ?? "error") === "error") failed = true;
    report(code, { prop, ...(params ?? {}) }, severity);
  };
  if (important) {
    fail("important-forbidden");
    return null;
  }
  if (isCustom) {
    if (!VAR_NAME_RE.test(prop)) {
      fail("custom-property-name", { name: prop.slice(0, 40) });
      return null;
    }
    if (ctx.where !== "rule") {
      fail("custom-property-name", { name: prop.slice(0, 40) });
      return null;
    }
  } else if (HIDING_PROPERTIES.includes(prop)) {
    fail("hiding-property");
    return null;
  } else if (!/^-?[a-z][a-z-]*$/.test(prop) || !ALLOWED_PROPERTIES.has(prop)) {
    fail("property-not-allowed", { name: prop.slice(0, 40) });
    return null;
  } else if (ctx.where === "keyframes" && !KEYFRAME_PROPERTIES.has(prop)) {
    fail("keyframe-property");
    return null;
  }
  const lex = tokenizeValue(valueRaw, {
    maxLength: isCustom ? ctx.limits.maxCustomValueLength : ctx.limits.maxValueLength,
    maxTokens: ctx.limits.maxValueTokens,
    maxNesting: ctx.limits.maxValueNesting,
  });
  if ("error" in lex) {
    fail(lexErrorCode(lex.error), lex.char ? { char: lex.char === "�" ? "?" : lex.char } : {});
    return null;
  }
  const tokens = lex.tokens;
  if (meaningful(tokens).length === 0) {
    fail("value-empty");
    return null;
  }
  const refs: string[] = [];
  const stringsOk = isCustom ? /^--(v-font|sk-font-[a-z0-9-]+)$/.test(prop) : (STRING_PROPERTIES as readonly string[]).includes(prop);
  const urlOk = isCustom || (IMAGE_URL_PROPERTIES as readonly string[]).includes(prop);
  const isContent = prop === "content" || prop === "quotes";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.k === "ident" && t.v.startsWith("--")) {
      // un nom de variable n'a sa place que comme premier argument de var()
      const before = tokens.slice(0, i).filter((x) => x.k !== "ws").pop();
      if (!before || before.k !== "fn" || before.v !== "var") fail("value-syntax");
    } else if (t.k === "fn" && t.v !== "") {
      if (t.v === "var") {
        if (isContent) {
          fail("content-not-allowed");
          continue;
        }
        const name = varName(tokens, i);
        const after = tokens.slice(i + 1).filter((x) => x.k !== "ws")[1];
        if (!name || !VAR_NAME_RE.test(name)) fail("var-name-not-allowed", { name: (name ?? "").slice(0, 40) });
        else if (!after || (after.k !== "comma" && after.k !== "close")) fail("value-syntax");
        else refs.push(name);
      } else if (t.v === "env") {
        const name = varName(tokens, i);
        if (!name || !SAFE_AREA_ENV.includes(name.toLowerCase())) fail("env-not-allowed", { name: (name ?? "").slice(0, 40) });
      } else if (!ALLOWED_FUNCTIONS.includes(t.v)) {
        fail(FORBIDDEN_FUNCTION_CODES[t.v] ?? "function-not-allowed", { name: t.v.slice(0, 40) });
      } else if (t.v === "format" && prop !== "src") {
        fail("function-not-allowed", { name: t.v });
      } else if (isContent) {
        fail("content-not-allowed");
      }
    } else if (t.k === "url") {
      if (!urlOk) {
        fail("url-not-allowed-here");
      } else if (!t.v.startsWith("skin:")) {
        fail("url-external", { url: t.v.slice(0, 40) });
      } else {
        const path = t.v.slice(5);
        if (!IMAGE_PATH_RE.test(path)) fail("url-path-bad", { path: path.slice(0, 60) });
        else if (ctx.assets && !ctx.assets.has(path)) fail("asset-not-declared", { path });
        else ctx.used.assets.add(path);
      }
    } else if (t.k === "str") {
      if (!stringsOk) fail("string-not-allowed");
      else if (isContent) checkContentString(t.v, prop, fail);
      else if (prop === "grid-template-areas" || prop === "grid-template" || prop === "grid") {
        if (!/^[A-Za-z0-9 ._-]{1,100}$/.test(t.v)) fail("string-not-allowed");
      } else if (prop === "font-feature-settings") {
        if (!/^[A-Za-z0-9]{4}$/.test(t.v)) fail("string-not-allowed");
      } else if (!/^[A-Za-z0-9 _-]{1,64}$/.test(t.v)) fail("font-name-bad");
    } else if (t.k === "ident" && isContent) {
      const v = t.v.toLowerCase();
      if (!(v === "none" || v === "normal" || v === "auto" || WIDE.has(v))) fail("content-not-allowed");
    } else if ((t.k === "lbr" || t.k === "rbr") && !(prop.startsWith("grid") || isCustom)) {
      fail("value-syntax");
    } else if (t.k === "num" || t.k === "dim" || t.k === "hash" || t.k === "comma" || t.k === "slash" || t.k === "op") {
      if (isContent) fail("content-not-allowed");
    }
  }
  if (isContent && !failed) {
    const subjOk = ctx.subjects.length > 0 && ctx.subjects.every((s) => s.pseudoElement === "before" || s.pseudoElement === "after");
    const m = meaningful(tokens);
    const isNone = m.length === 1 && m[0]!.k === "ident";
    if (prop === "content" && !subjOk && !(isNone && ["none", "normal"].includes((m[0] as Extract<Tok, { k: "ident" }>).v.toLowerCase())) && ctx.where === "rule") fail("content-selector");
    if (m.length > (prop === "quotes" ? 4 : 1)) fail("content-not-allowed");
  }
  if (failed) return null;

  const meta = { infinite: false, durationsMs: [] as number[] };
  if (!isCustom) {
    const check: Check = { prop, toks: tokens, ctx, report: fail, meta };
    checkProperty(check);
    if (failed) return null;
    // contournements par variables : on essaie les valeurs littérales que la feuille donne à chaque variable utilisée
    if (ctx.defs && hasVar(tokens) && !isContent) {
      let tried = 0;
      for (let i = 0; i < tokens.length && tried < 8; i++) {
        const t = tokens[i]!;
        if (t.k !== "fn" || t.v !== "var") continue;
        const name = varName(tokens, i);
        if (!name) continue;
        tried++;
        for (const cand of candidates(name, ctx.defs, ctx)) {
          checkProperty({ prop, toks: substitute(tokens, i, cand), ctx, report: fail, meta: { infinite: false, durationsMs: [] } });
        }
      }
      if (failed) return null;
    }
  }
  const value = serializeTokens(tokens, (p) => urlOut(p, ctx));
  if (/[<>{}\;@!]|\/\*|expression|javascript:|data:|behavior|binding/i.test(value.replace(/"[^"]*"/g, '""'))) {
    // filet de sécurité : ne devrait jamais se produire après l'analyse des jetons
    fail("char-forbidden", { char: "?" });
    return null;
  }
  return { prop, value, refs, infinite: meta.infinite, durationsMs: meta.durationsMs };
}

export function urlOut(path: string, ctx: Pick<DeclContext, "assetBase">): string {
  if (ctx.assetBase && ASSET_BASE_RE.test(ctx.assetBase) && path.startsWith("skin:")) return `url("${ctx.assetBase}${path.slice(5)}")`;
  return `url(${path})`;
}

function checkContentString(text: string, prop: string, fail: Report) {
  const chars = [...text];
  if (prop === "quotes") {
    if (chars.length > CONTENT_MAX_CHARS) fail("content-not-allowed");
  } else if (chars.length > CONTENT_MAX_CHARS) {
    fail("content-too-long", { max: CONTENT_MAX_CHARS });
    return;
  }
  for (const ch of chars) {
    if (ch !== "\uFFFD" && (ch === " " || /^[\p{P}\p{S}]$/u.test(ch))) continue;
    fail("content-not-allowed");
    return;
  }
}

