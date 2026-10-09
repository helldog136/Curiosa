import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceById } from "@/core/instances";
import { prisma } from "@/core/db";
import { parseTags } from "@/core/content/entries";
import { entryState } from "@/core/content/state";
import { getInstanceLabeler } from "@/core/modules/labels";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { getRefOptions } from "@/core/services/topics";
import { ui } from "@/components/admin/ui";
import { EntryForm } from "../EntryForm";
import { deleteEntry, deleteTranslation } from "../actions";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const CHIP = { draft: ui.chipWarn, scheduled: ui.chip, expired: ui.chipWarn, published: ui.chipOk } as const;

export default async function EditEntryPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ locale?: string; created?: string }>;
}) {
  const { t, locale: adminLocale, config, advanced } = await adminCtx("editor");
  const { id } = await params;
  const { locale: requested, created } = await searchParams;
  const entry = await prisma.entry.findUnique({ where: { id }, include: { translations: true } });
  if (!entry) notFound();
  const collection = await getInstanceById(entry.instanceId);
  if (!collection) notFound();

  const locale =
    requested && config.locales.includes(requested)
      ? requested
      : entry.translations.some((tr) => tr.locale === config.defaultLocale) ? config.defaultLocale : (entry.translations[0]?.locale ?? config.defaultLocale);
  const exists = entry.translations.some((tr) => tr.locale === locale);
  const title = entry.translations.find((tr) => tr.locale === locale)?.title;
  const state = entryState(entry);
  const name = (await getInstanceLabeler(adminLocale, config.defaultLocale)).label(collection);

  let fields: Record<string, unknown> = {};
  try { fields = JSON.parse(entry.fields); } catch { /* champs libres illisibles : on repart de zéro */ }

  const refOptions: Record<string, { value: string; label: string }[]> = {};
  for (const f of collection.fieldSchema) if (f.type === "ref" && f.topic) refOptions[f.topic] = await getRefOptions(collection.id, f.topic, config.defaultLocale);
  return (
    <div className="space-y-6">
      <div>
        <a href={`/admin/entries?c=${collection.key}`} className="text-sm text-muted hover:text-accent">← {t("entries.backTo", { name })}</a>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{title ?? t("entries.new")}</h1>
          <span className={CHIP[state]}>{t(`entries.state.${state}`)}</span>
        </div>
      </div>
      {created === "1" && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{t("entries.created")}</p>}
      <EntryForm
        refOptions={refOptions} advanced={advanced} t={t} collection={collection} locales={config.locales} locale={locale}
        data={{
          id: entry.id, status: entry.status, cover: entry.cover, icon: entry.icon, url: entry.url, code: entry.code,
          featured: entry.featured, tags: parseTags(entry.tags).join(", "), expiresAt: day(entry.expiresAt), publishedAt: day(entry.publishedAt), fields,
          translations: entry.translations.map((tr) => ({ locale: tr.locale, slug: tr.slug, title: tr.title, summary: tr.summary, body: tr.body })),
        }}
      />
      {/* Zone à part, loin de « Enregistrer » : on n'y arrive jamais par hasard, et chaque bouton demande confirmation. */}
      <section aria-label={t("entries.dangerTitle")} className="mt-10 space-y-3 rounded-2xl border border-red-500/30 p-5">
        <h2 className="text-[15px] font-semibold text-red-700">{t("entries.dangerTitle")}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {exists && entry.translations.length > 1 && (
            <form action={deleteTranslation.bind(null, entry.id, locale)}>
              <ConfirmButton message={t("entries.deleteVersionConfirm")}>{t("entries.deleteVersion")}</ConfirmButton>
            </form>
          )}
          <form action={deleteEntry.bind(null, entry.id)}>
            <ConfirmButton message={t("entries.deleteConfirm", { title: title ?? "" })}>{t("entries.delete")}</ConfirmButton>
          </form>
        </div>
        <p className="text-[13px] text-muted">{t("entries.dangerHelp")}</p>
      </section>
    </div>
  );
}
