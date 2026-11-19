import { prisma } from "@/core/db";
import { entryHref } from "@/core/adminLinks";
import { getInstanceLabeler } from "@/core/modules/labels";
import { getActiveInstances } from "@/core/modules/registry";
import type { SearchEntry } from "@/core/modules/placeSearch";
import { caseVariants, cleanQuery } from "./adminList";

/** Content results of the global search: titles only, at most this many, so the answer stays small whatever the size of the site. */
export const CONTENT_SEARCH_LIMIT = 20;

/**
 * (core 0.41.0) Entries whose title or address contains the typed text, across every extension that has a content list, as search results that open the editor.
 * Bounded (20), titles only (never the body), and only for people who may open the entries list (the caller checks the "editor" role). An empty search finds nothing.
 */
export async function searchContentEntries(raw: unknown, locale: string, defaultLocale: string): Promise<SearchEntry[]> {
  const q = cleanQuery(raw);
  if (!q) return [];
  const actives = (await getActiveInstances()).filter((a) => a.mod.manifest.content);
  if (actives.length === 0) return [];
  const byId = new Map(actives.map((a) => [a.instance.id, a.instance]));
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const terms = caseVariants(q);
  const rows = await prisma.entry.findMany({
    where: { instanceId: { in: [...byId.keys()] }, translations: { some: { OR: terms.flatMap((t) => [{ title: { contains: t } }, { slug: { contains: t } }]) } } },
    include: { translations: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: CONTENT_SEARCH_LIMIT,
  });
  return rows.flatMap((e) => {
    const inst = byId.get(e.instanceId);
    if (!inst) return [];
    const main = e.translations.find((tr) => tr.locale === defaultLocale) ?? e.translations[0];
    const name = labeler.label(inst);
    return [{ id: `entry.${e.id}`, kind: "entry" as const, title: main?.title || "—", sectionTitle: name, moduleId: inst.key, moduleName: name, breadcrumb: name, place: "", href: entryHref(e.id), advanced: false, modified: false }];
  });
}
