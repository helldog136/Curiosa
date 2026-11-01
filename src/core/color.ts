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

/** Choix facultatifs qui s'ajoutent au fond et à l'accent. Absent, vide ou invalide : la valeur est dérivée comme avant. */
export type ThemeExtra = {
  /** Accent secondaire (2e extrémité du dégradé). Absent = l'accent : aucun changement visible. */
  accent2?: string | null;
  /** Fond des cartes et panneaux. Absent = mélange de 6 % de texte dans le fond. */
  surface?: string | null;
  /** Couleur du texte. Absent = gris neutre clair ou foncé selon le fond. */
  text?: string | null;
};

const DEFAULT_BG = "#121214";
const DEFAULT_ACCENT = "#e8a23b";

/** Dégradé accent → accent2 (inclinaison 120°) : interpolé en OKLCH quand `oklch` est vrai (évite le milieu boueux), en sRGB sinon. Deux couleurs identiques : couleur unie. */
export function gradientOf(accent: string, accent2: string, oklch = true): string {
  return `linear-gradient(120deg${oklch && accent.toLowerCase() !== accent2.toLowerCase() ? " in oklch" : ""}, ${accent}, ${accent2})`;
}

/** Vrai si le site a choisi un accent secondaire différent de l'accent : c'est alors seulement que les accents de détail, les boutons pleins et les dégradés s'activent (attribut `data-accent2`). Sans choix, le site garde son apparence d'origine. */
export function hasAccent2(config: { accent?: string | null; accent2?: string | null }): boolean {
  return isHexColor(config.accent2) && (!isHexColor(config.accent) || config.accent2.toLowerCase() !== config.accent.toLowerCase());
}

/** Vrai si l'administrateur a choisi lui-même la couleur des cartes (attribut `data-surface`). */
export function hasChosenSurface(config: { surface?: string | null }): boolean {
  return isHexColor(config.surface);
}

/** Texte (noir ou blanc) à poser sur le dégradé accent → accent2 : celui dont le plus mauvais contraste, mesuré aux deux extrémités et en trois points intermédiaires, est le meilleur. */
export function gradientTextOn(accent: string, accent2: string): string {
  const points = [0, 0.25, 0.5, 0.75, 1].map((r) => mix(accent, accent2, r));
  const worst = (ink: string) => Math.min(...points.map((p) => contrast(p, ink)));
  return worst(INK) >= worst(PAPER) ? INK : PAPER;
}

/** Palette complète dérivée de deux couleurs (le fond et l'accent), et des choix facultatifs `extra`. Sans `extra`, le résultat est celui d'avant leur existence. */
export function buildPalette(background: string, accent: string, extra: ThemeExtra = {}): Record<string, string> {
  const bg = isHexColor(background) ? background : DEFAULT_BG;
  const ac = isHexColor(accent) ? accent : DEFAULT_ACCENT;
  const light = luminance(bg) > 0.4;
  const fg = isHexColor(extra.text) ? extra.text : light ? "#18181b" : "#f4f4f5";
  const surface = isHexColor(extra.surface) ? extra.surface : mix(bg, fg, 0.06);
  const ac2 = isHexColor(extra.accent2) ? extra.accent2 : ac;
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
  palette["--v-accent2"] = ac2;
  palette["--v-accent2-fg"] = textOn(ac2);
  palette["--v-gradient"] = gradientOf(ac, ac2);
  return palette;
}

/** Problèmes de lisibilité d'une combinaison de couleurs (rapports WCAG sous les seuils : texte/fond 4,5, accents/fond 3). Calcul pur, utilisable côté navigateur. */
export type ContrastIssue = { kind: "text" | "accent" | "accent2"; ratio: number; min: number };
export function contrastIssues(background: string, accent: string, extra: ThemeExtra = {}): ContrastIssue[] {
  const p = buildPalette(background, accent, extra);
  const checks: [ContrastIssue["kind"], string, number][] = [["text", p["--v-fg"]!, 4.5], ["accent", p["--v-accent"]!, 3]];
  if (isHexColor(extra.accent2)) checks.push(["accent2", p["--v-accent2"]!, 3]);
  return checks.map(([kind, color, min]) => ({ kind, min, ratio: Math.round(contrast(color, p["--v-bg"]!) * 100) / 100 })).filter((c) => c.ratio < c.min);
}

