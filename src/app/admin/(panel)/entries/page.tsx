import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey, pickName } from "@/core/instances";
import { prisma } from "@/core/db";
import { localeName } from "@/core/i18n/locales";
import { ui } from "@/components/admin/ui";

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { t, locale, config } = await adminCtx("editor");
  const { c } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();

  const entries = await prisma.entry.findMany({
    where: { instanceId: collection.id },
    include: { translations: true },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{pickName(collection, locale, config.defaultLocale)}</h1>
        <a href={`/admin/entries/new?c=${collection.key}`} className={ui.btnPrimary}>{t("entries.new")}</a>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted">{t("entries.empty")}</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr><th className={ui.th}>{t("field.title")}</th><th className={ui.th}>{t("field.status")}</th><th className={ui.th}>{t("entries.languages")}</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const main = e.translations.find((tr) => tr.locale === config.defaultLocale) ?? e.translations[0];
              return (
                <tr key={e.id} className="border-t border-line">
                  <td className={ui.td}>
                    <a href={`/admin/entries/${e.id}`} className="font-medium hover:text-accent">{main?.title ?? "—"}</a>
                  </td>
                  <td className={ui.td}>{t(e.status === "published" ? "status.published" : "status.draft")}</td>
                  <td className={ui.td}>
                    {e.translations.map((tr) => (
                      <a key={tr.locale} href={`/admin/entries/${e.id}?locale=${tr.locale}`} title={localeName(tr.locale)} className="mr-1 rounded bg-surface px-1.5 py-0.5 text-xs uppercase hover:text-accent">{tr.locale}</a>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
