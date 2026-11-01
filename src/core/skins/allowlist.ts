/**
 * Liste blanche de l'assainisseur de feuilles de style de skins (docs/SKINS.md §6).
 *
 * Ce fichier est la RÉFÉRENCE de ce qu'un skin peut faire dans sa feuille de style. Principe : tout ce qui n'est pas
 * listé ici est refusé (liste blanche, jamais liste noire). Un skin ne définit que de l'APPARENCE (§0) :
 *
 *  - Sélecteurs : seulement `[data-skin-region="…"]` et `[data-skin-part="…"]` (noms connus), leurs descendants
 *    (éléments de contenu listés), des attributs d'état stables, des pseudo-classes et pseudo-éléments listés.
 *    Jamais de classe, d'identifiant, de `*`, de `html`, de `body`, de `:root` nu, de balise seule.
 *  - Chaque sélecteur est réécrit en `:root[data-skin="<id>"] <sélecteur>` : rien ne peut sortir de la portée du skin.
 *  - At-règles : `@media`, `@supports`, `@container`, `@keyframes` (bornés), `@font-face` (polices embarquées).
 *  - Propriétés : famille par famille, ci-dessous. Valeurs : mots-clés, nombres, longueurs, couleurs, fonctions listées,
 *    `var(--v-*)` / `var(--sk-*)`, `url(skin:…)` vers une ressource du skin. Aucune URL absolue, aucun `data:`.
 *  - Masquer : seulement du décor (région `backdrop`, pièce `divider`, pseudo-éléments `::before`/`::after`), le bouton
 *    `menu-toggle`, et le menu/sous-menu FERMÉS (`[data-open="false"]`). Jamais un lien, un bouton, un titre, un texte.
 *  - Plafonds : taille, nombre de règles, de déclarations, profondeur et longueur de sélecteur, longueur de valeur.
 */

export const SKIN_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

/** Régions du DOM stable du cœur (§9.1). */
export const REGIONS = ["backdrop", "tray", "shell", "banner", "header", "nav", "tools", "main", "content", "footer"] as const;

/** Pièces communes du DOM stable (§9.2). Ajouter une pièce est additif ; en retirer une est cassant (`skinContract`). */
export const PARTS = [
  "card", "card-body", "button", "chip", "badge", "news-dot",
  "field", "input", "textarea", "label", "field-error",
  "list", "list-item", "table", "table-head", "table-row", "table-cell",
  "heading", "eyebrow", "lead", "prose", "quote", "code", "code-block", "copy-code",
  "image", "media", "avatar", "cover", "divider", "link", "notice", "panel", "hero", "stat",
  "tabs", "tab", "pagination", "pagination-link", "mode-switch", "mode-option",
  "brand", "menu-toggle", "nav-list", "nav-link", "submenu", "submenu-toggle", "header-group", "lang-switcher", "socials",
  "entries", "module-html",
  "home-flow", "home-cell", "cookie-tray", "footer-text", "footer-link", "credit", "skip-link",
] as const;

/** Décor : seul endroit où l'on peut masquer, estomper ou découper librement (§0.1). */
export const DECOR_REGIONS: readonly string[] = ["backdrop"];
export const DECOR_PARTS: readonly string[] = ["divider"];
/** Pseudo-éléments de décor (`content` limité à de la ponctuation, §6.3). */
export const DECOR_PSEUDO_ELEMENTS: readonly string[] = ["before", "after"];

/** Id d'une pièce de module : `<idDuModule>.<pièce>` (§6.1, §8). */
export const MODULE_PART_RE = /^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/;

/** Éléments de contenu ciblables, UNIQUEMENT derrière une région ou une pièce (jamais seuls). */
export const CONTENT_ELEMENTS: readonly string[] = [
  "a", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "img", "table", "thead", "tbody", "tr", "th", "td",
  "blockquote", "code", "pre", "hr", "strong", "em", "button", "input", "select", "textarea", "label", "figure",
  "figcaption", "svg", "time", "details", "summary",
];

/**
 * Éléments de MISE EN PAGE ciblables UNIQUEMENT sous `[data-skin-part="module-html"]` (docs/SKINS.md §6.1.1) : les boîtes internes que les modules écrivent eux-mêmes
 * dans leur HTML (`<div>`, `<span>`, `<section>`, `<article>`). Nulle part ailleurs : le DOM du cœur est ciblé par ses régions et ses pièces.
 */
