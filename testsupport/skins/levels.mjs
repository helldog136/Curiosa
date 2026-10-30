// À quel NIVEAU du rapport appartient un code de problème (docs/SKINS.md §13) : manifeste · ressources · jetons · feuille · principe fondateur · lisibilité ·
// neutralité · navigateur. Les codes de la bibliothèque du cœur (src/core/skins/messages.ts) sont classés ici ; ceux du kit (`kit-…`) ont leur niveau dans LEVEL_OF_KIT.

export const LEVELS = ["manifest", "resources", "tokens", "stylesheet", "principle", "readability", "neutrality", "browser"];

export const LEVEL_TITLE = {
  manifest: { fr: "Manifeste (skin.json)", en: "Manifest (skin.json)" },
  resources: { fr: "Ressources (polices, images, licences)", en: "Resources (fonts, images, licenses)" },
  tokens: { fr: "Jetons (tokens.json)", en: "Tokens (tokens.json)" },
  stylesheet: { fr: "Feuille de style (skin.css)", en: "Style sheet (skin.css)" },
  principle: { fr: "Principe fondateur (apparence seulement)", en: "Founding principle (appearance only)" },
  readability: { fr: "Lisibilité (WCAG AA)", en: "Readability (WCAG AA)" },
  neutrality: { fr: "Neutralité des textes", en: "Neutral texts" },
  browser: { fr: "Navigateur (--visual)", en: "Browser (--visual)" },
};

/** Les règles qui garantissent qu'un skin ne retire, ne masque, n'ajoute ni ne remplace rien (§0, §9.3). */
const PRINCIPLE = new Set([
  "hide-forbidden", "hiding-property", "menu-toggle-hidden", "opacity-too-low", "font-size-too-small", "line-height-too-small", "box-collapsed", "text-transparent",
  "offset-out-of-range", "text-indent-bad", "margin-too-negative", "spacing-too-large", "content-not-allowed", "content-too-long", "content-selector", "attr-forbidden",
  "counter-forbidden", "pointer-events-content", "blend-mode-content", "mask-needs-decor", "clip-path-bad", "clip-path-subject", "position-fixed-forbidden",
  "transform-not-allowed", "transform-too-large", "filter-not-allowed", "filter-too-strong", "unknown-region", "unknown-part", "class-selector", "id-selector",
  "element-not-allowed", "element-needs-module-html", "selector-needs-anchor", "universal-selector", "root-selector", "global-selector", "wrong-scope", "fixed-background-limit", "string-not-allowed",
  "z-index-range", "order-range", "float-not-none", "focus-indicator-missing",
]);

export function levelOf(code) {
  if (PRINCIPLE.has(code)) return "principle";
  if (/^(read-|probable-)/.test(code)) return "readability";
  if (/^tokens-|^module-token|^module-skin|^module-pair/.test(code)) return "tokens";
  if (/^(manifest-|bad-skin-id$|previews-too-many$|skin-modified$)/.test(code)) return "manifest";
  if (/^(skin-|file-too-large|fonts-|images-|asset-|local-font)/.test(code)) return "resources";
  return "stylesheet";
}

export const LEVEL_OF_KIT = {
  "kit-token-unknown": "tokens", "kit-module-tokens-unverified": "tokens", "kit-module-unknown": "tokens", "kit-module-token-unknown": "tokens",
  "kit-readability-adjusted": "readability", "kit-mode-suspended": "readability",
  "kit-preview-size": "resources", "kit-preview-unreadable": "resources", "kit-font-unused": "resources", "kit-image-unused": "resources", "kit-no-own-license": "resources", "kit-no-readme": "resources",
  "kit-breakpoint-undeclared": "stylesheet", "kit-target-small": "stylesheet", "kit-leading-low": "stylesheet", "kit-text-small": "stylesheet", "kit-coverage": "stylesheet",
  "kit-neutral": "neutrality", "kit-neutral-skipped": "neutrality",
  "kit-hidden": "principle", "kit-text-changed": "principle", "kit-structure-changed": "principle", "kit-injected-text": "principle", "kit-covered": "principle", "kit-offscreen": "principle",
};
// tout le reste des `kit-…` est du niveau navigateur
export const levelOfCode = (code) => (code.startsWith("kit-") ? LEVEL_OF_KIT[code] ?? "browser" : levelOf(code));
