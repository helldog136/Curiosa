import type { OverlayStyle } from "./model";
import { DEFAULT_STYLE } from "./model";

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
export const OV_REGIONS = ["page", "element"] as const;

export const STYLE_CHOICES = {
  text: ["light", "dark"],
  background: ["transparent", "soft"],
  corners: ["round", "square"],
} as const;

export function parseStyle(raw: unknown): OverlayStyle {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof OverlayStyle>(k: K): OverlayStyle[K] => ((STYLE_CHOICES[k] as readonly unknown[]).includes(o[k]) ? (o[k] as OverlayStyle[K]) : DEFAULT_STYLE[k]);
  return { text: pick("text"), background: pick("background"), corners: pick("corners") };
}

/** Valeurs des jetons pour un style. Le fond « semi-transparent » est contrasté avec le texte (texte clair → fond sombre, et l'inverse). */
export function tokenValues(style: OverlayStyle): Record<(typeof OV_TOKEN_NAMES)[number], string> {
  const light = style.text === "light";
  return {
    "--ov-fg": light ? "#ffffff" : "#111111",
    "--ov-surface": style.background === "transparent" ? "transparent" : light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)",
    "--ov-radius": style.corners === "round" ? "12px" : "0px",
    "--ov-border": style.background === "transparent" ? "transparent" : light ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)",
  };
}

export const tokensCss = (style: OverlayStyle, selector = ":root"): string => `${selector}{${Object.entries(tokenValues(style)).map(([k, v]) => `${k}:${v}`).join(";")}}`;

/** Paramètres d'adresse réservés par le cœur (préfixe `ov-`) et préfixe des options (`opt-<id>`). */
export const PARAM_PREFIX = "ov-";
export const OPTION_PARAM_PREFIX = "opt-";
