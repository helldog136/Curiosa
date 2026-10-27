/**
 * Assainisseur de la feuille de style d'un skin (docs/SKINS.md §6) : fonction PURE, sans Next, sans base de données, sans
 * réseau, sans minuteur. Elle analyse la feuille avec PostCSS, applique la liste blanche de `allowlist.ts` et RÉÉCRIT une
 * feuille sûre à partir de ce qui a été compris (rien n'est recopié tel quel).
 *
 * Garanties (testées, y compris par fuzz) : la sortie ne contient ni `@import`, ni `url()` autre que `url(skin:…)` (ou son
 * chemin servi), ni `expression`, ni `javascript:`, ni `data:`, ni `<`, ni `\`, ni sélecteur sans le préfixe
 * `:root[data-skin="<id>"]`, ni classe, ni identifiant, ni `!important`. Aucune exception ne s'échappe.
 *
 * Un refus n'est jamais silencieux : chaque problème est une `SkinIssue` (code stable pour les auteurs, message simple
 * FR/EN pour la personne). Les plafonds (taille, nombre de règles…) sont FATALS : rien n'est appliqué (sortie vide), comme
 * le veut §6.6. Les autres erreurs retirent la règle ou la déclaration fautive et marquent `ok: false` (le skin est refusé
 * à l'installation).
 */
import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from "postcss";
import { parseContainer, parseMedia, parseSupports, AtRuleError } from "./atrules";
import {
  ALLOWED_AT_RULES, ANIMATION_KEYWORDS, BOUNDS, ASSET_BASE_RE, CONDITIONAL_AT_RULES, CSS_WIDE_KEYWORDS, DEFAULT_LIMITS, FONT_PATH_RE, SKIN_ID_RE, type SkinLimits,
} from "./allowlist";
import { checkDeclaration, urlOut, type DeclContext } from "./declarations";
import type { Params } from "./messages";
import { makeIssue, type SkinIssue } from "./messages";
import { parseSelectorList, SelectorError, stripAuthorScope, validateAndRewrite, type Complex, type Subject } from "./selectors";
import { encodeCssString, tokenizeValue } from "./valueTokens";

export type SanitizeOptions = {
  /** Id du skin (`^[a-z][a-z0-9-]{1,40}$`), égal au nom de son dossier. */
  skinId: string;
  /** Base servie par le cœur pour les ressources : `/skins/<id>/<version>/`. Absente : `url(skin:chemin)` reste tel quel. */
  assetBase?: string;
  /** Ressources déclarées dans le manifeste (`fonts/a.woff2`, `images/b.png`). Absent : tout chemin bien formé est accepté. */
  assets?: readonly string[];
  /** Familles de polices déclarées dans le manifeste (`assets[].family`). Absent : toute famille est acceptée. */
  fontFamilies?: readonly string[];
  /** Pièces des modules installés (`{ idDuModule: ["piece"] }`). Absent : toute pièce `module.piece` bien formée est acceptée. */
  moduleParts?: Readonly<Record<string, readonly string[]>>;
  /** Plafonds (les valeurs par défaut sont celles de §5.3/§6.6). */
  limits?: Partial<SkinLimits>;
};

export type SanitizeStats = {
  bytes: number;
  rules: number;
  declarations: number;
  keyframes: number;
  fontFaces: number;
  /** Ressources `skin:` utilisées par la feuille. */
  assets: string[];
};

export type SanitizeResult = {
  /** Vrai s'il n'y a aucune erreur (les avertissements ne comptent pas). Un skin dont `ok` est faux n'est pas installé. */
  ok: boolean;
  /** La feuille réécrite, sûre. Vide si un plafond est dépassé ou si la feuille est illisible. */
  css: string;
  issues: SkinIssue[];
  stats: SanitizeStats;
};

const MAX_ISSUES = 200;

type DeclOut = { prop: string; value: string; line?: number };
type Out =
  | { type: "rule"; selectors: string[]; decls: DeclOut[] }
  | { type: "at"; header: string; children: Out[] }
  | { type: "keyframes"; name: string; frames: { selector: string; decls: DeclOut[] }[] }
  | { type: "fontface"; text: string };

class Fatal extends Error {}

