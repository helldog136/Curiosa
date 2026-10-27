/**
 * Contrôle de lisibilité d'un skin (docs/SKINS.md §7) : calcul WCAG 2.x pur (aucune base de données, aucun navigateur).
 *
 *  - `checkReadability(tokens, mode, options)` : les 12 paires de jetons du §7.1, pour UN mode (clair ou sombre).
 *    AA obligatoire (4,5 pour le texte, 3 pour le grand texte et les éléments d'interface) → problèmes de gravité `error` ;
 *    AAA en conseil (gravité `advice`, seulement si `options.advice`). `basic` est exempté.
 *  - `correctReadability(tokens, mode, options)` : l'échelle de correction du §7.3 appliquée AU RENDU, sans rien écrire :
 *    (1) recalculer les couleurs dérivées, (2) rapprocher le texte (et liens, focus, couleur principale) du noir/blanc,
 *    (3) remettre une pièce de module à sa valeur par défaut, (4) sinon SUSPENDRE le mode (le cœur applique alors basic).
 *  - `probableIllegibility(colors, mode)` : avertissement « illisibilité probable » de l'écran de retouches (jamais bloquant).
 *
 * Transparences : un fond translucide est composé sur ce qu'il y a derrière (fond de page, puis blanc en mode clair / noir en
 * mode sombre) ; un texte translucide est composé sur son fond. Ainsi un skin « verre » est jugé sur ce qu'on voit.
 */
import { buildPalette } from "../color";
import { parseColor, toHex, type Rgba } from "./colorParse";
import { catalogEntry, makeText, type Params, type Text } from "./messages";

export type Mode = "light" | "dark";
export type Tokens = Readonly<Record<string, string>>;

/** Seuils WCAG 2.x. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
export const AAA_TEXT = 7;
export const AAA_LARGE = 4.5;

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

// ---------------------------------------------------------------------------------------------------------------------
// Calcul WCAG

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Luminance relative WCAG d'une couleur (opacité ignorée : composez d'abord avec `composite`). */
export function relativeLuminance(c: Pick<Rgba, "r" | "g" | "b">): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Rapport de contraste WCAG (de 1 à 21) entre deux couleurs opaques. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pose `fg` (éventuellement translucide) sur `bg` : résultat opaque si `bg` l'est. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (f: number, b: number) => {
    const v = (f * fg.a + b * bg.a * (1 - fg.a)) / a;
    return a >= 1 ? Math.round(v) : v; // un navigateur affiche des canaux entiers
  };
  return { r: ch(fg.r, bg.r), g: ch(fg.g, bg.g), b: ch(fg.b, bg.b), a };
}

/** Contraste de `fg` sur `bg`, tous deux éventuellement translucides, sur un fond de base opaque `base`. */
export function contrastOver(fg: Rgba, bg: Rgba, base: Rgba = WHITE): number {
  const back = composite(bg, { ...base, a: 1 });
  return contrastRatio(composite(fg, back), back);
}

// ---------------------------------------------------------------------------------------------------------------------
// Les 12 paires du §7.1

export type PairSpec = {
  id: number;
  /** Jeton du premier plan (le premier présent des candidats). */
  fg: readonly string[];
  /** Fonds contre lesquels on mesure. */
  bg: readonly string[];
  min: number;
  /** Vrai si c'est du texte (le conseil AAA s'applique). */
  text: boolean;
  /** Courte description pour les conseils. */
  label: Text;
};

const STATES = ["success", "warning", "danger"] as const;

