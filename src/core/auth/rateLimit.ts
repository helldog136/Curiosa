/**
 * Small sliding-window limiter for the public onboarding pages (accept an invitation, ask for a reset link, use a link). In memory, like the temporary-password limiter:
 * the site runs as one process, and a restart only gives an attacker the same few tries again (the tokens themselves are 256-bit and cannot be guessed; these limits
 * protect the mail quota and the server). Keys are never a token or an address in clear: callers pass a short digest.
 *
 *  - `allowTry`: per-visitor keys (network address, address typed, token). Bounded: when full, the LEAST RECENTLY USED key goes first (a hit moves its key to the back), so a flood of
 *    new keys cannot push out a key that is being used.
 *  - `allowGlobal`: the few keys that protect the whole site (mail quota). They live in their own small map and are NEVER evicted, whatever the flood.
 *  - Old entries are swept by a timer (unref'd, so it never keeps the process alive), not on every call.
 */
type Entry = { hits: number[]; windowMs: number };
const hits = new Map<string, Entry>();
const globals = new Map<string, Entry>();
const MAX_KEYS = 5000;
const SWEEP_EVERY_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

function sweep(now = Date.now()): void {
  for (const map of [hits, globals]) for (const [k, e] of map) if (e.hits.every((t) => now - t >= e.windowMs)) map.delete(k);
}
function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => sweep(), SWEEP_EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
}

export const resetRateLimits = (): void => { hits.clear(); globals.clear(); };
/** For tests: how many evictable keys are held. */
export const trackedKeys = (): number => hits.size;
/** For tests: the periodic sweep, run now. */
export const sweepRateLimits = (now = Date.now()): void => sweep(now);

function record(map: Map<string, Entry>, key: string, max: number, windowMs: number, now: number): boolean {
  const entry = map.get(key);
  const recent = (entry?.hits ?? []).filter((t) => now - t < windowMs);
  // Delete then set: the key moves to the back of the map (most recently used), a refused try included.
  map.delete(key);
  if (recent.length >= max) { map.set(key, { hits: recent, windowMs }); return false; }
  map.set(key, { hits: [...recent, now], windowMs });
  return true;
}

/** Records one try and says whether it is allowed (`max` tries per `windowMs`). A refused try is not recorded: waiting is enough. */
export function allowTry(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  ensureTimer();
  const ok = record(hits, key, max, windowMs, now);
  while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
  return ok;
}

/** Same, for a limit that protects the whole site: never evicted. Use only for a handful of fixed keys. */
export function allowGlobal(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  ensureTimer();
  return record(globals, key, max, windowMs, now);
}

/** Same as `allowTry` without recording (to know whether a limit is already reached). */
export function wouldAllow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const e = hits.get(key) ?? globals.get(key);
  return (e?.hits ?? []).filter((t) => now - t < windowMs).length < max;
}