export const MODULE_HTML_ELEMENTS: readonly string[] = ["div", "span", "section", "article"];
/** Pièce sous laquelle les éléments ci-dessus (et l'attribut `[data-marker]`) deviennent ciblables. */
export const MODULE_HTML_PART = "module-html";
/** Repères de HTML de module (présence seulement, jamais de valeur) ciblables sous la même condition. */
export const MODULE_HTML_ATTRIBUTES: readonly string[] = ["data-marker"];

/** Cibles qui sortent de la portée d'un skin : refusées avec un message dédié. */
export const GLOBAL_ELEMENTS: readonly string[] = ["html", "body"];

/** Attributs d'état stables (§6.1 et attributs d'état du §9.2 : `data-size`, `data-variant`, `data-header-layout`). */
export const STATE_ATTRIBUTES: Readonly<Record<string, { ops: readonly string[]; value?: RegExp }>> = {
  "aria-current": { ops: ["", "="], value: /^[a-z]{2,10}$/ },
  "aria-expanded": { ops: ["", "="], value: /^(true|false)$/ },
  "aria-selected": { ops: ["", "="], value: /^(true|false)$/ },
  "aria-pressed": { ops: ["", "="], value: /^(true|false|mixed)$/ },
  "aria-hidden": { ops: ["", "="], value: /^(true|false)$/ },
  "data-btn": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-open": { ops: ["", "="], value: /^(true|false)$/ },
  "data-kind": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-on": { ops: ["", "="], value: /^[a-z0-9][a-z0-9_-]{0,30}$/ },
  "data-level": { ops: ["", "="], value: /^[1-6]$/ },
  "data-tone": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-state": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-size": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-variant": { ops: ["", "="], value: /^[a-z][a-z0-9_-]{0,30}$/ },
  "data-header-layout": { ops: ["", "="], value: /^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/ },
  role: { ops: ["", "="], value: /^[a-z]{2,30}$/ },
  type: { ops: ["", "="], value: /^[a-z]{2,30}$/ },
  target: { ops: ["", "="], value: /^_?[a-z]{2,10}$/ },
  rel: { ops: ["", "~="], value: /^[a-z]{2,20}$/ },
  lang: { ops: ["", "=", "|="], value: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/ },
};

/**
 * Choix clair/sombre du visiteur (docs/SKINS.md §3.8, décision Q-B) : `[data-mode="light"]` / `[data-mode="dark"]` est permis EN TÊTE de sélecteur seulement
 * (seul, ou après le préfixe `:root[data-skin="<id>"]`) ; il est réécrit à côté de `data-skin` sur la même racine. Nulle part ailleurs.
 */
export const MODE_ATTRIBUTE = "data-mode";
export const MODE_QUALIFIER_VALUES: readonly string[] = ["light", "dark"];

/** Pseudo-classes simples. */
export const PSEUDO_CLASSES: readonly string[] = [
  "hover", "focus", "focus-visible", "focus-within", "active", "disabled", "checked",
  "first-child", "last-child", "only-child", "empty",
];
/** Pseudo-classes fonctionnelles de position (`an+b` seulement, jamais `of <sélecteur>`). */
export const NTH_PSEUDO_CLASSES: readonly string[] = ["nth-child", "nth-of-type"];
/** Pseudo-classes qui contiennent des sélecteurs. `:has()` : profondeur ≤ 2 compositions (voir `selectors.ts`). */
export const LOGICAL_PSEUDO_CLASSES: readonly string[] = ["not", "is", "where", "has"];
/** Pseudo-éléments (écrits `::x` ; la forme historique `:before`/`:after`/`:first-letter`/`:first-line` est normalisée). */
export const PSEUDO_ELEMENTS: readonly string[] = ["before", "after", "marker", "placeholder", "selection", "first-letter", "first-line"];
export const LEGACY_PSEUDO_ELEMENTS: readonly string[] = ["before", "after", "first-letter", "first-line"];

/** At-règles. Tout le reste est refusé. */
export const ALLOWED_AT_RULES: readonly string[] = ["media", "supports", "container", "keyframes", "font-face"];
/** Les at-règles à bloc de conditions (peuvent s'imbriquer jusqu'à `maxAtRuleDepth`). */
export const CONDITIONAL_AT_RULES: readonly string[] = ["media", "supports", "container"];

