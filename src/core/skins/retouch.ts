/**
 * Les RETOUCHES de la personne (couche 4, docs/SKINS.md §3.2, §3.7), lues dans les réglages. Fonction pure : elle reçoit une lecture de réglage.
 *
 *   theme.background, theme.accent, theme.accent2, theme.surface, theme.text   : le jeu « un seul mode » (inchangé depuis toujours)
 *   theme.font                                                                 : sans | serif | mono (ancien réglage, toujours lu)
 *   theme.fontBody, theme.fontHeading                                          : la police du texte et des titres (docs/POLICES.md) ; `theme.fontFiles` : les polices envoyées
 *   theme.palette                                                              : « single » (défaut) | « both »
 *   theme.light.<couleur>, theme.dark.<couleur>                                : le jeu de chaque mode, utilisé quand theme.palette = both
 *
 * Une clé absente, vide ou invalide n'est pas une retouche (la valeur du skin s'applique). Aucune migration : un site existant n'a que `theme.*`.
 */
import { isHexColor } from "../color";
import { resolveFonts } from "../fonts/css";
import { SETTING_BODY, SETTING_FILES, SETTING_HEADING } from "../fonts/types";
import type { ColorRetouch, Retouches } from "./types";

export const COLOR_FIELDS = ["background", "accent", "accent2", "surface", "text"] as const;
export type ColorField = (typeof COLOR_FIELDS)[number];

/** Les clés de réglage qui sont des retouches (pour « Revenir au skin », la sauvegarde, les tests). */
export const RETOUCH_KEYS: readonly string[] = [
  ...COLOR_FIELDS.map((f) => `theme.${f}`), "theme.font", SETTING_BODY, SETTING_HEADING, "theme.palette",
  ...(["light", "dark"] as const).flatMap((m) => COLOR_FIELDS.map((f) => `theme.${m}.${f}`)),
];

/** Les clés à LIRE pour composer les retouches : les retouches, plus la liste des polices envoyées (qui n'est pas une retouche : « Revenir au skin » la garde). */
export const RETOUCH_READ_KEYS: readonly string[] = [...RETOUCH_KEYS, SETTING_FILES];

type Get = (key: string) => unknown;

function colorsAt(get: Get, prefix: string): ColorRetouch {
  const out: ColorRetouch = {};
  for (const f of COLOR_FIELDS) {
    const v = get(`${prefix}${f}`);
    // le fond et l'accent gardent leur casse d'origine (le CSS d'avant les skins les écrivait tels quels) ; les autres sont en minuscules, comme `optionalHex`
    if (isHexColor(v)) out[f] = f === "background" || f === "accent" ? v : v.toLowerCase();
  }
  return out;
}

export function retouchesFrom(get: Get): Retouches {
  const font = get("theme.font");
  const fonts = resolveFonts(get);
  return {
    palette: get("theme.palette") === "both" ? "both" : "single",
    single: colorsAt(get, "theme."),
    light: colorsAt(get, "theme.light."),
    dark: colorsAt(get, "theme.dark."),
    ...(font === "sans" || font === "serif" || font === "mono" ? { font } : {}),
    ...(fonts.body || fonts.heading ? { fonts } : {}),
  };
}
