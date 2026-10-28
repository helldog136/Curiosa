/**
 * Invalidation du rendu des skins, SANS dépendance : le rendu (`render.ts`) met sa feuille composée en cache avec une clé qui contient ce numéro de génération ;
 * l'installation, la mise à jour, le retour arrière, le retrait et la restauration d'un skin (`registry.ts`), ainsi que l'installation ou le retrait d'un module
 * (`moduleParts.ts` : ses pièces changent), l'incrémentent. Aucun minuteur, aucune importation du rendu ni du service (pas de cycle entre eux).
 */
let generation = 0;
const listeners: (() => void)[] = [];

/** Pour les caches qui doivent aussi être vidés (le service des skins vide ses skins relus). Appelé une fois à l'import. */
export function onSkinInvalidate(fn: () => void): void {
  listeners.push(fn);
}

/** Vide les feuilles composées du site public : la prochaine page les recompose. */
export function invalidateSkinCache(): void {
  generation = (generation + 1) % 1_000_000_000;
  for (const fn of listeners) fn();
}

/** Numéro courant, lu par le rendu pour sa clé de cache. */
export const skinCacheGeneration = (): number => generation;
