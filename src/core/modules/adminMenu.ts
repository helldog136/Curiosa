import type { Level } from "../auth/rights";

/** Les entrées de la rubrique « Administration » du menu, dans l'ordre d'affichage. */
export type AdminEntry = "extensions" | "assistants" | "users" | "backup" | "updates" | "audit";

/**
 * Quelles entrées d'« Administration » voit cette personne ? Logique pure, testée.
 * - Assistants IA : propriétaire seulement, en mode simple comme en mode avancé (c'est la page qu'une créatrice non technique utilise pour brancher une IA) ;
 * - Journal d'audit : propriétaire, mode avancé seulement.
 */
export function administrationEntries({ role, advanced }: { role: Level; advanced: boolean }): AdminEntry[] {
  // « Gérer » : administrateur ou propriétaire (un « none » à rôles personnalisés n'a pas cette rubrique, comme un éditeur).
  const manage = role === "admin" || role === "owner";
  const owner = role === "owner";
  const out: AdminEntry[] = [];
  if (manage) out.push("extensions");
  if (owner) out.push("assistants");
  if (manage) out.push("users");
  if (owner) out.push("backup", "updates");
  if (owner && advanced) out.push("audit");
  return out;
}

/**
 * Une entrée du menu (et du « À faire » du tableau de bord) que cette personne peut ouvrir : un module à contenu mène à la liste des entrées
 * (droit `core:entries.edit`), les autres à la page d'admin du module (droit `<module>:open`). Un lien qui mènerait à un refus n'est pas montré.
 */
export function navItemVisible(item: { content: boolean; moduleId: string }, can: (right: string) => boolean): boolean {
  return item.content ? can("core:entries.edit") : can(`${item.moduleId}:open`);
}
