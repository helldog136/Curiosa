import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCollectionByKey, pickDescription, pickName } from "@/core/collections";
import { listEntries } from "@/core/entries";
import { getVisitorLocale, LOCALE_HEADER } from "@/core/i18n/request";
import { withLocale } from "@/core/links";
import { runSlot } from "@/core/modules/runtime";
import { getSiteConfig } from "@/core/settings";
import { Blocks } from "@/components/site/Blocks";
import { EntryList } from "@/components/site/EntryList";
import { makeTranslator } from "@/core/i18n/dictionary";

export const dynamic = "force-dynamic";

/** Langue préférée d'un visiteur qui arrive sur "/" sans préférence mémorisée. */
function detect(acceptLanguage: string | null, enabled: string[]): string | null {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().split(/[;-]/)[0]?.toLowerCase();
    if (code && enabled.includes(code)) return code;
  }
  return null;
}

export default async function HomePage() {
  const config = await getSiteConfig();
  const h = await headers();

  if (!h.get(LOCALE_HEADER)) {
    const remembered = (await cookies()).get("vitrine_locale")?.value;
    const target =
      remembered && remembered !== "default"
        ? config.locales.includes(remembered) ? remembered : null
        : !remembered && config.autoDetect
          ? detect(h.get("accept-language"), config.locales)
          : null;
    if (target && target !== config.defaultLocale) redirect(`/${target}`);
  }

  const locale = await getVisitorLocale();
  const localized = await getSiteConfig(locale);
  const t = makeTranslator(locale);

  const sections = [];
  for (const section of localized.homeSections) {
    if (section.type === "hero") {
      sections.push(
        <section key={section.id} className="space-y-4 py-8 text-center">
          {localized.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={localized.logo} alt="" className="mx-auto h-28 w-28 rounded-full object-cover" />
          )}
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{localized.heroTitle || localized.name}</h1>
          {(localized.heroText || localized.tagline) && (
            <p className="mx-auto max-w-2xl text-lg text-muted">{localized.heroText || localized.tagline}</p>
          )}
        </section>,
      );
    } else if (section.type === "collection") {
      const collection = await getCollectionByKey(section.collection);
      if (!collection || !collection.published) continue;
      const entries = await listEntries({ collection, locale, limit: section.count });
      if (entries.length === 0) continue;
      const description = pickDescription(collection, locale, localized.defaultLocale);
      sections.push(
        <section key={section.id} className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-semibold">{pickName(collection, locale, localized.defaultLocale)}</h2>
            {collection.basePath && (
              <a href={withLocale(`/${collection.basePath}`, locale, localized.defaultLocale)} className="text-sm text-accent hover:underline">
                {t("site.seeAll")}
              </a>
            )}
          </div>
          {description && <p className="text-muted">{description}</p>}
          <EntryList entries={entries} collection={collection} locale={locale} defaultLocale={localized.defaultLocale} />
        </section>,
      );
    } else {
      const blocks = await runSlot(section.slot as never, locale);
      if (blocks.length) sections.push(<Blocks key={section.id} blocks={blocks} locale={locale} />);
    }
  }

  const [top, bottom] = await Promise.all([runSlot("home.top", locale), runSlot("home.bottom", locale)]);
  return (
    <div className="space-y-12">
      <Blocks blocks={top} locale={locale} />
      {sections}
      <Blocks blocks={bottom} locale={locale} />
    </div>
  );
}
