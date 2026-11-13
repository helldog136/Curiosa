/**
 * Soft refresh of an admin panel while something is pending (block `refreshWhile`, core 0.14.0). Pure: the schedule is decided here and tested without a browser.
 * The panel asks the server for its content again (`router.refresh()`: no page reload, the open window and what was typed stay) every `everySeconds` (3 by default,
 * 2 to 30) for the first 30 seconds, then every 10 seconds (or `everySeconds` if larger) until 3 minutes have passed, then it STOPS and offers "Check again".
 */
export const REFRESH_FAST_MS = 30_000;
export const REFRESH_TOTAL_MS = 180_000;
export const REFRESH_SLOW_MS = 10_000;

/** The wait between two refreshes at `elapsedMs` after the start, or null once the limit is reached (never loops forever). */
export function nextRefreshDelay(elapsedMs: number, everySeconds?: number): number | null {
  const every = Math.min(30, Math.max(2, Number.isFinite(everySeconds) ? Math.trunc(everySeconds as number) : 3)) * 1000;
  if (elapsedMs >= REFRESH_TOTAL_MS) return null;
  return elapsedMs < REFRESH_FAST_MS ? every : Math.max(every, REFRESH_SLOW_MS);
}
