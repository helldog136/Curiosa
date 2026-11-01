/**
 * Reprise RAWG (voir rawgHandover.ts) : « des modules ont changé » (installation, mise à jour, restauration) → la reprise se prépare EN ARRIÈRE-PLAN, sans attendre et sans jamais
 * faire échouer l'opération. Les tâches lancées sont suivies pour que les tests (et l'arrêt propre) puissent attendre leur fin. Aucun minuteur.
 */
const jobs = new Set<Promise<unknown>>();

/** Suit une tâche de reprise lancée en arrière-plan (elle ne lève jamais côté appelant). */
export function trackRawgJob<T>(job: Promise<T>): Promise<T | undefined> {
  const tracked: Promise<T | undefined> = job.catch(() => undefined).finally(() => { jobs.delete(tracked); });
  jobs.add(tracked);
  return tracked;
}

export function noteRawgModulesChanged(): void {
  trackRawgJob(import("@/core/services/rawgHandover").then((m) => m.noteModulesChanged()));
}

/** Attend que toute reprise lancée en arrière-plan soit finie (y compris celles lancées pendant l'attente). */
export async function rawgNoteIdle(): Promise<void> {
  while (jobs.size) await Promise.allSettled([...jobs]);
}
