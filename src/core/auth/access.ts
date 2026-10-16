import { prisma } from "../db";
import { sessionIsCurrent } from "./sessions";
import { getSetting } from "../settings";

export type Role = "owner" | "admin" | "editor";
export const RANK: Record<Role, number> = { editor: 1, admin: 2, owner: 3 };

/**
 * `needsTwoFactor` : le propriétaire exige la double vérification de tous et ce compte ne l'a pas encore activée.
 * `mustChangePassword` : le propriétaire a fixé un mot de passe temporaire à cette personne ; tant qu'elle n'a pas choisi le sien, elle n'accède à rien d'autre.
 */
export type AdminUser = { id: string; email: string; name: string; role: Role; locale: string | null; advanced: boolean; totp: boolean; passkeys: number; twoFactor: boolean; needsTwoFactor: boolean; mustChangePassword: boolean };

/** Le compte d'une session (relu en base : un compte supprimé, ou dont les sessions ont été coupées, perd l'accès immédiatement). Aucune règle de page ici : voir `accessGate`. */
export async function loadAdminUser(id: string | undefined, tokenVersion: unknown): Promise<AdminUser | null> {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  // Session coupée (déconnexion de tous les appareils, mot de passe changé ou réinitialisé…) : le jeton d'avant ne vaut plus rien.
  if (!sessionIsCurrent(tokenVersion, user.sessionVersion)) return null;
  const totp = !!user.totpEnabledAt;
  const passkeys = await prisma.passkey.count({ where: { userId: user.id } });
  const twoFactor = totp || passkeys > 0; // une clé d'accès vaut les deux facteurs à elle seule
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role, locale: user.locale, advanced: user.advanced, totp, passkeys, twoFactor, needsTwoFactor: required && !twoFactor, mustChangePassword: user.mustChangePassword };
}

export function hasRole(user: AdminUser | null, min: Role): user is AdminUser {
  return !!user && (RANK[user.role] ?? 0) >= RANK[min];
}

export type Gate = "ok" | "login" | "password" | "denied" | "enroll";
/** Où renvoyer chaque refus. */
export const GATE_PATH: Record<Exclude<Gate, "ok">, string> = { login: "/admin/login", password: "/admin/choose-password", denied: "/admin?denied=1", enroll: "/admin/account?need2fa=1" };

/**
 * La seule règle d'accès de l'admin (pages, actions serveur, routes d'API passent toutes par elle). Ordre : connecté → mot de passe temporaire à remplacer
 * (avant tout le reste : une session « forcée » n'a accès à RIEN d'autre, pas même à savoir si elle aurait le droit) → rôle → double vérification exigée.
 * `allowForced` : seulement la page « Choisissez votre mot de passe » et ses actions. `allowUnenrolled` : seulement « Mon compte » et ses actions.
 */
export function accessGate(user: AdminUser | null, min: Role, opts: { allowUnenrolled?: boolean; allowForced?: boolean } = {}): Gate {
  if (!user) return "login";
  if (user.mustChangePassword && !opts.allowForced) return "password";
  if (!hasRole(user, min)) return "denied";
  if (user.needsTwoFactor && !opts.allowUnenrolled) return "enroll";
  return "ok";
}
