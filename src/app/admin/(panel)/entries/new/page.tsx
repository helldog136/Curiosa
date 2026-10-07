import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey, pickName } from "@/core/instances";
import { EntryForm } from "../EntryForm";

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ c?: string; locale?: string }> }) {
  const { t, locale: adminLocale, config, advanced } = await adminCtx("editor");
  const { c, locale } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();
  const entryLocale = locale && config.locales.includes(locale) ? locale : config.defaultLocale;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("entries.new")} — {pickName(collection, adminLocale, config.defaultLocale)}</h1>
      <EntryForm
        advanced={advanced} t={t} collection={collection} locales={config.locales} locale={entryLocale}
        data={{ status: "draft", cover: null, icon: null, url: null, code: null, featured: false, tags: "", expiresAt: "", publishedAt: "", fields: {}, translations: [] }}
      />
    </div>
  );
}
