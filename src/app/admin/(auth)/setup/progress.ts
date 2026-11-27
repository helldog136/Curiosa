/**
 * Progression de l'assistant d'installation. Il a trois écrans, toujours les mêmes (langue et prénom, nom du site, e-mail et mot de passe) : le total est connu
 * d'avance et s'affiche (« Étape 2 sur 3 »). Les étapes facultatives (modules, assistant IA…) sont dans la liste « Mise en route » du tableau de bord.
 * La barre avance d'un tiers par écran et se remplit à la dernière.
 */
export const MAX_STEPS = 3;

export const stepNumber = (step: number): number => Math.min(MAX_STEPS, Math.max(1, Math.trunc(step) + 1));

export function progressPercent(step: number, isLast: boolean): number {
  if (isLast) return 100;
  return Math.min(100, Math.round((stepNumber(step) / MAX_STEPS) * 100));
}
