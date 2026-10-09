import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey } from "@/core/instances";
import { getRefOptions } from "@/core/services/topics";
import { getInstanceLabeler } from "@/core/modules/labels";
import { EntryForm } from "../EntryForm";

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ c?: string; locale?: string }> }) {
  const { t, locale: adminLocale, config, advanced } = await adminCtx("editor");
  const { c, locale } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();
  const entryLocale = locale && config.locales.includes(locale) ? locale : config.defaultLocale;
  const refOptions: Record<string, { value: string; label: string }[]> = {};
  for (const f of collection.fieldSchema) if (f.type === "ref" && f.topic) refOptions[f.topic] = await getRefOptions(collection.id, f.topic, config.defaultLocale);
  const name = (await getInstanceLabeler(adminLocale, config.defaultLocale)).label(collection);
  return (
    <div className="space-y-6">
      <div>
        <a href={`/admin/entries?c=${collection.key}`} className="text-sm text-muted hover:text-accent">← {t("entries.backTo", { name })}</a>
        <h1 className="mt-1 text-2xl font-bold">{t("entries.new")}</h1>
        <p className="mt-1 text-sm text-muted">{t("entries.newIntro")}</p>
      </div>
      <EntryForm
        refOptions={refOptions} advanced={advanced} t={t} collection={collection} locales={config.locales} locale={entryLocale}
        data={{ status: "draft", cover: null, icon: null, url: null, code: null, featured: false, tags: "", expiresAt: "", publishedAt: "", fields: {}, translations: [] }}
      />
    </div>
  );
}
