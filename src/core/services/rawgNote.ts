/**
 * Cale RAWG (à retirer en 0.3.0, voir rawgBridge.ts) : « des modules ont changé » (installation, mise à jour, restauration) → la reprise se prépare EN ARRIÈRE-PLAN,
 * sans attendre et sans jamais faire échouer l'opération. Les tâches lancées sont suivies pour que les tests (et l'arrêt propre) puissent attendre leur fin.
 */
const jobs = new Set<Promise<unknown>>();

export function noteRawgModulesChanged(): void {
  const job: Promise<unknown> = import("@/core/services/rawgBridge").then((m) => m.noteModulesChanged()).catch(() => {}).finally(() => { jobs.delete(job); });
  jobs.add(job);
}

/** Attend que toute reprise lancée en arrière-plan soit finie (y compris celles lancées pendant l'attente). */
export async function rawgNoteIdle(): Promise<void> {
  while (jobs.size) await Promise.allSettled([...jobs]);
}
