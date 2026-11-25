import { prisma } from "@/core/db";
import { assignOwner, neverOwnedAccesses } from "./owners";
import { resolvePersonalOwner } from "./owner";

/**
 * 0.49.0 MIGRATION, at every start-up, before any request is served (src/instrumentation.ts). Every live AI access that has no owner is attributed, once, to the site owner
 * (the oldest account of level "owner"). Additive and idempotent: an access that has an owner is never touched, nothing else about the access changes (no scope, no grant,
 * no ceiling kind), a second run finds nothing. A site with no owner account yet, or whose owner may not own an access (policy), is skipped and retried at the next start:
 * the accesses keep working as before. Each attribution writes one journal line, "attributed to the owner by the 0.49 migration" (never a code).
 */
export const OWNER_MIGRATION_NOTE = "attributed to the owner by the 0.49 migration";

export async function attributeOwnerlessAccesses(): Promise<{ attributed: number; skipped?: "no_owner" | "owner_not_allowed" }> {
  const owner = await prisma.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  if (!owner) return { attributed: 0, skipped: "no_owner" };
  const rows = await neverOwnedAccesses();
  // A locked owner (temporary password, two-factor missing) or one the policy refuses would make every access inert: nothing is attributed, the next start retries.
  if (rows.length && !(await resolvePersonalOwner(owner.id)).active) return { attributed: 0, skipped: "owner_not_allowed" };
  let attributed = 0;
  for (const row of rows) {
    const done = await assignOwner(row.id, owner.id, owner.email, owner.id, OWNER_MIGRATION_NOTE);
    if (done.ok) attributed++;
    else if (done.reason === "owner_not_allowed") return { attributed, skipped: "owner_not_allowed" };
  }
  return { attributed };
}
