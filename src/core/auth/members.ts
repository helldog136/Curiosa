/**
 * COMPTES DE L'ÉQUIPE (0.4.0) : créer, supprimer, débloquer, couper les sessions, réinitialiser la double vérification. Toutes les règles sont ICI, côté serveur :
 * les actions de la page Équipe ne font que passer l'identifiant de la personne connectée (jamais lu dans le formulaire) et les valeurs envoyées ; l'acteur est RELU en base.
 * « Qui peut gérer qui » : voir team.ts. Chaque changement est inscrit au journal d'audit.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { levelOf } from "./access";
import { passwordProblem } from "./passwordPolicy";
import { revokeSessions } from "./sessions";
import { unlockEmail } from "./lockout";
import { disableTwoFactor } from "./twoFactor";
import { assignInitialRole } from "./roles";
import { columnsOf, RANK, type Level } from "./rights";
import { canManageMember, grantableLevels } from "./team";

export type MemberFailure = "denied" | "invalid" | "password" | "exists" | "level" | "missing";
export type MemberResult<T = object> = ({ ok: true } & T) | { ok: false; reason: MemberFailure };

async function audit(actor: string, action: string, target = ""): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } }).catch(() => {});
}

type Actor = { id: string; email: string; level: Level };
/** L'acteur, relu en base : au moins administrateur, sans mot de passe temporaire à remplacer. */
async function actorOf(actorId: string): Promise<Actor | null> {
  const row = await prisma.user.findUnique({ where: { id: String(actorId ?? "") }, select: { id: true, email: true, role: true, coordinator: true, mustChangePassword: true } });
  if (!row || row.mustChangePassword) return null;
  const level = levelOf(row);
  return RANK[level] >= RANK.admin ? { id: row.id, email: row.email, level } : null;
}

/** Nouveau compte avec mot de passe initial. Le niveau doit être de ceux que l'acteur peut attribuer (`grantableLevels`) : seul le propriétaire crée un coordinateur ou un administrateur... */
export async function createMember(actorId: string, input: { name?: unknown; email?: unknown; password?: unknown; role?: unknown }): Promise<MemberResult<{ id: string; level: Level }>> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: "invalid" };
  if (passwordProblem(String(input.password ?? ""))) return { ok: false, reason: "password" };
  const level = String(input.role ?? "") as Level;
  // Jamais « owner » ni « none » (un rôle personnalisé s'affecte ensuite) ; « coordinator » : propriétaire seul.
  if (!grantableLevels(actor.level).includes(level)) return { ok: false, reason: "level" };
  if (await prisma.user.findUnique({ where: { email } })) return { ok: false, reason: "exists" };
  const created = await prisma.user.create({ data: { email, name, ...columnsOf(level), passwordHash: await bcrypt.hash(String(input.password), 12) } });
  await assignInitialRole(created.id);
  await audit(actor.email, "user.create", level === "coordinator" || level === "admin" ? `${email}:${level}` : email);
  return { ok: true, id: created.id, level };
}

/** Quelle opération sur quelle cible : la cible relue en base, la règle de team.ts appliquée. */
async function target(actor: Actor, targetId: string, opts: { allowSelf?: boolean } = {}): Promise<MemberResult<{ row: { id: string; email: string; level: Level } }>> {
  const row = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true, coordinator: true } });
  if (!row) return { ok: false, reason: "missing" };
  const level = levelOf(row);
  const self = row.id === actor.id;
  if (!canManageMember(actor.level, level, { self: self && !opts.allowSelf })) return { ok: false, reason: "denied" };
  return { ok: true, row: { id: row.id, email: row.email, level } };
}

/**
 * Supprime un compte. Qui détient `core:team` : tout compte sauf le propriétaire, soi-même et (sauf propriétaire) un coordinateur.
 * Un administrateur (sans `core:team`) ne supprime qu'un éditeur, comme avant.
 */
export async function deleteMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  if (actor.level === "admin") {
    const row = await prisma.user.findUnique({ where: { id: String(targetId ?? "") }, select: { id: true, email: true, role: true, coordinator: true } });
    if (!row || row.id === actor.id || levelOf(row) !== "editor") return { ok: false, reason: "denied" };
    await prisma.user.delete({ where: { id: row.id } });
    await audit(actor.email, "user.delete", row.email);
    return { ok: true };
  }
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  await prisma.user.delete({ where: { id: t.row.id } });
  await audit(actor.email, "user.delete", t.row.email);
  return { ok: true };
}

/** Débloque quelqu'un qui a trop essayé de se connecter (son e-mail redevient libre tout de suite). Jamais le propriétaire pour un coordinateur. */
export async function unlockMember(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId, { allowSelf: true });
  if (!t.ok) return t;
  await unlockEmail(t.row.email);
  await audit(actor.email, "user.unlock", t.row.email);
  return { ok: true };
}

/** Coupe toutes les sessions ouvertes de quelqu'un (appareil perdu, compte douteux). */
export async function revokeMemberSessions(actorId: string, targetId: string): Promise<MemberResult> {
  const actor = await actorOf(actorId);
  if (!actor) return { ok: false, reason: "denied" };
  const t = await target(actor, targetId);
  if (!t.ok) return t;
  await revokeSessions(t.row.id);
  await audit(actor.email, "user.sessions.revoke", t.row.email);
  return { ok: true };
}

/** Réinitialise la double vérification ET les clés d'accès de quelqu'un qui a perdu son téléphone et ses codes de secours (ses sessions ouvertes sont coupées). */
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
