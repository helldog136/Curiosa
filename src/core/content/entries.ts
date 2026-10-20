import type { Entry, EntryTranslation, Prisma } from "@prisma/client";
import { prisma } from "@/core/db";
import { getInstanceByKey, listInstances, type InstanceView } from "@/core/instances";
import { getSetting, getSiteConfig } from "@/core/settings";
import { effectiveSort, orderBy, sortByTitle, sortSettingKey } from "./sort";

export type EntryView = {
  id: string;
  instanceId: string;
  instanceKey: string;
  basePath: string;
  slug: string;
  /** Langue réellement affichée (peut différer de celle demandée). */
  locale: string;
  isFallback: boolean;
  title: string;
  summary: string;
  body: string;
  cover: string | null;
  icon: string | null;
  url: string | null;
  code: string | null;
  featured: boolean;
  tags: string[];
  expired: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  fields: Record<string, unknown>;
  /** Langues dans lesquelles cette entrée existe (pour hreflang et le sélecteur). */
  availableLocales: string[];
  /** Slug de chaque version, pour construire les liens hreflang. */
  translations: { locale: string; slug: string }[];
};

type EntryWithTr = Entry & { translations: EntryTranslation[] };

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Choisit la traduction à afficher, ou undefined si l'entrée n'existe pas dans cette langue. */
function pickTranslation(
  entry: EntryWithTr,
  instance: InstanceView,
  locale: string,
  defaultLocale: string,
): { tr: EntryTranslation; isFallback: boolean } | undefined {
  const exact = entry.translations.find((t) => t.locale === locale);
  if (exact) return { tr: exact, isFallback: false };
  if (!instance.fallbackToDefault) return undefined;
  const fb =
    entry.translations.find((t) => t.locale === defaultLocale) ??
    entry.translations.find((t) => t.locale === entry.sourceLocale) ??
    entry.translations[0];
  return fb ? { tr: fb, isFallback: true } : undefined;
}

function toView(
  entry: EntryWithTr,
  instance: InstanceView,
  picked: { tr: EntryTranslation; isFallback: boolean },
): EntryView {
  return {
    id: entry.id,
    instanceId: entry.instanceId,
    instanceKey: instance.key,
    basePath: instance.basePath ?? "",
    slug: picked.tr.slug,
    locale: picked.tr.locale,
    isFallback: picked.isFallback,
    title: picked.tr.title,
    summary: picked.tr.summary,
    body: picked.tr.body,
    cover: entry.cover,
    icon: entry.icon,
    url: entry.url,
    code: entry.code,
    featured: entry.featured,
    tags: parseTags(entry.tags),
    expired: !!entry.expiresAt && entry.expiresAt.getTime() < Date.now(),
    publishedAt: entry.publishedAt,
    expiresAt: entry.expiresAt,
    fields: parseFields(entry.fields),
    availableLocales: entry.translations.map((t) => t.locale),
    translations: entry.translations.map((t) => ({ locale: t.locale, slug: t.slug })),
  };
}

const publishedWhere = () => ({ status: "published", publishedAt: { lte: new Date() } });

export async function listEntries(opts: {
  instance: string | InstanceView;
  locale: string;
  limit?: number;
  offset?: number;
}): Promise<EntryView[]> {
  const instance =
    typeof opts.instance === "string" ? await getInstanceByKey(opts.instance) : opts.instance;
  if (!instance) return [];
  const { defaultLocale } = await getSiteConfig();
  const sort = effectiveSort(await getSetting(sortSettingKey(instance.id)), instance.display);
  const rows = await prisma.entry.findMany({
    where: { instanceId: instance.id, ...publishedWhere() },
    include: { translations: true },
    orderBy: orderBy(sort),
  });
  const views: EntryView[] = [];
  for (const row of rows) {
    const picked = pickTranslation(row, instance, opts.locale, defaultLocale);
    if (picked) views.push(toView(row, instance, picked));
  }
  // Les offres expirées passent après les autres sans disparaître.
  const ordered = sort === "title" ? sortByTitle(views, opts.locale) : views;
  ordered.sort((a, b) => Number(a.expired) - Number(b.expired));
  const start = opts.offset ?? 0;
  return opts.limit ? ordered.slice(start, start + opts.limit) : ordered.slice(start);
}

/** Articles par page sur le site public. */
export const PER_PAGE = 12;
/** Plafond dur d'une page (site, administration, outils) : aucune page n'est jamais plus grosse. */
export const MAX_PER_PAGE = 50;
/** Le tri par titre se fait en mémoire : au-delà de ce nombre d'entrées visibles, il retombe sur « plus récent d'abord ». */
export const TITLE_SORT_MAX = 5000;

export type EntriesPage = {
  items: EntryView[];
  /** Page demandée (entier >= 1). Peut dépasser `pages` : `items` est alors vide, c'est à l'appelant de répondre « introuvable ». */
  page: number;
  /** Nombre de pages (au moins 1, même sans entrée). */
  pages: number;
  total: number;
  perPage: number;
  /** Vrai si le tri par titre demandé a été remplacé par « plus récent d'abord » (trop d'entrées pour un tri en mémoire). */
  titleSortCapped: boolean;
};

