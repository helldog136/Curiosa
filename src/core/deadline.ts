/**
 * DÉLAI MAXIMAL (brique de base, sans aucune connaissance des modules ni du site).
 *
 * `withDeadline(travail, ms)` met un travail en course contre une horloge : il rend soit son résultat, soit `TIMED_OUT` si `ms` millisecondes
 * passent d'abord. Un travail ne peut pas être « tué » en JavaScript : il continue en arrière-plan, mais plus personne ne l'attend, et son
 * échec tardif est absorbé (jamais d'erreur « non gérée » qui ferait tomber le serveur). Une exception levée AVANT le délai est transmise telle quelle.
 */
export const TIMED_OUT = Symbol("timed-out");

export function withDeadline<T>(work: () => PromiseLike<T> | T, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => { over = true; resolve(TIMED_OUT); }, ms);
    let started: PromiseLike<T> | T;
    try { started = work(); } catch (error) { clearTimeout(timer); reject(error); return; }
    Promise.resolve(started).then(
      (value) => { clearTimeout(timer); if (!over) resolve(value); },
      (error) => { clearTimeout(timer); if (!over) reject(error); },   // après le délai : absorbé (déjà signalé comme « sans réponse »)
    );
  });
}