type State = {
  opts: SanitizeOptions;
  limits: SkinLimits;
  issues: SkinIssue[];
  truncated: boolean;
  rules: number;
  declarations: number;
  keyframes: number;
  fontFaces: number;
  used: { assets: Set<string> };
  counters: { fixedBackgrounds: number };
  keyframeMap: Map<string, string>;
  defs: Map<string, string[]>;
  assets?: ReadonlySet<string>;
  outlineRemoved: { line?: number } | null;
  focusIndicator: boolean;
  customDecls: { name: string; refs: string[]; length: number; target: DeclOut[]; decl: DeclOut }[];
};

function emptyResult(bytes: number, issues: SkinIssue[]): SanitizeResult {
  return { ok: !issues.some((i) => i.severity === "error"), css: "", issues, stats: { bytes, rules: 0, declarations: 0, keyframes: 0, fontFaces: 0, assets: [] } };
}

export function sanitizeSkinCss(css: unknown, options: SanitizeOptions): SanitizeResult {
  try {
    return run(css, options);
  } catch {
    return emptyResult(0, [makeIssue("internal-error", {}, "error")]);
  }
}

function run(css: unknown, opts: SanitizeOptions): SanitizeResult {
  const issues: SkinIssue[] = [];
  const bad = (code: string, params: Params = {}) => issues.push(makeIssue(code, params));
  if (typeof css !== "string") {
    bad("css-not-text");
    return emptyResult(0, issues);
  }
  if (typeof opts?.skinId !== "string" || !SKIN_ID_RE.test(opts.skinId) || opts.skinId === "basic") {
    bad("bad-skin-id");
    return emptyResult(0, issues);
  }
  if (opts.assetBase !== undefined && !ASSET_BASE_RE.test(opts.assetBase)) {
    bad("bad-asset-base");
    return emptyResult(0, issues);
  }
  const limits: SkinLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  let source = css.charCodeAt(0) === 0xfeff ? css.slice(1) : css;
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > limits.maxBytes) {
    bad("sheet-too-large", { size: Math.ceil(bytes / 1024), max: Math.floor(limits.maxBytes / 1024) });
    return emptyResult(bytes, issues);
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(source)) {
    bad("invalid-character");
    return emptyResult(bytes, issues);
  }
  // sauts de ligne Unicode et textes bidirectionnels : inutiles dans une feuille, refusés hors commentaires par les analyseurs suivants
  source = source.replace(/\r\n?/g, "\n");

  let root: Root;
  try {
    root = postcss.parse(source, { from: undefined });
  } catch (e) {
    const err = e as { line?: number; column?: number };
    const issue = makeIssue("css-syntax", { line: err.line ?? 0 });
    issue.line = err.line;
    issue.column = err.column;
    issues.push(issue);
    return emptyResult(bytes, issues);
  }

  const state: State = {
    opts,
    limits,
    issues,
    truncated: false,
    rules: 0,
    declarations: 0,
    keyframes: 0,
    fontFaces: 0,
    used: { assets: new Set() },
    counters: { fixedBackgrounds: 0 },
    keyframeMap: new Map(),
    defs: new Map(),
    assets: opts.assets ? new Set(opts.assets) : undefined,
    outlineRemoved: null,
    focusIndicator: false,
    customDecls: [],
  };

  let tree: Out[] = [];
  try {
    prepass(root, state);
    tree = processNodes(root.nodes, state, 0, false);
  } catch (e) {
    if (!(e instanceof Fatal)) throw e;
    return { ok: false, css: "", issues: state.issues, stats: stats(state, bytes) };
  }

  finishVariables(state);
  if (state.outlineRemoved && !state.focusIndicator) {
    const issue = makeIssue("focus-indicator-missing", {});
    issue.line = state.outlineRemoved.line;
    push(state, issue);
  }

  const text = tree.map((n) => render(n)).filter(Boolean).join("\n");
  const ok = !state.issues.some((i) => i.severity === "error");
  return { ok, css: text, issues: state.issues, stats: stats(state, bytes) };
}

function stats(state: State, bytes: number): SanitizeStats {
  return { bytes, rules: state.rules, declarations: state.declarations, keyframes: state.keyframes, fontFaces: state.fontFaces, assets: [...state.used.assets].sort() };
}

