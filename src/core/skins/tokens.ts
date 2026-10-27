/**
 * VOCABULAIRE DES JETONS de design (docs/SKINS.md §4) : défini UNE fois, ici. Chaque jeton a un nom `--sk-*` (ou `--v-*` pour les couleurs existantes),
 * un type, la valeur de `basic` (= l'apparence ACTUELLE du site, relevée dans le CSS compilé : voir tests/core/skins-tokens.test.mjs) et la propriété CSS
 * « représentative » qui sert à valider la valeur avec les MÊMES minimums que l'assainisseur de feuille (taille de texte ≥ 0,6875 rem, durée ≤ 600 ms…).
 *
 * Bibliothèque pure : ni Next, ni base de données, ni réseau, ni minuteur.
 */
import { VAR_NAME_RE } from "./allowlist";
import { checkDeclaration, type DeclContext } from "./declarations";
import { DEFAULT_LIMITS } from "./allowlist";
import { makeIssue, type SkinIssue } from "./messages";
import { tokenizeValue, type Tok } from "./valueTokens";

export type TokenType =
  | "color" | "gradient" | "length" | "length-pair" | "text-size" | "line-height" | "number" | "weight" | "tracking" | "duration" | "easing"
  | "font" | "shadow" | "text-transform" | "border-style" | "grid-columns" | "grid-areas" | "target";

export type TokenGroup = "color" | "typography" | "space" | "radius" | "border" | "shadow" | "motion" | "layout";

export type TokenDef = {
  name: string;
  group: TokenGroup;
  type: TokenType;
  /** Valeur de basic (apparence actuelle). `null` : jeton facultatif que basic ne définit pas. */
  basic: string | null;
  /** Rôle, en une phrase (documentation et kit de test). */
  role: string;
};

const t = (name: string, group: TokenGroup, type: TokenType, basic: string | null, role: string): TokenDef => ({ name, group, type, basic, role });

/** Les couleurs de base : obligatoires dans chaque mode d'un skin (§5.4). `--v-accent2` est facultatif. */
export const BASE_COLOR_TOKENS = ["--v-bg", "--v-surface", "--v-fg", "--v-accent"] as const;

/** Couleurs dérivées : le cœur les calcule (buildPalette) quand le skin ne les fixe pas (§4.3). */
export const DERIVED_COLOR_TOKENS = [
  "--v-muted", "--v-line", "--v-accent-fg", "--v-success", "--v-success-fg", "--v-warning", "--v-warning-fg", "--v-danger", "--v-danger-fg",
  "--v-accent2", "--v-accent2-fg", "--v-gradient",
] as const;

const SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"] as const;
const TEXT_REM: Record<(typeof SIZES)[number], string> = { xs: ".75rem", sm: ".875rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem", "5xl": "3rem", "6xl": "3.75rem" };
const RADII = ["sm", "md", "lg", "xl", "2xl", "3xl"] as const;
const RADIUS_REM: Record<(typeof RADII)[number], string> = { sm: ".25rem", md: ".375rem", lg: ".5rem", xl: ".75rem", "2xl": "1rem", "3xl": "1.5rem" };

