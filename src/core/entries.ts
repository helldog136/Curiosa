import type { Entry, EntryTranslation } from "@prisma/client";
import { prisma } from "./db";
import { getCollectionByKey, listCollections, type CollectionView } from "./collections";
import { getSiteConfig } from "./settings";

export type EntryView = {
  id: string;
  collectionId: string;
  collectionKey: string;
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
  collection: CollectionView,
  locale: string,
  defaultLocale: string,
): { tr: EntryTranslation; isFallback: boolean } | undefined {
  const exact = entry.translations.find((t) => t.locale === locale);
  if (exact) return { tr: exact, isFallback: false };
  if (!collection.fallbackToDefault) return undefined;
  const fb =
    entry.translations.find((t) => t.locale === defaultLocale) ??
    entry.translations.find((t) => t.locale === entry.sourceLocale) ??
    entry.translations[0];
  return fb ? { tr: fb, isFallback: true } : undefined;
}

function toView(
  entry: EntryWithTr,
  collection: CollectionView,
  picked: { tr: EntryTranslation; isFallback: boolean },
): EntryView {
  return {
    id: entry.id,
    collectionId: entry.collectionId,
    collectionKey: collection.key,
    basePath: collection.basePath,
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
  collection: string | CollectionView;
  locale: string;
  limit?: number;
  offset?: number;
}): Promise<EntryView[]> {
  const collection =
    typeof opts.collection === "string" ? await getCollectionByKey(opts.collection) : opts.collection;
  if (!collection) return [];
  const { defaultLocale } = await getSiteConfig();
  const rows = await prisma.entry.findMany({
    where: { collectionId: collection.id, ...publishedWhere() },
    include: { translations: true },
    orderBy: [{ featured: "desc" }, { position: "asc" }, { publishedAt: "desc" }],
  });
  const views: EntryView[] = [];
  for (const row of rows) {
    const picked = pickTranslation(row, collection, opts.locale, defaultLocale);
    if (picked) views.push(toView(row, collection, picked));
  }
  // Les offres expirées passent après les autres sans disparaître.
  views.sort((a, b) => Number(a.expired) - Number(b.expired));
  const start = opts.offset ?? 0;
  return opts.limit ? views.slice(start, start + opts.limit) : views.slice(start);
}

export type EntryLookup =
  | { kind: "found"; entry: EntryView }
  /** Le slug existe dans une autre langue : rediriger vers la bonne URL. */
  | { kind: "other-locale"; locale: string; slug: string }
  | { kind: "missing" };

export async function findEntryBySlug(
  collection: CollectionView,
  locale: string,
  slug: string,
): Promise<EntryLookup> {
  const { defaultLocale } = await getSiteConfig();
  const hit = await prisma.entryTranslation.findFirst({
    where: {
      collectionId: collection.id,
      slug,
      locale,
      entry: publishedWhere(),
    },
    include: { entry: { include: { translations: true } } },
  });
  if (hit) {
    const picked = pickTranslation(hit.entry, collection, locale, defaultLocale);
    if (picked) return { kind: "found", entry: toView(hit.entry, collection, picked) };
  }
  // Même slug dans une autre langue ? On redirige vers la version adaptée.
  const other = await prisma.entryTranslation.findFirst({
    where: { collectionId: collection.id, slug, entry: publishedWhere() },
    include: { entry: { include: { translations: true } } },
  });
  if (other) {
    const picked = pickTranslation(other.entry, collection, locale, defaultLocale);
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
  const collection = (await listCollections()).find((c) => c.id === row.collectionId);
  if (!collection) return undefined;
  const { defaultLocale } = await getSiteConfig();
  const picked = pickTranslation(row, collection, locale, defaultLocale);
  return picked ? toView(row, collection, picked) : undefined;
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
  collectionId: string,
  locale: string,
  wanted: string,
  ignoreEntryId?: string,
): Promise<string> {
  const base = wanted || "entry";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.entryTranslation.findFirst({
      where: { collectionId, locale, slug: candidate, ...(ignoreEntryId ? { NOT: { entryId: ignoreEntryId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}
