/**
 * TABLEAU DE BORD — quels blocs, dans quel ordre, pour qui. Pur : ne lit rien, se teste seul.
 *
 * Personnalisation par palier, sans AUCUN droit élargi (chaque bloc filtre en plus ses propres données par droits) :
 *  - Rédaction : à faire (brouillons…), créer, visites, ce qui s'est passé ;
 *  - Coordination technique : à faire (mises à jour, sauvegarde, assistants), santé, ce qui s'est passé ;
 *  - Administration et propriétaire : tout ;
 *  - un rôle personnalisé sans palier : à faire, créer, ce qui s'est passé, cartes des extensions.
 * Mode simple : peu de blocs, 2 cartes d'extensions au plus. Mode avancé : le site en chiffres et 4 cartes.
 */
import { effectiveLevel, type AdminUser } from "../auth/access";
import { DASHBOARD_LIMITS } from "./spec";

export const BLOCKS = ["setup", "health", "todo", "create", "activity", "visits", "modules", "numbers"] as const;
export type BlockId = (typeof BLOCKS)[number];
export type Plan = { blocks: BlockId[]; cards: number; profile: "editor" | "coordinator" | "admin" | "custom" };

export function dashboardPlan(user: AdminUser, advanced: boolean): Plan {
  const level = effectiveLevel(user);
  const cards = advanced ? DASHBOARD_LIMITS.shownCards : 2;
  let profile: Plan["profile"];
  let blocks: BlockId[];
  if (level === "owner" || level === "admin") {
    profile = "admin";
    blocks = ["setup", "health", "todo", "create", "activity", "visits", "modules", ...(advanced ? (["numbers"] as const) : [])];
  } else if (level === "coordinator") {
    profile = "coordinator";
    blocks = ["health", "todo", "activity", "modules", ...(advanced ? (["numbers"] as const) : [])];
  } else if (level === "editor") {
    profile = "editor";
    blocks = ["todo", "create", "visits", "activity", "modules"];
  } else {
    profile = "custom";
    blocks = ["todo", "create", "activity", "modules"];
  }
  return { blocks, cards, profile };
}
