/**
 * Invalidation du rendu des skins, SANS dépendance : le rendu (`render.ts`) met sa feuille composée en cache avec une clé qui contient ce numéro de génération ;
 * l'installation, la mise à jour, le retour arrière, le retrait et la restauration d'un skin (`registry.ts`), ainsi que l'installation ou le retrait d'un module
 * (`moduleParts.ts` : ses pièces changent), l'incrémentent. Aucun minuteur, aucune importation du rendu ni du service (pas de cycle entre eux).
 *
 * L'état est gardé sur `globalThis` (comme le cache des pièces de modules) : une action serveur (administration) et le rendu d'une page peuvent être chargés
 * comme deux copies du même fichier ; sans cela, l'une n'invaliderait pas l'autre.
 */
type State = { generation: number; listeners: Set<() => void> };
const g = globalThis as unknown as { curiosaSkinInvalidate?: State };
const state = (): State => (g.curiosaSkinInvalidate ??= { generation: 0, listeners: new Set() });

/** Pour les caches qui doivent aussi être vidés (le service des skins vide ses skins relus). Appelé une fois à l'import. */
export function onSkinInvalidate(fn: () => void): void {
  state().listeners.add(fn);
}

/** Vide les feuilles composées du site public : la prochaine page les recompose. */
export function invalidateSkinCache(): void {
  const s = state();
  s.generation = (s.generation + 1) % 1_000_000_000;
  for (const fn of s.listeners) fn();
}

/** Numéro courant, lu par le rendu pour sa clé de cache. */
export const skinCacheGeneration = (): number => state().generation;