/** Fonctions autorisées dans une valeur (union ; `url` est traité à part et n'accepte que `skin:`). */
export const ALLOWED_FUNCTIONS: readonly string[] = [
  // calcul et variables
  "var", "calc", "min", "max", "clamp", "env",
  // couleurs
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color-mix",
  // dégradés
  "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient",
  // transformations (bornées par propriété)
  "translate", "translatex", "translatey", "rotate", "scale", "scalex", "scaley",
  // filtres
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia",
  // courbes de mouvement, grilles, formes
  "cubic-bezier", "steps", "linear", "minmax", "repeat", "fit-content", "inset", "circle", "ellipse",
  // @font-face src
  "format",
];

/** Fonctions refusées avec une explication particulière (le reste : « fonction non autorisée »). */
export const FORBIDDEN_FUNCTION_CODES: Readonly<Record<string, string>> = {
  attr: "attr-forbidden",
  expression: "expression-forbidden",
  "image-set": "image-function-forbidden",
  "-webkit-image-set": "image-function-forbidden",
  image: "image-function-forbidden",
  "cross-fade": "image-function-forbidden",
  "-webkit-cross-fade": "image-function-forbidden",
  element: "image-function-forbidden",
  "-moz-element": "image-function-forbidden",
  paint: "image-function-forbidden",
  src: "image-function-forbidden",
  counter: "counter-forbidden",
  counters: "counter-forbidden",
  local: "local-font-forbidden",
};

/** Unités reconnues. */
export const LENGTH_UNITS: readonly string[] = ["px", "em", "rem", "ch", "ex", "vw", "vh", "vmin", "vmax", "svh", "lvh", "dvh", "svw", "lvw", "dvw", "cqw", "cqh", "cqi", "cqb", "pt", "cm", "mm", "in", "lh", "rlh", "fr"];
export const OTHER_UNITS: readonly string[] = ["%", "s", "ms", "deg", "turn", "rad", "grad", "x", "dppx", "dpi"];
export const ALL_UNITS: ReadonlySet<string> = new Set([...LENGTH_UNITS, ...OTHER_UNITS]);

export const SAFE_AREA_ENV: readonly string[] = ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"];

/** Variables : `--sk-*` et `--v-*` seulement (§6.3). */
export const VAR_NAME_RE = /^--(sk|v)-[a-z0-9][a-z0-9-]{0,60}$/;

// ---------------------------------------------------------------------------------------------------------------------
// Propriétés (§6.3). Les listes sont des noms exacts ; les familles à côtés sont développées par `expand`.

const SIDES = ["top", "right", "bottom", "left"] as const;
const LOGICAL = ["inline", "block", "inline-start", "inline-end", "block-start", "block-end"] as const;
const sides = (prefix: string, suffix = "") => [...SIDES, ...LOGICAL].map((s) => `${prefix}-${s}${suffix}`);

const BORDER_PARTS = [...SIDES, ...LOGICAL];
const border: string[] = ["border", "border-width", "border-style", "border-color"];
for (const s of BORDER_PARTS) border.push(`border-${s}`, `border-${s}-width`, `border-${s}-style`, `border-${s}-color`);
for (const c of ["top-left", "top-right", "bottom-right", "bottom-left", "start-start", "start-end", "end-start", "end-end"]) border.push(`border-${c}-radius`);
border.push("border-radius", "border-collapse", "border-spacing", "border-image", "border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat");

