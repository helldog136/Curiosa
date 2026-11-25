/**
 * INVITATIONS (core 0.49.0): the default way to add a person to the team. Every rule is HERE, on the server; the pages and actions only pass the id of the person who is
 * signed in (never read from a form) and the values typed. The actor is re-read from the database on every call.
 *
 *  - Who: a person holding `core:team` (the owner, a technical coordinator), not suspended, with no temporary password to replace.
 *  - What can be granted (anti-elevation, same rules as `setUserRoles`): a predefined level the actor may assign (`grantableLevels`: never "owner"; "coordinator" by the
 *    owner only), or a custom role whose every right the actor holds. Any other id, including a forged one, is refused.
 *  - The link: a 256-bit token (oneTimeToken.ts), only its keyed hash is stored, single use, valid 24 h / 72 h (default) / 7 days. It is bound to the e-mail address and to
 *    the role (`roleId`, which is never reused, and a snapshot of its rights).
 *  - At ACCEPTANCE the grant is checked again (`revalidate`): the inviter must still exist, be active, hold `core:team` and still be allowed to grant that role; the role must still
 *    exist with the same key; its rights must be inside the snapshot (a role that gained rights since is REFUSED, a role that lost rights is granted as it is now, which is less). A refusal
 *    marks the invitation "refused" and is audited. Nothing is silently widened, nothing is silently narrowed except to what the inviter had already approved.
 *  - One pending invitation per address (inviting again replaces it and kills the old link), at most `MAX_PENDING` pending in total.
 *  - Accepting never overwrites an account: an address that has an account by then refuses the invitation.
 *  - The public side answers ONE generic message for every failure (unknown, used, expired, revoked, refused): it never says whether an address has an account.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { getSiteConfig } from "../settings";
import { makeTranslator } from "../i18n/dictionary";
import { isValidEmail, sendCoreMail } from "../services/mail";
import { accessOf, currentCatalogue } from "./access";
import { lastRestoreAt } from "./restoreMark";
import { auditAccount } from "./accountAudit";
import { hashToken, looksLikeToken, newToken, sameDigest } from "./oneTimeToken";
import { passwordProblem } from "./passwordPolicy";
import { allowTry } from "./rateLimit";
import { columnsOf, isSystemKey, levelFromKeys, parseStoredRights, type Level, type RightInfo } from "./rights";
import { assignInitialRole, ensureSystemRoles } from "./roles";
import { grantableLevels } from "./team";
import { INVITATION_HREF } from "../adminLinks";

export const MAX_PENDING = 50;
export const TTL_CHOICES_HOURS = [24, 72, 168] as const;
export const DEFAULT_TTL_HOURS = 72;
const HOUR = 3_600_000;
const NAME_MAX = 80;
/** A pending invitation can be sent again at most this many times a day (mail flooding of one address). */
const RESENDS_PER_DAY = 5;

export type InviteFailure = "denied" | "invalid" | "exists" | "pending" | "role" | "limit" | "missing" | "state" | "rate";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired" | "refused";

type Actor = { id: string; email: string; level: Level; rights: Set<string> };
/** The database handle: the client, or the one of an open transaction (so a check and the write that depends on it see the same state). */
type Db = Pick<typeof prisma, "user" | "role" | "userRole" | "invitation">;

/** The actor, re-read from the database: holds `core:team`, is active, has no temporary password to replace. */
async function teamActor(actorId: string, catalogue: RightInfo[], db: Db = prisma): Promise<Actor | null> {
  const row = await db.user.findUnique({ where: { id: String(actorId ?? "") }, select: { id: true, email: true, role: true, coordinator: true, mustChangePassword: true, suspendedAt: true } });
  if (!row || row.mustChangePassword || row.suspendedAt) return null;
  const access = await accessOf(row, catalogue, db);
  return access.rights.has("core:team") ? { id: row.id, email: row.email, level: access.level, rights: access.rights } : null;
}

type RoleRow = { id: string; key: string; name: string; system: boolean; rights: string };

/** Can this actor grant this role? Predefined: only the levels `grantableLevels` allows (never owner). Custom: only if the actor holds every right in it. */
export function mayGrant(actor: { level: Level; rights: ReadonlySet<string> }, role: { key: string; system: boolean; rights: string }, catalogue: RightInfo[]): boolean {
  if (role.key === "owner") return false;
  if (role.system || isSystemKey(role.key)) return isSystemKey(role.key) && (grantableLevels(actor.level) as string[]).includes(role.key);
  return parseStoredRights(role.rights, catalogue).every((r) => actor.rights.has(r));
}

