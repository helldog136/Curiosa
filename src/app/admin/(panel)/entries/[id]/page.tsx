import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceById } from "@/core/instances";
import { prisma } from "@/core/db";
import { parseTags } from "@/core/entries";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { EntryForm } from "../EntryForm";
import { deleteEntry, deleteTranslation } from "../actions";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function EditEntryPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ locale?: string }>;
}) {
  const { t, config, advanced } = await adminCtx("editor");
  const { id } = await params;
  const { locale: requested } = await searchParams;
  const entry = await prisma.entry.findUnique({ where: { id }, include: { translations: true } });
  if (!entry) notFound();
  const collection = await getInstanceById(entry.instanceId);
  if (!collection) notFound();

  const locale =
    requested && config.locales.includes(requested)
      ? requested
      : entry.translations.some((tr) => tr.locale === config.defaultLocale) ? config.defaultLocale : (entry.translations[0]?.locale ?? config.defaultLocale);
  const exists = entry.translations.some((tr) => tr.locale === locale);

  let fields: Record<string, unknown> = {};
  try { fields = JSON.parse(entry.fields); } catch { /* champs libres illisibles : on repart de zéro */ }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{entry.translations.find((tr) => tr.locale === locale)?.title ?? t("entries.new")}</h1>
      <EntryForm
        advanced={advanced} t={t} collection={collection} locales={config.locales} locale={locale}
        data={{
          id: entry.id, status: entry.status, cover: entry.cover, icon: entry.icon, url: entry.url, code: entry.code,
          featured: entry.featured, tags: parseTags(entry.tags).join(", "), expiresAt: day(entry.expiresAt), publishedAt: day(entry.publishedAt), fields,
          translations: entry.translations.map((tr) => ({ locale: tr.locale, slug: tr.slug, title: tr.title, summary: tr.summary, body: tr.body })),
        }}
      />
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        {exists && entry.translations.length > 1 && (
          <form action={deleteTranslation.bind(null, entry.id, locale)}>
            <ConfirmButton message={t("confirm.delete")}>{t("entries.deleteVersion")}</ConfirmButton>
          </form>
        )}
        <form action={deleteEntry.bind(null, entry.id)}>
          <ConfirmButton message={t("confirm.delete")}>{t("entries.delete")}</ConfirmButton>
        </form>
      </div>
    </div>
  );
}
