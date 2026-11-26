import { CREDIT_URL } from "./credit";
import { buildPalette } from "./color";

/**
 * THÈME DE L'ADMIN — clair (papier crème), sombre, ou « auto » (suit le réglage du système). Indépendant du thème du site.
 * Le choix est mémorisé dans un cookie du navigateur (pas de donnée à migrer, et chaque appareil garde sa préférence).
 *
 * SEULE SOURCE DE VÉRITÉ de l'apparence de l'administration (docs/ideas/skins-admin.md) : les JETONS `--cur-*` ci-dessous, en clair et en sombre.
 * L'admin les consomme (`--v-bg:var(--cur-bg)`…, donc Tailwind `bg-bg`…), et les modules les reçoivent pour leurs pages secrètes
 * (`ctx.api.adminTheme()`, voir `moduleAdminTheme`). Ajouter un jeton : l'ajouter ici ET à la liste figée de tests/core/admin-theme-tokens.test.mjs.
 * Retirer ou renommer un jeton : INTERDIT (des modules l'emploient) ; le test devient rouge.
 */
export const ADMIN_THEMES = ["auto", "light", "dark"] as const;
export type AdminTheme = (typeof ADMIN_THEMES)[number];
export const ADMIN_THEME_COOKIE = "curiosa_admin_theme";

export const parseAdminTheme = (v: unknown): AdminTheme => (ADMIN_THEMES as readonly string[]).includes(String(v)) ? (v as AdminTheme) : "auto";

/** Les deux modes d'un jeton d'admin. */
export type AdminScheme = "light" | "dark";

/** Les jetons COULEUR, avec ce qu'ils servent à peindre. Noms STABLES (préfixe `--cur-`). */
export const ADMIN_COLOR_TOKENS = [
  "--cur-bg", // fond de la page
  "--cur-fg", // texte
  "--cur-muted", // texte secondaire (4,5:1 sur le fond, les surfaces et le fond survolé)
  "--cur-surface", // cartes et panneaux
  "--cur-line", // filets et séparateurs (décoratifs : ne portent jamais seuls une information)
  "--cur-accent", // accent (boutons, liens, focus) : 3:1 au moins sur le fond
  "--cur-accent-fg", // texte posé sur l'accent
  "--cur-ok", // succès (texte lisible sur le fond et les surfaces)
  "--cur-ok-fg",
  "--cur-warn", // avertissement
  "--cur-warn-fg",
  "--cur-danger", // erreur
  "--cur-danger-fg",
  "--cur-focus", // anneau de focus (3:1 au moins sur le fond et sur les surfaces)
  // Ajoutés pour le contraste AA (audit F-A11Y-004/005) : on ajoute, on ne retire jamais.
  "--cur-line-strong", // bordure des champs, interrupteurs et cases : 3:1 au moins sur le fond et sur les surfaces (le filet `--cur-line` reste décoratif)
  "--cur-accent-text", // texte d'accent (lien, élément actif du menu) : 4,5:1 sur le fond, les surfaces et la teinte
  "--cur-accent-tint", // fond doux de l'élément actif (texte `--cur-accent-text` dessus)
  "--cur-ok-text", // texte d'une pastille « réussi » (4,5:1 sur `--cur-ok-soft`)
  "--cur-ok-soft", // fond d'une pastille « réussi »
  "--cur-warn-text", // texte d'une pastille « à surveiller »
  "--cur-warn-soft",
  "--cur-danger-text", // texte d'une pastille « erreur »
  "--cur-danger-soft",
  "--cur-neutral-text", // texte d'une pastille neutre
  "--cur-neutral-soft",
] as const;
/** Les jetons de FORME et de TEXTE (mêmes valeurs en clair et en sombre). */
export const ADMIN_SHAPE_TOKENS = [
  "--cur-radius", // rayon courant (champs, boutons)
  "--cur-radius-lg", // grand rayon (cartes, panneaux)
  "--cur-shadow", // ombre d'une carte
  "--cur-space", // unité d'espacement
  "--cur-font", // police du texte (pile du système : rien n'est chargé)
] as const;
export const ADMIN_TOKENS = [...ADMIN_COLOR_TOKENS, ...ADMIN_SHAPE_TOKENS] as const;
export type AdminToken = (typeof ADMIN_TOKENS)[number];

