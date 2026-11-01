import { prisma } from "@/core/db";
import { stateWhere, type AdminState } from "./adminList";

/** Ce que le tableau de bord sait compter d'une extension : seules celles qui ont une liste d'entrées à ouvrir (contenu, pas en erreur). */
export type CountableItem = { id: string; key: string; name: string; icon: string; content: boolean; error: boolean };
export type CountPart = { key: string; name: string; icon: string; n: number };
export type EntryCount = { total: number; parts: CountPart[] };

/** Ajoute les nombres par extension : celles à zéro disparaissent, les plus fournies passent d'abord. Pur, pour être testé sans base. */
export function sumByItem(items: CountableItem[], perInstance: Map<string, number>): EntryCount {
  const parts = items
    .filter((i) => i.content && !i.error)
    .map((i) => ({ key: i.key, name: i.name, icon: i.icon, n: perInstance.get(i.id) ?? 0 }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { total: parts.reduce((s, p) => s + p.n, 0), parts };
}

/**
 * Entrées publiées et brouillons du tableau de bord, comptés avec les MÊMES règles que les listes qu'ils ouvrent (`stateWhere`) et seulement dans les extensions
 * dont la liste existe : une entrée d'une extension désinstallée, sans liste ou en erreur n'est jamais comptée, puisqu'on ne pourrait pas la retrouver.
 */
export async function dashboardEntryCounts(items: CountableItem[]): Promise<Record<Extract<AdminState, "published" | "draft">, EntryCount>> {
  const now = new Date();
  const ids = items.filter((i) => i.content && !i.error).map((i) => i.id);
  const one = async (state: "published" | "draft") => {
    if (ids.length === 0) return sumByItem(items, new Map());
    const rows = await prisma.entry.groupBy({ by: ["instanceId"], where: { AND: [{ instanceId: { in: ids } }, stateWhere(state, now)] }, _count: { _all: true } });
    return sumByItem(items, new Map(rows.map((r) => [r.instanceId, r._count._all])));
  };
  return { published: await one("published"), draft: await one("draft") };
}

/** Nombre d'entrées de l'extension pour chaque filtre de sa liste (les pastilles « Brouillons (2) »). */
export async function entryStateCounts(instanceId: string): Promise<Record<AdminState, number>> {
  const now = new Date();
  const states = ["all", "published", "draft", "scheduled", "expired"] as const;
  const counts = await Promise.all(states.map((s) => prisma.entry.count({ where: { AND: [{ instanceId }, stateWhere(s, now)] } })));
  return Object.fromEntries(states.map((s, i) => [s, counts[i]])) as Record<AdminState, number>;
}