export const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Pile monospace de Tailwind 4.3.3 (`--font-mono`), relevée dans le CSS compilé. */
export const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const TOKEN_DEFS: readonly TokenDef[] = [
  // ── Couleurs (les `--v-*` existants gardent leur nom et leur rôle : contrat public des modules). Leurs valeurs de basic sont celles de buildPalette(fond, accent par défaut).
  t("--v-bg", "color", "color", "#121214", "fond de page"),
  t("--v-surface", "color", "color", "#202022", "fond des cartes et panneaux"),
  t("--v-fg", "color", "color", "#f4f4f5", "couleur du texte"),
  t("--v-accent", "color", "color", "#e8a23b", "couleur de marque, liens, boutons"),
  t("--v-accent2", "color", "color", "var(--v-accent)", "accent secondaire (= l'accent si non choisi)"),
  t("--v-muted", "color", "color", "#9e9ea0", "texte secondaire"),
  t("--v-line", "color", "color", "#363638", "filets et bordures"),
  t("--v-accent-fg", "color", "color", "#111111", "texte sur l'accent"),
  t("--v-accent2-fg", "color", "color", "#111111", "texte sur l'accent secondaire"),
  t("--v-success", "color", "color", "#4ade80", "état : réussite"),
  t("--v-success-fg", "color", "color", "#111111", "texte sur la couleur de réussite"),
  t("--v-warning", "color", "color", "#fbbf24", "état : attention"),
  t("--v-warning-fg", "color", "color", "#111111", "texte sur la couleur d'attention"),
  t("--v-danger", "color", "color", "#f87171", "état : erreur"),
  t("--v-danger-fg", "color", "color", "#111111", "texte sur la couleur d'erreur"),
  t("--v-gradient", "color", "gradient", "linear-gradient(120deg, #e8a23b, #e8a23b)", "dégradé accent vers accent secondaire"),
  t("--sk-color-focus", "color", "color", "var(--v-accent)", "anneau de focus"),
  t("--sk-color-link", "color", "color", "var(--v-accent)", "liens dans le texte"),
  t("--sk-color-veil", "color", "color", "rgb(0 0 0 / .55)", "voile sur image (blocs « panneau »)"),
  t("--sk-color-scrim", "color", "color", "#000000", "base des voiles translucides sur image ou vidéo (boutons, légende)"),
  t("--sk-color-on-veil", "color", "color", "#ffffff", "texte et filets posés sur un voile ou une vidéo"),
  t("--sk-color-veil-ink", "color", "color", "#000000", "texte d'un bouton rempli de la couleur « sur voile » (survol)"),
  t("--sk-color-selection", "color", "color", null, "sélection de texte (facultatif : le navigateur choisit)"),
  t("--sk-color-heading", "color", "color", null, "titres (facultatif : si défini, contrôlé à 3:1)"),

  // ── Typographie
  t("--v-font", "typography", "font", FONT_SANS, "police du texte"),
  t("--sk-font-heading", "typography", "font", "var(--v-font)", "police des titres"),
  t("--sk-font-mono", "typography", "font", FONT_MONO, "police du code"),
  ...SIZES.map((s) => t(`--sk-text-${s}`, "typography", "text-size", TEXT_REM[s], `taille de texte « ${s} »`)),
  t("--sk-leading-body", "typography", "line-height", "1.75rem", "interligne du texte courant"),
  t("--sk-weight-normal", "typography", "weight", "400", "graisse normale"),
  t("--sk-weight-medium", "typography", "weight", "500", "graisse moyenne"),
  t("--sk-weight-semibold", "typography", "weight", "600", "graisse demi-grasse"),
  t("--sk-weight-bold", "typography", "weight", "700", "graisse grasse"),
  t("--sk-weight-extrabold", "typography", "weight", "800", "graisse extra-grasse"),
  t("--sk-tracking-tight", "typography", "tracking", "-.025em", "interlettrage serré"),
  t("--sk-tracking-wide", "typography", "tracking", ".025em", "interlettrage large"),
  t("--sk-tracking-wider", "typography", "tracking", ".05em", "interlettrage plus large"),
  t("--sk-tracking-widest", "typography", "tracking", ".1em", "interlettrage le plus large"),
  t("--sk-heading-transform", "typography", "text-transform", "none", "casse des titres"),
  t("--sk-eyebrow-transform", "typography", "text-transform", "uppercase", "casse de la petite ligne au-dessus d'un titre"),
  t("--sk-text-tray", "typography", "text-size", "13px", "texte du bandeau de cookies (petit écran)"),
  t("--sk-text-tray-title", "typography", "text-size", "15px", "titre du bandeau de cookies (petit écran)"),

  // ── Espaces et largeurs
  t("--sk-space", "space", "length", ".25rem", "unité d'espacement (--spacing de Tailwind)"),
  t("--sk-page-width", "space", "length", "64rem", "largeur maximale du contenu"),
  t("--sk-page-pad-x", "space", "length", "1rem", "marge horizontale de la page"),
  t("--sk-page-pad-y", "space", "length", "2.5rem", "marge verticale de la page"),
  t("--sk-stack-gap", "space", "length", "1.5rem", "espace entre les blocs d'une page"),
  t("--sk-prose-width", "space", "length", "42rem", "largeur de lecture des textes courts"),
  t("--sk-prose-width-wide", "space", "length", "48rem", "largeur de lecture des textes plus longs"),
  t("--sk-grid-gap", "space", "length", "1.25rem", "espace entre les cartes d'une grille"),

  // ── Rayons
  ...RADII.map((r) => t(`--sk-radius-${r}`, "radius", "length", RADIUS_REM[r], `rayon « ${r} »`)),
  t("--sk-radius-full", "radius", "length", "9999px", "rayon maximal (pastille)"),
  t("--sk-radius-card", "radius", "length", "var(--sk-radius-xl)", "rayon des cartes"),
  t("--sk-radius-panel", "radius", "length", "var(--sk-radius-2xl)", "rayon des panneaux"),
  t("--sk-radius-button", "radius", "length", "var(--sk-radius-full)", "rayon des boutons"),
  t("--sk-radius-field", "radius", "length", "var(--sk-radius-lg)", "rayon des champs"),
  t("--sk-radius-chip", "radius", "length", "var(--sk-radius-full)", "rayon des pastilles"),
  t("--sk-radius-media", "radius", "length", "var(--sk-radius-lg)", "rayon des images"),
  t("--sk-radius-avatar", "radius", "length", "var(--sk-radius-full)", "rayon des logos et portraits ronds"),

  // ── Bordures
  t("--sk-border-width", "border", "length", "1px", "épaisseur des bordures"),
  t("--sk-border-width-strong", "border", "length", "2px", "épaisseur des bordures marquées"),
  t("--sk-border-style", "border", "border-style", "solid", "style des bordures"),

  // ── Ombres
  t("--sk-shadow-card", "shadow", "shadow", "none", "ombre des cartes"),
  t("--sk-shadow-raised", "shadow", "shadow", "0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a", "ombre d'un élément surélevé"),
  t("--sk-shadow-pop", "shadow", "shadow", "var(--sk-shadow-raised)", "ombre des sous-menus et du menu sobre"),
  t("--sk-shadow-tray", "shadow", "shadow", "0 -8px 30px #0000002e", "ombre du bandeau de cookies"),
  t("--sk-glow", "shadow", "shadow", "none", "lueur appliquée aux pièces qui l'acceptent"),

  // ── Mouvement et cibles
  t("--sk-duration", "motion", "duration", "150ms", "durée des transitions"),
  t("--sk-ease", "motion", "easing", "cubic-bezier(.4, 0, .2, 1)", "courbe des transitions"),
  t("--sk-target", "motion", "target", "2.75rem", "taille minimale d'une cible tactile"),
  t("--sk-focus-width", "motion", "length", "2px", "épaisseur de l'anneau de focus"),
  t("--sk-focus-offset", "motion", "length", "2px", "écart de l'anneau de focus"),

  // ── Mise en page
  t("--sk-shell-columns", "layout", "grid-columns", "minmax(0, 1fr)", "colonnes de la coquille"),
  t("--sk-shell-areas", "layout", "grid-areas", '"banner" "header" "main" "footer"', "zones nommées de la coquille"),
  t("--sk-header-width", "layout", "length", "auto", "largeur de l'en-tête quand il devient colonne"),
  t("--sk-cards-min", "layout", "length", "15rem", "largeur minimale d'une carte de grille"),
  t("--sk-flow-gap", "layout", "length-pair", "2rem 1.5rem", "espace de l'accueil fluide (lignes, colonnes)"),
  t("--sk-vh-small-basis", "layout", "length", "14rem", "taille d'un petit morceau d'accueil"),
  t("--sk-vh-medium-basis", "layout", "length", "22rem", "taille d'un morceau d'accueil moyen"),
  t("--sk-vh-large-basis", "layout", "length", "34rem", "taille d'un grand morceau d'accueil"),
];

