/**
 * Progression de l'assistant d'installation. Le nombre d'étapes dépend d'un choix fait en cours de route (l'étape « liens » n'existe que si la
 * collection de liens est choisie) : afficher « 3 / 4 » puis « 4 / 5 » trompait. On n'affiche donc PAS de total (« Étape 3 »), et la barre ne recule
 * jamais : elle avance d'un cinquième par étape (le maximum possible) et se remplit à la dernière.
 */
export const MAX_STEPS = 5;

export const stepNumber = (step: number): number => Math.max(1, Math.trunc(step) + 1);

export function progressPercent(step: number, isLast: boolean): number {
  if (isLast) return 100;
  return Math.min(100, Math.round((stepNumber(step) / MAX_STEPS) * 100));
}
