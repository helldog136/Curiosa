import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { makeTranslator } from "../i18n/dictionary";
import { sendMail } from "../services/mail";
import { getSiteConfig } from "../settings";
import { generateTemporaryPassword, passwordProblem } from "./passwordPolicy";

/**
 * MOT DE PASSE TEMPORAIRE FIXÉ PAR LE PROPRIÉTAIRE. Ce module porte toute la règle ; les actions serveur ne font que l'appeler.
 *  - Seul le propriétaire (relu EN BASE, jamais une valeur envoyée par le navigateur) ; jamais sur soi-même ni sur un autre propriétaire.
 *  - Le mot de passe n'est ni journalisé, ni stocké en clair, ni envoyé par e-mail : il est renvoyé UNE fois à l'appelant (mode « généré »), puis perdu.
 *  - En une seule écriture : nouveau hash, drapeau « doit choisir le sien » posé, numéro de session augmenté (toutes ses sessions ouvertes sont coupées).
 *  - Les clés d'accès et la double vérification restent en place : la prochaine connexion RÉUSSIE (mot de passe, code ou clé d'accès) mène à « Choisissez votre mot de passe ».
 */
export type ResetFailure = "denied" | "missing" | "self" | "owner" | "weak" | "limited";
export type ResetResult = { ok: true; name: string; password?: string; mailed: boolean } | { ok: false; reason: ResetFailure };

const COST = 12; // même coût que partout ailleurs (création d'un utilisateur, Mon compte)

/* ── Limitation de débit : en mémoire (un seul processus), assez pour décourager un compte propriétaire piraté ou un script ── */
const PER_ACTOR = { max: 10, windowMs: 15 * 60_000 };
const PER_TARGET = { max: 5, windowMs: 60 * 60_000 };
const hits = new Map<string, number[]>();
export function resetTeamPasswordLimits(): void { hits.clear(); }
function recent(key: string, windowMs: number, now: number): number[] { return (hits.get(key) ?? []).filter((t) => now - t < windowMs); }
function allow(actorId: string, targetId: string, now: number): boolean {
  const a = recent(`a:${actorId}`, PER_ACTOR.windowMs, now);
  const b = recent(`t:${targetId}`, PER_TARGET.windowMs, now);
  if (a.length >= PER_ACTOR.max || b.length >= PER_TARGET.max) return false;
  hits.set(`a:${actorId}`, [...a, now]);
  hits.set(`t:${targetId}`, [...b, now]);
  return true;
}

/** Le courrier à la personne : ce qui s'est passé et ce qu'elle devra faire, JAMAIS le mot de passe. Sans e-mail configuré sur le site : rien, sans erreur. */
async function notify(target: { email: string; name: string; locale: string | null }): Promise<boolean> {
  try {
    const cfg = await getSiteConfig().catch(() => null);
    const t = makeTranslator(target.locale ?? cfg?.defaultLocale ?? "en");
    const site = cfg?.name || "Curiosa";
    const sent = await sendMail({ to: target.email, subject: t("users.tempMail.subject", { site }), text: t("users.tempMail.body", { name: target.name, site }) }, "core");
    return sent.ok;
  } catch {
    return false;
  }
}

export async function resetMemberPassword(input: { actorId: string; targetId: string; mode: "generate" | "custom"; password?: string; now?: number }): Promise<ResetResult> {
  const now = input.now ?? Date.now();
  const actor = await prisma.user.findUnique({ where: { id: String(input.actorId ?? "") }, select: { id: true, email: true, role: true } });
  if (!actor || actor.role !== "owner") return { ok: false, reason: "denied" };
  const target = await prisma.user.findUnique({ where: { id: String(input.targetId ?? "") } });
  if (!target) return { ok: false, reason: "missing" };
  if (target.id === actor.id) return { ok: false, reason: "self" };
  if (target.role === "owner") return { ok: false, reason: "owner" };
  const custom = input.mode === "custom";
  if (custom && passwordProblem(String(input.password ?? ""))) return { ok: false, reason: "weak" };
  if (!allow(actor.id, target.id, now)) return { ok: false, reason: "limited" };

  const password = custom ? String(input.password) : generateTemporaryPassword();
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(password, COST), mustChangePassword: true, sessionVersion: { increment: 1 } } });
  // Qui, pour qui : jamais le mot de passe. (Pas d'`audit()` ici : on ne veut pas d'un `.catch` qui avale une erreur d'écriture du journal sans rien dire.)
  await prisma.auditLog.create({ data: { actor: actor.email, action: "user.password.reset", target: target.email } });
  const mailed = await notify(target);
  return { ok: true, name: target.name, mailed, ...(custom ? {} : { password }) };
}

export type ChooseFailure = "notRequired" | "weak" | "mismatch" | "same";
export type ChooseResult = { ok: true } | { ok: false; reason: ChooseFailure };

/** La personne choisit son mot de passe personnel. Différent du temporaire (donc de l'actuel), confirmé, mêmes règles de solidité. Coupe les AUTRES sessions : l'appelant ouvre une session neuve pour celle-ci. */
export async function chooseOwnPassword(userId: string, next: string, confirm: string): Promise<ChooseResult> {
  const user = await prisma.user.findUnique({ where: { id: String(userId ?? "") } });
  if (!user || !user.mustChangePassword) return { ok: false, reason: "notRequired" };
  if (passwordProblem(next)) return { ok: false, reason: "weak" };
  if (next !== confirm) return { ok: false, reason: "mismatch" };
  if (await bcrypt.compare(next, user.passwordHash)) return { ok: false, reason: "same" };
  // Écriture conditionnelle : deux onglets qui envoient en même temps, un seul gagne.
  const done = await prisma.user.updateMany({ where: { id: user.id, mustChangePassword: true, passwordHash: user.passwordHash }, data: { passwordHash: await bcrypt.hash(next, COST), mustChangePassword: false, sessionVersion: { increment: 1 } } });
  if (done.count !== 1) return { ok: false, reason: "notRequired" };
  await prisma.auditLog.create({ data: { actor: user.email, action: "user.password.chosen", target: user.email } });
  return { ok: true };
}