export const TOKEN_BY_NAME: ReadonlyMap<string, TokenDef> = new Map(TOKEN_DEFS.map((d) => [d.name, d]));
export const isKnownToken = (name: string): boolean => TOKEN_BY_NAME.has(name);

/** Jetons que seule la personne (ou le cœur) définit : l'administration n'en a pas et un skin ne peut pas les fixer. */
export const RESERVED_NAMES: readonly string[] = [];

/** Valeurs de basic, par nom (jetons facultatifs exclus). */
export function basicTokenValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of TOKEN_DEFS) if (d.basic !== null) out[d.name] = d.basic;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Types de jetons de module (docs/SKINS.md §8.2) → type de jeton du vocabulaire

export const MODULE_TOKEN_TYPES = ["color", "length", "shadow", "number", "font", "duration", "text-transform"] as const;
export type ModuleTokenType = (typeof MODULE_TOKEN_TYPES)[number];

/** Le jeton d'une pièce de module : `--sk-<idDuModule>-<pièce>-<propriété>`. */
export const MODULE_TOKEN_RE = /^--sk-[a-z][a-z0-9-]{1,100}$/;

// ---------------------------------------------------------------------------------------------------------------------
// Validation par type

/** Propriété CSS « représentative » d'un type : c'est elle qui fournit les minimums de l'assainisseur. */
const PROP_OF: Record<TokenType, string> = {
  color: "color", gradient: "background-image", length: "padding-left", "length-pair": "gap", "text-size": "font-size", "line-height": "line-height",
  number: "flex-grow", weight: "font-weight", tracking: "letter-spacing", duration: "transition-duration", easing: "transition-timing-function",
  font: "font-family", shadow: "box-shadow", "text-transform": "text-transform", "border-style": "border-style", "grid-columns": "grid-template-columns",
  "grid-areas": "grid-template-areas", target: "min-height",
};

