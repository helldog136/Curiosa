import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { pickDescription, pickName, type InstanceView } from "@/core/instances";
import { getActiveInstances, type ActiveInstance } from "@/core/modules/registry";
import { RESERVED_PATHS, siteUrl } from "@/core/config";
import { pickLogo } from "@/core/logos";
import { breadcrumbDocument, jsonLd, languageAlternates, pageUrl, socialMeta, type BreadcrumbItem } from "@/core/seo";
import { entryPath, findEntryBySlug, listEntries, type EntryView } from "@/core/content/entries";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { resolveRedirect } from "@/core/redirects";
import { filterEntryBody, runPage, runSlot } from "@/core/modules/runtime";
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
  | { kind: "list"; active: ActiveInstance }
  | { kind: "entry"; active: ActiveInstance; slug: string }
  | { kind: "module"; active: ActiveInstance; segments: string[] }
  | { kind: "go"; instanceKey: string; slug: string }
  | { kind: "redirect"; path: string }
  | { kind: "none" };

/**
 * Ordre de résolution d'une URL : /go/<instance>/<entrée>, instance montée sur ce
 * chemin (page propre au module, sinon liste + entrées du cœur), redirections
 * externes autorisées, enfin la page d'une instance montée à la racine.
 */
async function resolve(segments: string[]): Promise<Resolved> {
  const segs = segments.map((s) => decodeURIComponent(s).toLowerCase());
  const first = segs[0] ?? "";
  if (first === "go" && segs.length === 3) return { kind: "go", instanceKey: segs[1]!, slug: segs[2]! };
  if (RESERVED_PATHS.has(first)) return { kind: "none" };

  const mounted = (await getActiveInstances()).filter((a) => a.instance.basePath !== null);
  const serve = (active: ActiveInstance, rest: string[], root: boolean): Resolved => {
    if (active.mod.def.page) return { kind: "module", active, segments: rest };
    if (!active.mod.manifest.content) return { kind: "none" };
    if (root) return rest.length === 1 ? { kind: "entry", active, slug: rest[0]! } : { kind: "none" };
    if (rest.length === 0) return { kind: "list", active };
    return rest.length === 1 ? { kind: "entry", active, slug: rest[0]! } : { kind: "none" };
  };

  const byBase = mounted.find((a) => a.instance.basePath && a.instance.basePath === first);
  if (byBase) return serve(byBase, segs.slice(1), false);

  if (await prisma.redirect.findUnique({ where: { path: segs.join("/") }, select: { id: true } })) {
    return { kind: "redirect", path: segs.join("/") };
  }
  const root = mounted.find((a) => a.instance.basePath === "");
  return root ? serve(root, segs, true) : { kind: "none" };
}

function prefixed(path: string, locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? path : `/${locale}${path}`;
}

/** Adresse canonique, partage (Open Graph + Twitter) et titre d'une page, tous cohérents entre eux. */
function pageMeta(opts: { siteName: string; title: string; description?: string; image?: string | null; canonical: string; locale: string; type?: "website" | "article"; languages?: Record<string, string> }): Metadata {
  return {
    title: opts.title,
    description: opts.description || undefined,
    alternates: { canonical: opts.canonical, ...(opts.languages ? { languages: opts.languages } : {}) },
    ...socialMeta({ siteName: opts.siteName, title: opts.title, description: opts.description || undefined, image: opts.image, url: opts.canonical, type: opts.type, locale: opts.locale }),
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const resolved = await resolve(path);
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const site = await getSiteConfig();
  const share = pickLogo(config.logos, "share", false);
  const all = (p: string) => languageAlternates(siteUrl, site.locales, locale, site.defaultLocale, p);
  if (resolved.kind === "list") {
    const { instance } = resolved.active;
    const alt = all("/" + path.join("/"));
    return pageMeta({ siteName: config.name, title: pickName(instance, locale, site.defaultLocale), description: pickDescription(instance, locale, site.defaultLocale), image: share, canonical: alt.canonical, languages: alt.languages, locale });
  }
  if (resolved.kind === "module") {
    const page = await runPage(resolved.active.instance.key, resolved.segments, locale);
    // Titre et description fournis par le module ; la même page existe dans les autres langues (même chemin).
    if (!page) return {};
    const alt = all("/" + path.join("/"));
    return pageMeta({ siteName: config.name, title: page.title || config.name, description: page.description, image: share, canonical: alt.canonical, languages: alt.languages, locale });
  }
  if (resolved.kind === "entry") {
    const found = await findEntryBySlug(resolved.active.instance, locale, resolved.slug);
    if (found.kind !== "found") return {};
    const e = found.entry;
    const languages = Object.fromEntries(
      e.translations.map((tr) => [
        tr.locale,
        prefixed(`${e.basePath ? `/${e.basePath}` : ""}/${tr.slug}`, tr.locale, site.defaultLocale),
      ]),
    );
    // Canonique : l'adresse de la langue réellement affichée (une page en repli de langue pointe vers la vraie version).
    const canonical = `${siteUrl}${entryPath(e, site.defaultLocale)}`;
    return pageMeta({ siteName: config.name, title: e.title, description: e.summary || undefined, image: e.cover || share, canonical, locale: e.locale, type: "article", languages: e.translations.length > 1 ? languages : undefined });
  }
  return {};
}

/** Fil d'Ariane (schema.org) : accueil > collection > page. */
function BreadcrumbLd({ items }: { items: BreadcrumbItem[] }) {
  const doc = breadcrumbDocument(items);
  return doc ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(doc) }} /> : null;
}

