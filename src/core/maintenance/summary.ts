import { prisma } from "@/core/db";
import { listRequests } from "./requests";
import { getSeenAt } from "./settings";

/**
 * Ce que l'administrateur doit voir sans chercher (pastille du menu, encadré du tableau de bord) :
 *  - les demandes d'une IA qui attendent sa réponse ;
 *  - les actions de niveau 2 ou 3 faites par une IA depuis sa dernière visite des vues « Demandes à valider » ou « Historique » de la page Assistants IA.
 */
export const AI_ACTION_PREFIX = "mcp.maintenance.";
/** Lignes du journal qui ne sont pas une action exécutée. */
const NOT_AN_ACTION = ["mcp.maintenance.request", "mcp.maintenance.approve", "mcp.maintenance.deny", "mcp.maintenance.mode", "mcp.maintenance.notify"];

export async function maintenanceSummary(): Promise<{ pending: number; doneSinceVisit: number; total: number }> {
  const [list, seen] = await Promise.all([listRequests(), getSeenAt()]);
  const pending = list.filter((r) => r.status === "pending").length;
  const doneSinceVisit = await prisma.auditLog.count({ where: { action: { startsWith: AI_ACTION_PREFIX, notIn: NOT_AN_ACTION }, createdAt: { gt: new Date(seen) }, actor: { startsWith: "mcp:" } } });
  return { pending, doneSinceVisit, total: pending + doneSinceVisit };
}
