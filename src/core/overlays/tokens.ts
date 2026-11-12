import type { OverlayStyle } from "./model";
import { DEFAULT_STYLE } from "./model";
import { parseTextScale } from "./textScale";

/**
 * JETONS D'APPARENCE d'une page d'overlay (0.5.0). Vocabulaire PROPRE aux overlays, distinct de celui des skins de site (`--sk-*`, `data-skin-*`) :
 * le cœur réserve les noms `--ov-*`, `data-ov-part` et `data-ov-region`. La page de rendu n'utilise JAMAIS un skin de site ; un futur « skin d'overlay »
 * (dépôt curiosa-skins) se brancherait ici, sur ces seuls noms. Voir docs/OVERLAY-ELEMENTS.md.
 *
 * Le style commun est transmis à chaque élément qui le suit sous forme de PARAMÈTRES d'adresse (`ov-text`, `ov-surface`, `ov-corners`) ; les valeurs de jetons
 * ci-dessous sont celles que l'élément en déduit (`TOKEN_VALUES`), et que la page du cœur applique à ses propres habillages.
 */
export const OV_TOKEN_NAMES = ["--ov-fg", "--ov-surface", "--ov-radius", "--ov-border"] as const;
export const OV_PARTS = ["page", "frame", "test-frame", "label", "empty"] as const;

/** Solid panel colours of the "Opaque" background, one per text colour (contrast with the text at least 4.5:1, in practice about 17:1: see the tests). */
export const OPAQUE_SURFACE = { light: "#14171c", dark: "#f7f7f5" } as const;

/** What an element receives as `ov-surface`: an opaque page is given to elements as "soft" (every element already knows it) and the core sets the solid colour on top (see `ownerSurfaceCss`). */
export const moduleSurface = (background: OverlayStyle["background"]): "transparent" | "soft" => (background === "opaque" ? "soft" : background);

/** Sheet the core page adopts into each element that follows the style, on an opaque page and when no skin is worn (a skin carries its own solid colour, see skinSheet.ts). Specificity: above the element's own tokens. */
export const ownerSurfaceCss = (style: OverlayStyle): string => { const v = tokenValues(style); return `html[data-ov-owner="1"]:not([data-ov-skin]),html[data-ov-owner="1"]:not([data-ov-skin]) [data-ov-region="element"]{--ov-surface:${v["--ov-surface"]}!important;--ov-border:${v["--ov-border"]}!important}`; };

export const STYLE_CHOICES = {
  text: ["light", "dark"],
  /** `opaque` (0.11.0) is the third choice: a solid panel. Unknown stored values fall back to the default (transparent) in `parseStyle`. */
  background: ["transparent", "soft", "opaque"],
  corners: ["round", "square"],
} as const;

export function parseStyle(raw: unknown): OverlayStyle {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = <K extends Exclude<keyof OverlayStyle, "textScale">>(k: K): OverlayStyle[K] => ((STYLE_CHOICES[k] as readonly unknown[]).includes(o[k]) ? (o[k] as OverlayStyle[K]) : DEFAULT_STYLE[k]);
  const textScale = parseTextScale(o.textScale);
  return { text: pick("text"), background: pick("background"), corners: pick("corners"), ...(textScale !== null && textScale !== 100 ? { textScale } : {}) };
}

/** Valeurs des jetons pour un style. Le fond « semi-transparent » est contrasté avec le texte (texte clair → fond sombre, et l'inverse). */
export function tokenValues(style: OverlayStyle): Record<(typeof OV_TOKEN_NAMES)[number], string> {
  const light = style.text === "light";
  return {
    "--ov-fg": light ? "#ffffff" : "#111111",
    "--ov-surface": style.background === "transparent" ? "transparent" : style.background === "opaque" ? (light ? OPAQUE_SURFACE.light : OPAQUE_SURFACE.dark) : light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)",
    "--ov-radius": style.corners === "round" ? "12px" : "0px",
    "--ov-border": style.background === "transparent" ? "transparent" : light ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)",
  };
}

export const tokensCss = (style: OverlayStyle, selector = ":root"): string => `${selector}{${Object.entries(tokenValues(style)).map(([k, v]) => `${k}:${v}`).join(";")}}`;

/** Paramètres d'adresse réservés par le cœur (préfixe `ov-`) et préfixe des options (`opt-<id>`). */
export const PARAM_PREFIX = "ov-";
export const OPTION_PARAM_PREFIX = "opt-";
