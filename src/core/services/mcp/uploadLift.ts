import { prisma } from "@/core/db";

/**
 * UPLOAD LIMITS OF THE AI ASSISTANTS: the owner may start the daily count over, or lift the upload limits for 10, 30 or 60 minutes (core 0.28.0).
 *
 * Two settings, written ONLY by the owner in Admin > AI assistants > Settings (no MCP tool reads or writes them), read from the database on every call:
 *   - `mcp.media.quotaFrom`   (epoch ms) the daily quota counts the journal lines after max(now - 24 h, this). Nothing in the journal is deleted or changed.
 *   - `mcp.media.liftedUntil` (epoch ms) while now < this end, for media_upload and media_import: no daily quota, one image up to 10 MB (the media_upload body
 *     up to 14 MB); for media_upload also no "content" hourly counter. The end is compared on every call, with NO timer: a restart neither extends nor forgets it.
 *     A stored end further than 60 minutes ahead is not trusted (treated as not lifted).
 * Never lifted: the type read from the bytes, the pixel limit, the svg cleaning, the 1 MB cap of every other call, the "risky" counter, the trusted sources list,
 * the rights per tool. "Lifted" is a higher bound, never "unlimited": the body of an upload is read into memory.
 */
export const LIFT_KEY = "mcp.media.liftedUntil";
export const QUOTA_FROM_KEY = "mcp.media.quotaFrom";
export const LIFT_MINUTES = [10, 30, 60] as const;
export type LiftMinutes = (typeof LIFT_MINUTES)[number];
export const DEFAULT_LIFT_MINUTES: LiftMinutes = 10;
export const MAX_LIFT_MS = 60 * 60_000;

/** One image: 3 MB normally, 10 MB while lifted. */
export const MEDIA_BYTES = 3 * 1024 * 1024;
export const LIFTED_MEDIA_BYTES = 10 * 1024 * 1024;
/** The body of a media_upload call (the image in base64 plus the JSON around it). */
export const MEDIA_BODY = 4_300_000;
export const LIFTED_MEDIA_BODY = 14_000_000;

/** The clock, replaceable in tests. */
export const liftDeps: { now: () => number } = { now: () => Date.now() };

async function readMs(key: string): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return null;
  try { const v = Number(JSON.parse(row.value)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
async function writeMs(key: string, ms: number): Promise<void> {
  const value = JSON.stringify(ms);
  await prisma.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value }, update: { value } });
}

/** The end of the current lift (epoch ms), or null when the limits apply. Exactly at the end time the limits apply again. */
export async function liftedUntil(): Promise<number | null> {
  const end = await readMs(LIFT_KEY);
  const now = liftDeps.now();
  if (end === null || now >= end || end - now > MAX_LIFT_MS) return null;
  return end;
}

/** Owner only (the caller checked it). Any other duration is refused: 10, 30 or 60 minutes. Returns the end. */
export async function liftLimits(minutes: number): Promise<number> {
  if (!(LIFT_MINUTES as readonly number[]).includes(minutes)) throw new Error(`lift: ${minutes} minutes is not one of ${LIFT_MINUTES.join(", ")}`);
  const end = liftDeps.now() + minutes * 60_000;
  await writeMs(LIFT_KEY, end);
  return end;
}

/** Owner only. Ends the lift at once (the end becomes now). True when a lift was running. */
export async function stopLift(): Promise<boolean> {
  const running = (await liftedUntil()) !== null;
  if (running) await writeMs(LIFT_KEY, liftDeps.now());
  return running;
}

/** Owner only. The daily quota counts from now on; the journal is untouched. Returns the new start. */
export async function resetDailyQuota(): Promise<number> {
  const now = liftDeps.now();
  await writeMs(QUOTA_FROM_KEY, now);
  return now;
}

/** Where the daily count starts: 24 hours ago, or the owner's last reset if it is more recent. */
export async function dailyWindowStart(): Promise<number> {
  const day = liftDeps.now() - 86_400_000;
  const from = await readMs(QUOTA_FROM_KEY);
  return from !== null && from > day ? Math.min(from, liftDeps.now()) : day;
}

/** The limits that apply now to media_upload and media_import. */
export async function mediaLimitsNow(): Promise<{ until: number | null; imageBytes: number; bodyBytes: number; daily: boolean; contentCounter: boolean }> {
  const until = await liftedUntil();
  return until === null
    ? { until, imageBytes: MEDIA_BYTES, bodyBytes: MEDIA_BODY, daily: true, contentCounter: true }
    : { until, imageBytes: LIFTED_MEDIA_BYTES, bodyBytes: LIFTED_MEDIA_BODY, daily: false, contentCounter: false };
}

/** Tests: the real clock again. */
export function resetLiftDeps(): void { liftDeps.now = () => Date.now(); }
