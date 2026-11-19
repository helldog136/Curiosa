/**
 * How long the Node.js that runs the site is maintained. Computed locally from `process.version` and a small static table (no network): the official release
 * schedule (https://github.com/nodejs/Release) gives each major its end-of-life date. A major that is not in the table is "unknown" and raises no warning.
 * `to` is the major the owner should move to: the newest one the release archive carries a SQLite driver for (scripts/release-pack.mjs), null when the
 * running major already is that one.
 */
export type NodeSupportState = "ok" | "ending-soon" | "end-of-life" | "unknown";
export type NodeSupport = { major: number | null; state: NodeSupportState; endsOn: string | null; to: number | null };

/** Last day of maintenance of each Node.js major (UTC date). */
export const NODE_END_OF_LIFE: Record<number, string> = { 20: "2026-04-30", 22: "2027-04-30", 24: "2028-04-30", 26: "2029-04-30" };
/** The major the installer, the image and the CI use. */
export const NODE_RECOMMENDED_MAJOR = 24;
/** "Ending soon" starts this many months before the end date. */
export const NODE_ENDING_SOON_MONTHS = 6;

export function nodeSupport(version: string = process.version, now: number = Date.now()): NodeSupport {
  const major = /^v?(\d+)\./.exec(version)?.[1];
  const n = major ? Number(major) : null;
  const endsOn = n !== null ? NODE_END_OF_LIFE[n] ?? null : null;
  if (n === null || !endsOn) return { major: n, state: "unknown", endsOn: null, to: null };
  const today = new Date(now).toISOString().slice(0, 10);
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + NODE_ENDING_SOON_MONTHS);
  const state: NodeSupportState = today > endsOn ? "end-of-life" : endsOn <= horizon.toISOString().slice(0, 10) ? "ending-soon" : "ok";
  return { major: n, state, endsOn, to: n < NODE_RECOMMENDED_MAJOR ? NODE_RECOMMENDED_MAJOR : null };
}
