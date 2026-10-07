import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getCollectionByKey, pickName } from "@/core/collections";
import { EntryForm } from "../EntryForm";

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ c?: string; locale?: string }> }) {
  const { t, locale: adminLocale, config } = await adminCtx("editor");
  const { c, locale } = await searchParams;
  const collection = c ? await getCollectionByKey(c) : undefined;
  if (!collection) notFound();
  const entryLocale = locale && config.locales.includes(locale) ? locale : config.defaultLocale;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("entries.new")} — {pickName(collection, adminLocale, config.defaultLocale)}</h1>
      <EntryForm
        t={t} collection={collection} locales={config.locales} locale={entryLocale}
        data={{ status: "draft", cover: null, icon: null, url: null, code: null, featured: false, expiresAt: "", publishedAt: "", fields: {}, translations: [] }}
      />
    </div>
  );
}
