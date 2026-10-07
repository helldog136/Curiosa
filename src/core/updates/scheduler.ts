import { runScheduledCheck } from "./service";

const EVERY = 6 * 60 * 60_000;
const FIRST = 5 * 60_000;
const g = globalThis as unknown as { vitrineUpdateScheduler?: boolean };

/**
 * Vérification périodique des mises à jour (toutes les 6 h, la première 5 minutes après le démarrage).
 * Elle ne fait QUE vérifier tant que l'administrateur n'a pas activé la mise à jour automatique.
 * Un seul minuteur par processus, qui ne retient jamais l'arrêt du serveur.
 */
export function startUpdateScheduler(): void {
  if (g.vitrineUpdateScheduler) return;
  g.vitrineUpdateScheduler = true;
  const tick = () => runScheduledCheck().catch((error) => console.error("[updates] scheduled check failed:", error?.message));
  setTimeout(() => { void tick(); setInterval(() => void tick(), EVERY).unref(); }, FIRST).unref();
}
