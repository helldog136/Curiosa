import { can, hasRole, type AdminUser } from "@/core/auth/access";
import { actionRight } from "@/core/auth/rights";
import type { AdminActionHandler, ModuleDefinition } from "./types";

/** `handler` : autorisé ; `denied` : refusé (ce qui manquait, pour le journal) ; null : pas d'action de ce nom. */
export type AdminActionDecision = { handler: AdminActionHandler } | { denied: string } | null;

/**
 * Qui peut exécuter une `adminAction` d'un module (décision pure ; la personne est celle relue en base à cette requête) :
 * - forme fonction : administrateurs seulement (comme avant la 0.2.0) ;
 * - forme objet `{ right, run }` : `<module>:open` ET `<module>:<right>` (préfixe imposé : le droit d'un autre module, ou un identifiant invalide, est toujours refusé).
 */
export function decideAdminAction(user: AdminUser | null, moduleId: string, actions: ModuleDefinition["adminActions"], action: string): AdminActionDecision {
  const declared = actions && Object.hasOwn(actions, action) ? actions[action] : undefined;
  if (!declared) return null;
  if (typeof declared === "function") return hasRole(user, "admin") && can(user, `${moduleId}:open`) ? { handler: declared } : { denied: `module:${moduleId}:${action}` };
  const right = actionRight(moduleId, declared.right);
  if (typeof declared.run === "function" && right && can(user, `${moduleId}:open`) && can(user, right)) return { handler: declared.run };
  return { denied: right ?? `module:${moduleId}:${action}` };
}