/**
 * Entrées visibles dans cette langue, exactement comme `pickTranslation` : une traduction dans la langue demandée ; sinon (repli de langue activé)
 * n'importe quelle traduction, car le repli en trouve toujours une dès que l'entrée en a une.
 */
export const languageWhere = (instance: Pick<InstanceView, "fallbackToDefault">, locale: string): Prisma.EntryWhereInput => ({
  translations: { some: instance.fallbackToDefault ? {} : { locale } },
});
const freshWhere = (now: Date): Prisma.EntryWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] });
const staleWhere = (now: Date): Prisma.EntryWhereInput => ({ expiresAt: { lt: now } });

/**
 * Une page de la liste publique. Tri par date / à la main : la pagination est faite par la base (un `count`, puis `skip/take` sur les entrées non
 * expirées, puis sur les expirées qui passent à la fin) ; jamais de lecture complète. Tri par titre : en mémoire, borné à `TITLE_SORT_MAX`.
 */
export async function listEntriesPage(opts: {
  instance: string | InstanceView;
  locale: string;
  page: number;
  perPage?: number;
}): Promise<EntriesPage> {
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(opts.perPage ?? PER_PAGE) || PER_PAGE));
  const page = Number.isFinite(opts.page) && opts.page >= 1 ? Math.trunc(opts.page) : 1;
  const empty: EntriesPage = { items: [], page, pages: 1, total: 0, perPage, titleSortCapped: false };
  const instance = typeof opts.instance === "string" ? await getInstanceByKey(opts.instance) : opts.instance;
  if (!instance) return empty;
  const { defaultLocale } = await getSiteConfig();
  let sort = effectiveSort(await getSetting(sortSettingKey(instance.id)), instance.display);
  const base: Prisma.EntryWhereInput = { instanceId: instance.id, ...publishedWhere(), ...languageWhere(instance, opts.locale) };
  let titleSortCapped = false;

  if (sort === "title") {
    if ((await prisma.entry.count({ where: base })) <= TITLE_SORT_MAX) {
      const all = await listEntries({ instance, locale: opts.locale });
      const start = (page - 1) * perPage;
      return { items: all.slice(start, start + perPage), page, pages: Math.max(1, Math.ceil(all.length / perPage)), total: all.length, perPage, titleSortCapped };
    }
    sort = "newest";
    titleSortCapped = true;
  }

  const now = new Date();
  const freshAll: Prisma.EntryWhereInput = { AND: [base, freshWhere(now)] };
  const staleAll: Prisma.EntryWhereInput = { AND: [base, staleWhere(now)] };
  const [fresh, stale] = [await prisma.entry.count({ where: freshAll }), await prisma.entry.count({ where: staleAll })];
  const total = fresh + stale;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (page > pages) return { items: [], page, pages, total, perPage, titleSortCapped };

  const order = [...orderBy(sort), { id: "desc" as const }];
  const start = (page - 1) * perPage;
  const rows: EntryWithTr[] = [];
  const takeFresh = Math.max(0, Math.min(perPage, fresh - start));
  if (takeFresh > 0) rows.push(...(await prisma.entry.findMany({ where: freshAll, include: { translations: true }, orderBy: order, skip: start, take: takeFresh })));
  const takeStale = perPage - takeFresh;
  if (takeStale > 0 && stale > 0) rows.push(...(await prisma.entry.findMany({ where: staleAll, include: { translations: true }, orderBy: order, skip: Math.max(0, start - fresh), take: takeStale })));
  const items: EntryView[] = [];
  for (const row of rows) {
    const picked = pickTranslation(row, instance, opts.locale, defaultLocale);
    if (picked) items.push(toView(row, instance, picked));
  }
  return { items, page, pages, total, perPage, titleSortCapped };
}

/**
 * Les `limit` dernières entrées (au plus 100), du plus récent au plus ancien, quel que soit le tri choisi pour l'instance. Triées par la base :
 * jamais de lecture complète. Les entrées expirées sont écartées sauf `includeExpired`.
 */
export async function latestEntries(opts: { instance: InstanceView; locale: string; limit: number; includeExpired?: boolean }): Promise<EntryView[]> {
  const take = Math.min(100, Math.max(1, Math.trunc(opts.limit) || 1));
  const { defaultLocale } = await getSiteConfig();
  const where: Prisma.EntryWhereInput = { instanceId: opts.instance.id, ...publishedWhere(), ...languageWhere(opts.instance, opts.locale), ...(opts.includeExpired ? {} : freshWhere(new Date())) };
  const rows = await prisma.entry.findMany({ where, include: { translations: true }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take });
  const views: EntryView[] = [];
  for (const row of rows) {
    const picked = pickTranslation(row, opts.instance, opts.locale, defaultLocale);
    if (picked) views.push(toView(row, opts.instance, picked));
  }
  return views;
}

