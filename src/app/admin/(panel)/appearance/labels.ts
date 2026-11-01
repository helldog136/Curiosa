import en from "@/locales/en.json";
import type { Translator } from "@/core/i18n/dictionary";

/**
 * Les textes de la page Apparence pour ses composants du navigateur : toutes les clés `appearance.*` (déjà traduites par le serveur, les `{variables}` sont
 * remplacées côté navigateur par `useAL`). La liste des clés vient du dictionnaire anglais (le français a les mêmes, testé).
 */
export function appearanceLabels(t: Translator): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(en)) if (key.startsWith("appearance.") || key.startsWith("skins.error.")) out[key] = t(key);
  return out;
}