function push(state: State, issue: SkinIssue) {
  if (state.issues.length >= MAX_ISSUES) {
    if (!state.truncated) {
      state.truncated = true;
      state.issues.push(makeIssue("too-many-issues", { max: MAX_ISSUES }));
    }
    return;
  }
  state.issues.push(issue);
}

function reporter(state: State, node?: { source?: { start?: { line: number; column: number } } }) {
  return (code: string, params: Params = {}, severity?: "error" | "warning") => {
    const issue = makeIssue(code, params, severity);
    issue.line = node?.source?.start?.line;
    issue.column = node?.source?.start?.column;
    push(state, issue);
  };
}

function fatal(state: State, node: { source?: { start?: { line: number; column: number } } } | undefined, code: string, params: Params): never {
  reporter(state, node)(code, params);
  throw new Fatal();
}

// ---------------------------------------------------------------------------------------------------------------------
// Avant-passe : noms de @keyframes et définitions de variables (pour suivre `display: var(--x)`).

function prepass(root: Root, state: State) {
  // parcours itératif (une feuille très imbriquée ne doit pas faire déborder la pile)
  const stack: ChildNode[] = [...(root.nodes ?? [])].reverse();
  let visited = 0;
  while (stack.length && visited++ < 200000) {
    const node = stack.pop()!;
    if (node.type === "atrule" && node.name.toLowerCase() === "keyframes") {
      const name = node.params.trim();
      if (/^[a-z][a-z0-9_-]{0,40}$/.test(name) && !ANIMATION_KEYWORDS.includes(name) && !CSS_WIDE_KEYWORDS.includes(name)) {
        const prefix = `sk-${state.opts.skinId}-`;
        const out = name.startsWith(prefix) ? name : prefix + name;
        state.keyframeMap.set(name, out);
        state.keyframeMap.set(out, out);
      }
    } else if (node.type === "decl" && node.prop.startsWith("--") && state.defs.size < 2000) {
      const list = state.defs.get(node.prop) ?? [];
      if (list.length < 16) list.push(node.value);
      state.defs.set(node.prop, list);
    }
    if ("nodes" in node && node.nodes) for (let i = node.nodes.length - 1; i >= 0; i--) stack.push(node.nodes[i]!);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

function countRule(state: State, node: ChildNode) {
  state.rules++;
  if (state.rules > state.limits.maxRules) fatal(state, node, "too-many-rules", { max: state.limits.maxRules });
}

function safeName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "?").slice(0, 30);
}

function processNodes(nodes: readonly ChildNode[] | undefined, state: State, depth: number, motionOk: boolean): Out[] {
  const out: Out[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "comment":
        break;
      case "decl":
        reporter(state, node)("declaration-outside-rule");
        break;
      case "rule": {
        countRule(state, node);
        const r = processRule(node, state, motionOk);
        if (r) out.push(r);
        break;
      }
      case "atrule": {
        const r = processAtRule(node, state, depth, motionOk);
        if (r) out.push(r);
        break;
      }
    }
  }
  return out;
}

function processAtRule(node: AtRule, state: State, depth: number, motionOk: boolean): Out | null {
  const report = reporter(state, node);
  const name = node.name.toLowerCase();
  countRule(state, node);
  if (!ALLOWED_AT_RULES.includes(name)) {
    report(name === "import" ? "import-forbidden" : "at-rule-forbidden", { name: safeName(node.name) });
    return null;
  }
  if (CONDITIONAL_AT_RULES.includes(name)) {
    if (!node.nodes) {
      report("at-rule-syntax", { name });
      return null;
    }
    if (depth + 1 > state.limits.maxAtRuleDepth) {
      report("at-rule-too-deep", { max: state.limits.maxAtRuleDepth });
      return null;
    }
    let cond: { text: string; motionNoPreference: boolean };
    try {
      if (name === "media") cond = parseMedia(node.params, state.limits);
      else if (name === "container") cond = parseContainer(node.params);
      else {
        cond = parseSupports(node.params, (prop, value) => {
          const ctx = declContext(state, "supports", [], motionOk);
          const r = checkDeclaration(prop, value, false, ctx, report);
          return r ? r.value : null;
        });
      }
    } catch (e) {
      if (e instanceof AtRuleError) report(e.code, { name, ...e.params });
      else report("at-rule-syntax", { name });
      return null;
    }
    const children = processNodes(node.nodes, state, depth + 1, motionOk || cond.motionNoPreference);
    return children.length ? { type: "at", header: `@${name} ${cond.text}`, children } : null;
  }
  if (name === "keyframes") return processKeyframes(node, state, depth, motionOk);
  return processFontFace(node, state, depth);
}

