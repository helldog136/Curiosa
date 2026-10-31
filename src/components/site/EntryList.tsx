import type { InstanceView } from "@/core/instances";
import { entryPath, type EntryView } from "@/core/content/entries";
import { makeTranslator } from "@/core/i18n/dictionary";
import { measureHref, type MeasureMap } from "@/core/redirectMeasure";
import { safeHref } from "@/core/url";
import { CopyCode } from "./CopyCode";
import { EntryIcon } from "./EntryIcon";
import { CoverImage } from "./CoverImage";

type Props = {
  entries: EntryView[];
  collection: Pick<InstanceView, "display" | "clickAction">;
  locale: string;
  defaultLocale: string;
  /** « Compter les clics sur mes liens » : la carte destination → lien court (core/redirectMeasure.ts) ; absente ou vide : adresses inchangées. */
  measure?: MeasureMap;
};

function formatDate(date: Date | null, locale: string): string {
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date) : "";
}

/** Où mène le clic sur une entrée : sa page, ou son lien externe selon la collection. */
export function entryHref(
  entry: EntryView,
  collection: Pick<InstanceView, "clickAction">,
  defaultLocale: string,
  measure?: MeasureMap,
): { href: string; external: boolean } {
  if (collection.clickAction === "external" && entry.url) return { href: measure ? measureHref(measure, safeHref(entry.url)) : safeHref(entry.url), external: true };
  return { href: entryPath(entry, defaultLocale), external: false };
}

export function EntryList({ entries, collection, locale, defaultLocale, measure }: Props) {
  const t = makeTranslator(locale);
  if (entries.length === 0) return <p data-skin-part="prose" className="text-muted">{t("site.empty")}</p>;

  if (collection.display === "links") {
    return (
      <ul data-skin-part="list" data-kind="links" className="flex flex-wrap gap-3">
        {entries.map((e) => {
          const { href, external } = entryHref(e, collection, defaultLocale, measure);
          return (
            <li key={e.id} data-skin-part="list-item">
              <a
                href={href}
                lang={e.locale}
                data-skin-part="chip"
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                data-chip="" className="inline-flex items-center gap-2 rounded-chip border-token border-line bg-surface px-4 py-2 text-sm transition-colors hover:border-accent hover:text-accent"
              >
                <EntryIcon icon={e.icon} />
                {e.title}
              </a>
            </li>
          );
        })}
      </ul>
    );
  }

  if (collection.display === "list") {
    return (
      <ul data-skin-part="list" data-kind="list" className="divide-y divide-line border-y-token border-line">
        {entries.map((e) => {
          const { href, external } = entryHref(e, collection, defaultLocale, measure);
          return (
            <li key={e.id} lang={e.locale} data-skin-part="list-item" className="py-4">
              <a href={href} data-skin-part="link" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="font-medium hover:text-accent">
                {e.title}
              </a>
              {e.summary && <p data-skin-part="lead" className="mt-1 text-sm text-muted">{e.summary}</p>}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul data-skin-part="list" data-kind="cards" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--sk-cards-min,15rem)),1fr))] gap-[var(--sk-grid-gap,1.25rem)]">
      {entries.map((e) => {
        const { href, external } = entryHref(e, collection, defaultLocale, measure);
        const isCode = collection.display === "codes";
        return (
          <li
            key={e.id}
            lang={e.locale}
            data-card="" data-skin-part="card" className={`flex flex-col overflow-hidden rounded-card border-token border-line bg-surface ${e.expired ? "opacity-60" : ""}`}
          >
            {e.cover && <CoverImage src={e.cover} variant="card" />}
            <div data-skin-part="card-body" className="flex flex-1 flex-col gap-2 p-[calc(var(--sk-card-pad,calc(var(--spacing)*4))*1.25)]">
              <h3 data-skin-part="heading" data-level="3" className="flex items-center gap-2 text-lg font-semibold">
                <EntryIcon icon={e.icon} />
                <a href={href} data-skin-part="link" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="hover:text-accent">
                  {e.title}
                </a>
              </h3>
              {e.summary && <p data-skin-part="lead" className="text-sm text-muted">{e.summary}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-3 text-xs text-muted">
                {isCode && e.code && (
                  <CopyCode code={e.code} copyLabel={t("site.copy")} copiedLabel={t("site.copied")} />
                )}
                {e.expired && <span data-skin-part="badge" className="rounded-sm bg-line px-2 py-0.5">{t("site.expired")}</span>}
                {!isCode && <time>{formatDate(e.publishedAt, locale)}</time>}
                {e.isFallback && <span data-skin-part="badge" className="uppercase">{e.locale}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