/** Pile du texte de l'admin : celle de `globals.css` (`--v-font`), pour que brancher le jeton ne change rien. */
const ADMIN_FONT = "ui-sans-serif, system-ui, sans-serif";
/** Valeurs de forme : celles dont l'admin se sert déjà (cartes arrondies `rounded-xl`/`rounded-2xl`, ombre légère). */
const SHAPE: Record<(typeof ADMIN_SHAPE_TOKENS)[number], string> = {
  "--cur-radius": "0.5rem",
  "--cur-radius-lg": "1rem",
  "--cur-shadow": "0 1px 2px #0000000d",
  "--cur-space": "0.25rem",
  "--cur-font": ADMIN_FONT,
};

const LIGHT = { ...buildPalette("#faf7f2", "#6c5ce7"), "--v-surface": "#ffffff", "--v-fg": "#2b2622", "--v-muted": "#6a6057", "--v-line": "#ebe4d9",
  "--v-line-strong": "#8a7f73", "--v-accent-text": "#5b4bd6", "--v-accent-tint": "#efedfc",
  "--v-ok-text": "#00664a", "--v-ok-soft": "#d9f0e5", "--v-warn-text": "#8f3d00", "--v-warn-soft": "#fbe9ce",
  "--v-danger-text": "#a82a1f", "--v-danger-soft": "#fcebe8", "--v-neutral-text": "#4f463e", "--v-neutral-soft": "#ece6dc" };
const DARK = { ...buildPalette("#15141a", "#9b8cff"), "--v-surface": "#1e1d26", "--v-fg": "#ecebf2", "--v-muted": "#a3a1b3", "--v-line": "#2d2b38",
  "--v-line-strong": "#6b6880", "--v-accent-text": "#b3a8ff", "--v-accent-tint": "#2a2745",
  "--v-ok-text": "#6fe0b0", "--v-ok-soft": "#16342a", "--v-warn-text": "#f5b266", "--v-warn-soft": "#3a2c14",
  "--v-danger-text": "#ff9a8f", "--v-danger-soft": "#3d1d1f", "--v-neutral-text": "#c4c2d2", "--v-neutral-soft": "#2d2b38" };

/** Jeton couleur → variable `--v-*` de la palette d'où vient sa valeur (l'accent sert aussi d'anneau de focus, comme dans globals.css). */
const COLOR_SOURCE: Record<(typeof ADMIN_COLOR_TOKENS)[number], string> = {
  "--cur-bg": "--v-bg", "--cur-fg": "--v-fg", "--cur-muted": "--v-muted", "--cur-surface": "--v-surface", "--cur-line": "--v-line",
  "--cur-accent": "--v-accent", "--cur-accent-fg": "--v-accent-fg",
  "--cur-ok": "--v-success", "--cur-ok-fg": "--v-success-fg", "--cur-warn": "--v-warning", "--cur-warn-fg": "--v-warning-fg",
  "--cur-danger": "--v-danger", "--cur-danger-fg": "--v-danger-fg", "--cur-focus": "--v-accent",
  "--cur-line-strong": "--v-line-strong", "--cur-accent-text": "--v-accent-text", "--cur-accent-tint": "--v-accent-tint",
  "--cur-ok-text": "--v-ok-text", "--cur-ok-soft": "--v-ok-soft", "--cur-warn-text": "--v-warn-text", "--cur-warn-soft": "--v-warn-soft",
  "--cur-danger-text": "--v-danger-text", "--cur-danger-soft": "--v-danger-soft", "--cur-neutral-text": "--v-neutral-text", "--cur-neutral-soft": "--v-neutral-soft",
};
/** Ce que l'admin lit dans les jetons : `--v-*` (donc Tailwind `bg-bg`, `text-fg`…) = `var(--cur-*)`. Les trois autres variables de la palette (accent secondaire, dégradé) restent telles que calculées. */
const ADMIN_READS: Record<string, AdminToken> = Object.fromEntries([
  ...Object.entries(COLOR_SOURCE).filter(([k]) => k !== "--cur-focus").map(([cur, v]) => [v, cur as AdminToken]),
  ["--v-font", "--cur-font"],
]);

const PALETTES: Record<AdminScheme, Record<string, string>> = { light: LIGHT, dark: DARK };

/** Les valeurs de TOUS les jetons d'un mode. */
export function adminTokens(scheme: AdminScheme): Record<AdminToken, string> {
  const p = PALETTES[scheme];
  const colors = Object.fromEntries(ADMIN_COLOR_TOKENS.map((t) => [t, p[COLOR_SOURCE[t]]!]));
  return { ...colors, ...SHAPE } as Record<AdminToken, string>;
}