export const PROPERTY_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  "Couleur et fond": [
    "color", "background", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "background-attachment", "background-clip", "background-blend-mode", "accent-color", "caret-color", "color-scheme", "opacity",
    "mix-blend-mode", "filter", "backdrop-filter", "-webkit-backdrop-filter", "fill", "stroke", "stroke-width",
  ],
  Texte: [
    "font", "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-variant-caps", "font-variant-numeric",
    "font-variant-ligatures", "font-variant-east-asian", "font-variant-alternates", "font-variant-position", "font-feature-settings",
    "line-height", "letter-spacing", "word-spacing", "text-transform", "text-decoration", "text-decoration-line", "text-decoration-style",
    "text-decoration-color", "text-decoration-thickness", "text-decoration-skip-ink", "text-underline-offset", "text-shadow", "text-align",
    "text-wrap", "text-indent", "white-space", "hyphens", "quotes", "list-style", "list-style-type", "list-style-position", "tab-size",
    "overflow-wrap", "word-break", "vertical-align",
  ],
  Boîte: [
    ...sides("margin"), "margin", ...sides("padding"), "padding", "gap", "row-gap", "column-gap", "width", "min-width", "max-width", "height",
    "min-height", "max-height", "aspect-ratio", "box-sizing", "overflow", "overflow-x", "overflow-y", "object-fit", "object-position", "table-layout",
  ],
  "Bordures et contours": [...border, "outline", "outline-width", "outline-style", "outline-color", "outline-offset", "box-shadow"],
  "Mise en page": [
    "display", "flex", "flex-grow", "flex-shrink", "flex-basis", "flex-direction", "flex-wrap", "flex-flow",
    "grid", "grid-template", "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-area", "grid-column", "grid-column-start",
    "grid-column-end", "grid-row", "grid-row-start", "grid-row-end", "grid-auto-columns", "grid-auto-rows", "grid-auto-flow",
    "place-items", "place-content", "place-self", "align-items", "align-content", "align-self", "justify-items", "justify-content", "justify-self",
    "order", "columns", "column-count", "column-width", "column-fill", "column-span", "column-rule", "column-rule-width", "column-rule-style",
    "column-rule-color", "float", "container-type", "container-name", "position", "top", "right", "bottom", "left",
    "inset", "inset-block", "inset-inline", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "z-index",
    ...sides("scroll-margin"), "scroll-margin", ...sides("scroll-padding"), "scroll-padding", "scroll-behavior",
  ],
  Mouvement: [
    "transition", "transition-property", "transition-duration", "transition-timing-function", "transition-delay",
    "animation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count",
    "animation-direction", "animation-fill-mode", "animation-play-state", "transform", "transform-origin",
  ],
  "Contenu décoratif": ["content"],
  Divers: ["cursor", "pointer-events", "user-select", "scrollbar-color", "scrollbar-width", "appearance", "resize", "clip-path", "mask-image"],
};

export const ALLOWED_PROPERTIES: ReadonlySet<string> = new Set(Object.values(PROPERTY_FAMILIES).flat());

/** Propriétés qui MASQUENT : refusées avec un message dédié (§0, §9.3). */
export const HIDING_PROPERTIES: readonly string[] = ["visibility", "clip", "content-visibility"];

/** Propriétés dont la valeur peut être `url(skin:images/…)`. */
export const IMAGE_URL_PROPERTIES: readonly string[] = ["background", "background-image", "mask-image"];

/** Propriétés qui acceptent des chaînes entre guillemets (avec contrôle propre à chacune). */
export const STRING_PROPERTIES: readonly string[] = ["content", "quotes", "font-family", "font", "font-feature-settings", "grid-template-areas", "grid-template", "grid"];

/** Mots-clés de `display` hors `none` (§6.3). */
export const DISPLAY_VALUES: readonly string[] = ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "contents", "flow-root"];
export const CSS_WIDE_KEYWORDS: readonly string[] = ["inherit", "initial", "unset", "revert", "revert-layer"];
export const CURSOR_VALUES: readonly string[] = ["auto", "default", "pointer", "text", "not-allowed"];
export const OVERFLOW_VALUES: readonly string[] = ["visible", "auto", "hidden"];
export const POSITION_VALUES: readonly string[] = ["static", "relative", "sticky", "absolute", "fixed"];
export const ANIMATION_KEYWORDS: readonly string[] = [
  "none", "infinite", "normal", "reverse", "alternate", "alternate-reverse", "forwards", "backwards", "both", "running", "paused",
  "ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end",
];
/** Mots-clés de taille de police trop petits (< 0.6875rem) ou relatifs imprévisibles. */
export const TINY_FONT_SIZE_KEYWORDS: readonly string[] = ["xx-small", "x-small", "smaller"];

/** Polices génériques (sans guillemets) toujours permises dans `font-family`. */
export const GENERIC_FONT_FAMILIES: readonly string[] = [
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math",
  "-apple-system", "blinkmacsystemfont",
];

// ---------------------------------------------------------------------------------------------------------------------
// Pièces qui ne se masquent jamais (§9.3) : tout ce qui n'est pas du décor est traité comme porteur de contenu ou d'action.

/** Pièces et régions listées au §9.3 (documentaire : la règle appliquée est « tout sauf le décor »). */
export const NON_HIDEABLE: readonly string[] = [
  "brand", "nav-link", "nav-list", "submenu", "tools", "lang-switcher", "heading", "prose", "link", "button", "field", "input", "textarea",
  "label", "field-error", "card", "card-body", "list-item", "image", "media", "cover", "avatar", "notice", "stat", "tab", "pagination",
  "pagination-link", "cookie-tray", "footer-link", "credit", "skip-link", "mode-switch", "mode-option", "submenu-toggle", "header-group", "entries", "module-html",
];

// ---------------------------------------------------------------------------------------------------------------------
// Plafonds (§5.3, §6.6) et bornes (§6.3).