/** Les paires fixes (la 9, la 10 et la 11 sont développées par état / par pièce de module). */
export const READABILITY_PAIRS: readonly PairSpec[] = [
  { id: 1, fg: ["--v-fg"], bg: ["--v-bg"], min: AA_TEXT, text: true, label: { fr: "le texte sur le fond de la page", en: "the text on the page background" } },
  { id: 2, fg: ["--v-fg"], bg: ["--v-surface"], min: AA_TEXT, text: true, label: { fr: "le texte sur les cartes", en: "the text on cards" } },
  { id: 3, fg: ["--v-muted"], bg: ["--v-bg", "--v-surface"], min: AA_TEXT, text: true, label: { fr: "le texte secondaire", en: "the secondary text" } },
  { id: 4, fg: ["--v-accent-fg"], bg: ["--v-accent"], min: AA_TEXT, text: true, label: { fr: "le texte des boutons pleins", en: "the text of filled buttons" } },
  { id: 5, fg: ["--v-accent2-fg"], bg: ["--v-accent2"], min: AA_TEXT, text: true, label: { fr: "le texte des boutons de la seconde couleur", en: "the text of second-color buttons" } },
  { id: 6, fg: ["--sk-color-link", "--v-accent"], bg: ["--v-bg", "--v-surface"], min: AA_TEXT, text: true, label: { fr: "les liens dans le texte", en: "links inside the text" } },
  { id: 7, fg: ["--v-accent"], bg: ["--v-bg"], min: AA_LARGE, text: false, label: { fr: "la couleur principale sur le fond", en: "the main color on the background" } },
  { id: 8, fg: ["--sk-color-focus", "--v-accent"], bg: ["--v-bg", "--v-surface"], min: AA_LARGE, text: false, label: { fr: "le cadre de focus", en: "the focus frame" } },
  { id: 9, fg: STATES.map((s) => `--v-${s}`), bg: ["--v-bg", "--v-surface"], min: AA_TEXT, text: true, label: { fr: "les couleurs d'état", en: "the status colors" } },
  { id: 10, fg: STATES.map((s) => `--v-${s}-fg`), bg: STATES.map((s) => `--v-${s}`), min: AA_TEXT, text: true, label: { fr: "le texte sur les couleurs d'état", en: "the text on status colors" } },
  { id: 11, fg: [], bg: [], min: AA_TEXT, text: true, label: { fr: "les pièces de module", en: "module parts" } },
  // Paire 12 : les titres. Le §7.1 ne nomme pas de jeton de titre ; on contrôle `--sk-color-heading` (facultatif) au seuil « grand texte ».
  { id: 12, fg: ["--sk-color-heading"], bg: ["--v-bg", "--v-surface"], min: AA_LARGE, text: true, label: { fr: "les gros titres", en: "large headings" } },
];

export type ModulePair = {
  /** Jeton du texte (`--sk-<module>-<pièce>-…`) et du fond. */
  fg: string;
  bg: string;
  /** Valeur par défaut du module (couche 2) : sert à l'échelle de correction. */
  defaults?: { fg?: string; bg?: string };
};

export type ReadabilityIssue = {
  code: string;
  /** `error` : sous le seuil AA, le skin est refusé à l'installation. `advice` : AAA conseillé. */
  severity: "error" | "advice";
  pair: number;
  mode: Mode;
  /** Jeton du premier plan et du fond de la mesure. */
  fgToken: string;
  bgToken: string;
  ratio: number;
  required: number;
  message: Text;
  hint: Text;
  /** Une couleur qui passerait, si on a su en calculer une. */
  example?: string;
};

export type ReadabilityOptions = {
  /** `basic` est exempté (c'est l'apparence existante). Par défaut : vrai si `skinId === "basic"`. */
  exempt?: boolean;
  skinId?: string;
  /** Ajoute les conseils AAA (gravité `advice`). */
  advice?: boolean;
  /** Paires `fg`/`bg` déclarées par les pièces de modules (paire 11). */
  modulePairs?: readonly ModulePair[];
};

