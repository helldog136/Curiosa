import type { Prisma } from "@prisma/client";

/**
 * ORDRE D'AFFICHAGE d'une collection (blog, codes promo, sponsors, liens…). Réglage de chaque instance, par défaut « du plus récent au plus ancien »
 * (sauf une liste de LIENS, qui garde l'ordre dans lequel on les a saisis). Une entrée « mise en avant » passe toujours devant.
 */
export const SORTS = ["newest", "oldest", "title", "manual"] as const;
export type EntrySort = (typeof SORTS)[number];

export const sortSettingKey = (instanceId: string) => `instance.${instanceId}.__sort`;
export const isSort = (v: unknown): v is EntrySort => (SORTS as readonly string[]).includes(String(v));
export const defaultSort = (display: string): EntrySort => (display === "links" ? "manual" : "newest");
export const effectiveSort = (stored: unknown, display: string): EntrySort => (isSort(stored) ? stored : defaultSort(display));

/** Tri fait par la base. « title » (par titre, dans la langue demandée) se fait ensuite, voir `sortByTitle`. */
export function orderBy(sort: EntrySort): Prisma.EntryOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest": return [{ featured: "desc" }, { publishedAt: "asc" }, { createdAt: "asc" }];
    case "manual": return [{ featured: "desc" }, { position: "asc" }, { createdAt: "asc" }];
    case "title": return [{ featured: "desc" }, { publishedAt: "desc" }];
    default: return [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }];
  }
}

/** Tri par titre (A → Z, selon la langue du visiteur), les entrées mises en avant d'abord. */
export function sortByTitle<T extends { title: string; featured: boolean }>(items: T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...items].sort((a, b) => Number(b.featured) - Number(a.featured) || collator.compare(a.title, b.title));
}
