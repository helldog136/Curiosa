import { prisma } from "@/core/db";
import { can, effectiveLevel, loadAdminUserById } from "@/core/auth/access";
import { RANK } from "@/core/auth/rights";
import { getPersonalPolicy, PERSONAL_AI_RIGHT, personalAiAllowed } from "./policy";

/**
 * OWNERS OF AI ACCESSES (core 0.47.0). Every AI access belongs to a person. This file is the PERMANENT part of that rule: who may own an access, the access that has no owner
 * (an owner that does not exist counts as none: for instance after a restore), and the assignment of an owner by a holder of `core:mcp.tokens` (the callers check that right).
 * An access without an owner keeps working as it did before, and says so on screen ("No owner"); it can never be given NEW rights until it has one.
 * Journal: `mcp.personal.assign` with the access NAME and the person's e-mail, never a code.
 */

export type AssignFailure = "access_missing" | "owner_missing" | "owner_not_allowed";
export type AssignResult = { ok: true; changed: boolean } | { ok: false; reason: AssignFailure };

/** May this person own an access? (override is not "deny", and the role right or an "allow" override) */
export async function mayOwnAccess(userId: string): Promise<boolean> {
  const found = await loadAdminUserById(userId);
  if (!found) return false;
  return personalAiAllowed(await getPersonalPolicy(), found.personalAi, can(found.user, PERSONAL_AI_RIGHT));
}

/**
 * May this ACTOR give an access to this person? Never to someone above their own level (a coordinator cannot hand the site owner's ceiling to anyone, nor take it for themselves
 * by naming the owner): the actor's level must be at least the target's. Giving to oneself is always allowed (the target must still be allowed to own one).
 */
export async function actorMayGiveTo(actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId) return true;
  const [actor, target] = await Promise.all([loadAdminUserById(String(actorId ?? "")), loadAdminUserById(String(targetId ?? ""))]);
  if (!actor || !target) return false;
  return (RANK[effectiveLevel(actor.user)] ?? 0) >= (RANK[effectiveLevel(target.user)] ?? 0);
}

/** The people who may own an access, for a select (name and e-mail only). With `forActor`: only those this person may give an access to (never above their own level). */
export async function eligibleOwners(forActor?: string): Promise<{ id: string; name: string; email: string }[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const out: { id: string; name: string; email: string }[] = [];
  for (const u of users) {
    if (!(await mayOwnAccess(u.id)) || (forActor !== undefined && !(await actorMayGiveTo(forActor, u.id)))) continue;
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, name: true, email: true } });
    if (row) out.push(row);
  }
  return out;
}

/** Choice list for an owner select: the name alone, with the address added only when two people share a name (a select cannot wrap its label). */
export function ownerOptions(list: { id: string; name: string; email: string }[]): { id: string; label: string }[] {
  const seen = new Map<string, number>();
  for (const o of list) seen.set(o.name, (seen.get(o.name) ?? 0) + 1);
  return list.map((o) => ({ id: o.id, label: (seen.get(o.name) ?? 0) > 1 ? `${o.name} (${o.email})` : o.name }));
}

/**
 * Live accesses with no usable owner, in two kinds that behave differently: `ownerGone: false` never had an owner (it WORKS as before); `ownerGone: true` had one that no longer
 * exists (a restored site, a person removed by hand): it is STOPPED (the request is refused) until an owner is chosen. Choosing an owner fixes both.
 */
export async function accessesWithoutOwner() {
  const [rows, users] = await Promise.all([prisma.apiToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } }), prisma.user.findMany({ select: { id: true } })]);
  const ids = new Set(users.map((u) => u.id));
  return rows.filter((r) => !r.ownerId || !ids.has(r.ownerId)).map((r) => ({ ...r, ownerGone: !!r.ownerId }));
}

/**
 * Gives an access to a person. The access keeps its ceiling kind as it is (an access that predates the owners is already marked coarse, see legacyOwners.ts and ownerCeiling.ts;
 * a newer one stays fail-closed, even if its owner was lost). The target must be allowed to own an access.
 */
export async function assignOwner(tokenId: string, ownerId: string, actorEmail: string, actorId: string): Promise<AssignResult> {
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId ?? "") } });
  if (!row || row.revokedAt) return { ok: false, reason: "access_missing" };
  const target = await prisma.user.findUnique({ where: { id: String(ownerId ?? "") }, select: { id: true, email: true } });
  if (!target) return { ok: false, reason: "owner_missing" };
  if (!(await mayOwnAccess(target.id)) || !(await actorMayGiveTo(actorId, target.id))) return { ok: false, reason: "owner_not_allowed" };
  if (row.ownerId === target.id) return { ok: true, changed: false };
  // The ceiling kind (`coarseCeiling`) is NEVER changed here: it marks an access that predates the owners (written only by legacyOwners.ts), so an access that lost its owner stays fail-closed.
  await prisma.apiToken.update({ where: { id: row.id }, data: { ownerId: target.id } });
  await prisma.auditLog.create({ data: { actor: actorEmail, actorKind: "person", action: "mcp.personal.assign", target: `${row.name} -> ${target.email}`.slice(0, 300) } }).catch(() => {});
  return { ok: true, changed: true };
}

/** The same owner for every access that has none. Returns the names that changed and the ones refused (none when the person is allowed). */
export async function assignAllWithoutOwner(ownerId: string, actorEmail: string, actorId: string): Promise<{ ok: boolean; changed: number; reason?: AssignFailure }> {
  if (!(await prisma.user.findUnique({ where: { id: String(ownerId ?? "") }, select: { id: true } }))) return { ok: false, changed: 0, reason: "owner_missing" };
  if (!(await mayOwnAccess(ownerId)) || !(await actorMayGiveTo(actorId, ownerId))) return { ok: false, changed: 0, reason: "owner_not_allowed" };
  let changed = 0;
  for (const row of await accessesWithoutOwner()) if ((await assignOwner(row.id, ownerId, actorEmail, actorId)).ok) changed++;
  return { ok: true, changed };
}

/** How many live accesses a person owns (for the team dialog). */
export async function countOwned(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { ownerId: String(userId ?? ""), revokedAt: null } });
}

/** The display names of the people, by id: only what a list needs to say who owns an access (no e-mail, no other data). */
export async function ownerNames(): Promise<Map<string, string>> {
  return new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
}
