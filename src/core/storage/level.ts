/**
 * STORAGE — how full the disk is. Pure: reads nothing, tests alone. The thresholds live here and nowhere else
 * (the maintenance "health" tool, the dashboard card and the upload hint all call `diskLevel`).
 */
export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/** Below this much free space the state is "very low"... */
export const CRITICAL_FREE_BYTES = 300 * MB;
/** ...or below this share of the disk while less than `CRITICAL_PERCENT_CAP_BYTES` is free. */
export const CRITICAL_FREE_PERCENT = 2;
export const CRITICAL_PERCENT_CAP_BYTES = 2 * GB;
/** Below this much free space the state is "getting low"... */
export const LOW_FREE_BYTES = 1.5 * GB;
/** ...or below this share of the disk while less than `LOW_PERCENT_CAP_BYTES` is free (a 2 TB disk is not "low" at 8%). */
export const LOW_FREE_PERCENT = 8;
export const LOW_PERCENT_CAP_BYTES = 10 * GB;

export type DiskLevel = "ok" | "low" | "critical";
export type DiskSpace = { freeBytes: number; totalBytes: number; freePercent: number; level: DiskLevel };

export function diskLevel(freeBytes: number, totalBytes: number): DiskLevel {
  const percent = totalBytes ? (freeBytes / totalBytes) * 100 : 0;
  if (freeBytes < CRITICAL_FREE_BYTES || (percent < CRITICAL_FREE_PERCENT && freeBytes < CRITICAL_PERCENT_CAP_BYTES)) return "critical";
  if (freeBytes < LOW_FREE_BYTES || (percent < LOW_FREE_PERCENT && freeBytes < LOW_PERCENT_CAP_BYTES)) return "low";
  return "ok";
}

export function describeDisk(freeBytes: number, totalBytes: number): DiskSpace {
  const freePercent = totalBytes ? Math.round((freeBytes / totalBytes) * 1000) / 10 : 0;
  return { freeBytes, totalBytes, freePercent, level: diskLevel(freeBytes, totalBytes) };
}
