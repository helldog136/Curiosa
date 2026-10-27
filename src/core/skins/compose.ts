/**
 * COMPOSITION des couches d'apparence (docs/SKINS.md §1, §3, §4.3) : fonction PURE (ni base de données, ni réseau, ni minuteur, ni horloge).
 *
 *   1. basic                         (embarqué, jamais absent)
 *   2. pièces des modules            (valeurs par défaut de leurs jetons ; vide tant qu'aucun module n'en déclare)
 *   3. le skin actif                 (jetons communs, jetons du mode, options)
 *   4. les retouches de la personne  (`theme.*` ; `theme.light.*` / `theme.dark.*` en « clair et sombre »)
 *
 * Repli valeur par valeur : tout jeton que le skin ne définit pas, ou dont la valeur est refusée, vient de basic. Les couleurs dérivées (texte secondaire,
 * filets, texte des boutons, états, dégradé) sont recalculées par `buildPalette` quand une couleur dont elles dépendent est retouchée, sinon le skin les fixe
 * ou, à défaut, elles sont dérivées. Le contrôle de lisibilité (`correctReadability`) s'applique au résultat de chaque mode d'un skin (basic est exempté).
 *
 * Pour basic, le résultat est EXACTEMENT celui d'avant les skins : `buildPalette(fond, accent, choix facultatifs)` (tests/core/skins-compose.test.mjs).
 */
import { buildPalette, FONT_STACKS, gradientTextOn, isHexColor, luminance, THEME_TOKENS, type Theme, type ThemeToken } from "../color";
import { BASIC } from "./basic";
import { parseColor, toHex } from "./colorParse";
import { makeIssue, type SkinIssue, type Text } from "./messages";
import { composite, correctReadability, type CorrectionChange } from "./readability";
import type { ColorRetouch, Mode, ModulePairDecl, ModuleTokenDecl, Retouches, SkinDefaults, SkinDefinition } from "./types";
import { literalOf, TOKEN_BY_NAME, validateTokenValue, type TokenType } from "./tokens";

/** Les 16 couleurs `--v-*` de la palette (tout `--v-*` sauf `--v-font`) : dérivées de fond + accent par `buildPalette`. */
const PALETTE_TOKENS = ["--v-bg", "--v-surface", "--v-fg", "--v-accent", "--v-accent2", "--v-muted", "--v-line", "--v-accent-fg", "--v-accent2-fg", "--v-success", "--v-success-fg", "--v-warning", "--v-warning-fg", "--v-danger", "--v-danger-fg", "--v-gradient"] as const;
const PALETTE_SET: ReadonlySet<string> = new Set(PALETTE_TOKENS);
const STATE_TOKENS = ["--v-success", "--v-success-fg", "--v-warning", "--v-warning-fg", "--v-danger", "--v-danger-fg"];

export type ComposeInput = {
  /** Le skin actif (déjà lu, feuille assainie). Absent : basic. */
  skin?: SkinDefinition | null;
  retouches?: Retouches;
  /** `skin.options` : `{ [optionId]: valeurId }`. */
  options?: Record<string, string>;
  /** Jetons des pièces de modules installés (couche 2). */
  moduleTokens?: readonly ModuleTokenDecl[];
  /** Paires de couleurs des pièces de modules (contrôle de lisibilité, paire 11). */
  modulePairs?: readonly ModulePairDecl[];
};

export type ComposedMode = {
  mode: Mode;
  /** Jetons effectifs de ce mode : couleurs, `--v-font` et tous les `--sk-*` (valeurs finales, après correction de lisibilité). */
  tokens: Record<string, string>;
  /** Thème « #rrggbb » pour le halo et le fond (mêmes champs que `buildTheme`). */
  theme: Theme;
  /** Mode de ce skin suspendu pour illisibilité : basic s'applique à la place (§7.3). */
  suspended: boolean;
  /** Corrections de lisibilité appliquées au rendu. */
  changes: CorrectionChange[];
  notice: Text | null;
  /** Le fond effectif est-il sombre ? (même seuil que le logo : luminance ≤ 0,4). */
  darkBackground: boolean;
};

export type Composed = {
  /** Id posé sur `<html data-skin>` : le skin appliqué (`basic` si le skin demandé n'est pas disponible). */
  skinId: string;
  modes: ComposedMode[];
  /** Vrai si le visiteur peut choisir clair / sombre : le skin effectif fournit les deux modes. */
  switchAvailable: boolean;
  colorScheme: boolean;
  /** Feuille de style du skin (assainie, vide pour basic). */
  css: string;
  defaults: SkinDefaults;
  /** Un accent secondaire distinct de l'accent est effectif dans au moins un mode. */
  hasAccent2: boolean;
  /** Une couleur de cartes a été choisie par la personne. */
  hasChosenSurface: boolean;
  issues: SkinIssue[];
  notices: Text[];
};