const modeText = (mode: Mode): Text => (mode === "dark" ? { fr: "sombre", en: "dark" } : { fr: "clair", en: "light" });

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Résout un jeton en couleur ; suit `var(--autre)` (jusqu'à 5 renvois) quand l'autre jeton est donné. */
function resolve(tokens: Tokens, name: string): { raw: string | undefined; color: Rgba | null } {
  let current = name;
  for (let i = 0; i < 6; i++) {
    const raw = tokens[current];
    if (typeof raw !== "string") return i === 0 ? { raw: undefined, color: null } : { raw: tokens[name], color: null };
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i.exec(raw.trim());
    if (!ref) return { raw, color: parseColor(raw) };
    current = ref[1]!;
  }
  return { raw: tokens[name], color: null };
}

type Resolved = { bg: Rgba; surface: Rgba; get: (name: string) => Rgba | null; has: (name: string) => boolean; missing: string[]; unreadable: Map<string, string> };

function resolveAll(tokens: Tokens, mode: Mode): Resolved {
  const canvas = mode === "dark" ? BLACK : WHITE;
  const missing: string[] = [];
  const unreadable = new Map<string, string>();
  const cache = new Map<string, Rgba | null>();
  const has = (name: string) => typeof tokens[name] === "string";
  const get = (name: string): Rgba | null => {
    if (cache.has(name)) return cache.get(name)!;
    const r = resolve(tokens, name);
    if (r.raw !== undefined && !r.color) unreadable.set(name, r.raw);
    cache.set(name, r.color);
    return r.color;
  };
  const bgRaw = get("--v-bg");
  const bg = bgRaw ? composite(bgRaw, { ...canvas, a: 1 }) : canvas;
  const surfRaw = get("--v-surface");
  const surface = surfRaw ? composite(surfRaw, bg) : bg;
  for (const base of ["--v-bg", "--v-surface", "--v-fg", "--v-accent"]) if (!has(base)) missing.push(base);
  return { bg, surface, get, has, missing, unreadable };
}

function backgroundFor(r: Resolved, token: string): Rgba | null {
  if (token === "--v-bg") return r.bg;
  if (token === "--v-surface") return r.surface;
  const c = r.get(token);
  return c ? composite(c, r.bg) : null;
}

/** Cherche, dans les deux sens (vers le noir, vers le blanc), la plus petite correction de `color` qui passe contre tous les fonds. */
export function suggestColor(color: Rgba, against: readonly Rgba[], min: number): { hex: string; dir: "lighter" | "darker" } | null {
  if (!against.length) return null;
  const opaque: Rgba = { ...color, a: 1 };
  const mix = (to: Rgba, t: number): Rgba => ({ r: opaque.r + (to.r - opaque.r) * t, g: opaque.g + (to.g - opaque.g) * t, b: opaque.b + (to.b - opaque.b) * t, a: 1 });
  let best: { hex: string; dir: "lighter" | "darker"; steps: number } | null = null;
  for (const [to, dir] of [[BLACK, "darker"], [WHITE, "lighter"]] as const) {
    for (let step = 0; step <= 400; step++) {
      const c = mix(to, step / 400);
      const rounded: Rgba = { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 };
      if (against.every((b) => contrastRatio(rounded, b) >= min)) {
        if (!best || step < best.steps) best = { hex: toHex(rounded), dir, steps: step };
        break;
      }
    }
  }
  return best ? { hex: best.hex, dir: best.dir } : null;
}

function makeIssue(pair: number, severity: "error" | "advice", mode: Mode, fgToken: string, bgToken: string, ratio: number, required: number, fgColor: Rgba, againstAll: readonly Rgba[], extra: Params = {}): ReadabilityIssue {
  const params: Params = { mode: modeText(mode), ratio, min: required, token: fgToken, ...extra };
  let example: string | undefined;
  let hint: Text;
  if (severity === "error") {
    const s = suggestColor(fgColor, againstAll, required);
    example = s?.hex;
    const e = catalogEntry(s ? "read-hint-example" : "read-hint-plain")!;
    const dir: Text = s?.dir === "lighter" ? { fr: "claire", en: "lighter" } : { fr: "foncée", en: "darker" };
    hint = makeText(e.fr, e.en, { ...params, dir, example: s?.hex ?? "" });
  } else {
    const e = catalogEntry("read-advice")!;
    hint = { fr: e.hintFr, en: e.hintEn };
  }
  const label = READABILITY_PAIRS.find((p) => p.id === pair)!.label;
  const code = severity === "error" ? `read-low-${pair}` : "read-advice";
  const e = catalogEntry(code)!;
  const message = makeText(e.fr, e.en, { ...params, what: label });
  return { code, severity, pair, mode, fgToken, bgToken, ratio: round2(ratio), required, message, hint, ...(example ? { example } : {}) };
}

/**
 * Contrôle les 12 paires du §7.1 pour UN mode. `tokens` sont les valeurs EFFECTIVES (skin + retouches + options) de ce mode,
 * déjà résolues : un `var(--autre)` vers un jeton donné est suivi, mais `color-mix()` et autres calculs ne sont pas compris
 * (problème `read-color-unreadable`). Liste vide = lisible.
 */
export function checkReadability(tokens: Tokens, mode: Mode, options: ReadabilityOptions = {}): ReadabilityIssue[] {
  try {
    const exempt = options?.exempt ?? options?.skinId === "basic";
    if (exempt) return [];
    return evaluate(tokens !== null && typeof tokens === "object" ? tokens : {}, mode, options ?? {});
  } catch {
    return [];
  }
}

function plainIssue(code: string, mode: Mode, token: string): ReadabilityIssue {
  const e = catalogEntry(code)!;
  const params: Params = { token, mode: modeText(mode) };
  return { code, severity: "error", pair: 0, mode, fgToken: token, bgToken: "", ratio: 0, required: 0, message: makeText(e.fr, e.en, params), hint: makeText(e.hintFr, e.hintEn, params) };
}

function evaluate(tokens: Tokens, mode: Mode, options: ReadabilityOptions): ReadabilityIssue[] {
  const out: ReadabilityIssue[] = [];
  const r = resolveAll(tokens, mode);
  for (const m of r.missing) out.push(plainIssue("read-token-missing", mode, m));
  for (const base of ["--v-bg", "--v-surface", "--v-fg", "--v-accent"]) r.get(base);
  if (r.missing.length) {
    for (const [name] of r.unreadable) out.push(plainIssue("read-color-unreadable", mode, name));
    return out;
  }

  const test = (pair: PairSpec, fgToken: string, bgTokens: readonly string[], min = pair.min) => {
    const fg = r.get(fgToken);
    if (!fg) return;
    const backs = bgTokens.map((t) => [t, backgroundFor(r, t)] as const).filter((x): x is readonly [string, Rgba] => x[1] !== null);
    // la correction proposée doit convenir à TOUS les fonds où ce texte est posé (fond de page et cartes)
    const shared = fgToken === "--v-fg" ? [r.bg, r.surface] : null;
    const against = shared ?? backs.map((b) => b[1]);
    for (const [bgToken, back] of backs) {
      const ratio = contrastRatio(composite(fg, back), back);
      if (ratio < min) {
        out.push(makeIssue(pair.id, "error", mode, fgToken, bgToken, ratio, min, composite(fg, back), against));
      } else if (options.advice && pair.text) {
        const aaa = min === AA_LARGE ? AAA_LARGE : AAA_TEXT;
        if (ratio < aaa) out.push(makeIssue(pair.id, "advice", mode, fgToken, bgToken, ratio, aaa, composite(fg, back), against));
      }
    }
  };

  for (const pair of READABILITY_PAIRS) {
    if (pair.id === 11) {
      for (const mp of options.modulePairs ?? []) {
        const fg = r.get(mp.fg);
        const bg = backgroundFor(r, mp.bg);
        if (!fg || !bg) {
          if (r.has(mp.fg) || r.has(mp.bg)) {
            for (const t of [mp.fg, mp.bg]) if (r.has(t) && !r.get(t)) out.push(plainIssue("read-color-unreadable", mode, t));
          }
          continue;
        }
        const solid = composite(fg, bg);
        const ratio = contrastRatio(solid, bg);
        if (ratio < pair.min) out.push(makeIssue(11, "error", mode, mp.fg, mp.bg, ratio, pair.min, solid, [bg]));
        else if (options.advice && ratio < AAA_TEXT) out.push(makeIssue(11, "advice", mode, mp.fg, mp.bg, ratio, AAA_TEXT, solid, [bg]));
      }
      continue;
    }
    if (pair.id === 10) {
      for (const s of STATES) if (r.has(`--v-${s}-fg`) && r.has(`--v-${s}`)) test(pair, `--v-${s}-fg`, [`--v-${s}`]);
      continue;
    }
    if (pair.id === 9) {
      for (const s of STATES) if (r.has(`--v-${s}`)) test(pair, `--v-${s}`, pair.bg);
      continue;
    }
    if (pair.id === 5) {
      // sans accent secondaire distinct, la paire 5 est la paire 4
      if (r.has("--v-accent2") && r.has("--v-accent2-fg")) test(pair, "--v-accent2-fg", ["--v-accent2"]);
      continue;
    }
    const fgToken = pair.fg.find((t) => r.has(t));
    if (!fgToken) continue; // jeton dérivé ou facultatif absent : rien à mesurer
    if (pair.id === 4 && !r.has("--v-accent-fg")) continue;
    test(pair, fgToken, pair.bg);
  }
  // couleurs présentes mais incompréhensibles : on ne peut pas prouver qu'elles sont lisibles
  const seen = new Set(out.filter((i) => i.code === "read-color-unreadable").map((i) => i.fgToken));
  for (const [name] of r.unreadable) if (!seen.has(name)) out.push(plainIssue("read-color-unreadable", mode, name));
  return out;
}

/** Vrai s'il y a au moins un problème bloquant (sous le seuil AA). */
export function hasReadabilityErrors(issues: readonly ReadabilityIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------------------------------------------------
// Échelle de correction (§7.3)

export type CorrectionStep = "derived" | "text" | "module";

export type CorrectionChange = { token: string; from: string; to: string; step: CorrectionStep; pair: number };

export type Correction = {
  /** Jetons corrigés (copie). Identiques à l'entrée si rien n'a été touché ou si le mode est suspendu. */
  tokens: Record<string, string>;
  changes: CorrectionChange[];
  /** Vrai si le mode doit être suspendu : le cœur applique alors basic pour ce mode. */
  suspended: boolean;
  /** Problèmes bloquants restants après les tentatives. */
  remaining: ReadabilityIssue[];
  /** Phrase pour l'encadré de la page Apparence (`null` si rien n'a changé). */
  notice: Text | null;
};

const DERIVED = new Set(["--v-muted", "--v-accent-fg", "--v-accent2-fg", ...STATES.flatMap((s) => [`--v-${s}`, `--v-${s}-fg`])]);

function hexOf(c: Rgba | null, fallback: string): string {
  return c ? toHex({ ...c, a: 1 }) : fallback;
}

/**
 * Corrige les problèmes bloquants SANS rien écrire : renvoie les jetons à utiliser au rendu. Ordre (§7.3) :
 * (1) couleurs dérivées recalculées avec `buildPalette` ; (2) texte, liens, focus et couleur principale rapprochés du
 * noir/blanc jusqu'au seuil ; (3) jeton de pièce de module remis à sa valeur par défaut ; (4) sinon `suspended`.
 */
export function correctReadability(tokens: Tokens, mode: Mode, options: ReadabilityOptions = {}): Correction {
  if (tokens === null || typeof tokens !== "object") tokens = {};
  options ??= {};
  const original: Record<string, string> = { ...tokens };
  const unchanged: Correction = { tokens: original, changes: [], suspended: false, remaining: [], notice: null };
  try {
    if (options.exempt ?? options.skinId === "basic") return unchanged;
    const work: Record<string, string> = { ...tokens };
    const changes: CorrectionChange[] = [];
    const check = () => checkReadability(work, mode, { ...options, advice: false, exempt: false });
    let issues = check();
    if (!issues.length) return unchanged;
    // des couleurs que l'on ne comprend pas ou qui manquent ne se corrigent pas
    if (issues.some((i) => i.pair === 0)) return { tokens: original, changes: [], suspended: true, remaining: issues, notice: suspendedNotice(mode) };

    const set = (token: string, to: string, step: CorrectionStep, pair: number) => {
      const from = work[token] ?? "";
      if (from.toLowerCase() === to.toLowerCase()) return;
      work[token] = to;
      changes.push({ token, from, to, step, pair });
    };

    const derive = () => {
      const failing = new Set(issues.filter((i) => DERIVED.has(i.fgToken) || DERIVED.has(i.bgToken)).map((i) => i.pair));
      if (!failing.size) return;
      const r = resolveAll(work, mode);
      const palette = buildPalette(hexOf(r.bg, "#121214"), hexOf(r.get("--v-accent"), "#e8a23b"), {
        surface: hexOf(r.surface, ""),
        text: hexOf(r.get("--v-fg"), ""),
        accent2: r.has("--v-accent2") ? hexOf(r.get("--v-accent2"), "") : null,
      });
      for (const i of issues) {
        for (const t of [i.fgToken, i.bgToken]) {
          if (DERIVED.has(t) && palette[t] !== undefined) set(t, palette[t]!, "derived", i.pair);
        }
      }
    };

    // (1) dérivées
    derive();
    issues = check();

    // (2) texte et couleurs de premier plan
    if (issues.length) {
      const r = resolveAll(work, mode);
      const nudge = (token: string, bgs: readonly Rgba[], min: number, pair: number, writeAs = token) => {
        const c = r.get(token);
        if (!c) return;
        const s = suggestColor(composite(c, bgs[0]!), bgs, min);
        if (s) set(writeAs, s.hex, "text", pair);
      };
      const pairs = new Set(issues.map((i) => i.pair));
      if (pairs.has(1) || pairs.has(2)) nudge("--v-fg", [r.bg, r.surface], AA_TEXT, pairs.has(1) ? 1 : 2);
      if (pairs.has(6)) {
        const t = r.has("--sk-color-link") ? "--sk-color-link" : "--v-accent";
        nudge(t, [r.bg, r.surface], AA_TEXT, 6, "--sk-color-link");
      }
      if (pairs.has(8)) {
        const t = r.has("--sk-color-focus") ? "--sk-color-focus" : "--v-accent";
        nudge(t, [r.bg, r.surface], AA_LARGE, 8, "--sk-color-focus");
      }
      if (pairs.has(12)) nudge("--sk-color-heading", [r.bg, r.surface], AA_LARGE, 12);
      if (pairs.has(7)) nudge("--v-accent", [r.bg], AA_LARGE, 7);
      issues = check();
      // les couleurs dérivées suivent le texte et l'accent qui viennent de bouger
      if (issues.length) {
        derive();
        issues = check();
      }
    }

    // (3) pièces de module : valeur par défaut du module
    if (issues.some((i) => i.pair === 11)) {
      for (const mp of options.modulePairs ?? []) {
        if (!issues.some((i) => i.pair === 11 && i.fgToken === mp.fg && i.bgToken === mp.bg)) continue;
        if (mp.defaults?.fg !== undefined) set(mp.fg, mp.defaults.fg, "module", 11);
        if (mp.defaults?.bg !== undefined) set(mp.bg, mp.defaults.bg, "module", 11);
      }
      issues = check();
    }

    // (4) suspension
    if (hasReadabilityErrors(issues)) return { tokens: original, changes: [], suspended: true, remaining: issues, notice: suspendedNotice(mode) };
    const e = catalogEntry("read-adjusted")!;
    return { tokens: work, changes, suspended: false, remaining: [], notice: changes.length ? { fr: e.fr, en: e.en } : null };
  } catch {
    return { tokens: original, changes: [], suspended: true, remaining: [], notice: suspendedNotice(mode) };
  }
}

function suspendedNotice(mode: Mode): Text {
  const e = catalogEntry("read-suspended")!;
  return makeText(e.fr, e.en, { mode: modeText(mode) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retouches : « illisibilité probable » (écran Apparence, jamais bloquant)

export type RetouchColors = {
  background?: string | null;
  surface?: string | null;
  text?: string | null;
  accent?: string | null;
  accent2?: string | null;
};

export type ProbableField = "background" | "surface" | "text" | "accent" | "accent2";

export type ProbableIssue = {
  /** Champ sous lequel afficher l'avertissement. */
  field: ProbableField;
  pair: number;
  mode: Mode | null;
  ratio: number;
  required: number;
  /** Phrase simple, avec un exemple. */
  message: Text;
  /** Détails (à replier) : les chiffres. */
  detail: Text;
  example?: string;
  exampleHint?: Text;
};

const solid = (v: string | null | undefined): Rgba | null => {
  const c = typeof v === "string" ? parseColor(v) : null;
  return c && c.a === 1 ? c : null;
};

/**
 * Avertissement « illisibilité probable » pour l'écran de retouches : la personne a choisi ses couleurs (cinq au plus) ;
 * on dit, sous le bon champ et en mots simples, ce qui serait difficile à lire. `mode` est `null` en « un seul mode ».
 * Les couleurs dérivées (texte secondaire, texte des boutons, états) sont recalculées par le cœur : elles ne sont pas jugées ici.
 */
export function probableIllegibility(colors: RetouchColors, mode: Mode | null): ProbableIssue[] {
  try {
    const bg = solid(colors.background);
    if (!bg) return [];
    const surface = solid(colors.surface) ?? null;
    const text = solid(colors.text);
    const accent = solid(colors.accent);
    const accent2 = solid(colors.accent2);
    // texte « habituel » quand la personne n'en a pas choisi : celui que le cœur dérive du fond
    const hex = (c: Rgba) => toHex(c);
    const palette = buildPalette(hex(bg), accent ? hex(accent) : "#e8a23b", { surface: surface ? hex(surface) : null, text: text ? hex(text) : null, accent2: accent2 ? hex(accent2) : null });
    const fg = parseColor(palette["--v-fg"]!)!;
    const card = parseColor(palette["--v-surface"]!)!;
    const out: ProbableIssue[] = [];
    const sfx = mode ? "-mode" : "";
    const where: Params = { mode: mode ? modeText(mode) : "" };

    const add = (field: ProbableField, pair: number, code: string, hintCode: string, fgColor: Rgba, backs: readonly Rgba[], min: number) => {
      const worst = Math.min(...backs.map((b) => contrastRatio(fgColor, b)));
      if (worst >= min) return;
      const e = catalogEntry(code)!;
      const d = catalogEntry("probable-detail")!;
      const s = suggestColor(fgColor, backs, min);
      const item: ProbableIssue = {
        field, pair, mode, ratio: round2(worst), required: min,
        message: makeText(e.fr, e.en, where),
        detail: makeText(d.fr, d.en, { ratio: worst, min }),
      };
      if (s) {
        const h = catalogEntry(hintCode)!;
        item.example = s.hex;
        const light = s.dir === "lighter";
        const dir: Text = hintCode === "probable-hint-color" ? { fr: light ? "claire" : "foncée", en: s.dir } : { fr: light ? "clair" : "foncé", en: s.dir };
        item.exampleHint = makeText(h.fr, h.en, { dir, example: s.hex });
      }
      out.push(item);
    };

    // texte / fond, texte / cartes : sous le champ « texte » s'il est choisi, sinon sous le fond ou la surface
    const textField: ProbableField = text ? "text" : "background";
    add(textField, 1, `probable-text${sfx}`, text ? "probable-hint-text" : "probable-hint-color", fg, [bg], AA_TEXT);
    if (surface) add(text ? "text" : "surface", 2, `probable-surface${sfx}`, text ? "probable-hint-text" : "probable-hint-color", fg, [card], AA_TEXT);
    if (accent) {
      add("accent", 7, `probable-accent${sfx}`, "probable-hint-color", accent, [bg], AA_LARGE);
      if (!out.some((i) => i.field === "accent")) add("accent", 6, `probable-link${sfx}`, "probable-hint-color", accent, [bg, card], AA_TEXT);
    }
    if (accent2) add("accent2", 7, `probable-accent2${sfx}`, "probable-hint-color", accent2, [bg], AA_LARGE);
    return out;
  } catch {
    return [];
  }
}
