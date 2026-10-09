import type { InstanceView } from "@/core/instances";
import { entryPath, type EntryView } from "@/core/content/entries";
import { makeTranslator } from "@/core/i18n/dictionary";
import { safeHref } from "@/core/url";
import { CopyCode } from "./CopyCode";
import { EntryIcon } from "./EntryIcon";

type Props = {
  entries: EntryView[];
  collection: Pick<InstanceView, "display" | "clickAction">;
  locale: string;
  defaultLocale: string;
};

function formatDate(date: Date | null, locale: string): string {
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date) : "";
}

/** Où mène le clic sur une entrée : sa page, ou son lien externe selon la collection. */
export function entryHref(
  entry: EntryView,
  collection: Pick<InstanceView, "clickAction">,
  defaultLocale: string,
): { href: string; external: boolean } {
  if (collection.clickAction === "external" && entry.url) return { href: safeHref(entry.url), external: true };
  return { href: entryPath(entry, defaultLocale), external: false };
}

export function EntryList({ entries, collection, locale, defaultLocale }: Props) {
  const t = makeTranslator(locale);
  if (entries.length === 0) return <p className="text-muted">{t("site.empty")}</p>;

  if (collection.display === "links") {
    return (
      <ul className="flex flex-wrap gap-3">
        {entries.map((e) => {
          const { href, external } = entryHref(e, collection, defaultLocale);
          return (
            <li key={e.id}>
              <a
                href={href}
                lang={e.locale}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                data-chip="" className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm transition-colors hover:border-accent hover:text-accent"
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
      <ul className="divide-y divide-line border-y border-line">
        {entries.map((e) => {
          const { href, external } = entryHref(e, collection, defaultLocale);
          return (
            <li key={e.id} lang={e.locale} className="py-4">
              <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="font-medium hover:text-accent">
                {e.title}
              </a>
              {e.summary && <p className="mt-1 text-sm text-muted">{e.summary}</p>}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-5">
      {entries.map((e) => {
        const { href, external } = entryHref(e, collection, defaultLocale);
        const isCode = collection.display === "codes";
        return (
          <li
            key={e.id}
            lang={e.locale}
            data-card="" className={`flex flex-col overflow-hidden rounded-xl border border-line bg-surface ${e.expired ? "opacity-60" : ""}`}
          >
            {e.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.cover} alt="" loading="lazy" className="aspect-video w-full object-cover" />
            )}
            <div className="flex flex-1 flex-col gap-2 p-5">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <EntryIcon icon={e.icon} />
                <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="hover:text-accent">
                  {e.title}
                </a>
              </h3>
              {e.summary && <p className="text-sm text-muted">{e.summary}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-3 text-xs text-muted">
                {isCode && e.code && (
                  <CopyCode code={e.code} copyLabel={t("site.copy")} copiedLabel={t("site.copied")} />
                )}
                {e.expired && <span className="rounded bg-line px-2 py-0.5">{t("site.expired")}</span>}
                {!isCode && <time>{formatDate(e.publishedAt, locale)}</time>}
                {e.isFallback && <span className="uppercase">{e.locale}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
