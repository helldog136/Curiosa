import { prisma } from "../db";

/**
 * SESSIONS RÉVOCABLES. La session est un jeton signé que le navigateur garde ; il porte le « numéro de session » de l'utilisateur au moment de la connexion.
 * Tant que ce numéro est celui de la base, la session vaut ; l'augmenter coupe d'un coup toutes les sessions ouvertes de cet utilisateur
 * (autre ordinateur, session volée…). Les jetons d'avant cette fonction n'ont pas de numéro : ils valent 0, comme tous les comptes existants.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }).catch(() => {});
}

export const sessionIsCurrent = (tokenVersion: unknown, dbVersion: number): boolean => (typeof tokenVersion === "number" ? tokenVersion : 0) === dbVersion;