export type SkinLimits = {
  /** Taille de la feuille en octets (UTF-8). */
  maxBytes: number;
  maxRules: number;
  maxDeclarations: number;
  maxDeclarationsPerRule: number;
  maxKeyframes: number;
  maxKeyframeSteps: number;
  maxFontFaces: number;
  maxSelectorLength: number;
  maxSelectorsPerRule: number;
  /** Nombre maximal de suites de sélecteurs composés (`a b > c` = 3). */
  maxSelectorDepth: number;
  /** Imbrication maximale de `:not()/:is()/:where()/:has()`. */
  maxFunctionalNesting: number;
  maxAtRuleDepth: number;
  maxValueLength: number;
  maxCustomValueLength: number;
  maxValueTokens: number;
  maxValueNesting: number;
  /** Nombre de règles qui utilisent `background-attachment: fixed`. */
  maxFixedBackgrounds: number;
  /** Taille maximale (caractères) de la valeur d'une variable une fois toutes les `var()` développées. */
  maxVarExpansion: number;
  maxQueriesPerCondition: number;
};

export const DEFAULT_LIMITS: SkinLimits = {
  maxBytes: 60 * 1024,
  maxRules: 600,
  maxDeclarations: 6000,
  maxDeclarationsPerRule: 120,
  maxKeyframes: 12,
  maxKeyframeSteps: 20,
  maxFontFaces: 4,
  maxSelectorLength: 600,
  maxSelectorsPerRule: 20,
  maxSelectorDepth: 6,
  maxFunctionalNesting: 2,
  maxAtRuleDepth: 3,
  maxValueLength: 500,
  maxCustomValueLength: 300,
  maxValueTokens: 300,
  maxValueNesting: 8,
  maxFixedBackgrounds: 2,
  maxVarExpansion: 20000,
  maxQueriesPerCondition: 4,
};

/** Bornes de valeurs (en px quand c'est une longueur). */
export const BOUNDS = {
  /** `opacity` minimale sur une pièce de contenu ou d'action. */
  minContentOpacity: 0.6,
  /** `font-size` minimale : 0,6875 rem. */
  minFontSizePx: 11,
  /** `text-indent` minimal : -0,5 em (en em). */
  minTextIndentEm: -0.5,
  maxTextIndentRem: 8,
  maxBackdropBlurPx: 24,
  maxContentBlurPx: 2,
  maxDecorBlurPx: 100,
  minFilterFactor: 0.5,
  maxFilterFactor: 2,
  /** Décalage (`top`, `left`, `inset`…) minimal : -1 rem ; maximal : 60 rem. */
  minOffsetPx: -16,
  maxOffsetPx: 960,
  minMarginPx: -64,
  maxZIndex: 30,
  maxOrder: 10,
  /** Mouvement. */
  maxTransitionMs: 600,
  maxAnimationMs: 20000,
  maxAnimationIterations: 3,
  /** Une boucle infinie ne doit pas dépasser 3 Hz : durée d'un tour ≥ 0,34 s. */
  minLoopMs: 340,
  maxTranslatePx: 64,
  maxTranslatePercent: 50,
  maxRotateDeg: 5,
  minScale: 0.9,
  maxScale: 1.1,
  /** Largeur/hauteur minimale d'une boîte de contenu : 0,25 rem. */
  minBoxPx: 4,
  maxLetterSpacingPx: 8,
  minLineHeight: 0.8,
  /** Requêtes de média : bornes des longueurs. */
  mediaMinEm: 20,
  mediaMaxEm: 160,
  containerMinEm: 5,
  containerMaxEm: 160,
} as const;

/** Parties pour lesquelles `clip-path` est permis (§6.3). */
export const CLIP_PATH_PARTS: readonly string[] = ["card", "panel", "button", "image", "avatar", "badge"];

/** Contenu décoratif : 1 à 3 caractères, aucune lettre ni chiffre (§6.3). */
export const CONTENT_MAX_CHARS = 3;

/** Assets : chemins `skin:` autorisés. */
export const FONT_PATH_RE = /^fonts\/[a-z0-9][a-z0-9._-]{0,63}\.woff2$/;
export const IMAGE_PATH_RE = /^images\/[a-z0-9][a-z0-9._-]{0,63}\.(png|webp|avif|jpe?g|svg)$/;
/** Base d'URL servie par le cœur (§5.6). */
export const ASSET_BASE_RE = /^\/skins\/[a-z][a-z0-9-]{1,40}\/[0-9A-Za-z.+-]{1,40}\/$/;
