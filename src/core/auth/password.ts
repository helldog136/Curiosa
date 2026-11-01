import bcrypt from "bcryptjs";
import { prisma } from "../db";

// Mot de passe fictif : on compare toujours un mot de passe, même si l'e-mail n'existe pas, pour que la durée de la réponse ne révèle pas quels comptes existent.
const DUMMY_HASH = bcrypt.hashSync("curiosa-dummy-password", 12);

/** Le compte dont l'e-mail et le mot de passe sont bons, sinon null (même durée dans les deux cas). */
export async function verifyPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const good = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && good ? user : null;
}
