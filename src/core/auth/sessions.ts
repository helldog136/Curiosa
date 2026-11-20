import { prisma } from "../db";

/**
 * SESSIONS RÉVOCABLES. La session est un jeton signé que le navigateur garde ; il porte le « numéro de session » de l'utilisateur au moment de la connexion.
 * Tant que ce numéro est celui de la base, la session vaut ; l'augmenter coupe d'un coup toutes les sessions ouvertes de cet utilisateur
 * (autre ordinateur, session volée…). Les jetons d'avant cette fonction n'ont pas de numéro : ils valent 0, comme tous les comptes existants.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }).catch(() => {});
  await pausePersonalAccesses(userId);
}

/**
 * (core 0.46.0) Cutting someone's sessions (sign out everywhere, lost device, password changed or reset, two-factor reset) is a compromise signal: the personal AI assistant
 * of that person, a long-lived credential, is PAUSED until they resume it themselves. Nothing is deleted. Never throws (a failure here must not block the sign-out).
 */
export async function pausePersonalAccesses(userId: string): Promise<void> {
  await prisma.apiToken.updateMany({ where: { ownerId: userId, revokedAt: null, pausedAt: null }, data: { pausedAt: new Date() } }).catch(() => {});
}

export const sessionIsCurrent = (tokenVersion: unknown, dbVersion: number): boolean => (typeof tokenVersion === "number" ? tokenVersion : 0) === dbVersion;
