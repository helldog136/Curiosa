/**
 * Small sliding-window limiter for the public onboarding pages (accept an invitation, ask for a reset link, use a link). In memory, like the temporary-password limiter:
 * the site runs as one process, and a restart only gives an attacker the same few tries again (the tokens themselves are 256-bit and cannot be guessed; these limits
 * protect the mail quota and the server). Keys are never a token or an address in clear: callers pass a short digest.
 */
const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

export const resetRateLimits = (): void => hits.clear();

/** Records one try and says whether it is allowed (`max` tries per `windowMs`). A refused try is not recorded: waiting is enough. */
export function allowTry(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  if (hits.size >= MAX_KEYS && !hits.has(key)) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
  }
  hits.set(key, [...recent, now]);
  return true;
}

/** Same as `allowTry` without recording (to know whether a limit is already reached). */
export function wouldAllow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length < max;
}
