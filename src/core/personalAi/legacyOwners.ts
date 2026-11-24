import { prisma } from "@/core/db";
import { setSetting } from "@/core/settings";
import { resolvePersonalOwner } from "./owner";

/**
 * TEMPORARY (introduced in 0.47.0, SUNSET 0.49.0: delete this file, its call in src/instrumentation.ts and the folder src/app/admin/(panel)/assistants/assign-owners/;
 * tests/services/access-owners.test.mjs ("sunset") fails once package.json reaches 0.49.0 while they exist).
 *
 * 1. MARKER, ONCE. The first start-up after the migration marks `coarseCeiling` (see ownerCeiling.ts, COARSE_FALLBACK) on the accesses that have no owner and were created
 *    before that moment (`ai.legacyCutoff`, written before marking so that a retry after a crash reuses it): they predate the owners. Then `ai.legacyMarked` is written, and
 *    NEVER AGAIN is anything marked: an ownerless access created later (a helper, a downgrade and upgrade) stays fail-closed. This file is the ONLY writer of the flag (a later
 *    assignment never touches it: the owner of an access never changes, see owners.ts).
 * 2. Single-account sites: every live MARKED access that has no owner is given to the ONLY account of the site, but only if that account may own an access and is not locked
 *    (otherwise every automation would stop): then the accesses stay without an owner and keep working, and maintenance_diagnose says so.
 *    "Account" = a row of the user table: an invited person who has not signed in yet is a row too, so a site with an owner and a pending invitation has TWO accounts and
 *    nothing is assigned automatically (an administrator chooses on the Assign owners page). Idempotent: an access that already has an owner is never touched.
 *    Safe next to a restore: it runs once at start-up, before the schedulers; an access whose owner row does not exist is NOT adopted (it only takes rows with no `ownerId`).
 * At the sunset this file, the two settings and the call go away; the `ApiToken.coarseCeiling` COLUMN stays, and so does the behaviour of the rows that carry it (the coarse
 * fallback, their secret address and full powers) until they are revoked: nothing else reads the settings.
 * Rollback by hand, only for the rows this step touched: `UPDATE ApiToken SET ownerId = NULL, pausedAt = NULL WHERE coarseCeiling = 1;`
 * (`pausedAt` too: an access without an owner ignores it, so a paused one would start working again; revoke the paused ones first if that is not wanted).
 * Accesses created later are not marked and are not affected.
 */
export const LEGACY_OWNERS_SUNSET = "0.49.0";

export const LEGACY_CUTOFF_KEY = "ai.legacyCutoff";
export const LEGACY_MARKED_KEY = "ai.legacyMarked";
const readFlag = async (key: string): Promise<string | null> => {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return null;
  try { const v = JSON.parse(row.value); return typeof v === "string" ? v : null; } catch { return null; }
};

export async function assignLegacyOwners(): Promise<{ assigned: number; marked: number; skipped?: "accounts" | "owner_not_allowed" }> {
  let marked = 0;
  if (!(await readFlag(LEGACY_MARKED_KEY))) {
    const cutoff = (await readFlag(LEGACY_CUTOFF_KEY)) ?? new Date().toISOString();
    await setSetting(LEGACY_CUTOFF_KEY, cutoff);
    marked = (await prisma.apiToken.updateMany({ where: { ownerId: null, coarseCeiling: false, createdAt: { lte: new Date(cutoff) } }, data: { coarseCeiling: true } })).count;
    await setSetting(LEGACY_MARKED_KEY, new Date().toISOString()); // only after the marking succeeded: a throw above leaves the flag unset and the next start retries with the same cutoff
  }
  const users = await prisma.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length !== 1) return { assigned: 0, marked, skipped: "accounts" };
  const only = users[0]!;
  const rows = await prisma.apiToken.findMany({ where: { ownerId: null, coarseCeiling: true, revokedAt: null }, select: { id: true, name: true } });
  if (!rows.length) return { assigned: 0, marked };
  // A locked account (temporary password, two-factor missing), an override "deny" or a level without the right would make every access inert: assign nothing then.
  if (!(await resolvePersonalOwner(only.id)).active) return { assigned: 0, marked, skipped: "owner_not_allowed" };
  let assigned = 0;
  for (const r of rows) {
    const done = await prisma.apiToken.updateMany({ where: { id: r.id, ownerId: null }, data: { ownerId: only.id } });
    if (done.count === 1) {
      assigned++;
      await prisma.auditLog.create({ data: { actor: "system", actorKind: "system", action: "mcp.personal.assign", target: `${r.name} -> ${only.email} (single account)`.slice(0, 300) } }).catch(() => {});
    }
  }
  return { assigned, marked };
}
