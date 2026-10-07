import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { listCollections, pickDescription, pickName, type CollectionView } from "@/core/collections";
import { RESERVED_PATHS } from "@/core/config";
import { findEntryBySlug, listEntries, type EntryView } from "@/core/entries";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { resolveRedirect } from "@/core/redirects";
import { filterEntryBody, runSlot } from "@/core/modules/runtime";
import { getSiteConfig } from "@/core/settings";
import { prisma } from "@/core/db";
import { isSafeExternalUrl } from "@/core/url";
import { Blocks } from "@/components/site/Blocks";
import { CopyCode } from "@/components/site/CopyCode";
import { EntryIcon } from "@/components/site/EntryIcon";
import { EntryList } from "@/components/site/EntryList";
import { Markdown } from "@/components/site/Markdown";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ path: string[] }> };

type Resolved =
  | { kind: "list"; collection: CollectionView }
  | { kind: "entry"; collection: CollectionView; slug: string }
  | { kind: "go"; collectionKey: string; slug: string }
  | { kind: "redirect"; path: string }
  | { kind: "none" };

/**
 * Ordre de résolution d'une URL : /go/<collection>/<slug>, redirections
 * externes autorisées, collection (liste ou entrée), page à la racine.
 */
async function resolve(segments: string[]): Promise<Resolved> {
  const segs = segments.map((s) => decodeURIComponent(s).toLowerCase());
  const first = segs[0] ?? "";
  if (first === "go" && segs.length === 3) return { kind: "go", collectionKey: segs[1]!, slug: segs[2]! };
  if (!RESERVED_PATHS.has(first)) {
    const collections = (await listCollections()).filter((c) => c.published);
    const byBase = collections.find((c) => c.basePath && c.basePath === first);
    if (byBase) {
      if (segs.length === 1) return { kind: "list", collection: byBase };
      if (segs.length === 2) return { kind: "entry", collection: byBase, slug: segs[1]! };
    }
    if (await prisma.redirect.findUnique({ where: { path: segs.join("/") }, select: { id: true } })) {
      return { kind: "redirect", path: segs.join("/") };
    }
    const root = collections.find((c) => c.basePath === "");
    if (root && segs.length === 1) return { kind: "entry", collection: root, slug: segs[0]! };
  }
  return { kind: "none" };
}

function prefixed(path: string, locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? path : `/${locale}${path}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const resolved = await resolve(path);
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  if (resolved.kind === "list") return { title: pickName(resolved.collection, locale, config.defaultLocale) };
  if (resolved.kind === "entry") {
    const found = await findEntryBySlug(resolved.collection, locale, resolved.slug);
    if (found.kind !== "found") return {};
    const e = found.entry;
    const languages = Object.fromEntries(
      e.translations.map((tr) => [
        tr.locale,
        prefixed(`${e.basePath ? `/${e.basePath}` : ""}/${tr.slug}`, tr.locale, config.defaultLocale),
      ]),
    );
    return {
      title: e.title,
      description: e.summary || undefined,
      openGraph: { title: e.title, description: e.summary || undefined, images: e.cover ? [e.cover] : undefined, type: "article" },
      alternates: e.translations.length > 1 ? { languages } : undefined,
    };
  }
  return {};
}

export default async function CatchAllPage({ params }: Props) {
  const { path } = await params;
  const resolved = await resolve(path);
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const t = makeTranslator(locale);

  switch (resolved.kind) {
    case "redirect": {
      const target = await resolveRedirect(resolved.path);
      if (!target) notFound();
      return target.permanent ? permanentRedirect(target.url) : redirect(target.url);
    }

    case "go": {
      const collection = (await listCollections()).find((c) => c.key === resolved.collectionKey);
      if (!collection || !collection.allowGoLinks || !collection.published) notFound();
      const found = await findEntryBySlug(collection, locale, resolved.slug);
      if (found.kind !== "found" || !isSafeExternalUrl(found.entry.url)) notFound();
      return redirect(found.entry.url!);
    }

    case "list": {
      const { collection } = resolved;
      const entries = await listEntries({ collection, locale });
      const description = pickDescription(collection, locale, config.defaultLocale);
      const [top, bottom] = await Promise.all([
        runSlot("collection.top", locale, { collection: { key: collection.key, basePath: collection.basePath } }),
        runSlot("collection.bottom", locale, { collection: { key: collection.key, basePath: collection.basePath } }),
      ]);
      return (
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold">{pickName(collection, locale, config.defaultLocale)}</h1>
            {description && <p className="text-muted">{description}</p>}
          </header>
          <Blocks blocks={top} locale={locale} />
          <EntryList entries={entries} collection={collection} locale={locale} defaultLocale={config.defaultLocale} />
          <Blocks blocks={bottom} locale={locale} />
        </div>
      );
    }

    case "entry": {
      const { collection } = resolved;
      const found = await findEntryBySlug(collection, locale, resolved.slug);
      if (found.kind === "missing") notFound();
      if (found.kind === "other-locale") {
        const target = `${collection.basePath ? `/${collection.basePath}` : ""}/${found.slug}`;
        return redirect(prefixed(target, found.locale, config.defaultLocale));
      }
      return <EntryPage entry={found.entry} collection={collection} locale={locale} t={t} />;
    }

    case "none":
      notFound();
  }
}

async function EntryPage({
  entry, collection, locale, t,
}: {
  entry: EntryView;
  collection: CollectionView;
  locale: string;
  t: ReturnType<typeof makeTranslator>;
}) {
  const extras = { collection: { key: collection.key, basePath: collection.basePath }, entry: { id: entry.id, title: entry.title, slug: entry.slug } };
  const [top, bottom, body] = await Promise.all([
    runSlot("entry.top", locale, extras),
    runSlot("entry.bottom", locale, extras),
    filterEntryBody(entry.body, locale, extras),
  ]);
  const customFields = collection.fieldSchema.filter((f) => entry.fields[f.key] !== undefined && entry.fields[f.key] !== "");

  return (
    <article lang={entry.locale} className="mx-auto max-w-3xl space-y-6">
      {entry.isFallback && (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">{t("site.fallbackNotice", { lang: entry.locale.toUpperCase() })}</p>
      )}
      {entry.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.cover} alt="" className="aspect-video w-full rounded-xl object-cover" />
      )}
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold"><EntryIcon icon={entry.icon} className="h-7 w-7" />{entry.title}</h1>
        {collection.display !== "links" && entry.publishedAt && (
          <time className="text-sm text-muted" dateTime={entry.publishedAt.toISOString()}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(entry.publishedAt)}
          </time>
        )}
        {entry.summary && <p className="text-lg text-muted">{entry.summary}</p>}
      </header>

      {(entry.code || isSafeExternalUrl(entry.url)) && (
        <div className="flex flex-wrap items-center gap-4">
          {entry.code && <CopyCode code={entry.code} copyLabel={t("site.copy")} copiedLabel={t("site.copied")} />}
          {isSafeExternalUrl(entry.url) && (
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-fg">
              {t("site.visit")}
            </a>
          )}
          {entry.expiresAt && (
            <span className="text-sm text-muted">
              {entry.expired ? t("site.expired") : t("site.expiresOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(entry.expiresAt) })}
            </span>
          )}
        </div>
      )}

      <Blocks blocks={top} locale={locale} />
      {body && <Markdown text={body} />}
      {customFields.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          {customFields.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd>{String(entry.fields[f.key])}</dd>
            </div>
          ))}
        </dl>
      )}
      <Blocks blocks={bottom} locale={locale} />
    </article>
  );
}