const normEmail = (value: unknown): string => String(value ?? "").trim().toLowerCase();
const digest = (s: string) => hashToken("invite", `d|${s}`).slice(0, 16);

export async function expireStale(now = new Date()): Promise<number> {
  const stale = await prisma.invitation.findMany({ where: { status: "pending", expiresAt: { lte: now } }, select: { id: true, email: true, invitedByLevel: true }, take: 200 });
  let n = 0;
  for (const s of stale) {
    const done = await prisma.invitation.updateMany({ where: { id: s.id, status: "pending" }, data: { status: "expired" } });
    if (done.count === 1) { n++; await auditAccount("system", "system", "invite.expire", s.email); }
  }
  return n;
}

/** The mail: who invited, to which site, in which role (the role's own name), until when. The link is the only secret in it. */
async function sendInvitationMail(input: { to: string; inviterName: string; role: { key: string; name: string; system: boolean }; link: string; expiresAt: Date }): Promise<boolean> {
  try {
    const cfg = await getSiteConfig().catch(() => null);
    const t = makeTranslator(cfg?.defaultLocale ?? "en");
    const site = cfg?.name || "Curiosa";
    const until = new Intl.DateTimeFormat(cfg?.defaultLocale ?? "en", { dateStyle: "long", timeStyle: "short" }).format(input.expiresAt);
    const sent = await sendCoreMail({ to: input.to, subject: t("invite.mail.subject", { site }), text: t("invite.mail.body", { inviter: input.inviterName, site, role: input.role.system ? t(`role.${input.role.key}`) : input.role.name, link: input.link, until }) }, "onboarding");
    return sent.ok;
  } catch {
    return false;
  }
}

export type InvitationCreated = { ok: true; id: string; email: string; mailed: boolean; /** Present only when no e-mail left (the site has none, or sending failed): shown ONCE to the person who invites. */ link?: string; roleName: string; expiresAt: Date; replaced: boolean };

/** What the caller sees: the link of a not-sent invitation exists only in this return value. */
export async function createInvitation(actorId: string, input: { email?: unknown; roleId?: unknown; ttlHours?: unknown; origin: string; mailConfigured: boolean; now?: Date }): Promise<InvitationCreated | { ok: false; reason: InviteFailure }> {
  const now = input.now ?? new Date();
  const catalogue = await currentCatalogue();
  const actor = await teamActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const email = normEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, reason: "invalid" };
  const ttl = Number(input.ttlHours ?? DEFAULT_TTL_HOURS);
  if (!(TTL_CHOICES_HOURS as readonly number[]).includes(ttl)) return { ok: false, reason: "invalid" };
  await ensureSystemRoles();
  const role = await prisma.role.findUnique({ where: { id: String(input.roleId ?? "") }, select: { id: true, key: true, name: true, system: true, rights: true } });
  if (!role || !mayGrant(actor, role, catalogue)) return { ok: false, reason: "role" };
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { ok: false, reason: "exists" };
  if (!allowTry(`invite:create:${actor.id}`, 60, HOUR, now.getTime())) return { ok: false, reason: "rate" };
  await expireStale(now);

  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttl * HOUR);
  // The checks that decide (an account appeared, a pending invitation to replace, the cap) and the writes that depend on them run in ONE transaction, on the same state.
  const made = await prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) return { fail: "exists" as const };
    const existing = await tx.invitation.findFirst({ where: { email, status: "pending" }, select: { id: true, roleKey: true } });
    // Replacing a pending invitation revokes it: only a person who could revoke it may do that (same rule as `revokeInvitation`).
    if (existing && isSystemKey(existing.roleKey) && !(grantableLevels(actor.level) as string[]).includes(existing.roleKey)) return { fail: "pending" as const };
    if (!existing && (await tx.invitation.count({ where: { status: "pending" } })) >= MAX_PENDING) return { fail: "limit" as const };
    const old = await tx.invitation.updateMany({ where: { email, status: "pending" }, data: { status: "revoked" } });
    const row = await tx.invitation.create({ data: {
      email, tokenHash: hashToken("invite", token), status: "pending", roleId: role.id, roleKey: role.key,
      rightsSnapshot: JSON.stringify(parseStoredRights(role.rights, catalogue).sort()), invitedById: actor.id, invitedByEmail: actor.email, invitedByLevel: actor.level,
      deliveredBy: input.mailConfigured ? "email" : "link", expiresAt, createdAt: now, lastSentAt: now,
    } });
    return { row, replaced: old.count > 0 };
  });
  if (!("row" in made)) return { ok: false, reason: made.fail };
  const created = made as { row: { id: string }; replaced: boolean };
  const link = `${input.origin.replace(/\/+$/, "")}${INVITATION_HREF}#t=${token}`;
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const roleName = role.name;
  const mailed = input.mailConfigured ? await sendInvitationMail({ to: email, inviterName: me?.name ?? actor.email, role, link, expiresAt }) : false;
  if (created.replaced) await auditAccount(actor.email, actor.level, "invite.revoke", email, { why: "replaced" });
  await auditAccount(actor.email, actor.level, "invite.create", email, { role: role.key, hours: ttl, via: mailed ? "email" : "link" });
  if (input.mailConfigured && !mailed) await prisma.invitation.update({ where: { id: created.row.id }, data: { deliveredBy: "link" } });
  return { ok: true, id: created.row.id, email, mailed, ...(mailed ? {} : { link }), roleName, expiresAt, replaced: created.replaced };
}

