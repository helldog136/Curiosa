import { prisma } from "@/core/db";
import { resolvePersonalOwner } from "./owner";

/**
 * TEMPORARY (introduced in 0.47.0, SUNSET 0.49.0: delete this file, its call in src/instrumentation.ts and the folder src/app/admin/(panel)/assistants/assign-owners/;
 * tests/services/access-owners.test.mjs ("sunset") fails once package.json reaches 0.49.0 while they exist).
 *
 * 1. MARKER. Every access that has no owner when the site starts is an access that predates the owners: it is marked `coarseCeiling` (see ownerCeiling.ts, COARSE_FALLBACK).
 *    This file is the ONLY writer of that flag (a later reassignment never touches it), so an access created after the feature that lost its owner stays fail-closed.
 * 2. Single-account sites: every live access that has no owner is given to the ONLY account of the site, but only if that account may own an access and is not locked
 *    (otherwise every automation would stop): then the accesses stay without an owner and keep working, and maintenance_diagnose says so.
 *    "Account" = a row of the user table: an invited person who has not signed in yet is a row too, so a site with an owner and a pending invitation has TWO accounts and
 *    nothing is assigned automatically (an administrator chooses on the Assign owners page). Idempotent: an access that already has an owner is never touched.
 *    Safe next to a restore: it runs once at start-up, before the schedulers; an access whose owner row does not exist is NOT adopted (it only takes rows with no `ownerId`).
 * Rollback by hand, only for the rows this step touched: `UPDATE ApiToken SET ownerId = NULL, pausedAt = NULL WHERE coarseCeiling = 1;`
 * (`pausedAt` too: an access without an owner ignores it, so a paused one would start working again; revoke the paused ones first if that is not wanted).
 * Accesses created later, or reassigned after losing their owner, are not marked and are not affected.
 */
export const LEGACY_OWNERS_SUNSET = "0.49.0";

export async function assignLegacyOwners(): Promise<{ assigned: number; marked: number; skipped?: "accounts" | "owner_not_allowed" }> {
  const marked = (await prisma.apiToken.updateMany({ where: { ownerId: null, coarseCeiling: false }, data: { coarseCeiling: true } })).count;
  const users = await prisma.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length !== 1) return { assigned: 0, marked, skipped: "accounts" };
  const only = users[0]!;
  const rows = await prisma.apiToken.findMany({ where: { ownerId: null, revokedAt: null }, select: { id: true, name: true } });
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
