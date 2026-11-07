import type { Level } from "../auth/rights";
import { levelHolds } from "../auth/team";
import { MAINTENANCE_TAB_HREFS } from "../adminLinks";

/** Les entrées de la rubrique « Administration » du menu, dans l'ordre d'affichage. */
export type AdminEntry = "extensions" | "overlays" | "assistants" | "users" | "maintenance";

/** Les entrées d'« Administration » réservées au mode avancé : jamais dans le menu d'une personne en mode simple (test : tests/core/admin-simple-mode.test.mjs). Aucune aujourd'hui : le journal d'activité est un onglet d'Entretien, réservé au mode avancé (ADVANCED_ONLY_TABS). */
export const ADVANCED_ONLY_ENTRIES: readonly AdminEntry[] = [];

/** Les onglets de l'entrée « Entretien », dans l'ordre d'affichage. Chacun garde sa propre adresse (adminLinks.ts) : l'entrée de menu les réunit, rien n'est redirigé. */
export type MaintenanceTab = keyof typeof MAINTENANCE_TAB_HREFS;
/** Onglets d'Entretien réservés au mode avancé. */
export const ADVANCED_ONLY_TABS: readonly MaintenanceTab[] = ["audit"];

/**
 * Quels onglets d'Entretien voit cette personne ? Logique pure, testée.
 * - Contrôle du site (contenu) : administrateur, coordinateur et propriétaire ;
 * - Sauvegarde : `core:backup` ; Mises à jour et Restes d'anciennes versions : `core:updates` ;
 * - Journal d'activité : `core:security`, mode avancé seulement.
 */
export function maintenanceTabs({ role, advanced }: { role: Level; advanced: boolean }): MaintenanceTab[] {
  const manage = role === "admin" || role === "coordinator" || role === "owner";
  const out: MaintenanceTab[] = [];
  if (manage) out.push("health");
  if (levelHolds(role, "core:backup")) out.push("backup");
  if (levelHolds(role, "core:updates")) out.push("updates", "upkeep");
  if (levelHolds(role, "core:security")) out.push("audit");
  return advanced ? out : out.filter((e) => !ADVANCED_ONLY_TABS.includes(e));
}

/**
 * Quelles entrées d'« Administration » voit cette personne ? Logique pure, testée.
 * - Assistants IA : qui détient `core:mcp.tokens` (personne propriétaire, coordination technique), en mode simple comme en mode avancé (c'est la page qu'une personne non technique utilise pour brancher une IA) ;
 * - Entretien : une seule entrée, présente dès que la personne a au moins un onglet (maintenanceTabs : contrôle du site, sauvegarde, mises à jour, restes d'anciennes versions, journal d'activité) ;
 */
export function administrationEntries({ role, advanced }: { role: Level; advanced: boolean }): AdminEntry[] {
  // « Gérer » : administrateur, coordinateur ou propriétaire (un « none » à rôles personnalisés n'a pas cette rubrique, comme un éditeur).
  const manage = role === "admin" || role === "coordinator" || role === "owner";
  const out: AdminEntry[] = [];
  if (manage) out.push("extensions");
  // Overlays (0.5.0) : composer les pages d'overlay est une fonction d'administration (administration, coordination technique, personne propriétaire), en mode simple comme avancé.
  // Pas de droit dédié : l'éditeur et les rôles personnalisés sans palier n'y entrent pas (voir overlays/access.ts).
  if (manage) out.push("overlays");
  if (levelHolds(role, "core:mcp.tokens")) out.push("assistants");
  if (manage) out.push("users");
  if (maintenanceTabs({ role, advanced }).length > 0) out.push("maintenance");
  return advanced ? out : out.filter((e) => !ADVANCED_ONLY_ENTRIES.includes(e));
}

/**
 * Une entrée du menu (et du « À faire » du tableau de bord) que cette personne peut ouvrir : un module à contenu mène à la liste des entrées
 * (droit `core:entries.edit`), les autres à la page d'admin du module (droit `<module>:open`). Un lien qui mènerait à un refus n'est pas montré.
 */
export function navItemVisible(item: { content: boolean; moduleId: string }, can: (right: string) => boolean): boolean {
  return item.content ? can("core:entries.edit") : can(`${item.moduleId}:open`);
}
