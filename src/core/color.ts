const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function parse(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mix(a: string, b: string, ratio: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, "0");
  return `#${m(ar, br)}${m(ag, bg)}${m(ab, bb)}`;
}

/** Rapport de contraste WCAG 2.x entre deux couleurs (de 1 à 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const INK = "#111111";
const PAPER = "#ffffff";

/** Couleur de texte (noir quasi pur ou blanc) la plus lisible posée sur `color` : celle qui donne le meilleur rapport de contraste WCAG. */
export function textOn(color: string): string {
  return contrast(color, INK) >= contrast(color, PAPER) ? INK : PAPER;
}

/** Rapproche `color` de `toward` (par pas de 1 %) jusqu'à atteindre `min`:1 contre toutes les couleurs `against`. Une couleur qui passe déjà n'est pas touchée. */
function reach(color: string, toward: string, against: string[], min: number): string {
  for (let step = 0; step <= 100; step++) {
    const c = step === 0 ? color : mix(color, toward, step / 100);
    if (against.every((o) => contrast(c, o) >= min)) return c;
  }
  return toward;
}

/** Texte secondaire : le mélange habituel fond/texte (62 %), porté plus près du texte si besoin pour rester lisible (4,5:1) sur le fond ET sur la surface. */
function mutedOn(bg: string, fg: string, surface: string): string {
  for (let pct = 62; pct <= 100; pct++) {
    const c = mix(bg, fg, pct / 100);
    if (contrast(c, bg) >= 4.5 && contrast(c, surface) >= 4.5) return c;
  }
  return fg;
}

// Couleurs d'état : une version pour fond sombre, une pour fond clair, rapprochées du texte si le fond choisi les rend illisibles.
const STATES = {
  dark: { success: "#4ade80", warning: "#fbbf24", danger: "#f87171" },
  light: { success: "#15803d", warning: "#b45309", danger: "#b91c1c" },
} as const;

/** Palette complète dérivée de deux couleurs : le fond et l'accent. */
export function buildPalette(background: string, accent: string): Record<string, string> {
  const bg = isHexColor(background) ? background : "#121214";
  const ac = isHexColor(accent) ? accent : "#e8a23b";
  const light = luminance(bg) > 0.4;
  const fg = light ? "#18181b" : "#f4f4f5";
  const surface = mix(bg, fg, 0.06);
  const palette: Record<string, string> = {
    "--v-bg": bg,
    "--v-fg": fg,
    "--v-muted": mutedOn(bg, fg, surface),
    "--v-surface": surface,
    "--v-line": mix(bg, fg, 0.16),
    "--v-accent": ac,
    "--v-accent-fg": textOn(ac),
  };
  for (const [name, base] of Object.entries(STATES[light ? "light" : "dark"])) {
    const c = reach(base, fg, [bg, surface], 4.5);
    palette[`--v-${name}`] = c;
    palette[`--v-${name}-fg`] = textOn(c);
  }
  return palette;
}

export const FONT_STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** Les jetons du thème du site, tels que les modules les reçoivent (`ctx.theme`) et les utilisent comme valeur par défaut (`"theme:accent"`). */
export const THEME_TOKENS = ["accent", "accentFg", "bg", "surface", "fg", "muted", "line", "success", "successFg", "warning", "warningFg", "danger", "dangerFg"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type Theme = Record<ThemeToken, string> & {
  /** Famille de police du site (« sans », « serif » ou « mono »). */
  fontKey: "sans" | "serif" | "mono";
  /** Pile CSS complète de cette police. */
  font: string;
};

const VARS: Record<ThemeToken, string> = { accent: "--v-accent", accentFg: "--v-accent-fg", bg: "--v-bg", surface: "--v-surface", fg: "--v-fg", muted: "--v-muted", line: "--v-line",
  success: "--v-success", successFg: "--v-success-fg", warning: "--v-warning", warningFg: "--v-warning-fg", danger: "--v-danger", dangerFg: "--v-danger-fg" };

/** Thème complet (couleurs dérivées + police) à partir des deux réglages de l'admin. Même calcul que le site. */
export function buildTheme(background: string, accent: string, font: string): Theme {
  const palette = buildPalette(background, accent);
  const fontKey = font === "serif" || font === "mono" ? font : "sans";
  const colors = Object.fromEntries(THEME_TOKENS.map((t) => [t, palette[VARS[t]]!])) as Record<ThemeToken, string>;
  return { ...colors, fontKey, font: FONT_STACKS[fontKey] };
}

/** Variables CSS `--v-*` (et `--v-font`) du thème : ce que le site met sur `:root`, que les overlays reçoivent aussi. */
export function themeCss(theme: Theme): string {
  return `:root{${THEME_TOKENS.map((t) => `${VARS[t]}:${theme[t]}`).join(";")};--v-font:${theme.font}}`;
}

/** « theme:accent » → jeton ; autre valeur → null. */
export function themeRef(value: unknown): ThemeToken | null {
  if (typeof value !== "string" || !value.startsWith("theme:")) return null;
  const token = value.slice(6);
  return (THEME_TOKENS as readonly string[]).includes(token) ? (token as ThemeToken) : null;
}