/** Sends a pending (or expired) invitation again with a NEW link and a fresh expiry; the old link stops working at once. The actor must be allowed to grant the role. */
export async function resendInvitation(actorId: string, invitationId: string, input: { origin: string; mailConfigured: boolean; ttlHours?: unknown; now?: Date }): Promise<InvitationCreated | { ok: false; reason: InviteFailure }> {
  const now = input.now ?? new Date();
  const catalogue = await currentCatalogue();
  const actor = await teamActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const inv = await prisma.invitation.findUnique({ where: { id: String(invitationId ?? "") } });
  if (!inv) return { ok: false, reason: "missing" };
  if (inv.status !== "pending" && inv.status !== "expired") return { ok: false, reason: "state" };
  const role = await prisma.role.findUnique({ where: { id: inv.roleId }, select: { id: true, key: true, name: true, system: true, rights: true } });
  if (!role || role.key !== inv.roleKey || !mayGrant(actor, role, catalogue)) return { ok: false, reason: "role" };
  if (await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } })) return { ok: false, reason: "exists" };
  if (!allowTry(`invite:resend:${inv.id}`, RESENDS_PER_DAY, 24 * HOUR, now.getTime())) return { ok: false, reason: "rate" };
  const ttl = Number(input.ttlHours ?? DEFAULT_TTL_HOURS);
  if (!(TTL_CHOICES_HOURS as readonly number[]).includes(ttl)) return { ok: false, reason: "invalid" };
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttl * HOUR);
  // Conditional write: two people pressing "send again" together, or a person accepting meanwhile: only one write lands on a still-open invitation.
  const done = await prisma.invitation.updateMany({ where: { id: inv.id, status: { in: ["pending", "expired"] } }, data: {
    tokenHash: hashToken("invite", token), status: "pending", expiresAt, lastSentAt: now, sendCount: { increment: 1 }, invitedById: actor.id, invitedByEmail: actor.email, invitedByLevel: actor.level,
    rightsSnapshot: JSON.stringify(parseStoredRights(role.rights, catalogue).sort()), deliveredBy: input.mailConfigured ? "email" : "link",
  } });
  if (done.count !== 1) return { ok: false, reason: "state" };
  const link = `${input.origin.replace(/\/+$/, "")}${INVITATION_HREF}#t=${token}`;
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const roleName = role.name;
  const mailed = input.mailConfigured ? await sendInvitationMail({ to: inv.email, inviterName: me?.name ?? actor.email, role, link, expiresAt }) : false;
  await auditAccount(actor.email, actor.level, "invite.resend", inv.email, { role: role.key, hours: ttl, via: mailed ? "email" : "link" });
  return { ok: true, id: inv.id, email: inv.email, mailed, ...(mailed ? {} : { link }), roleName, expiresAt, replaced: true };
}

/** Revokes a pending invitation at once (its link stops working). Only a person who could have granted the role revokes it. */
export async function revokeInvitation(actorId: string, invitationId: string): Promise<{ ok: true } | { ok: false; reason: InviteFailure }> {
  const catalogue = await currentCatalogue();
  const actor = await teamActor(actorId, catalogue);
  if (!actor) return { ok: false, reason: "denied" };
  const inv = await prisma.invitation.findUnique({ where: { id: String(invitationId ?? "") } });
  if (!inv) return { ok: false, reason: "missing" };
  if (inv.status !== "pending" && inv.status !== "expired") return { ok: false, reason: "state" };
  // The coordinator level is the owner's to give and to take back; for the rest, holding the team right is enough.
  if (isSystemKey(inv.roleKey) && !(grantableLevels(actor.level) as string[]).includes(inv.roleKey)) return { ok: false, reason: "role" };
  const done = await prisma.invitation.updateMany({ where: { id: inv.id, status: { in: ["pending", "expired"] } }, data: { status: "revoked" } });
  if (done.count !== 1) return { ok: false, reason: "state" };
  await auditAccount(actor.email, actor.level, "invite.revoke", inv.email, { role: inv.roleKey });
  return { ok: true };
}

