import type { Level } from "../auth/rights";
import { levelHolds } from "../auth/team";

/** Les entrées de la rubrique « Administration » du menu, dans l'ordre d'affichage. */
export type AdminEntry = "extensions" | "assistants" | "users" | "health" | "backup" | "updates" | "audit";

/**
 * Quelles entrées d'« Administration » voit cette personne ? Logique pure, testée.
 * - Assistants IA : qui détient `core:mcp.tokens` (personne propriétaire, coordination technique), en mode simple comme en mode avancé (c'est la page qu'une personne non technique utilise pour brancher une IA) ;
 * - Sauvegardes, Mises à jour : `core:backup`, `core:updates` ; Journal d'audit : `core:security`, mode avancé seulement (la table est dans rights.ts, `LEVEL_RESERVED`) ;
 * - Santé de mon site (contrôle du contenu) : administrateur et propriétaire, en mode simple comme avancé ;
 */
export function administrationEntries({ role, advanced }: { role: Level; advanced: boolean }): AdminEntry[] {
  // « Gérer » : administrateur, coordinateur ou propriétaire (un « none » à rôles personnalisés n'a pas cette rubrique, comme un éditeur).
  const manage = role === "admin" || role === "coordinator" || role === "owner";
  const out: AdminEntry[] = [];
  if (manage) out.push("extensions");
  if (levelHolds(role, "core:mcp.tokens")) out.push("assistants");
  if (manage) out.push("users", "health");
  if (levelHolds(role, "core:backup")) out.push("backup");
  if (levelHolds(role, "core:updates")) out.push("updates");
  if (levelHolds(role, "core:security") && advanced) out.push("audit");
  return out;
}

/**
 * Une entrée du menu (et du « À faire » du tableau de bord) que cette personne peut ouvrir : un module à contenu mène à la liste des entrées
 * (droit `core:entries.edit`), les autres à la page d'admin du module (droit `<module>:open`). Un lien qui mènerait à un refus n'est pas montré.
 */
export function navItemVisible(item: { content: boolean; moduleId: string }, can: (right: string) => boolean): boolean {
  return item.content ? can("core:entries.edit") : can(`${item.moduleId}:open`);
}
