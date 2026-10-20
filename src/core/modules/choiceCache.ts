/** Le cache des résolutions de réglages « choix » (voir choice.ts) vit sur `globalThis` : ce petit fichier peut donc l'oublier sans importer choice.ts (pas de cycle). */
export function forgetAllChoices(): void {
  (globalThis as { curiosaChoiceCache?: Map<string, unknown> }).curiosaChoiceCache?.clear();
}
