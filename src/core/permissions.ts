import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./db";
import { actorKindOf } from "./journal/events";
import { accessGate, can, deniedPath, GATE_PATH, hasRole, isMember, isOwner, loadAdminUser, needLabel, rememberDenied, shouldAuditDenied, type AdminUser, type Need } from "./auth/access";

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

/** A background render (link prefetch) is not a refusal the person has seen: it must not overwrite the one they are about to read. */
async function isPrefetch(): Promise<boolean> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.has("next-router-prefetch") || (h.get("purpose") ?? "").toLowerCase() === "prefetch" || (h.get("sec-purpose") ?? "").toLowerCase().includes("prefetch");
  } catch {
    return false; // outside a request (tests, scripts): not a prefetch
  }
}

/** À appeler en tête de chaque page ET de chaque action serveur d'admin. `need` : un palier (« editor », « admin », « owner »), « member » (tout accès) ou `{ right }`. */
/** `allowUnenrolled` : seulement pour la page « Mon compte » (où l'on active la double vérification exigée) et ses actions. `allowForced` : seulement pour « Choisissez votre mot de passe ». */
export async function requireRole(min: Need, opts: { allowUnenrolled?: boolean; allowForced?: boolean } = {}): Promise<AdminUser> {
  const session = await auth();
  const user = await loadAdminUser(session?.user?.id, session?.user?.sv);
  const gate = accessGate(user, min, opts);
  if (gate === "denied" && user) {
    await auditDenied(user, needLabel(min));
    if (!(await isPrefetch())) rememberDenied(user.id, min);
    redirect(deniedPath(user));
  }
  if (gate !== "ok") redirect(GATE_PATH[gate]);
  return user!;
}

/**
 * Écrit une ligne du journal d'audit. `meta` (cœur 0.6.0) la rattache à un module (`module`, `instance`) pour son onglet « Historique » et fixe son niveau ;
 * l'origine (`actorKind`) se déduit de la forme de `actor` (adresse e-mail = personne, « mcp: » = assistant, « module: » = module, sinon le système).
 */
export async function audit(actor: string, action: string, target = "", meta: { module?: string; instance?: string; level?: "info" | "warn" | "error" } = {}): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target, actorKind: actorKindOf(actor), ...(meta.module ? { module: meta.module, instance: meta.instance ?? "" } : {}), ...(meta.level ? { level: meta.level } : {}) } }).catch(() => {});
}