/** Propriété plus précise pour certains jetons (bornes propres). */
const PROP_OVERRIDE: Record<string, string> = {
  "--sk-page-width": "max-width", "--sk-prose-width": "max-width", "--sk-prose-width-wide": "max-width", "--sk-header-width": "width", "--sk-cards-min": "min-width",
  "--sk-border-width": "border-width", "--sk-border-width-strong": "border-width", "--sk-focus-width": "outline-width", "--sk-focus-offset": "outline-offset",
  "--sk-vh-small-basis": "flex-basis", "--sk-vh-medium-basis": "flex-basis", "--sk-vh-large-basis": "flex-basis", "--sk-space": "gap",
  "--sk-glow": "box-shadow",
  // fonds, filets et voile : une couleur de FOND (la translucidité y est permise, le texte posé dessus est contrôlé par la lisibilité)
  "--v-bg": "background-color", "--v-surface": "background-color", "--v-line": "border-color", "--sk-color-veil": "background-color", "--sk-color-selection": "background-color",
};

const LENGTH_FUNCS = new Set(["calc", "min", "max", "clamp", "var"]);
const meaningful = (toks: readonly Tok[]) => toks.filter((x) => x.k !== "ws");
const COLOR_FUNCS = new Set(["rgb", "rgba", "hsl", "hsla", "oklch", "oklab", "lab", "lch", "color-mix", "color", "var", "hwb"]);

/** Une valeur est-elle une longueur (ou un calcul de longueur) ? Les `var()` sont acceptés : leur résultat est contrôlé à la composition. */
function lengthShape(toks: readonly Tok[], allowAuto = false, allowPercent = true): boolean {
  const m = meaningful(toks);
  if (m.length === 0) return false;
  const first = m[0]!;
  if (m.length === 1) {
    if (first.k === "num") return first.n === 0;
    if (first.k === "dim") return ["px", "rem", "em", "ch", "ex", "vw", "vh", "vmin", "vmax", "svh", "lvh", "dvh", "svw", "lvw", "dvw", "pt", "cm", "mm", "in", "lh", "rlh", ...(allowPercent ? ["%"] : [])].includes(first.unit);
    if (first.k === "ident") return allowAuto && first.v.toLowerCase() === "auto";
  }
  // calc(), clamp(), min(), max(), var(...) : le premier jeton est la fonction, le dernier la ferme
  if (first.k === "fn" && LENGTH_FUNCS.has(first.v) && m[m.length - 1]!.k === "close") return true;
  return false;
}

