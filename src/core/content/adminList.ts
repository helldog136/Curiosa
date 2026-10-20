import type { Entry, EntryTranslation, Prisma } from "@prisma/client";
import { prisma } from "@/core/db";
import type { InstanceView } from "@/core/instances";
import { getSetting } from "@/core/settings";
import { MAX_PER_PAGE, TITLE_SORT_MAX } from "./entries";
import { effectiveSort, orderBy, sortByTitle, sortSettingKey, type EntrySort } from "./sort";

/** Entrées par page dans l'administration, et longueur maximale de la recherche. */
export const ADMIN_PER_PAGE = 50;
export const SEARCH_MAX = 100;

export const ADMIN_STATES = ["all", "published", "draft", "scheduled", "expired"] as const;
export type AdminState = (typeof ADMIN_STATES)[number];
export const parseAdminState = (raw: unknown): AdminState => ((ADMIN_STATES as readonly string[]).includes(String(raw)) ? (raw as AdminState) : "all");

/** Recherche nettoyée : espaces superflus retirés, 100 caractères au plus ; vide = pas de recherche. */
export const cleanQuery = (raw: unknown): string => (typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX) : "");

/**
 * SQLite ne compare sans tenir compte de la casse QUE pour A–Z (son `LIKE`) : « été » ne trouve pas « Été ». On cherche donc aussi la saisie en minuscules,
 * en majuscules et avec une majuscule initiale (les cas courants). Les accents eux-mêmes restent significatifs.
 */
export function caseVariants(q: string): string[] {
  const lower = q.toLocaleLowerCase();
  const capital = lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
  const words = lower.replace(/(^|[\s'’-])(\S)/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase());
  return [...new Set([q, lower, q.toLocaleUpperCase(), capital, words])];
}

const stateWhere = (state: AdminState, now: Date): Prisma.EntryWhereInput => {
  switch (state) {
    case "draft": return { status: { not: "published" } };
    case "expired": return { status: "published", expiresAt: { lte: now } };
    case "scheduled": return { status: "published", publishedAt: { gt: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    case "published": return { status: "published", AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] }] };
    default: return {};
  }
};

export type AdminEntry = Entry & { translations: EntryTranslation[] };
export type AdminEntriesPage = { rows: AdminEntry[]; page: number; pages: number; total: number; perPage: number; sort: EntrySort; titleSortCapped: boolean };

/** Une page de la liste d'administration : même ordre que sur le site, recherche (titre et adresse de chaque traduction) et filtre d'état dans la requête. */
export async function listAdminEntries(opts: { instance: Pick<InstanceView, "id" | "display">; defaultLocale: string; page: number; q?: string; state?: AdminState; perPage?: number }): Promise<AdminEntriesPage> {
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, opts.perPage ?? ADMIN_PER_PAGE));
  const q = cleanQuery(opts.q);
  const and: Prisma.EntryWhereInput[] = [{ instanceId: opts.instance.id }, stateWhere(opts.state ?? "all", new Date())];
  if (q) {
    const terms = caseVariants(q);
    and.push({ translations: { some: { OR: terms.flatMap((t) => [{ title: { contains: t } }, { slug: { contains: t } }]) } } });
  }
  const where: Prisma.EntryWhereInput = { AND: and };
  let sort = effectiveSort(await getSetting(sortSettingKey(opts.instance.id)), opts.instance.display);
  const total = await prisma.entry.count({ where });
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Math.trunc(opts.page) || 1));
  const start = (page - 1) * perPage;
  let titleSortCapped = false;

  if (sort === "title") {
    if (total <= TITLE_SORT_MAX) {
      const all = await prisma.entry.findMany({ where, include: { translations: true }, orderBy: orderBy("title") });
      const view = all.map((e) => ({ e, title: (e.translations.find((t) => t.locale === opts.defaultLocale) ?? e.translations[0])?.title ?? "", featured: e.featured }));
      return { rows: sortByTitle(view, opts.defaultLocale).slice(start, start + perPage).map((v) => v.e), page, pages, total, perPage, sort, titleSortCapped };
    }
    // Trop d'entrées pour un tri en mémoire : le site retombe sur « plus récent d'abord » et l'administration le dit.
    sort = "newest";
    titleSortCapped = true;
  }
  const rows = await prisma.entry.findMany({ where, include: { translations: true }, orderBy: [...orderBy(sort), { id: "desc" }], skip: start, take: perPage });
  return { rows, page, pages, total, perPage, sort, titleSortCapped };
}