function declContext(state: State, where: DeclContext["where"], subjects: readonly Subject[], motionOk: boolean, finalFrame = false): DeclContext {
  return {
    skinId: state.opts.skinId,
    limits: state.limits,
    assetBase: state.opts.assetBase,
    assets: state.assets,
    where,
    subjects,
    finalFrame,
    motionOk,
    keyframes: state.keyframeMap,
    defs: state.defs,
    used: state.used,
    counters: state.counters,
  };
}

function processRule(node: Rule, state: State, motionOk: boolean): Out | null {
  const report = reporter(state, node);
  const limits = state.limits;
  const raw = node.selector;
  if (raw.length > limits.maxSelectorLength) {
    report("selector-too-long", { max: limits.maxSelectorLength });
    return null;
  }
  let list: Complex[];
  let selectors: string[];
  let subjects: Subject[];
  try {
    list = stripAuthorScope(parseSelectorList(raw, limits), state.opts.skinId);
    ({ selectors, subjects } = validateAndRewrite(list, { skinId: state.opts.skinId, limits, moduleParts: state.opts.moduleParts }));
  } catch (e) {
    if (e instanceof SelectorError) report(e.code, e.params);
    else report("selector-syntax");
    return null;
  }
  const ctx = declContext(state, "rule", subjects, motionOk);
  const decls: DeclOut[] = [];
  let infinite = false;
  let durations: number[] = [];
  let count = 0;
  const focusSubject = list.some((x) => x.compounds[x.compounds.length - 1]!.pseudos.some((p) => ["focus-visible", "focus", "focus-within"].includes(p.name)));
  for (const child of node.nodes ?? []) {
    if (child.type === "comment") continue;
    if (child.type !== "decl") {
      reporter(state, child)("nested-rule-forbidden");
      continue;
    }
    count++;
    state.declarations++;
    if (state.declarations > limits.maxDeclarations) fatal(state, child, "too-many-declarations", { max: limits.maxDeclarations });
    if (count > limits.maxDeclarationsPerRule) {
      if (count === limits.maxDeclarationsPerRule + 1) reporter(state, child)("too-many-declarations-rule", { max: limits.maxDeclarationsPerRule });
      continue;
    }
    const d = checkDeclaration((child as Declaration).prop, (child as Declaration).value, (child as Declaration).important === true, ctx, reporter(state, child));
    if (!d) continue;
    const entry: DeclOut = { prop: d.prop, value: d.value, line: child.source?.start?.line };
    decls.push(entry);
    infinite ||= d.infinite;
    durations = durations.concat(d.durationsMs);
    if (d.prop.startsWith("--")) state.customDecls.push({ name: d.prop, refs: d.refs, length: d.value.length, target: decls, decl: entry });
    trackFocus(d.prop, d.value, entry.line, focusSubject, state);
  }
  if (infinite && durations.some((ms) => ms < BOUNDS.minLoopMs)) report("animation-too-fast");
  return decls.length ? { type: "rule", selectors, decls } : null;
}

