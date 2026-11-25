import { prisma } from "@/core/db";
import { revokeAccess } from "./revoke";
import { expirePendingOfToken, listRequests } from "@/core/maintenance/requests";

/**
 * THE OWNER OF AN ACCESS IS A PERMANENT FACT (core 0.47.1): an access is never given to another person, and when its owner disappears the access disappears with them (it is REVOKED,
 * never left "stopped, pick a new owner"). Two functions here: the removal of a user (below) and the safety sweep (further down).
 *
 * A user is deleted: every personal AI of that user is REVOKED first (core 0.46.0), never turned into an independent access (there is no `SetNull` on `ownerId`).
 * Code that deletes a user must call this BEFORE the delete (members.ts does). Behind it, authentication refuses an access whose owner has no row any more (fail closed).
 * One journal line per access: its NAME, never the code.
 */
export async function revokePersonalAccessesOf(userId: string, actorEmail: string): Promise<number> {
  const rows = await prisma.apiToken.findMany({ where: { ownerId: userId, revokedAt: null }, select: { id: true, name: true } });
  for (const row of rows) {
    await revokeAccess(row.id);
    await prisma.auditLog.create({ data: { actor: actorEmail, action: "mcp.personal.revoke", target: `${row.name}: owner deleted` } }).catch(() => {});
  }
  return rows.length;
}

/**
 * SAFETY SWEEP (0.47.1): every live access whose `ownerId` is set but points to NO user row is revoked, its pending requests expire (`revokeAccess`), and the journal gets one
 * `mcp.personal.revoke` line per access: the NAME and the reason, never a code. How such a row appears: a restore replaces the people but not the accesses, or a person removed by hand
 * in the database. Cheap (two small reads) and idempotent: a revoked access is not looked at again, and two sweeps at the same moment share one run (one journal line). An access that
 * NEVER had an owner (`ownerId` null, the legacy ones) is NEVER touched: it keeps working as before until the 0.49 migration attributes it to the site owner (ownerMigration.ts).
 * Called at start-up, when the accesses list is read (assistants page, team page, the By person tab) and at the end of a restore (`actor` then names the person who restored).
 */
let sweeping: Promise<string[]> | null = null;
export function sweepOrphanedAccesses(actor = "system"): Promise<string[]> {
  if (sweeping) return sweeping;
  const run = (async () => {
    // Accesses FIRST, people second: a person created after the first read can never make a valid access look orphaned. And the check is made again right before each revoke (revocation is final).
    const rows = await prisma.apiToken.findMany({ where: { ownerId: { not: null } }, select: { id: true, name: true, ownerId: true, revokedAt: true } });
    if (rows.length === 0) return [];
    const users = await prisma.user.findMany({ select: { id: true } });
    // An empty user table (swapped or wiped database, setup not done) proves nothing about owners: do nothing.
    if (users.length === 0) return [];
    const ids = new Set(users.map((u) => u.id));
    const orphans = rows.filter((r) => r.ownerId && !ids.has(r.ownerId));
    const names: string[] = [];
    // Revoked orphans whose pending requests were not expired (a failure midway): finish that job, idempotent.
    const pending = new Set((await listRequests().catch(() => [])).filter((r) => r.status === "pending").map((r) => r.tokenId));
    for (const row of orphans.filter((r) => r.revokedAt && pending.has(r.id))) await expirePendingOfToken(row.id).catch(() => 0);
    for (const row of orphans) {
      if (row.revokedAt) continue;
      try {
        if (await prisma.user.findUnique({ where: { id: row.ownerId! }, select: { id: true } })) continue;
        await revokeAccess(row.id);
        await prisma.auditLog.create({ data: { actor, actorKind: actor === "system" ? "system" : "person", action: "mcp.personal.revoke", target: `${row.name}: owner removed`.slice(0, 300) } }).catch(() => {});
        names.push(row.name);
      } catch (error) {
        console.error("[ai] owner sweep: one access could not be revoked, it will be retried:", (error as Error)?.message);
      }
    }
    return names;
  })().finally(() => { sweeping = null; });
  sweeping = run;
  return run;
}
