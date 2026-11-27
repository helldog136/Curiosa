/**
 * TABLEAU DE BORD — quels blocs, dans quel ordre, pour qui. Pur : ne lit rien, se teste seul.
 *
 * Personnalisation par palier, sans AUCUN droit élargi (chaque bloc filtre en plus ses propres données par droits) :
 *  - Rédaction : à faire (brouillons…), créer, visites, ce qui s'est passé ;
 *  - Coordination technique : à faire (mises à jour, sauvegarde, assistants), santé, stockage (place prise et place libre), ce qui s'est passé ;
 *  - Administration et propriétaire : tout (dont le stockage) ;
 *  - un rôle personnalisé sans palier : à faire, créer, ce qui s'est passé, cartes des extensions.
 * Ordre (C5a) : ce qui attend une action d'abord (à régler), puis la mise en route, créer, à finir, les cartes des modules, la vue d'ensemble (chiffres puis visites repliées), le stockage et le journal repliés.
 * « Ce qui s'est passé » (le journal) est toujours le DERNIER bloc, dans les deux modes et pour tous les paliers.
 * « À finir » (brouillons avec leurs titres) et « le site en chiffres » viennent de la correction des chiffres et se montrent dans les deux modes. Mode simple : 2 cartes d'extensions au plus ; mode avancé : 4.
 */
import { effectiveLevel, type AdminUser } from "../auth/access";
import { DASHBOARD_LIMITS } from "./spec";

export const BLOCKS = ["health", "todo", "setup", "create", "drafts", "modules", "numbers", "visits", "storage", "activity"] as const;
export type BlockId = (typeof BLOCKS)[number];
export type Plan = { blocks: BlockId[]; cards: number; profile: "editor" | "coordinator" | "admin" | "custom" };

export function dashboardPlan(user: AdminUser, advanced: boolean): Plan {
  const level = effectiveLevel(user);
  const cards = advanced ? DASHBOARD_LIMITS.shownCards : 2;
  let profile: Plan["profile"];
  let blocks: BlockId[];
  if (level === "owner" || level === "admin") {
    profile = "admin";
    blocks = ["health", "todo", "setup", "create", "drafts", "modules", "numbers", "visits", "storage", "activity"];
  } else if (level === "coordinator") {
    profile = "coordinator";
    blocks = ["health", "todo", "modules", "numbers", "storage", "activity"];
  } else if (level === "editor") {
    profile = "editor";
    blocks = ["todo", "create", "drafts", "modules", "numbers", "visits", "activity"];
  } else {
    profile = "custom";
    blocks = ["todo", "create", "drafts", "modules", "numbers", "activity"];
  }
  return { blocks, cards, profile };
}
