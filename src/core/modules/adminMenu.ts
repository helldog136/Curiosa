import type { Role } from "../permissions";

/** Les entrées de la rubrique « Administration » du menu, dans l'ordre d'affichage. */
export type AdminEntry = "extensions" | "assistants" | "users" | "backup" | "updates" | "audit";

/**
 * Quelles entrées d'« Administration » voit cette personne ? Logique pure, testée.
 * - Assistants IA : propriétaire seulement, en mode simple comme en mode avancé (c'est la page qu'une créatrice non technique utilise pour brancher une IA) ;
 * - Journal d'audit : propriétaire, mode avancé seulement.
 */
export function administrationEntries({ role, advanced }: { role: Role; advanced: boolean }): AdminEntry[] {
  const manage = role !== "editor";
  const owner = role === "owner";
  const out: AdminEntry[] = [];
  if (manage) out.push("extensions");
  if (owner) out.push("assistants");
  if (manage) out.push("users");
  if (owner) out.push("backup", "updates");
  if (owner && advanced) out.push("audit");
  return out;
}