function topFunctionOnly(toks: readonly Tok[], names: ReadonlySet<string>): boolean {
  const m = meaningful(toks);
  return m.length >= 2 && m[0]!.k === "fn" && names.has(m[0]!.v) && m[m.length - 1]!.k === "close";
}

function shapeOk(type: TokenType, name: string, toks: readonly Tok[]): boolean {
  const m = meaningful(toks);
  const first = m[0];
  if (!first) return false;
  const isVarOnly = first.k === "fn" && first.v === "var" && m[m.length - 1]!.k === "close";
  switch (type) {
    case "color": return isVarOnly || (first.k === "hash" && m.length === 1) || (first.k === "ident" && m.length === 1) || topFunctionOnly(toks, COLOR_FUNCS);
    case "gradient": return isVarOnly || topFunctionOnly(toks, new Set(["linear-gradient", "radial-gradient", "conic-gradient", "var"]));
    case "length": return lengthShape(toks, name === "--sk-header-width");
    case "target": return lengthShape(toks);
    case "length-pair": {
      if (isVarOnly) return true;
      // une ou deux longueurs simples
      return (m.length === 1 || m.length === 2) && m.every((x) => (x.k === "dim" && lengthShape([x])) || (x.k === "num" && x.n === 0));
    }
    case "text-size": return lengthShape(toks, false, true) || m.length === 1 && first.k === "ident" && ["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large"].includes(first.v.toLowerCase());
    case "line-height": return isVarOnly || (m.length === 1 && (first.k === "num" || (first.k === "dim" && lengthShape([first])))) || (topFunctionOnly(toks, LENGTH_FUNCS));
    case "number": return isVarOnly || (m.length === 1 && first.k === "num");
    case "weight": return isVarOnly || (m.length === 1 && first.k === "num" && Number.isInteger(first.n) && first.n >= 100 && first.n <= 900);
    case "tracking": return isVarOnly || (m.length === 1 && (first.k === "dim" || (first.k === "num" && first.n === 0)) || (m.length === 1 && first.k === "ident" && first.v.toLowerCase() === "normal")) || topFunctionOnly(toks, LENGTH_FUNCS);
    case "duration": return isVarOnly || (m.length === 1 && first.k === "dim" && (first.unit === "ms" || first.unit === "s"));
    case "easing": return isVarOnly || (m.length === 1 && first.k === "ident" && ["ease", "ease-in", "ease-out", "ease-in-out", "linear"].includes(first.v.toLowerCase())) || topFunctionOnly(toks, new Set(["cubic-bezier", "steps", "var"]));
    case "font": return m.length > 0;
    case "shadow": return (m.length === 1 && first.k === "ident" && first.v.toLowerCase() === "none") || m.length > 1 || isVarOnly;
    case "text-transform": return isVarOnly || (m.length === 1 && first.k === "ident" && ["none", "uppercase", "lowercase", "capitalize"].includes(first.v.toLowerCase()));
    case "border-style": return isVarOnly || (m.length === 1 && first.k === "ident" && ["solid", "dashed", "dotted", "double"].includes(first.v.toLowerCase()));
    case "grid-columns": return m.length > 0;
    case "grid-areas": return m.length > 0 && m.every((x) => x.k === "str" || x.k === "ident");
  }
}

function newCtx(skinId: string): DeclContext {
  return { skinId, limits: DEFAULT_LIMITS, where: "rule", subjects: [], motionOk: false, keyframes: new Map(), used: { assets: new Set() }, counters: { fixedBackgrounds: 0 } };
}

export type TokenCheck = { ok: true; value: string; issues: SkinIssue[] } | { ok: false; unknown?: boolean; issues: SkinIssue[] };

