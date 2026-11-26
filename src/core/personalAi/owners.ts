import { prisma } from "@/core/db";
import { can, effectiveLevel, loadAdminUserById } from "@/core/auth/access";
import { RANK } from "@/core/auth/rights";
import { getPersonalPolicy, PERSONAL_AI_RIGHT, personalAiAllowed } from "./policy";
import { sweepOrphanedAccesses } from "./lifecycle";

/**
 * OWNERS OF AI ACCESSES (core 0.47.0). Every AI access belongs to a person, and THE OWNER IS A PERMANENT FACT (0.47.1): it is set when the access is created and can never change.
 * There is no exchange of accesses between people. This file holds who may own an access, the accesses that NEVER had an owner (`ownerId` null) and the one-time
 * assignment of an owner to those, which only the 0.49 migration does (ownerMigration.ts: every ownerless access goes to the site owner at start-up). `assignOwner` refuses an access that has an owner (`already_owned`), whoever
 * that owner is and whether that person still exists: an owner that disappears takes the access with them (it is revoked, see lifecycle.ts), it is never handed over.
 * An access without an owner keeps working as it did before, and says so on screen ("No owner"); it can never be given NEW rights until it has one.
 * Journal: `mcp.personal.assign` with the access NAME and the person's e-mail, never a code.
 */

export type AssignFailure = "access_missing" | "already_owned" | "owner_missing" | "owner_not_allowed";
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
 * Live accesses that NEVER had an owner (`ownerId` null): they WORK as before until an owner is given, once. Pure read, no side effect (the health report uses it).
 * `ownerGone` is kept in the shape for the temporary panel and is always false: an access whose owner disappeared no longer exists as such, it is revoked (lifecycle.ts).
 */
export async function neverOwnedAccesses() {
  const rows = await prisma.apiToken.findMany({ where: { revokedAt: null, ownerId: null }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...r, ownerGone: false as const }));
}

/** Same list, after the safety sweep: an access whose owner has no user any more is revoked first, so it can never show up here as a third state. */
export async function accessesWithoutOwner() {
  await sweepOrphanedAccesses().catch(() => []);
  return neverOwnedAccesses();
}

/**
 * Gives an access that has NEVER had an owner to a person, ONCE. An access that has an owner is refused with `already_owned` (even for the same person, even if that owner no longer
 * exists: such an access is revoked by the sweep, never given away). The check is also part of the write (`ownerId: null` in the update condition), so two simultaneous calls
 * cannot both succeed. The access keeps its ceiling kind as it is (an access that predates the owners is already marked coarse, see ownerCeiling.ts).
 * The target must be allowed to own an access.
 */
export async function assignOwner(tokenId: string, ownerId: string, actorEmail: string, actorId: string, via?: string): Promise<AssignResult> {
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId ?? "") } });
  if (!row || row.revokedAt) return { ok: false, reason: "access_missing" };
  if (row.ownerId) return { ok: false, reason: "already_owned" };
  const target = await prisma.user.findUnique({ where: { id: String(ownerId ?? "") }, select: { id: true, email: true } });
  if (!target) return { ok: false, reason: "owner_missing" };
  if (!(await mayOwnAccess(target.id)) || !(await actorMayGiveTo(actorId, target.id))) return { ok: false, reason: "owner_not_allowed" };
  // The ceiling kind (`coarseCeiling`) is NEVER changed here: it marks an access that predates the owners (written by the 0.47.0 start-up step, gone in 0.49.0).
  const done = await prisma.apiToken.updateMany({ where: { id: row.id, ownerId: null, revokedAt: null }, data: { ownerId: target.id } });
  if (done.count !== 1) return { ok: false, reason: "already_owned" };
  // `via` is set only by the 0.49 migration (ownerMigration.ts): the journal then names the migration and not a person.
  const entry = via ? { actor: "system", actorKind: "system", target: `${row.name}: ${via}` } : { actor: actorEmail, actorKind: "person", target: `${row.name} -> ${target.email}` };
  await prisma.auditLog.create({ data: { ...entry, target: entry.target.slice(0, 300), action: "mcp.personal.assign" } }).catch(() => {});
  return { ok: true, changed: true };
}

/** How many live accesses a person owns (for the team dialog). */
export async function countOwned(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { ownerId: String(userId ?? ""), revokedAt: null } });
}

/** The display names of the people, by id: only what a list needs to say who owns an access (no e-mail, no other data). */
export async function ownerNames(): Promise<Map<string, string>> {
  return new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
}
