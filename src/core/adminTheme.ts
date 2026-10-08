import { buildPalette } from "./color";

/**
 * THÈME DE L'ADMIN — clair (papier crème), sombre, ou « auto » (suit le réglage du système). Indépendant du thème du site.
 * Le choix est mémorisé dans un cookie du navigateur (pas de donnée à migrer, et chaque appareil garde sa préférence).
 */
export const ADMIN_THEMES = ["auto", "light", "dark"] as const;
export type AdminTheme = (typeof ADMIN_THEMES)[number];
export const ADMIN_THEME_COOKIE = "curiosa_admin_theme";

export const parseAdminTheme = (v: unknown): AdminTheme => (ADMIN_THEMES as readonly string[]).includes(String(v)) ? (v as AdminTheme) : "auto";

const LIGHT = { ...buildPalette("#faf7f2", "#6c5ce7"), "--v-surface": "#ffffff", "--v-fg": "#2b2622", "--v-muted": "#7a7066", "--v-line": "#ebe4d9" };
const DARK = { ...buildPalette("#15141a", "#9b8cff"), "--v-surface": "#1e1d26", "--v-fg": "#ecebf2", "--v-muted": "#9d9bad", "--v-line": "#2d2b38" };

const vars = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}:${v}`).join(";");
/** Les couleurs « d'état » (erreur, succès, avertissement) posées en dur dans l'admin : éclaircies pour rester lisibles sur fond sombre. */
const STATE_OVERRIDES: [string[], string][] = [
  [["text-red-700", "text-red-600", "text-red-500"], "#fca5a5"],
  [["text-emerald-700", "text-emerald-800", "text-emerald-900"], "#6ee7b7"],
  [["text-amber-700"], "#fcd34d"],
];

/** Feuille de style de l'admin : variables claires par défaut, sombres si `data-admin-theme="dark"` ou, en « auto », si le système est en mode sombre. */
export function adminThemeCss(): string {
  // Chaque classe est préfixée par le thème (une liste « .a,.b » ne préfixerait que la première).
  const dark = (scope: string) => `${scope}{${vars(DARK)};color-scheme:dark}${STATE_OVERRIDES.map(([classes, color]) => `${classes.map((c) => `${scope} .${c}`).join(",")}{color:${color}}`).join("")}`;
  return `:root{${vars(LIGHT)}}${dark(':root[data-admin-theme="dark"]')}@media (prefers-color-scheme: dark){${dark(':root[data-admin-theme="auto"]')}}`;
}