export default async function CatchAllPage({ params }: Props) {
  const { path } = await params;
  const resolved = await resolve(path);
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const t = makeTranslator(locale);
  const home: BreadcrumbItem = { name: config.name, url: pageUrl(siteUrl, locale, config.defaultLocale, "/") };

  switch (resolved.kind) {
    case "redirect": {
      const target = await resolveRedirect(resolved.path);
      if (!target) notFound();
      return target.permanent ? permanentRedirect(target.url) : redirect(target.url);
    }

    case "go": {
      const active = (await getActiveInstances()).find((a) => a.instance.key === resolved.instanceKey);
      if (!active || !active.instance.allowGoLinks) notFound();
      const found = await findEntryBySlug(active.instance, locale, resolved.slug);
      if (found.kind !== "found" || !isSafeExternalUrl(found.entry.url)) notFound();
      return redirect(found.entry.url!);
    }

    case "module": {
      const page = await runPage(resolved.active.instance.key, resolved.segments, locale);
      if (!page || page.notFound) notFound();
      const page_ = { key: resolved.active.instance.key, basePath: resolved.active.instance.basePath };
      const [top, bottom] = await Promise.all([runSlot("page.top", locale, { page: page_ }), runSlot("page.bottom", locale, { page: page_ })]);
      return (
        <div className="space-y-8">
          {page.title && <BreadcrumbLd items={[home, { name: page.title, url: pageUrl(siteUrl, locale, config.defaultLocale, `/${[resolved.active.instance.basePath, ...resolved.segments].filter(Boolean).join("/")}`) }]} />}
          {page.title && <h1 className="text-3xl font-bold">{page.title}</h1>}
          <Blocks blocks={top} locale={locale} />
          <Blocks blocks={page.blocks} locale={locale} />
          <Blocks blocks={bottom} locale={locale} />
        </div>
      );
    }

    case "list": {
      const { instance } = resolved.active;
      const entries = await listEntries({ instance, locale });
      const description = pickDescription(instance, locale, config.defaultLocale);
      const page = { key: instance.key, basePath: instance.basePath };
      const [top, bottom] = await Promise.all([runSlot("page.top", locale, { page }), runSlot("page.bottom", locale, { page })]);
      return (
        <div className="space-y-8">
          <BreadcrumbLd items={[home, { name: pickName(instance, locale, config.defaultLocale), url: pageUrl(siteUrl, locale, config.defaultLocale, `/${instance.basePath}`) }]} />
          <header className="space-y-2">
            <h1 className="text-3xl font-bold">{pickName(instance, locale, config.defaultLocale)}</h1>
            {description && <p className="text-muted">{description}</p>}
          </header>
          <Blocks blocks={top} locale={locale} />
          <EntryList entries={entries} collection={instance} locale={locale} defaultLocale={config.defaultLocale} />
          <Blocks blocks={bottom} locale={locale} />
        </div>
      );
    }

    case "entry": {
      const { instance } = resolved.active;
      const found = await findEntryBySlug(instance, locale, resolved.slug);
      if (found.kind === "missing") notFound();
      if (found.kind === "other-locale") {
        const target = `${instance.basePath ? `/${instance.basePath}` : ""}/${found.slug}`;
        return redirect(prefixed(target, found.locale, config.defaultLocale));
      }
      return <EntryPage entry={found.entry} instance={instance} locale={locale} t={t} crumbs={[home, ...(instance.basePath ? [{ name: pickName(instance, locale, config.defaultLocale), url: pageUrl(siteUrl, locale, config.defaultLocale, `/${instance.basePath}`) }] : []), { name: found.entry.title, url: `${siteUrl}${entryPath(found.entry, config.defaultLocale)}` }]} />;
    }

    case "none":
      notFound();
  }
}

async function EntryPage({
  entry, instance, locale, t, crumbs,
}: {
  crumbs: BreadcrumbItem[];
  entry: EntryView;
  instance: InstanceView;
  locale: string;
  t: ReturnType<typeof makeTranslator>;
}) {
  const extras = { page: { key: instance.key, basePath: instance.basePath }, entry: { id: entry.id, title: entry.title, slug: entry.slug } };
  const [top, bottom, body] = await Promise.all([
    runSlot("entry.top", locale, extras),
    runSlot("entry.bottom", locale, extras),
    filterEntryBody(entry.body, locale, extras),
  ]);
  const customFields = instance.fieldSchema.filter((f) => f.type !== "ref" && entry.fields[f.key] !== undefined && entry.fields[f.key] !== "");

  return (
    <article lang={entry.locale} className="mx-auto max-w-3xl space-y-6">
      <BreadcrumbLd items={crumbs} />
      {entry.isFallback && (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">{t("site.fallbackNotice", { lang: entry.locale.toUpperCase() })}</p>
      )}
      {entry.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.cover} alt="" className="aspect-video w-full rounded-xl object-cover" />
      )}
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold"><EntryIcon icon={entry.icon} className="h-7 w-7" />{entry.title}</h1>
        {instance.display !== "links" && entry.publishedAt && (
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
