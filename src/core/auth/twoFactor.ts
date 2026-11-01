import crypto from "node:crypto";
import { prisma } from "../db";
import { getAuthSecret } from "../secret";
import { generateSecret, otpauthUri, stepOf, verifyTotp } from "./totp";

/**
 * DOUBLE VÉRIFICATION. Après le mot de passe, on demande un code à 6 chiffres (application d'authentification) ou, si le téléphone est perdu,
 * l'un des 8 codes de secours (chacun ne sert qu'une fois). Le secret est dans la base : c'est la base qu'il faut protéger (les sauvegardes sont chiffrées).
 */
export const RECOVERY_COUNT = 8;
const RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // sans 0/O/1/l/i : on les recopie à la main

const hmac = (label: string, text: string): string => crypto.createHmac("sha256", getAuthSecret()).update(`${label}|${text}`).digest("hex");

/** « abcde-fghij » : 10 caractères tirés au hasard, groupés pour être lisibles. */
export function newRecoveryCode(): string {
  const pick = () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]!;
  const raw = Array.from({ length: 10 }, pick).join("");
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
const normalizeRecovery = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]/g, "");
const looksLikeRecovery = (input: string): boolean => /^[a-z0-9]{10}$/.test(normalizeRecovery(input));

export const hasTwoFactor = (u: { totpEnabledAt: Date | null }): boolean => !!u.totpEnabledAt;

/** Commence l'activation : une clé neuve, gardée « en attente » jusqu'à ce que l'utilisateur prouve qu'il sait générer un code. */
export async function beginEnroll(userId: string, issuer: string): Promise<{ secret: string; uri: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.totpEnabledAt) return null;
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpPending: secret } });
  return { secret, uri: otpauthUri({ issuer, account: user.email, secret }) };
}

async function writeRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hmac(`recovery|${userId}`, normalizeRecovery(c)) })) }),
  ]);
  return codes;
}

/** Le code saisi prouve que l'application est bien réglée : la double vérification est activée et les codes de secours sont donnés (une seule fois). */
export async function confirmEnroll(userId: string, code: string, now = Date.now()): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpPending || user.totpEnabledAt) return { ok: false };
  const step = verifyTotp(user.totpPending, code, { now });
  if (step === null) return { ok: false };
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: user.totpPending, totpPending: null, totpEnabledAt: new Date(now), totpLastStep: step } });
  return { ok: true, recoveryCodes: await writeRecoveryCodes(userId) };
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.totpEnabledAt ? writeRecoveryCodes(userId) : null;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}

/** Désactive (ou réinitialise, pour le propriétaire qui dépanne quelqu'un) : secret, codes de secours et sessions ouvertes disparaissent. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } } }),
  ]);
}

export type SecondFactor = { ok: true; kind: "totp" | "recovery" } | { ok: false };

/** Vérifie le deuxième facteur saisi à la connexion : code de l'application, ou code de secours (consommé). */
export async function verifySecondFactor(userId: string, input: string, now = Date.now()): Promise<SecondFactor> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret || !user.totpEnabledAt) return { ok: false };
  const text = input.trim();
  if (/^\d[\d\s]{5,7}$/.test(text)) {
    const step = verifyTotp(user.totpSecret, text, { now, afterStep: user.totpLastStep });
    if (step === null) return { ok: false };
    // « updateMany » conditionnel : si deux requêtes présentent le même code en même temps, une seule passe
    const done = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return done.count === 1 ? { ok: true, kind: "totp" } : { ok: false };
  }
  if (!looksLikeRecovery(text)) return { ok: false };
  const hash = hmac(`recovery|${userId}`, normalizeRecovery(text));
  const used = await prisma.recoveryCode.updateMany({ where: { userId, codeHash: hash, usedAt: null }, data: { usedAt: new Date(now) } });
  return used.count === 1 ? { ok: true, kind: "recovery" } : { ok: false };
}

/* ───────────── Jetons signés de courte durée (aucune table : on signe, on vérifie) ───────────── */

export type TokenPurpose = "pwd" | "ticket";
const TTL: Record<TokenPurpose, number> = { pwd: 5 * 60_000, ticket: 60_000 };

/**
 * « pwd » : le mot de passe était bon, on attend le deuxième facteur (5 min). « ticket » : TOUT est vérifié (mot de passe + deuxième facteur, ou clé d'accès),
 * la connexion peut être créée (60 s) — c'est la seule façon de se connecter à un compte protégé par la double vérification.
 */
export function signToken(purpose: TokenPurpose, userId: string, binding = "", now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ p: purpose, u: userId, b: binding, e: now + TTL[purpose], n: crypto.randomBytes(6).toString("hex") })).toString("base64url");
  return `${payload}.${hmac("token", payload)}`;
}

export function readToken(purpose: TokenPurpose, token: string, binding = "", now = Date.now()): string | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = hmac("token", payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p: string; u: string; b: string; e: number };
    return d.p === purpose && d.b === binding && now < d.e && typeof d.u === "string" ? d.u : null;
  } catch { return null; }
}

/** L'utilisateur nommé par un jeton, signature vérifiée mais ni durée ni usage (pour retrouver son compte avant de contrôler le reste). */
export function peekToken(token: string): string | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = hmac("token", payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown }; return typeof d.u === "string" ? d.u : null; } catch { return null; }
}

/** Ce qui change quand le mot de passe change : un jeton « mot de passe bon » d'avant ne vaut alors plus rien. */
export const passwordBinding = (passwordHash: string): string => hmac("pwbind", passwordHash).slice(0, 12);

export { stepOf };