const isDarkHex = (hex: string) => luminance(hex) <= 0.4;

/** Couleur CSS quelconque → « #rrggbb » opaque (composée sur `over` si translucide) ; `null` si elle n'est pas comprise. */
function toOpaqueHex(value: string | undefined, over?: string): string | null {
  if (value === undefined) return null;
  if (isHexColor(value)) return value;
  const c = parseColor(value);
  if (!c) return null;
  if (c.a >= 1) return toHex({ ...c, a: 1 });
  const base = over && parseColor(over) ? parseColor(over)! : { r: 0, g: 0, b: 0, a: 1 };
  return toHex({ ...composite(c, { ...base, a: 1 }), a: 1 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Couches de jetons (validées, repli sur basic)

type Layer = Record<string, string>;

function validated(source: Record<string, string> | undefined, skinId: string, extra: ReadonlyMap<string, TokenType>, issues: SkinIssue[]): Layer {
  const out: Layer = {};
  if (!source || typeof source !== "object") return out;
  for (const [name, value] of Object.entries(source)) {
    const r = validateTokenValue(name, value, { skinId, extra });
    if (r.ok) out[name] = r.value;
    else if (!("unknown" in r && r.unknown)) issues.push(...r.issues.map((i) => ({ ...i, severity: "warning" as const })));
    // un jeton inconnu est ignoré sans erreur (§4.1)
  }
  return out;
}

/** Le plan des modes : quels modes le site propose-t-il, et quelles retouches de couleurs vont à chacun ? */
function planModes(skin: SkinDefinition, ret: Retouches): { modes: Mode[]; retouch: Partial<Record<Mode, ColorRetouch>> } {
  const declared = (["light", "dark"] as const).filter((m) => skin.modes.includes(m));
  if (declared.length <= 1) {
    const m = declared[0] ?? "dark";
    return { modes: [m], retouch: { [m]: ret.palette === "both" && skin.id !== "basic" ? ret[m] : ret.single } };
  }
  if (ret.palette === "both") return { modes: ["light", "dark"], retouch: { light: ret.light, dark: ret.dark } };
  // « un seul mode » : un fond retouché rend le site mono-mode, celui que dit sa luminance (§3.7) ; sans fond retouché, les autres couleurs vont aux deux modes
  const bg = ret.single.background;
  if (bg) {
    const m: Mode = isDarkHex(bg) ? "dark" : "light";
    return { modes: [m], retouch: { [m]: ret.single } };
  }
  return { modes: ["light", "dark"], retouch: { light: ret.single, dark: ret.single } };
}

/** Les jetons effectifs d'un mode. */
function composeMode(args: {
  mode: Mode; skin: SkinDefinition; basic: SkinDefinition; retouch: ColorRetouch; font?: "sans" | "serif" | "mono"; issues: SkinIssue[];
  extra: ReadonlyMap<string, TokenType>; moduleDefaults: Layer; optionLayer: Layer; modulePairs: readonly ModulePairDecl[];
}): ComposedMode {
  const { mode, skin, basic, retouch: R, issues, extra } = args;
  const isBasic = skin.id === basic.id;

  // ── jetons qui ne sont pas la palette : basic < modules < skin (commun puis mode) < options < police retouchée
  const basicLayer = validated({ ...basic.tokens.common, ...basic.tokens.dark }, basic.id, extra, []);
  const skinLayer = isBasic ? {} : validated({ ...skin.tokens.common, ...skin.tokens[mode] }, skin.id, extra, issues);
  const merged: Layer = { ...stripPalette(basicLayer), ...args.moduleDefaults, ...stripPalette(skinLayer), ...args.optionLayer };
  const skinPalette: Layer = isBasic ? basicLayer : pickPalette(skinLayer);
  if (args.font) merged["--v-font"] = FONT_STACKS[args.font];

  // ── palette
  const palette = isBasic ? basicPalette(R, basicLayer) : skinPaletteOf(R, skinPalette, basicLayer);
  const tokens: Record<string, string> = { ...merged, ...palette };

  // ── jetons qui ne sont qu'une référence : leur valeur littérale doit passer les mêmes bornes (sinon repli sur basic)
  for (const [name, value] of Object.entries(merged)) {
    if (!/^var\(/.test(value.trim()) || !TOKEN_BY_NAME.has(name)) continue;
    const lit = literalOf(name, tokens);
    if (lit === null || lit === value) continue;
    if (!validateTokenValue(name, lit, { skinId: skin.id, extra }).ok) {
      issues.push(makeIssue("value-syntax", { prop: name.slice(0, 40) }, "warning"));
      const fallback = basicLayer[name];
      if (fallback !== undefined) tokens[name] = fallback;
      else delete tokens[name];
    }
  }

  // ── lisibilité (jamais pour basic : c'est l'apparence existante)
  let changes: CorrectionChange[] = [];
  let notice: Text | null = null;
  let suspended = false;
  let finalTokens = tokens;
  if (!isBasic) {
    const c = correctReadability(tokens, mode, { skinId: skin.id, modulePairs: args.modulePairs.map((p) => ({ fg: p.fg, bg: p.bg, defaults: { fg: args.moduleDefaults[p.fg], bg: args.moduleDefaults[p.bg] } })) });
    changes = c.changes;
    notice = c.notice;
    if (c.suspended) {
      suspended = true;
      notice = c.notice;
      // basic s'applique à ce mode : ses couleurs (la feuille et les autres jetons du skin restent)
      finalTokens = { ...tokens, ...basicPalette({}, basicLayer) };
    } else finalTokens = c.tokens;
  }
  // Texte à poser sur le dégradé accent → accent secondaire (règles `[data-accent2]` du cœur) : seulement si les deux accents diffèrent
  const a = finalTokens["--v-accent"], b = finalTokens["--v-accent2"];
  if (isHexColor(a) && isHexColor(b) && a.toLowerCase() !== b.toLowerCase()) finalTokens = { ...finalTokens, "--c-grad-fg": gradientTextOn(a, b) };
  const theme = themeOf(finalTokens, args.font);
  return { mode, tokens: finalTokens, theme, suspended, changes, notice, darkBackground: isDarkHex(theme.bg) };
}

const stripPalette = (l: Layer): Layer => Object.fromEntries(Object.entries(l).filter(([k]) => !PALETTE_SET.has(k)));
const pickPalette = (l: Layer): Layer => Object.fromEntries(Object.entries(l).filter(([k]) => PALETTE_SET.has(k)));

/** Basic : EXACTEMENT `buildPalette` des choix de la personne (comportement d'avant les skins). */
function basicPalette(R: ColorRetouch, basicLayer: Layer): Layer {
  const bg = R.background ?? basicLayer["--v-bg"]!;
  const accent = R.accent ?? basicLayer["--v-accent"]!;
  return buildPalette(bg, accent, { accent2: R.accent2, surface: R.surface, text: R.text });
}

/** Un autre skin : ses valeurs fixées sont gardées tant qu'aucune couleur dont elles dépendent n'est retouchée ; les manquantes sont dérivées. */
function skinPaletteOf(R: ColorRetouch, skinP: Layer, basicLayer: Layer): Layer {
  const bgRaw = R.background ?? skinP["--v-bg"] ?? basicLayer["--v-bg"]!;
  const accentRaw = R.accent ?? skinP["--v-accent"] ?? basicLayer["--v-accent"]!;
  const bgHex = toOpaqueHex(bgRaw) ?? basicLayer["--v-bg"]!;
  const accentHex = toOpaqueHex(accentRaw, bgHex) ?? basicLayer["--v-accent"]!;
  const textRaw = R.text ?? skinP["--v-fg"], surfaceRaw = R.surface ?? skinP["--v-surface"];
  const accent2Raw = R.accent2 ?? skinP["--v-accent2"];
  const accent2IsRef = accent2Raw === undefined || /^var\(\s*--v-accent\s*\)$/.test(accent2Raw.trim());
  const derived = buildPalette(bgHex, accentHex, {
    text: toOpaqueHex(textRaw, bgHex) ?? undefined,
    surface: toOpaqueHex(surfaceRaw, bgHex) ?? undefined,
    accent2: accent2IsRef ? undefined : (toOpaqueHex(accent2Raw, bgHex) ?? undefined),
  });
  const rb = !!R.background, rt = !!R.text, rs = !!R.surface, ra = !!R.accent, ra2 = !!R.accent2;
  const retouchedDeps: Record<string, boolean> = {
    "--v-muted": rb || rt || rs, "--v-line": rb || rt, "--v-accent-fg": ra, "--v-accent2-fg": ra || ra2, "--v-gradient": ra || ra2,
    ...Object.fromEntries(STATE_TOKENS.map((n) => [n, rb || rt || rs])),
  };
  const out: Layer = {};
  // bases : la retouche, sinon la valeur du skin telle qu'il l'a écrite (rgb(), oklch()… compris), sinon basic
  out["--v-bg"] = bgRaw;
  out["--v-accent"] = accentRaw;
  out["--v-fg"] = textRaw ?? derived["--v-fg"]!;
  out["--v-surface"] = surfaceRaw ?? derived["--v-surface"]!;
  out["--v-accent2"] = R.accent2 ?? (accent2IsRef ? derived["--v-accent2"]! : accent2Raw!);
  // dérivées : la valeur du skin si rien n'a bougé, sinon le calcul
  for (const name of PALETTE_TOKENS) {
    if (name in out) continue;
    const fixed = skinP[name];
    out[name] = !retouchedDeps[name] && fixed !== undefined ? fixed : derived[name]!;
  }
  return out;
}

/** Le thème « #rrggbb » (halo, fond) d'un jeu de jetons : les couleurs non hexadécimales sont converties. */
function themeOf(tokens: Record<string, string>, fontKey?: "sans" | "serif" | "mono"): Theme {
  const bg = toOpaqueHex(tokens["--v-bg"]) ?? "#121214";
  const NAME: Record<ThemeToken, string> = { accent: "--v-accent", accentFg: "--v-accent-fg", bg: "--v-bg", surface: "--v-surface", fg: "--v-fg", muted: "--v-muted", line: "--v-line", success: "--v-success", successFg: "--v-success-fg", warning: "--v-warning", warningFg: "--v-warning-fg", danger: "--v-danger", dangerFg: "--v-danger-fg", accent2: "--v-accent2", accent2Fg: "--v-accent2-fg", gradient: "--v-gradient" };
  const out = {} as Record<ThemeToken, string>;
  for (const key of THEME_TOKENS) {
    const v = tokens[NAME[key]];
    out[key] = key === "gradient" ? (v ?? "") : (toOpaqueHex(v, bg) ?? "#808080");
  }
  const font = tokens["--v-font"] ?? FONT_STACKS.sans;
  const key = fontKey ?? (font === FONT_STACKS.serif ? "serif" : font === FONT_STACKS.mono ? "mono" : "sans");
  return { ...out, fontKey: key, font };
}

// ---------------------------------------------------------------------------------------------------------------------

/** Compose les quatre couches. Ne lève jamais : en cas de doute, c'est basic qui s'applique. */
export function composeSkin(input: ComposeInput = {}): Composed {
  const issues: SkinIssue[] = [];
  try {
    return compose(input, issues);
  } catch {
    issues.push(makeIssue("internal-error", {}));
    return compose({ retouches: input.retouches }, issues, true);
  }
}

function compose(input: ComposeInput, issues: SkinIssue[], forceBasic = false): Composed {
  const basic = BASIC;
  const skin = forceBasic || !input.skin ? basic : input.skin;
  const ret = input.retouches ?? { palette: "single" as const, single: {}, light: {}, dark: {} };
  const extra = new Map<string, TokenType>((input.moduleTokens ?? []).map((d) => [d.name, d.type]));
  const moduleDefaults = validated(Object.fromEntries((input.moduleTokens ?? []).map((d) => [d.name, d.default])), basic.id, extra, []);

  // options : chaque valeur choisie n'est qu'une liste de jetons (§3.4)
  const optionTokens: Record<string, string> = {};
  for (const opt of skin.options) {
    const chosen = input.options?.[opt.id];
    const value = opt.values.find((v) => v.id === chosen) ?? opt.values.find((v) => v.id === opt.default);
    if (value) Object.assign(optionTokens, value.tokens);
  }
  const optionLayer = skin === basic ? {} : validated(optionTokens, skin.id, extra, issues);

  // jetons de modules du skin (`modules.<id>`) : seulement ceux des modules installés
  const skinModuleTokens: Record<string, string> = {};
  for (const tokens of Object.values(skin.tokens.modules ?? {})) for (const [n, v] of Object.entries(tokens ?? {})) if (extra.has(n)) skinModuleTokens[n] = v;
  const moduleLayer = { ...moduleDefaults, ...(skin === basic ? {} : validated(skinModuleTokens, skin.id, extra, issues)) };

  const plan = planModes(skin, ret);
  const modes = plan.modes.map((mode) =>
    composeMode({
      mode, skin, basic, retouch: plan.retouch[mode] ?? {}, font: ret.font, issues, extra, moduleDefaults: moduleLayer, optionLayer, modulePairs: input.modulePairs ?? [],
    }),
  );
  const hasAcc2 = modes.some((m) => {
    const a = m.tokens["--v-accent"], b = m.tokens["--v-accent2"];
    return isHexColor(a) && isHexColor(b) && a.toLowerCase() !== b.toLowerCase();
  });
  const chosenSurface = Object.values(plan.retouch).some((r) => isHexColor(r?.surface));
  return {
    skinId: skin.id,
    modes,
    switchAvailable: modes.length === 2,
    colorScheme: skin.colorScheme,
    css: skin.css,
    defaults: skin.defaults,
    hasAccent2: hasAcc2,
    hasChosenSurface: chosenSurface,
    issues,
    notices: modes.flatMap((m) => (m.notice ? [m.notice] : [])),
  };
}