/**
 * Vérifie la valeur d'UN jeton : (1) sûreté et forme générales (celles de la feuille : fonctions, unités, `url(skin:…)`, 300 caractères), (2) forme du type,
 * (3) bornes de la propriété CSS représentative (mêmes que l'assainisseur : taille de texte ≥ 0,6875 rem, durée ≤ 600 ms…).
 * Un jeton hors vocabulaire (et hors `extra`, le vocabulaire des modules installés) est `unknown` : ignoré sans erreur par l'appelant (§4.1).
 * Les `var()` ne sont pas résolus ici (voir `literalOf`) : leur résultat est contrôlé par la composition.
 */
export function validateTokenValue(name: string, value: unknown, options: { skinId?: string; extra?: ReadonlyMap<string, TokenType> } = {}): TokenCheck {
  const issues: SkinIssue[] = [];
  const type = TOKEN_BY_NAME.get(name)?.type ?? options.extra?.get(name);
  if (!type || !VAR_NAME_RE.test(name)) return { ok: false, unknown: true, issues };
  if (typeof value !== "string") return { ok: false, issues: [makeIssue("value-syntax", { prop: name.slice(0, 40) })] };
  const skinId = options.skinId && options.skinId !== "basic" ? options.skinId : "skin-check";
  const report = (code: string, params?: Record<string, string | number>, severity?: "error" | "warning") => issues.push(makeIssue(code, params, severity));
  // (1) sûreté générale : le jeton est une variable CSS, validée comme n'importe quelle variable de la feuille
  const generic = checkDeclaration(name, value, false, newCtx(skinId), report);
  if (!generic) return { ok: false, issues };
  // (2) forme du type
  const lex = tokenizeValue(generic.value, { maxLength: DEFAULT_LIMITS.maxCustomValueLength, maxTokens: DEFAULT_LIMITS.maxValueTokens, maxNesting: DEFAULT_LIMITS.maxValueNesting });
  if ("error" in lex || !shapeOk(type, name, lex.tokens)) {
    issues.push(makeIssue("value-syntax", { prop: name.slice(0, 40) }));
    return { ok: false, issues };
  }
  // (3) bornes de la propriété représentative, sauf pour une simple référence `var()` (résolue plus tard)
  const prop = PROP_OVERRIDE[name] ?? PROP_OF[type];
  const m = meaningful(lex.tokens);
  const refOnly = m[0]!.k === "fn" && m[0]!.v === "var" && m[m.length - 1]!.k === "close";
  if (!refOnly) {
    const bounded = checkDeclaration(prop, generic.value, false, newCtx(skinId), report);
    if (!bounded) return { ok: false, issues };
    if (type === "target" && !targetBigEnough(generic.value)) {
      issues.push(makeIssue("value-syntax", { prop: name.slice(0, 40) }));
      return { ok: false, issues };
    }
  }
  return { ok: !issues.some((i) => i.severity === "error"), value: generic.value, issues } as TokenCheck;
}

/** Une cible tactile ne descend pas sous 2,75 rem (44 px). Calculs et `var()` : contrôlés à la composition. */
function targetBigEnough(value: string): boolean {
  const m = /^(\d*\.?\d+)(px|rem|em)$/.exec(value.trim());
  if (!m) return true;
  const n = Number(m[1]);
  return (m[2] === "px" ? n : n * 16) >= 44;
}

/**
 * Valeur littérale d'un jeton après avoir suivi les `var(--autre[, repli])` simples (jusqu'à 6 renvois) dans `tokens` : sert à contrôler les minimums
 * d'une valeur qui n'est qu'une référence. `null` si la chaîne ne se termine pas par un littéral connu.
 */
export function literalOf(name: string, tokens: Readonly<Record<string, string>>): string | null {
  let current = tokens[name];
  for (let i = 0; i < 6 && typeof current === "string"; i++) {
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(current.trim());
    if (!ref) return current;
    const next = tokens[ref[1]!];
    current = typeof next === "string" ? next : ref[2];
  }
  return null;
}

/** Contrôle d'une valeur qui n'était qu'une référence, une fois résolue en littéral : mêmes bornes que `validateTokenValue`. */
export function validateResolved(name: string, literal: string, extra?: ReadonlyMap<string, TokenType>): boolean {
  const r = validateTokenValue(name, literal, { extra });
  return r.ok;
}
