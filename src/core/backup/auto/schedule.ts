import crypto from "node:crypto";
import { dayKey, nextDay, zonedToUtc } from "@/core/siteTime";

/**
 * SCHEDULE OF THE AUTOMATIC BACKUP (docs/BACKUP.md): pure functions, no clock and no database read, so that "due", "catch-up", "jitter" and "retry" are tested as such.
 *
 * A slot is a fixed instant: 03:MM on the site clock, where MM (0 to 59) comes from a hash of the site name (so that many sites do not all start at 03:00 sharp).
 * Daily: every day. Weekly: every Sunday. Monthly: the 1st of the month. A run is "due" when the latest slot that has passed (and that is later than the moment the
 * feature was switched on) has not been handled yet. After a stop the server finds the same answer at its next start: that is the catch-up, once, never one run per missed slot.
 */
export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const DEFAULT_FREQUENCY: Frequency = "weekly";
export const isFrequency = (v: unknown): v is Frequency => typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);

/** Minute (0 to 59) of the slot, from the site name: the same name always gives the same minute. */
export function jitterMinute(siteName: string): number {
  const h = crypto.createHash("sha256").update(String(siteName ?? "").trim().toLowerCase(), "utf8").digest();
  return h.readUInt32BE(0) % 60;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const weekday = (day: string): number => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const matchesDay = (frequency: Frequency, day: string): boolean => frequency === "daily" || (frequency === "weekly" ? weekday(day) === 0 : day.endsWith("-01"));
const previousDay = (day: string): string => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); };

/** The slot of a given day (a calendar day of the site clock), or null when this frequency has no slot on that day. */
export function slotOfDay(day: string, frequency: Frequency, siteName: string, timeZone: string): Date | null {
  if (!matchesDay(frequency, day)) return null;
  return zonedToUtc(day, `03:${p2(jitterMinute(siteName))}`, timeZone);
}

/** The latest slot that is not after `now`, or null (never for a valid zone: a slot exists at least every 31 days). */
export function latestSlot(now: Date, frequency: Frequency, siteName: string, timeZone: string): Date | null {
  let day = dayKey(now, timeZone);
  for (let i = 0; i < 70; i++, day = previousDay(day)) {
    const slot = slotOfDay(day, frequency, siteName, timeZone);
    if (slot && slot.getTime() <= now.getTime()) return slot;
  }
  return null;
}

/** The first slot after `now` (to tell the person when the next backup comes). */
export function nextSlot(now: Date, frequency: Frequency, siteName: string, timeZone: string): Date | null {
  let day = dayKey(now, timeZone);
  for (let i = 0; i < 70; i++, day = nextDay(day)) {
    const slot = slotOfDay(day, frequency, siteName, timeZone);
    if (slot && slot.getTime() > now.getTime()) return slot;
  }
  return null;
}

/** Waits before the 2nd, 3rd and 4th attempt of the same slot: 15 minutes, 1 hour, 4 hours. After the 4th failure the next slot is awaited. */
export const RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Delay before the next attempt after `failures` failed attempts in a row on the same slot; null = no more attempts for this slot. */
export function retryDelay(failures: number): number | null {
  return failures >= 1 && failures <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[failures - 1]! : null;
}

/** What the scheduler needs to know of the saved state. All dates are ISO texts. */
export type ScheduleState = { lastSlot?: string; retryAt?: string };

/**
 * The slot to run now, or null. Due = the latest passed slot is later than the moment the feature was switched on, has not been handled yet
 * (`lastSlot`: the slot of the last success, or of the last attempt whose retries ran out), and no retry is waiting for its time.
 */
export function dueSlot(now: Date, config: { frequency: Frequency; since: string }, state: ScheduleState, siteName: string, timeZone: string): Date | null {
  const slot = latestSlot(now, config.frequency, siteName, timeZone);
  if (!slot) return null;
  const since = Date.parse(config.since);
  if (Number.isFinite(since) && slot.getTime() <= since) return null;
  const handled = Date.parse(state.lastSlot ?? "");
  if (Number.isFinite(handled) && handled >= slot.getTime()) return null;
  const retryAt = Date.parse(state.retryAt ?? "");
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) return null;
  return slot;
}
