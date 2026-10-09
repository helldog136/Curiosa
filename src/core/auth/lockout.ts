import crypto from "node:crypto";
import { prisma } from "../db";
import { getAuthSecret } from "../secret";

/**
 * BLOCAGES PROGRESSIFS DE LA CONNEXION. Jamais définitifs : un utilisateur maladroit revient toujours.
 *   - 5 mots de passe faux de suite → blocage de 1 h ; 5 de plus → 3 h, puis 5, 8, 13, 21, 34, 55 et 89 h (Fibonacci, plafonné).
 *   - Deux clés : l'adresse IP (tous les comptes) et l'e-mail (même s'il n'existe pas : on ne révèle rien).
 *   - Le blocage par e-mail ne vaut PAS pour une adresse d'où cet utilisateur s'est déjà connecté ces 30 derniers jours : un inconnu ne peut pas
 *     enfermer le propriétaire hors de son site en tapant de faux mots de passe.
 *   - Une connexion réussie remet les compteurs à zéro ; sans erreur pendant 7 jours, les paliers retombent aussi.
 * L'état est en base : il survit au redémarrage du site.
 */
export const LOCK_HOURS = [1, 3, 5, 8, 13, 21, 34, 55, 89];
export const MAX_FAILURES = 5;
const HOUR = 3_600_000;
const FAILURE_CHAIN_MS = HOUR;          // deux erreurs espacées de plus d'une heure ne font pas partie de la même série
const STRIKES_FORGOTTEN_MS = 7 * 24 * HOUR;
const TRUST_MS = 30 * 24 * HOUR;
const MAX_TRUSTED = 8;

export type LockState = { locked: false } | { locked: true; until: Date; scope: "ip" | "email" };

const ipKey = (ip: string) => `ip:${ip}`;
const emailKey = (email: string) => `email:${email.trim().toLowerCase().slice(0, 200)}`;
/** Empreinte d'une adresse (jamais l'adresse elle-même en base). */
export const ipHash = (ip: string): string => crypto.createHmac("sha256", getAuthSecret()).update(`ip|${ip}`).digest("hex").slice(0, 32);

async function isTrusted(email: string, ip: string, now: Date): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!user) return false;
  const row = await prisma.trustedIp.findUnique({ where: { userId_hash: { userId: user.id, hash: ipHash(ip) } } });
  return !!row && now.getTime() - row.lastSeen.getTime() < TRUST_MS;
}

/** Cette tentative de connexion est-elle permise ? À appeler AVANT de regarder le mot de passe. */
export async function checkLogin(ip: string, email: string, now = new Date()): Promise<LockState> {
  const byIp = await prisma.authLock.findUnique({ where: { key: ipKey(ip) } });
  if (byIp?.lockedUntil && byIp.lockedUntil > now) return { locked: true, until: byIp.lockedUntil, scope: "ip" };
  const byEmail = email ? await prisma.authLock.findUnique({ where: { key: emailKey(email) } }) : null;
  if (byEmail?.lockedUntil && byEmail.lockedUntil > now && !(await isTrusted(email, ip, now))) return { locked: true, until: byEmail.lockedUntil, scope: "email" };
  return { locked: false };
}

async function strike(key: string, now: Date): Promise<Date | null> {
  const row = await prisma.authLock.findUnique({ where: { key } });
  let failures = row?.failures ?? 0;
  let strikes = row?.strikes ?? 0;
  const last = row?.lastFailureAt?.getTime() ?? 0;
  if (last && now.getTime() - last > STRIKES_FORGOTTEN_MS) { strikes = 0; failures = 0; }
  else if (last && now.getTime() - last > FAILURE_CHAIN_MS) failures = 0;
  failures += 1;
  let lockedUntil: Date | null = row?.lockedUntil ?? null;
  if (failures >= MAX_FAILURES) {
    strikes += 1;
    failures = 0;
    lockedUntil = new Date(now.getTime() + LOCK_HOURS[Math.min(strikes, LOCK_HOURS.length) - 1]! * HOUR);
  }
  await prisma.authLock.upsert({ where: { key }, create: { key, failures, strikes, lastFailureAt: now, lockedUntil }, update: { failures, strikes, lastFailureAt: now, lockedUntil } });
  return failures === 0 ? lockedUntil : null;
}

/** Un mot de passe faux : compte pour l'adresse et pour l'e-mail. Renvoie la fin du blocage si cette erreur vient de le déclencher. */
export async function recordFailure(ip: string, email: string, now = new Date()): Promise<{ lockedUntil: Date | null }> {
  const a = await strike(ipKey(ip), now);
  const b = email ? await strike(emailKey(email), now) : null;
  const lockedUntil = [a, b].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  if (lockedUntil) await prisma.auditLog.create({ data: { actor: email.trim().toLowerCase().slice(0, 200) || "?", action: "login.locked", target: `${ip} jusqu'à ${lockedUntil.toISOString()}` } }).catch(() => {});
  return { lockedUntil };
}

/** Connexion réussie : compteurs remis à zéro, et l'adresse devient « connue » pour cet utilisateur. */
export async function recordSuccess(ip: string, userId: string, email: string, now = new Date()): Promise<void> {
  await prisma.authLock.deleteMany({ where: { key: { in: [ipKey(ip), emailKey(email)] } } });
  const hash = ipHash(ip);
  await prisma.trustedIp.upsert({ where: { userId_hash: { userId, hash } }, create: { userId, hash, lastSeen: now }, update: { lastSeen: now } });
  const all = await prisma.trustedIp.findMany({ where: { userId }, orderBy: { lastSeen: "desc" } });
  const stale = all.slice(MAX_TRUSTED).concat(all.filter((r) => now.getTime() - r.lastSeen.getTime() >= TRUST_MS));
  if (stale.length) await prisma.trustedIp.deleteMany({ where: { userId, hash: { in: stale.map((r) => r.hash) } } });
}

/** Le propriétaire débloque quelqu'un (page Utilisateurs) : son e-mail redevient libre. L'adresse IP, elle, n'est pas concernée. */
export async function unlockEmail(email: string): Promise<void> {
  await prisma.authLock.deleteMany({ where: { key: emailKey(email) } });
}

export async function isEmailLocked(email: string, now = new Date()): Promise<Date | null> {
  const row = await prisma.authLock.findUnique({ where: { key: emailKey(email) } });
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/** « 14:32 » le jour même, sinon « 11/10 à 14:32 » — dans la langue de l'interface. */
export function formatUntil(until: Date, locale: string, now = new Date()): string {
  const sameDay = until.toDateString() === now.toDateString();
  try { return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(until); } catch { return until.toISOString(); }
}
