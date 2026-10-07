import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { pickDescription, pickName, type InstanceView } from "@/core/instances";
import { getActiveInstances, type ActiveInstance } from "@/core/modules/registry";
import { RESERVED_PATHS } from "@/core/config";
import { findEntryBySlug, listEntries, type EntryView } from "@/core/entries";
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const resolved = await resolve(path);
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  if (resolved.kind === "list") return { title: pickName(resolved.active.instance, locale, config.defaultLocale) };
  if (resolved.kind === "module") {
    const page = await runPage(resolved.active.instance.key, resolved.segments, locale);
    return page ? { title: page.title, description: page.description } : {};
  }
  if (resolved.kind === "entry") {
    const found = await findEntryBySlug(resolved.active.instance, locale, resolved.slug);
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
      return <EntryPage entry={found.entry} instance={instance} locale={locale} t={t} />;
    }

    case "none":
      notFound();
  }
}

async function EntryPage({
  entry, instance, locale, t,
}: {
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
  const customFields = instance.fieldSchema.filter((f) => entry.fields[f.key] !== undefined && entry.fields[f.key] !== "");

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
