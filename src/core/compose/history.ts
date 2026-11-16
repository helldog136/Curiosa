/**
 * Undo and redo of the composition editor (core 0.19.0): 50 steps, for the time the editor is open. Pure (a value in, a value out), tested alone.
 * A drag is ONE step: the editor records the state before it starts, not every move.
 */
export const HISTORY_MAX = 50;
export type History<T> = { past: T[]; present: T; future: T[] };

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });
/** A new state: the old one goes to the past (50 at most, the oldest dropped), the future is forgotten. The same state twice is not a step. */
export function record<T>(h: History<T>, next: T, same: (a: T, b: T) => boolean = Object.is): History<T> {
  if (same(h.present, next)) return h;
  const past = [...h.past, h.present];
  if (past.length > HISTORY_MAX) past.splice(0, past.length - HISTORY_MAX);
  return { past, present: next, future: [] };
}
/** Replaces the present without a step (while dragging). */
export const replace = <T>(h: History<T>, next: T): History<T> => ({ ...h, present: next });
export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next!, future: rest };
}
