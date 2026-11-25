/**
 * TEAM ACCOUNTS: create (with a first password), delete, suspend, reactivate, unlock, cut sessions, reset the second factor. Every rule is HERE, on the server:
 * the actions of the Team page only pass the id of the signed-in person (never read from a form) and the values sent; the actor is RE-READ from the database.
 * Who may manage whom: see team.ts. Every change is written to the audit journal, with the level that acted.
 * Adding a person by invitation (the default way) lives in invitations.ts; `createMember` stays for sites that choose to hand over a first password themselves.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { levelOf } from "./access";
import { passwordProblem } from "./passwordPolicy";
import { pausePersonalAccesses, revokeSessions } from "./sessions";
import { auditAccount } from "./accountAudit";
import { revokePersonalAccessesOf } from "../personalAi/lifecycle";
import { unlockEmail } from "./lockout";
import { disableTwoFactor } from "./twoFactor";
import { assignInitialRole } from "./roles";
import { columnsOf, RANK, type Level } from "./rights";
import { canManageMember, grantableLevels } from "./team";

export type MemberFailure = "denied" | "invalid" | "password" | "exists" | "level" | "missing" | "state" | "last";
export type MemberResult<T = object> = ({ ok: true } & T) | { ok: false; reason: MemberFailure };

async function audit(actor: string, action: string, target = ""): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } }).catch(() => {});
}

type Actor = { id: string; email: string; level: Level };
/** The actor, re-read from the database: at least administrator, active, with no temporary password to replace. */
async function actorOf(actorId: string): Promise<Actor | null> {
  const row = await prisma.user.findUnique({ where: { id: String(actorId ?? "") }, select: { id: true, email: true, role: true, coordinator: true, mustChangePassword: true, suspendedAt: true } });
  if (!row || row.mustChangePassword || row.suspendedAt) return null;
  const level = levelOf(row);
  return RANK[level] >= RANK.admin ? { id: row.id, email: row.email, level } : null;
}

/** New account with a first password (`mustChangePassword: true` is set in the SAME write: the person must choose their own at first sign-in). The level must be one the actor may grant (`grantableLevels`). */
export async function createMember(actorId: string, input: { name?: unknown; email?: unknown; password?: unknown; role?: unknown; mustChangePassword?: unknown }): Promise<MemberResult<{ id: string; level: Level }>> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: "invalid" };
  if (passwordProblem(String(input.password ?? ""))) return { ok: false, reason: "password" };
  const level = String(input.role ?? "") as Level;
  // Never "owner" nor "none" (a custom role is assigned afterwards); "coordinator": the owner only.
  if (!grantableLevels(actor.level).includes(level)) return { ok: false, reason: "level" };
  if (await prisma.user.findUnique({ where: { email } })) return { ok: false, reason: "exists" };
  const created = await prisma.user.create({ data: { email, name, ...columnsOf(level), passwordHash: await bcrypt.hash(String(input.password), 12), ...(input.mustChangePassword === true ? { mustChangePassword: true } : {}) } });
  await assignInitialRole(created.id);
  await audit(actor.email, "user.create", level === "coordinator" || level === "admin" ? `${email}:${level}` : email);
  return { ok: true, id: created.id, level };
}

/** The target, re-read from the database, with the rule of team.ts applied. */
async function target(actor: Actor, targetId: string, opts: { allowSelf?: boolean } = {}): Promise<MemberResult<{ row: { id: string; email: string; level: Level } }>> {
  const row = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true, coordinator: true } });
  if (!row) return { ok: false, reason: "missing" };
  const level = levelOf(row);
  const self = row.id === actor.id;
  if (!canManageMember(actor.level, level, { self: self && !opts.allowSelf })) return { ok: false, reason: "denied" };
  return { ok: true, row: { id: row.id, email: row.email, level } };
}

/**
 * Deletes an account. Whoever holds `core:team`: any account except the owner, oneself and (unless owner) a coordinator.
 * An administrator (without `core:team`) deletes an editor only, as before. A pending reset link of the person goes with them.
 */
export async function deleteMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  if (actor.level === "admin") {
    const row = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true, coordinator: true } });
    if (!row || row.id === actor.id || levelOf(row) !== "editor") return { ok: false, reason: "denied" };
    await revokePersonalAccessesOf(row.id, actor.email);
    await prisma.user.delete({ where: { id: row.id } });
    await prisma.passwordReset.deleteMany({ where: { userId: row.id } });
    await audit(actor.email, "user.delete", row.email);
    return { ok: true };
  }
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  await revokePersonalAccessesOf(t.row.id, actor.email);
  await prisma.user.delete({ where: { id: t.row.id } });
  await prisma.passwordReset.deleteMany({ where: { userId: t.row.id } });
  await audit(actor.email, "user.delete", t.row.email);
  return { ok: true };
}

/** Unlocks someone who tried to sign in too often (their address is free at once). */
export async function unlockMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId, { allowSelf: true });
  if (!t.ok) return t;
  await unlockEmail(t.row.email);
  await audit(actor.email, "user.unlock", t.row.email);
  return { ok: true };
}

/** Cuts every open session of someone (lost device, doubtful account). */
export async function revokeMemberSessions(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  await revokeSessions(t.row.id);
  await audit(actor.email, "user.sessions.revoke", t.row.email);
  return { ok: true };
}

/** Resets the second factor AND the passkeys of someone who lost their phone and recovery codes (their open sessions are cut). */
export async function resetMemberTwoFactor(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  await disableTwoFactor(t.row.id);
  await prisma.passkey.deleteMany({ where: { userId: t.row.id } });
  await audit(actor.email, "user.2fa.reset", t.row.email);
  return { ok: true };
}

/**
 * SUSPEND a person: reversible, immediate. Sign-in is refused, every open session is cut (session number raised), a pending reset link is removed, personal AI accesses are paused.
 * Their content and authorship stay as they are. Same "who may manage whom" as every other action (team.ts): never the owner, never oneself, a coordinator only by the owner.
 * A last guard: the site must keep at least one ACTIVE owner or technical coordinator besides the person suspended.
 */
export async function suspendMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  const row = await prisma.user.findUnique({ where: { id: t.row.id }, select: { suspendedAt: true } });
  if (row?.suspendedAt) return { ok: false, reason: "state" };
  if (t.row.level === "owner" || t.row.level === "coordinator") {
    const others = await prisma.user.findMany({ where: { id: { not: t.row.id }, suspendedAt: null, role: { in: ["owner", "admin"] } }, select: { role: true, coordinator: true } });
    if (!others.some((o) => { const l = levelOf(o); return l === "owner" || l === "coordinator"; })) return { ok: false, reason: "last" };
  }
  await prisma.user.update({ where: { id: t.row.id }, data: { suspendedAt: new Date(), sessionVersion: { increment: 1 } } });
  await pausePersonalAccesses(t.row.id);
  await prisma.passwordReset.deleteMany({ where: { userId: t.row.id } });
  await auditAccount(actor.email, actor.level, "user.suspend", t.row.email);
  return { ok: true };
}

/** Reactivates a suspended person. Their old sessions stay cut (they sign in again); their personal AI stays paused until they resume it. */
export async function reactivateMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  const done = await prisma.user.updateMany({ where: { id: t.row.id, suspendedAt: { not: null } }, data: { suspendedAt: null } });
  if (done.count !== 1) return { ok: false, reason: "state" };
  await auditAccount(actor.email, actor.level, "user.reactivate", t.row.email);
  return { ok: true };
}