function trackFocus(prop: string, value: string, line: number | undefined, focusSubject: boolean, state: State) {
  const removal =
    (prop === "outline" && /^(none|0|0px)(\s|$)/.test(value)) ||
    (prop === "outline-style" && /^(none|hidden)$/.test(value)) ||
    (prop === "outline-width" && /^0(px|rem|em)?$/.test(value));
  if (removal && !state.outlineRemoved) state.outlineRemoved = { line };
  if (focusSubject && !removal && (prop === "outline" || prop === "outline-width" || prop === "box-shadow" || prop === "border-color" || prop === "outline-color")) {
    if (!(prop === "box-shadow" && value === "none")) state.focusIndicator = true;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// @keyframes

function processKeyframes(node: AtRule, state: State, depth: number, motionOk: boolean): Out | null {
  const report = reporter(state, node);
  const name = node.params.trim();
  const out = state.keyframeMap.get(name);
  if (!out || !node.nodes) {
    report("keyframes-name-bad", { name: safeName(name) });
    return null;
  }
  if (!motionOk) {
    report("keyframes-needs-motion-query");
    return null;
  }
  state.keyframes++;
  if (state.keyframes > state.limits.maxKeyframes) fatal(state, node, "too-many-keyframes", { max: state.limits.maxKeyframes });
  void depth;
  const frames: { selector: string; decls: DeclOut[] }[] = [];
  for (const child of node.nodes) {
    if (child.type === "comment") continue;
    if (child.type !== "rule") {
      reporter(state, child)("keyframes-content");
      continue;
    }
    if (frames.length >= state.limits.maxKeyframeSteps) {
      report("keyframes-too-long", { max: state.limits.maxKeyframeSteps });
      break;
    }
    const sel = child.selector.replace(/\s+/g, "").toLowerCase();
    const parts = sel.split(",");
    const okParts = parts.every((p) => p === "from" || p === "to" || (/^\d{1,3}(\.\d{1,3})?%$/.test(p) && parseFloat(p) <= 100));
    if (!okParts) {
      reporter(state, child)("keyframes-content");
      continue;
    }
    const final = parts.includes("to") || parts.includes("100%");
    const ctx = declContext(state, "keyframes", [], motionOk, final);
    const decls: DeclOut[] = [];
    for (const d of child.nodes ?? []) {
      if (d.type === "comment") continue;
      if (d.type !== "decl") {
        reporter(state, d)("nested-rule-forbidden");
        continue;
      }
      state.declarations++;
      if (state.declarations > state.limits.maxDeclarations) fatal(state, d, "too-many-declarations", { max: state.limits.maxDeclarations });
      const r = checkDeclaration(d.prop, d.value, d.important === true, ctx, reporter(state, d));
      if (r) decls.push({ prop: r.prop, value: r.value, line: d.source?.start?.line });
    }
    if (decls.length) frames.push({ selector: parts.join(","), decls });
  }
  return frames.length ? { type: "keyframes", name: out, frames } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// @font-face

function processFontFace(node: AtRule, state: State, depth: number): Out | null {
  const report = reporter(state, node);
  if (depth > 0) {
    report("font-face-nested");
    return null;
  }
  state.fontFaces++;
  if (state.fontFaces > state.limits.maxFontFaces) fatal(state, node, "too-many-font-faces", { max: state.limits.maxFontFaces });
  if (!node.nodes) {
    report("at-rule-syntax", { name: "font-face" });
    return null;
  }
  const lexOpts = { maxLength: state.limits.maxValueLength, maxTokens: state.limits.maxValueTokens, maxNesting: 4 };
  let family: string | null = null;
  let src: string[] = [];
  const extra: string[] = [];
  let failed = false;
  const fail = (code: string, params: Params = {}, n: ChildNode = node) => {
    failed = true;
    reporter(state, n)(code, params);
  };
  for (const d of node.nodes) {
    if (d.type === "comment") continue;
    if (d.type !== "decl") {
      fail("font-face-descriptor", { name: "?" }, d);
      continue;
    }
    state.declarations++;
    const prop = d.prop.toLowerCase();
    if (d.important) {
      fail("important-forbidden", { prop }, d);
      continue;
    }
    if (prop === "font-display") continue; // imposé : swap
    if (prop === "unicode-range") {
      const v = d.value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
      if (/^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(, ?U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?){0,15}$/.test(v)) extra.push(`unicode-range:${v}`);
      else fail("font-face-descriptor", { name: prop }, d);
      continue;
    }
    if (!["font-family", "src", "font-weight", "font-style"].includes(prop)) {
      fail("font-face-descriptor", { name: safeName(prop) }, d);
      continue;
    }
    const lex = tokenizeValue(d.value, lexOpts);
    if ("error" in lex) {
      fail("font-face-descriptor", { name: prop }, d);
      continue;
    }
    const toks = lex.tokens.filter((t) => t.k !== "ws");
    if (prop === "font-family") {
      const t = toks[0];
      const name = toks.length === 1 && t && (t.k === "str" || t.k === "ident") ? t.v : null;
      if (name === null || !/^[A-Za-z0-9 _-]{1,64}$/.test(name)) fail("font-name-bad", {}, d);
      else if (state.opts.fontFamilies && !state.opts.fontFamilies.includes(name)) fail("font-family-undeclared", { name: name.slice(0, 40) }, d);
      else family = name;
    } else if (prop === "src") {
      const entries: Array<typeof toks> = [[]];
      for (const t of toks) {
        if (t.k === "comma") entries.push([]);
        else entries[entries.length - 1]!.push(t);
      }
      const outEntries: string[] = [];
      for (const e of entries) {
        const u = e[0];
        const fmt = e.slice(1);
        const fmtOk =
          fmt.length === 0 ||
          (fmt.length === 3 && fmt[0]!.k === "fn" && fmt[0]!.v === "format" && (fmt[1]!.k === "str" || fmt[1]!.k === "ident") && fmt[1]!.v.toLowerCase() === "woff2" && fmt[2]!.k === "close");
        if (!u || u.k !== "url" || !fmtOk) {
          const first = e[0];
          fail(first && first.k === "fn" && first.v === "local" ? "local-font-forbidden" : first && first.k === "url" ? "font-face-descriptor" : "font-face-descriptor", { name: "src" }, d);
          continue;
        }
        if (!u.v.startsWith("skin:")) {
          fail("url-external", { url: u.v.slice(0, 40) }, d);
          continue;
        }
        const path = u.v.slice(5);
        if (!FONT_PATH_RE.test(path)) fail("url-path-bad", { path: path.slice(0, 60) }, d);
        else if (state.assets && !state.assets.has(path)) fail("asset-not-declared", { path }, d);
        else {
          state.used.assets.add(path);
          outEntries.push(`${urlOut(`skin:${path}`, state.opts)} format("woff2")`);
        }
      }
      if (outEntries.length) src = outEntries;
    } else if (prop === "font-weight") {
      const ok = toks.length >= 1 && toks.length <= 2 && toks.every((t) => (t.k === "num" && t.n >= 1 && t.n <= 1000) || (t.k === "ident" && ["normal", "bold"].includes(t.v.toLowerCase())));
      if (ok) extra.push(`font-weight:${toks.map((t) => (t.k === "num" ? t.raw : t.k === "ident" ? t.v.toLowerCase() : "")).join(" ")}`);
      else fail("font-face-descriptor", { name: prop }, d);
    } else {
      const t = toks[0];
      if (toks.length === 1 && t && t.k === "ident" && ["normal", "italic", "oblique"].includes(t.v.toLowerCase())) extra.push(`font-style:${t.v.toLowerCase()}`);
      else fail("font-face-descriptor", { name: prop }, d);
    }
  }
  if (failed) return null;
  if (!family || src.length === 0) {
    report("font-face-incomplete");
    return null;
  }
  return { type: "fontface", text: `@font-face{font-family:${encodeCssString(family)};src:${src.join(",")};${extra.length ? extra.join(";") + ";" : ""}font-display:swap}` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Variables : cycles et développement démesuré

function finishVariables(state: State) {
  const byName = new Map<string, { refs: Set<string>; length: number; entries: State["customDecls"] }>();
  for (const c of state.customDecls) {
    const e = byName.get(c.name) ?? { refs: new Set<string>(), length: 0, entries: [] };
    for (const r of c.refs) e.refs.add(r);
    e.length = Math.max(e.length, c.length);
    e.entries.push(c);
    byName.set(c.name, e);
  }
  // DFS itératif : cycles puis taille de développement
  const color = new Map<string, 0 | 1 | 2>();
  const size = new Map<string, number>();
  const bad = new Set<string>();
  for (const start of byName.keys()) {
    if (color.get(start)) continue;
    const stack: { name: string; iter: Iterator<string> }[] = [{ name: start, iter: byName.get(start)!.refs.values() }];
    color.set(start, 1);
    const path: string[] = [start];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        const e = byName.get(top.name)!;
        let total = e.length;
        for (const r of e.refs) total += byName.has(r) ? (bad.has(r) ? 0 : (size.get(r) ?? 0)) : 0;
        size.set(top.name, Math.min(total, 1e9));
        if (total > state.limits.maxVarExpansion) bad.add(top.name);
        color.set(top.name, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const r = next.value;
      if (!byName.has(r)) continue;
      const c = color.get(r) ?? 0;
      if (c === 1) {
        const from = path.indexOf(r);
        for (const n of path.slice(from)) bad.add(n);
        bad.add(r);
      } else if (c === 0) {
        color.set(r, 1);
        path.push(r);
        stack.push({ name: r, iter: byName.get(r)!.refs.values() });
      }
    }
  }
  if (!bad.size) return;
  for (const name of bad) {
    const e = byName.get(name)!;
    const inCycle = reaches(name, name, byName);
    const first = e.entries[0]!;
    const issue = makeIssue(inCycle ? "var-cycle" : "var-expansion-too-large", { name: name.slice(0, 40), max: state.limits.maxVarExpansion });
    issue.line = first.decl.line;
    push(state, issue);
    for (const ent of e.entries) {
      const i = ent.target.indexOf(ent.decl);
      if (i >= 0) ent.target.splice(i, 1);
    }
  }
  // les règles devenues vides disparaissent au rendu
}

function reaches(from: string, to: string, graph: Map<string, { refs: Set<string> }>): boolean {
  const seen = new Set<string>();
  const stack = [...(graph.get(from)?.refs ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n) || !graph.has(n)) continue;
    seen.add(n);
    for (const r of graph.get(n)!.refs) stack.push(r);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Écriture

function renderDecls(d: DeclOut[]): string {
  return d.map((x) => `${x.prop}:${x.value}`).join(";");
}

function render(n: Out): string {
  switch (n.type) {
    case "rule":
      return n.decls.length ? `${n.selectors.join(",")}{${renderDecls(n.decls)}}` : "";
    case "at": {
      const inner = n.children.map(render).filter(Boolean).join("\n");
      return inner ? `${n.header}{\n${inner}\n}` : "";
    }
    case "keyframes":
      return `@keyframes ${n.name}{${n.frames.map((f) => `${f.selector}{${renderDecls(f.decls)}}`).join("")}}`;
    case "fontface":
      return n.text;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Jetons : la même vérification de valeur sert à `tokens.json` (§4.1, §5.4).

/**
 * Vérifie la valeur d'UN jeton de `tokens.json` (nom `--v-*` / `--sk-*`) avec les règles des valeurs de la feuille :
 * mêmes fonctions, mêmes unités, `url()` seulement `url(skin:…)`, 300 caractères au plus. Rend la valeur réécrite ou les problèmes.
 */
export function sanitizeTokenValue(name: string, value: unknown, options: Pick<SanitizeOptions, "skinId" | "assetBase" | "assets" | "limits">): { ok: true; value: string; issues: SkinIssue[] } | { ok: false; issues: SkinIssue[] } {
  const issues: SkinIssue[] = [];
  try {
    if (typeof value !== "string") {
      issues.push(makeIssue("value-syntax", { prop: String(name).slice(0, 40) }));
      return { ok: false, issues };
    }
    const limits: SkinLimits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
    const state = {
      issues,
    };
    const ctx: DeclContext = {
      skinId: options.skinId,
      limits,
      assetBase: options.assetBase && ASSET_BASE_RE.test(options.assetBase) ? options.assetBase : undefined,
      assets: options.assets ? new Set(options.assets) : undefined,
      where: "rule",
      subjects: [],
      motionOk: false,
      keyframes: new Map(),
      used: { assets: new Set() },
      counters: { fixedBackgrounds: 0 },
    };
    const r = checkDeclaration(name, value, false, ctx, (code, params, severity) => state.issues.push(makeIssue(code, params, severity)));
    if (!r) return { ok: false, issues };
    return { ok: !issues.some((i) => i.severity === "error"), value: r.value, issues } as { ok: true; value: string; issues: SkinIssue[] };
  } catch {
    issues.push(makeIssue("internal-error", {}));
    return { ok: false, issues };
  }
}