const declare = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(";");
/** Les couleurs « d'état » (erreur, succès, avertissement) posées en dur dans l'admin : éclaircies pour rester lisibles sur fond sombre. */
const STATE_OVERRIDES: [string[], string][] = [
  [["text-red-700", "text-red-800", "text-red-600", "text-red-500"], "#fca5a5"],
  [["text-emerald-700", "text-emerald-800", "text-emerald-900"], "#6ee7b7"],
  [["text-amber-700", "text-amber-900"], "#fcd34d"],
  [["text-sky-800"], "#7dd3fc"],
  [["text-violet-800"], "#c4b5fd"],
];

/** Feuille de style de l'admin : variables claires par défaut, sombres si `data-admin-theme="dark"` ou, en « auto », si le système est en mode sombre. */
export function adminThemeCss(): string {
  // Les jetons `--cur-*` portent les valeurs ; `--v-*` les lit (`var(--cur-*)`), sauf l'accent secondaire et le dégradé, qui ne sont pas des jetons d'admin.
  const mode = (scheme: AdminScheme) => {
    const reads = Object.fromEntries(Object.entries(ADMIN_READS).map(([v, cur]) => [v, `var(${cur})`]));
    const rest = Object.fromEntries(Object.entries(PALETTES[scheme]).filter(([v]) => !(v in ADMIN_READS)));
    return `${declare(adminTokens(scheme))};${declare(reads)};${declare(rest)}`;
  };
  // Chaque classe est préfixée par le thème (une liste « .a,.b » ne préfixerait que la première).
  const dark = (scope: string) => `${scope}{${mode("dark")};color-scheme:dark}${STATE_OVERRIDES.map(([classes, color]) => `${classes.map((c) => `${scope} .${c}`).join(",")}{color:${color}}`).join("")}`;
  return `:root{${mode("light")}}${dark(':root[data-admin-theme="dark"]')}@media (prefers-color-scheme: dark){${dark(':root[data-admin-theme="auto"]')}}`;
}

/** Ce que `ctx.api.adminTheme()` rend à un module (cœur après 0.6.6). */
export type ModuleAdminTheme = {
  /** Variables `--cur-*` (et `color-scheme`) seulement : aucune adresse, aucune police, aucun `@import`. À poser dans un `<style nonce>`. */
  css: string;
  /** Le mode obtenu : `light`, `dark`, ou `auto` (clair, et sombre si le système l'est). */
  scheme: AdminTheme;
  /** Le nom « Curiosa » rendu comme dans l'admin : `html` (un lien) + `css` (sa règle). À utiliser tel quel, ne jamais réécrire le mot à la main. */
  wordmark: { html: string; css: string };
};

/** Règle du nom « Curiosa » (Fraunces italique 600, 1,15 em, souligné) pour une page de module. La police n'est pas chargée : sans elle, le navigateur prend une empattée italique du système. */
const WORDMARK_CSS = '.cur-wordmark{--cur-wordmark-font:Fraunces,ui-serif,Georgia,serif;font-family:var(--cur-wordmark-font);font-style:italic;font-weight:600;font-size:1.15em;text-decoration:underline;text-underline-offset:2px;text-transform:none;letter-spacing:normal}';
// Le mot vient d'une constante : CuriosaMark (composant React) reste le seul endroit qui écrit le lien à la main ; ici c'est son équivalent pour une page de module qui n'a pas React.
const WORDMARK_NAME = "Curiosa";
const WORDMARK_HTML = `<a class="cur-wordmark" data-curiosa-wordmark="" href="${CREDIT_URL}" target="_blank" rel="noopener">${WORDMARK_NAME}</a>`;

/** Les jetons de l'admin pour la page secrète d'un module. `scheme` inconnu ou absent : `auto`. Pur et borné : même entrée, même sortie. */
export function moduleAdminTheme(opts?: { scheme?: unknown }): ModuleAdminTheme {
  const scheme = parseAdminTheme(opts?.scheme);
  const block = (s: AdminScheme) => declare(adminTokens(s));
  const css =
    scheme === "light" ? `:root{${block("light")};color-scheme:light}`
    : scheme === "dark" ? `:root{${block("dark")};color-scheme:dark}`
    : `:root{${block("light")};color-scheme:light dark}@media (prefers-color-scheme: dark){:root{${block("dark")}}}`;
  return { css, scheme, wordmark: { html: WORDMARK_HTML, css: WORDMARK_CSS } };
}
