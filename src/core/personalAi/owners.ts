import { prisma } from "@/core/db";
import { can, loadAdminUserById } from "@/core/auth/access";
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

/** The people who may own an access, for a select (name and e-mail only). */
export async function eligibleOwners(): Promise<{ id: string; name: string; email: string }[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const out: { id: string; name: string; email: string }[] = [];
  for (const u of users) {
    if (!(await mayOwnAccess(u.id))) continue;
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, name: true, email: true } });
    if (row) out.push(row);
  }
  return out;
}

/** Live accesses with no owner: no `ownerId`, or one that matches nobody (a restored site, a person removed by hand). */
/** Choice list for an owner select: the name alone, with the address added only when two people share a name (a select cannot wrap its label). */
export function ownerOptions(list: { id: string; name: string; email: string }[]): { id: string; label: string }[] {
  const seen = new Map<string, number>();
  for (const o of list) seen.set(o.name, (seen.get(o.name) ?? 0) + 1);
  return list.map((o) => ({ id: o.id, label: (seen.get(o.name) ?? 0) > 1 ? `${o.name} (${o.email})` : o.name }));
}

export async function accessesWithoutOwner() {
  const [rows, users] = await Promise.all([prisma.apiToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } }), prisma.user.findMany({ select: { id: true } })]);
  const ids = new Set(users.map((u) => u.id));
  return rows.filter((r) => !r.ownerId || !ids.has(r.ownerId));
}

/**
 * Gives an access to a person. An access that had no owner becomes owned with the COARSE ceiling (it keeps every module tool it could call: see ownerCeiling.ts, COARSE_FALLBACK);
 * one that already had a live owner keeps its ceiling kind. The target must be allowed to own an access.
 */
export async function assignOwner(tokenId: string, ownerId: string, actorEmail: string): Promise<AssignResult> {
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId ?? "") } });
  if (!row || row.revokedAt) return { ok: false, reason: "access_missing" };
  const target = await prisma.user.findUnique({ where: { id: String(ownerId ?? "") }, select: { id: true, email: true } });
  if (!target) return { ok: false, reason: "owner_missing" };
  if (!(await mayOwnAccess(target.id))) return { ok: false, reason: "owner_not_allowed" };
  if (row.ownerId === target.id) return { ok: true, changed: false };
  const hadLiveOwner = !!row.ownerId && !!(await prisma.user.findUnique({ where: { id: row.ownerId }, select: { id: true } }));
  await prisma.apiToken.update({ where: { id: row.id }, data: { ownerId: target.id, ...(hadLiveOwner ? {} : { coarseCeiling: true }) } });
  await prisma.auditLog.create({ data: { actor: actorEmail, actorKind: "person", action: "mcp.personal.assign", target: `${row.name} -> ${target.email}`.slice(0, 300) } }).catch(() => {});
  return { ok: true, changed: true };
}

/** The same owner for every access that has none. Returns the names that changed and the ones refused (none when the person is allowed). */
export async function assignAllWithoutOwner(ownerId: string, actorEmail: string): Promise<{ ok: boolean; changed: number; reason?: AssignFailure }> {
  if (!(await prisma.user.findUnique({ where: { id: String(ownerId ?? "") }, select: { id: true } }))) return { ok: false, changed: 0, reason: "owner_missing" };
  if (!(await mayOwnAccess(ownerId))) return { ok: false, changed: 0, reason: "owner_not_allowed" };
  let changed = 0;
  for (const row of await accessesWithoutOwner()) if ((await assignOwner(row.id, ownerId, actorEmail)).ok) changed++;
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
