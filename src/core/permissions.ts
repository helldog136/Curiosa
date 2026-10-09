import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./db";
import { sessionIsCurrent } from "./auth/sessions";
import { getSetting } from "./settings";

export type Role = "owner" | "admin" | "editor";
const RANK: Record<Role, number> = { editor: 1, admin: 2, owner: 3 };

/** `needsTwoFactor` : le propriétaire exige la double vérification de tous et ce compte ne l'a pas encore activée. */
export type AdminUser = { id: string; email: string; name: string; role: Role; locale: string | null; advanced: boolean; totp: boolean; passkeys: number; twoFactor: boolean; needsTwoFactor: boolean };

/** Utilisateur connecté (relu en base : un compte supprimé perd l'accès immédiatement). */
export async function currentUser(): Promise<AdminUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  // Session coupée (déconnexion de tous les appareils, mot de passe changé…) : le jeton d'avant ne vaut plus rien.
  if (!sessionIsCurrent(session?.user?.sv, user.sessionVersion)) return null;
  const totp = !!user.totpEnabledAt;
  const passkeys = await prisma.passkey.count({ where: { userId: user.id } });
  const twoFactor = totp || passkeys > 0; // une clé d'accès vaut les deux facteurs à elle seule
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role, locale: user.locale, advanced: user.advanced, totp, passkeys, twoFactor, needsTwoFactor: required && !twoFactor };
}

export function hasRole(user: AdminUser | null, min: Role): user is AdminUser {
  return !!user && (RANK[user.role] ?? 0) >= RANK[min];
}

/** À appeler en tête de chaque page ET de chaque action serveur d'admin. */
/** `allowUnenrolled` : seulement pour la page « Mon compte » (où l'on active la double vérification exigée) et ses actions. */
export async function requireRole(min: Role, opts: { allowUnenrolled?: boolean } = {}): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (!hasRole(user, min)) redirect("/admin?denied=1");
  if (user.needsTwoFactor && !opts.allowUnenrolled) redirect("/admin/account?need2fa=1");
  return user;
}

export async function audit(actor: string, action: string, target = ""): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } }).catch(() => {});
}
