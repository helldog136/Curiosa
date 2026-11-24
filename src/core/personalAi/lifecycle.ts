import { prisma } from "@/core/db";
import { revokeAccess } from "./revoke";

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
 * NEVER had an owner (`ownerId` null, the legacy ones) is NEVER touched: it keeps working as before until the migration ends (legacyOwners.ts).
 * Called at start-up, when the accesses list is read (assistants page, team page, the By person tab) and at the end of a restore (`actor` then names the person who restored).
 */
let sweeping: Promise<string[]> | null = null;
export function sweepOrphanedAccesses(actor = "system"): Promise<string[]> {
  if (sweeping) return sweeping;
  const run = (async () => {
    const [rows, users] = await Promise.all([
      prisma.apiToken.findMany({ where: { revokedAt: null, ownerId: { not: null } }, select: { id: true, name: true, ownerId: true } }),
      prisma.user.findMany({ select: { id: true } }),
    ]);
    const ids = new Set(users.map((u) => u.id));
    const names: string[] = [];
    for (const row of rows) {
      if (!row.ownerId || ids.has(row.ownerId)) continue;
      await revokeAccess(row.id);
      await prisma.auditLog.create({ data: { actor, actorKind: actor === "system" ? "system" : "person", action: "mcp.personal.revoke", target: `${row.name}: owner removed`.slice(0, 300) } }).catch(() => {});
      names.push(row.name);
    }
    return names;
  })().finally(() => { sweeping = null; });
  sweeping = run;
  return run;
}