export type InvitationRow = { id: string; email: string; state: InviteStatus; roleKey: string; roleName: string; invitedBy: string; expiresAt: Date; createdAt: Date; sendCount: number; by: string };

/** The list for the Team page: bounded, newest first, state as a plain word (expiry is computed, not waiting for a sweep). */
export async function listInvitations(now = new Date(), limit = 200): Promise<InvitationRow[]> {
  await expireStale(now);
  const rows = await prisma.invitation.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const roles = await prisma.role.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.roleId))] } }, select: { id: true, name: true, system: true, key: true } });
  const nameOf = new Map(roles.map((r) => [r.id, r]));
  return rows.map((r) => {
    const role = nameOf.get(r.roleId);
    const state: InviteStatus = r.status === "pending" && r.expiresAt <= now ? "expired" : (r.status as InviteStatus);
    return { id: r.id, email: r.email, state, roleKey: r.roleKey, roleName: role && !role.system ? role.name : "", invitedBy: r.invitedByEmail, expiresAt: r.expiresAt, createdAt: r.createdAt, sendCount: r.sendCount, by: r.invitedByLevel };
  });
}

/* ───────────── Public side: open and accept ───────────── */

export type AcceptFailure = "invalid" | "rate" | "name" | "password" | "mismatch";
export type AcceptResult = { ok: true; userId: string; email: string } | { ok: false; reason: AcceptFailure };

/** `customName` is the role's own name for a custom role, "" for a predefined one (the page then writes the translated level name from `roleKey`). */
export type InviteLook = { ok: true; roleKey: string; customName: string; email: string } | { ok: false; reason: "invalid" | "rate" };

const WRONG_PER_IP = { max: 30, windowMs: HOUR };
const TRIES_PER_TOKEN = { max: 12, windowMs: 15 * 60_000 };

/** Looks the token up (constant-shape work for a wrong token and a right one) without consuming it. */
async function openToken(token: unknown, ip: string, now: Date) {
  if (!allowTry(`invite:ip:${ip}`, WRONG_PER_IP.max, WRONG_PER_IP.windowMs, now.getTime())) return { reason: "rate" as const };
  if (!looksLikeToken(token)) return { reason: "invalid" as const };
  const hash = hashToken("invite", token);
  if (!allowTry(`invite:tok:${digest(token)}`, TRIES_PER_TOKEN.max, TRIES_PER_TOKEN.windowMs, now.getTime())) return { reason: "rate" as const };
  const row = await prisma.invitation.findUnique({ where: { tokenHash: hash } });
  if (!row || !sameDigest(row.tokenHash, hash) || row.status !== "pending" || row.expiresAt <= now) return { reason: "invalid" as const };
  // A link made before the last restore belongs to the timeline the restore replaced: refused here, so this never depends on the cleanup after a restore having worked.
  const restored = await lastRestoreAt();
  if (restored && Math.max(row.createdAt.getTime(), row.lastSentAt.getTime()) < restored.getTime()) return { reason: "invalid" as const };
  return { row, hash };
}

/** The grant, checked again at acceptance. Returns the role and the level it gives, or why it is refused (audited by the caller). */
async function revalidate(inv: { roleId: string; roleKey: string; rightsSnapshot: string; invitedById: string; email: string }, catalogue: RightInfo[], db: Db = prisma): Promise<{ role: RoleRow; level: Level } | { refused: string }> {
  const inviter = await teamActor(inv.invitedById, catalogue, db);
  if (!inviter) return { refused: "inviter" };
  const role = await db.role.findUnique({ where: { id: inv.roleId }, select: { id: true, key: true, name: true, system: true, rights: true } });
  if (!role) return { refused: "role-gone" };
  if (role.key !== inv.roleKey) return { refused: "role-changed" };
  if (role.key === "owner") return { refused: "owner" };
  if (!mayGrant(inviter, role, catalogue)) return { refused: "inviter-rights" };
  if (!role.system) {
    let snapshot: string[] = [];
    try { const v = JSON.parse(inv.rightsSnapshot); if (Array.isArray(v)) snapshot = v.filter((x): x is string => typeof x === "string"); } catch { /* unreadable = empty = anything gained is refused */ }
    if (parseStoredRights(role.rights, catalogue).some((r) => !snapshot.includes(r))) return { refused: "role-elevated" };
  }
  return { role, level: role.system ? levelFromKeys([role.key]) : "none" };
}

