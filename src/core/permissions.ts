import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./db";
import { accessGate, can, deniedPath, GATE_PATH, hasRole, isMember, isOwner, loadAdminUser, needLabel, shouldAuditDenied, type AdminUser, type Need } from "./auth/access";

export type { Role, AdminUser, Need, Level } from "./auth/access";
export { can, isOwner, isMember };

/**
 * Utilisateur connecté, ou null. Une session « forcée » (mot de passe temporaire à remplacer) vaut null PARTOUT, sauf si l'appelant dit `allowForced` :
 * les routes d'API et tout code qui oublierait la règle sont ainsi fermés par défaut.
 */
export async function currentUser(opts: { allowForced?: boolean } = {}): Promise<AdminUser | null> {
  const session = await auth();
  const user = await loadAdminUser(session?.user?.id, session?.user?.sv);
  if (user?.mustChangePassword && !opts.allowForced) return null;
  return user;
}

export { hasRole };

/** Refus noté au journal d'audit (`access.denied`), au plus une fois par personne et par droit toutes les 10 minutes. */
export async function auditDenied(user: AdminUser, what: string): Promise<void> {
  if (shouldAuditDenied(user.id, what)) await audit(user.email, "access.denied", what);
}

/** À appeler en tête de chaque page ET de chaque action serveur d'admin. `need` : un palier (« editor », « admin », « owner »), « member » (tout accès) ou `{ right }`. */
/** `allowUnenrolled` : seulement pour la page « Mon compte » (où l'on active la double vérification exigée) et ses actions. `allowForced` : seulement pour « Choisissez votre mot de passe ». */
export async function requireRole(min: Need, opts: { allowUnenrolled?: boolean; allowForced?: boolean } = {}): Promise<AdminUser> {
  const session = await auth();
  const user = await loadAdminUser(session?.user?.id, session?.user?.sv);
  const gate = accessGate(user, min, opts);
  if (gate === "denied" && user) {
    await auditDenied(user, needLabel(min));
    redirect(deniedPath(user));
  }
  if (gate !== "ok") redirect(GATE_PATH[gate]);
  return user!;
}

export async function audit(actor: string, action: string, target = ""): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } }).catch(() => {});
}