/** Curseur opaque `publishedAt|id` (voir `entriesAfter`). */
export const encodeEntryCursor = (e: { publishedAt: Date | null; id: string }): string =>
  Buffer.from(`${e.publishedAt?.getTime() ?? 0}|${e.id}`, "utf8").toString("base64url");
export function decodeEntryCursor(raw: string | null | undefined): { publishedAt: Date; id: string } | null {
  if (!raw || raw.length > 200) return null;
  const m = /^(\d{1,15})\|([\w-]{1,64})$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  return m ? { publishedAt: new Date(Number(m[1])), id: m[2]! } : null;
}

/**
 * Lecture par curseur, du plus récent au plus ancien (date, puis identifiant), entrées non expirées seulement : au plus `limit` lignes (200 au plus)
 * après le curseur. `more` dit s'il en reste. Un curseur illisible lève une erreur claire (jamais « tout depuis le début » en silence).
 */
export async function entriesAfter(opts: { instance: InstanceView; locale: string; limit: number; cursor?: string | null }): Promise<{ rows: { view: EntryView; cursor: string }[]; more: boolean }> {
  const take = Math.min(200, Math.max(1, Math.trunc(opts.limit) || 1));
  const after = opts.cursor ? decodeEntryCursor(opts.cursor) : null;
  if (opts.cursor && !after) throw new Error("invalid cursor");
  const { defaultLocale } = await getSiteConfig();
  const and: Prisma.EntryWhereInput[] = [{ instanceId: opts.instance.id, ...publishedWhere(), ...languageWhere(opts.instance, opts.locale) }, freshWhere(new Date())];
  if (after) and.push({ OR: [{ publishedAt: { lt: after.publishedAt } }, { publishedAt: after.publishedAt, id: { lt: after.id } }] });
  const found = await prisma.entry.findMany({ where: { AND: and }, include: { translations: true }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: take + 1 });
  const rows: { view: EntryView; cursor: string }[] = [];
  for (const row of found.slice(0, take)) {
    const picked = pickTranslation(row, opts.instance, opts.locale, defaultLocale);
    if (picked) rows.push({ view: toView(row, opts.instance, picked), cursor: encodeEntryCursor(row) });
  }
  return { rows, more: found.length > take };
}

export type EntryLookup =
  | { kind: "found"; entry: EntryView }
  /** Le slug existe dans une autre langue : rediriger vers la bonne URL. */
  | { kind: "other-locale"; locale: string; slug: string }
  | { kind: "missing" };

export async function findEntryBySlug(
  instance: InstanceView,
  locale: string,
  slug: string,
): Promise<EntryLookup> {
  const { defaultLocale } = await getSiteConfig();
  const hit = await prisma.entryTranslation.findFirst({
    where: {
      instanceId: instance.id,
      slug,
      locale,
      entry: publishedWhere(),
    },
    include: { entry: { include: { translations: true } } },
  });
  if (hit) {
    const picked = pickTranslation(hit.entry, instance, locale, defaultLocale);
    if (picked) return { kind: "found", entry: toView(hit.entry, instance, picked) };
  }
  // Même slug dans une autre langue ? On redirige vers la version adaptée.
  const other = await prisma.entryTranslation.findFirst({
    where: { instanceId: instance.id, slug, entry: publishedWhere() },
    include: { entry: { include: { translations: true } } },
  });
  if (other) {
    const picked = pickTranslation(other.entry, instance, locale, defaultLocale);
    if (picked) return { kind: "other-locale", locale: picked.tr.locale, slug: picked.tr.slug };
  }
  return { kind: "missing" };
}

export async function findEntryById(id: string, locale: string): Promise<EntryView | undefined> {
  const row = await prisma.entry.findFirst({
    where: { id, ...publishedWhere() },
    include: { translations: true },
  });
  if (!row) return undefined;
  const instance = (await listInstances()).find((c) => c.id === row.instanceId);
  if (!instance) return undefined;
  const { defaultLocale } = await getSiteConfig();
  const picked = pickTranslation(row, instance, locale, defaultLocale);
  return picked ? toView(row, instance, picked) : undefined;
}

/** URL publique d'une entrée dans sa langue d'affichage. */
export function entryPath(
  entry: Pick<EntryView, "basePath" | "slug" | "locale">,
  defaultLocale: string,
): string {
  const prefix = entry.locale === defaultLocale ? "" : `/${entry.locale}`;
  return `${prefix}${entry.basePath ? `/${entry.basePath}` : ""}/${entry.slug}`;
}

export async function uniqueSlug(
  db: Pick<typeof prisma, "entryTranslation">,
  instanceId: string,
  locale: string,
  wanted: string,
  ignoreEntryId?: string,
): Promise<string> {
  const base = wanted || "entry";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.entryTranslation.findFirst({
      where: { instanceId, locale, slug: candidate, ...(ignoreEntryId ? { NOT: { entryId: ignoreEntryId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}
