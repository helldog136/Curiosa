import { prisma } from "@/core/db";

/**
 * TEMPORARY (introduced in 0.47.0, SUNSET 0.49.0: delete this file, its call in src/instrumentation.ts and the folder src/app/admin/(panel)/assistants/assign-owners/;
 * tests/core/assign-owners-sunset.test.mjs fails once package.json reaches 0.49.0 while it exists).
 *
 * Single-user sites: every live access that has no owner is given to the ONLY account of the site, with the coarse ceiling (it keeps every tool it could call).
 * "Account" = a row of the user table: an invited person who has not signed in yet is a row too, so a site with an owner and a pending invitation has TWO accounts and
 * nothing is assigned automatically (the coordinator chooses on the Assign owners page). Idempotent: an access that already has an owner is never touched.
 * Safe next to a restore: it runs once at start-up, before the schedulers, and a restore runs inside the running server; an access whose owner row does not exist is NOT
 * adopted by this step (it only takes rows with no `ownerId`).
 * Rollback by hand: `UPDATE ApiToken SET ownerId = NULL, coarseCeiling = 0 WHERE coarseCeiling = 1;`
 */
export const LEGACY_OWNERS_SUNSET = "0.49.0";

export async function assignLegacyOwners(): Promise<{ assigned: number }> {
  const users = await prisma.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length !== 1) return { assigned: 0 };
  const only = users[0]!;
  const rows = await prisma.apiToken.findMany({ where: { ownerId: null, revokedAt: null }, select: { id: true, name: true } });
  for (const r of rows) {
    const done = await prisma.apiToken.updateMany({ where: { id: r.id, ownerId: null }, data: { ownerId: only.id, coarseCeiling: true } });
    if (done.count === 1) await prisma.auditLog.create({ data: { actor: "system", actorKind: "system", action: "mcp.personal.assign", target: `${r.name} -> ${only.email} (single account)`.slice(0, 300) } }).catch(() => {});
  }
  return { assigned: rows.length };
}
