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

export type DraftRow = { id: string; title: string; updatedAt: Date; key: string; name: string; icon: string };

/**
 * Les brouillons à finir, tous modules confondus, les plus récemment touchés d'abord : seulement ceux d'extensions qui ont une liste (donc qu'on peut ouvrir).
 * `total` est le nombre complet, `rows` en montre `limit` au plus (`skip` pour paginer).
 */
export async function listDrafts(items: CountableItem[], defaultLocale: string, opts: { limit: number; skip?: number }): Promise<{ total: number; rows: DraftRow[] }> {
  const byId = new Map(items.filter((i) => i.content && !i.error).map((i) => [i.id, i]));
  if (byId.size === 0) return { total: 0, rows: [] };
  const where = { AND: [{ instanceId: { in: [...byId.keys()] } }, stateWhere("draft", new Date())] };
  const [total, found] = await Promise.all([
    prisma.entry.count({ where }),
    prisma.entry.findMany({ where, include: { translations: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: opts.limit, skip: opts.skip ?? 0 }),
  ]);
  const rows = found.flatMap((e) => {
    const inst = byId.get(e.instanceId);
    if (!inst) return [];
    const main = e.translations.find((tr) => tr.locale === defaultLocale) ?? e.translations[0];
    return [{ id: e.id, title: main?.title ?? "", updatedAt: e.updatedAt, key: inst.key, name: inst.name, icon: inst.icon }];
  });
  return { total, rows };
}

/** Entrées publiées ou brouillons rangés dans une extension SANS liste (ou en erreur, ou retirée) : elles ne sont pas comptées, mais on peut dire où elles sont. */
export async function unlistedEntries(items: CountableItem[]): Promise<{ total: number; parts: { name: string; n: number }[] }> {
  const listable = items.filter((i) => i.content && !i.error).map((i) => i.id);
  const rows = await prisma.entry.groupBy({ by: ["instanceId"], where: { instanceId: { notIn: listable } }, _count: { _all: true } });
  const names = new Map(items.map((i) => [i.id, i.name]));
  const parts = rows.map((r) => ({ name: names.get(r.instanceId) ?? "", n: r._count._all }));
  return { total: parts.reduce((s, p) => s + p.n, 0), parts };
}
