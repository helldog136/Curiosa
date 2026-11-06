/**
 * STORAGE — the numbers behind the dashboard card, the upload hint and the maintenance "health" tool: one source.
 *
 *  - The free/total numbers are one cheap `statfs`, read on every call.
 *  - What the site takes (a bounded walk of the data folder) is cached for `CACHE_MS`, computed once at a time, and never awaited longer than the caller allows:
 *    a slow disk shows "calculating" (`usage: null, pending: true`) instead of a stuck page. `refresh` forces a new measurement, at most once per `REFRESH_MIN_GAP_MS`.
 *  - Bare metal and Docker measure the same thing: `DATA_DIR` (in the image it is the mounted data volume, so the free space is the volume's). The install kind is only reported.
 *  - The result never holds a path.
 */
import { DATA_DIR } from "../config";
import { deps } from "../maintenance/deps";
import { within } from "../maintenance/within";
import { installKind } from "../../../scripts/install-kind.mjs";
import { diskSpace } from "./disk";
import { measureUsage, type Usage } from "./usage";
import type { DiskSpace } from "./level";

/** Tests replace `measure` to control how long a measurement takes. */
export const runner = { measure: measureUsage };

export const CACHE_MS = 10 * 60_000;
export const REFRESH_MIN_GAP_MS = 30_000;

export type StorageInfo = {
  /** null: the system gave no answer about the disk. */
  disk: DiskSpace | null;
  usage: Usage | null;
  /** The measurement is not ready yet (first call, or a slow disk). */
  pending: boolean;
  /** ISO time of the measurement shown. */
  measuredAt: string | null;
  install: "docker" | "bare-metal";
};

type Cache = { at: number; usage: Usage; startedAt: number };
type State = { cache: Cache | null; running: Promise<Cache> | null; lastStart: number };
const KEY = Symbol.for("curiosa.storage.state");
function state(): State {
  const g = globalThis as unknown as Record<symbol, State>;
  return (g[KEY] ??= { cache: null, running: null, lastStart: 0 });
}
/** Tests: forget the cache. */
export function resetStorageCache(): void { const s = state(); s.cache = null; s.running = null; s.lastStart = 0; }

function start(force: boolean): Promise<Cache> | null {
  const s = state();
  if (s.running) return s.running;
  const t = deps.now();
  if (s.cache && !force && t - s.cache.at < CACHE_MS) return null;
  if (force && s.cache && t - s.lastStart < REFRESH_MIN_GAP_MS) return null;
  s.lastStart = t;
  const run = runner.measure(deps.dataDir ?? DATA_DIR).then((usage) => {
    const cache = { at: deps.now(), usage, startedAt: t };
    s.cache = cache;
    return cache;
  }).finally(() => { s.running = null; });
  s.running = run;
  return run;
}

/** `waitMs`: how long this call may wait for a fresh measurement (0: never wait, use what is cached). */
export async function storageInfo(options: { waitMs?: number; refresh?: boolean; /** Free space only: no measurement is started. */ diskOnly?: boolean } = {}): Promise<StorageInfo> {
  const s = state();
  const pending0 = options.diskOnly ? null : start(!!options.refresh) ?? s.running;
  if (pending0) await within(options.waitMs ?? 0, () => pending0);
  const cache = s.cache;
  return {
    disk: diskSpace(),
    usage: cache?.usage ?? null,
    pending: !cache && s.running !== null,
    measuredAt: cache ? new Date(cache.at).toISOString() : null,
    install: installKind(),
  };
}