/** Couleurs facultatives du thème envoyées par le formulaire (champ absent = on n'y touche pas ; vide = retour au dérivé). Null si l'une n'est pas un « #rrggbb ». */
export function parseOptionalColors(formData: { has(name: string): boolean; get(name: string): unknown }): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [field, key] of [["accent2", "theme.accent2"], ["surface", "theme.surface"], ["text", "theme.text"]] as const) {
    if (!formData.has(field)) continue;
    const v = String(formData.get(field) ?? "").trim().toLowerCase();
    if (v && !isHexColor(v)) return null;
    out[key] = v;
  }
  return out;
}

export const FONT_STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** Les jetons du thème du site, tels que les modules les reçoivent (`ctx.theme`) et les utilisent comme valeur par défaut (`"theme:accent"`). */
export const THEME_TOKENS = ["accent", "accentFg", "bg", "surface", "fg", "muted", "line", "success", "successFg", "warning", "warningFg", "danger", "dangerFg", "accent2", "accent2Fg", "gradient"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
/** Les jetons qui sont une couleur « #rrggbb » (tout sauf `gradient`, un dégradé CSS) : les seuls utilisables comme défaut « theme:… » d'un réglage de couleur. */
export const COLOR_TOKENS = THEME_TOKENS.filter((t) => t !== "gradient") as Exclude<ThemeToken, "gradient">[];
export type Theme = Record<ThemeToken, string> & {
  /** Famille de police du site (« sans », « serif » ou « mono »). */
  fontKey: "sans" | "serif" | "mono";
  /** Pile CSS complète de cette police. */
  font: string;
};

const VARS: Record<ThemeToken, string> = { accent: "--v-accent", accentFg: "--v-accent-fg", bg: "--v-bg", surface: "--v-surface", fg: "--v-fg", muted: "--v-muted", line: "--v-line",
  success: "--v-success", successFg: "--v-success-fg", warning: "--v-warning", warningFg: "--v-warning-fg", danger: "--v-danger", dangerFg: "--v-danger-fg",
  accent2: "--v-accent2", accent2Fg: "--v-accent2-fg", gradient: "--v-gradient" };

/** Thème complet (couleurs dérivées + police) à partir des réglages de l'admin (fond, accent, police, et choix facultatifs). Même calcul que le site. */
export function buildTheme(background: string, accent: string, font: string, extra: ThemeExtra = {}): Theme {
  const palette = buildPalette(background, accent, extra);
  const fontKey = font === "serif" || font === "mono" ? font : "sans";
  const colors = Object.fromEntries(THEME_TOKENS.map((t) => [t, palette[VARS[t]]!])) as Record<ThemeToken, string>;
  return { ...colors, fontKey, font: FONT_STACKS[fontKey] };
}

/** Variables CSS `--v-*` (et `--v-font`) du thème : ce que le site met sur `:root`, que les overlays reçoivent aussi. */
export function themeCss(theme: Theme): string {
  // Le dégradé est posé en sRGB (compris partout), puis amélioré en OKLCH par les navigateurs qui le savent.
  const plain = THEME_TOKENS.filter((t) => t !== "gradient").map((t) => `${VARS[t]}:${theme[t]}`).join(";");
  const fallback = gradientOf(theme.accent, theme.accent2, false);
  const upgrade = theme.gradient !== fallback ? `@supports (background-image:linear-gradient(in oklch,#000,#fff)){:root{--v-gradient:${theme.gradient}}}` : "";
  return `:root{${plain};--v-gradient:${fallback};--v-font:${theme.font}}${upgrade}`;
}

/** « theme:accent » → jeton ; autre valeur → null. */
export function themeRef(value: unknown): Exclude<ThemeToken, "gradient"> | null {
  if (typeof value !== "string" || !value.startsWith("theme:")) return null;
  const token = value.slice(6);
  return (COLOR_TOKENS as readonly string[]).includes(token) ? (token as Exclude<ThemeToken, "gradient">) : null;
}
