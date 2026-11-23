import { prisma } from "@/core/db";
import { revokeAccess } from "./revoke";

/**
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