export async function peekInvitation(token: unknown, ip: string, now = new Date()): Promise<InviteLook> {
  const found = await openToken(token, ip, now);
  if (!found.row) return { ok: false, reason: found.reason };
  const role = await prisma.role.findUnique({ where: { id: found.row.roleId }, select: { name: true, key: true, system: true } });
  return { ok: true, email: found.row.email, roleKey: found.row.roleKey, customName: role && !role.system ? role.name : "" };
}

export const cleanName = (value: unknown): string | null => {
  const name = String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= NAME_MAX ? name : null;
};

/**
 * The person chose a name and a password on the invitation page. Token valid and open, fields valid, grant valid again, address still free: then the account is created and the
 * invitation spent in ONE transaction (the spend is a conditional write: a replay, or two tabs at once, creates one account at most). Never overwrites an account.
 */
export async function acceptInvitation(input: { token: unknown; name: unknown; password: unknown; confirm: unknown; ip: string; now?: Date }): Promise<AcceptResult> {
  const now = input.now ?? new Date();
  const found = await openToken(input.token, input.ip, now);
  if (!found.row) return { ok: false, reason: found.reason };
  const inv = found.row;
  const name = cleanName(input.name);
  if (!name) return { ok: false, reason: "name" };
  const password = String(input.password ?? "");
  if (passwordProblem(password)) return { ok: false, reason: "password" };
  if (password !== String(input.confirm ?? "")) return { ok: false, reason: "mismatch" };

  // Slow work first (the password hash), then ONE short transaction: the grant is checked again right before the invitation is spent, on the same state the writes use,
  // so an inviter suspended, a role changed or an account created between the check and the write cannot slip through.
  const passwordHash = await bcrypt.hash(password, 12);
  const catalogue = await currentCatalogue();
  await ensureSystemRoles();
  let userId = "";
  let level: Level = "none";
  let roleSystem = true;
  let refusal: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const grant = await revalidate(inv, catalogue, tx);
      if ("refused" in grant) { refusal = grant.refused; throw new Error("refused"); }
      const spent = await tx.invitation.updateMany({ where: { id: inv.id, status: "pending", expiresAt: { gt: now } }, data: { status: "accepted", acceptedAt: now } });
      if (spent.count !== 1) throw new Error("spent");
      if (await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } })) { refusal = "account-exists"; throw new Error("refused"); }
      const user = await tx.user.create({ data: { email: inv.email, name, ...columnsOf(grant.level), passwordHash, mustChangePassword: false } });
      userId = user.id;
      level = grant.level;
      roleSystem = grant.role.system;
      if (!grant.role.system) await tx.userRole.create({ data: { userId, roleId: grant.role.id } });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedUserId: userId } });
    });
  } catch {
    if (refusal) {
      await prisma.invitation.updateMany({ where: { id: inv.id, status: "pending" }, data: { status: "refused" } });
      await auditAccount(inv.email, "visitor", "invite.denied", inv.email, { why: refusal, role: inv.roleKey });
    }
    return { ok: false, reason: "invalid" };
  }
  if (roleSystem) await assignInitialRole(userId);
  await auditAccount(inv.email, level, "invite.accept", inv.email, { role: inv.roleKey, inviter: inv.invitedByLevel });
  return { ok: true, userId, email: inv.email };
}

/**
 * After a restore the people were replaced by those of the backup: every link still waiting (invitation or reset) belongs to another timeline (its inviter or person may not
 * exist any more). They are all withdrawn; spent, expired and withdrawn ones stay as they are and can never come back (no table here is part of a backup).
 */
export async function withdrawAllLinks(actor: string): Promise<{ invitations: number; resets: number }> {
  const pending = await prisma.invitation.findMany({ where: { status: "pending" }, select: { id: true, email: true } });
  let invitations = 0;
  for (const p of pending) {
    const done = await prisma.invitation.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "revoked" } });
    if (done.count === 1) { invitations++; await auditAccount(actor, "system", "invite.revoke", p.email, { why: "restore" }); }
  }
  const resets = (await prisma.passwordReset.deleteMany({})).count;
  return { invitations, resets };
}
