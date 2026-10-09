import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceByKey } from "@/core/instances";
import { prisma } from "@/core/db";
import { getSetting } from "@/core/settings";
import { localeName } from "@/core/i18n/locales";
import { getActiveInstances } from "@/core/modules/registry";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { getInstanceLabeler } from "@/core/modules/labels";
import { effectiveSort, orderBy, sortByTitle, sortSettingKey } from "@/core/content/sort";
import { entryState, type EntryState } from "@/core/content/state";
import { ui } from "@/components/admin/ui";

const CHIP: Record<EntryState, string> = { draft: ui.chipWarn, scheduled: ui.chip, expired: ui.chipWarn, published: ui.chipOk };

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { t, locale, config, user } = await adminCtx("editor");
  const { c } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();

  // Même ordre que sur le site : ce qu'on voit ici en premier est ce que le visiteur voit en premier.
  const sort = effectiveSort(await getSetting(sortSettingKey(collection.id)), collection.display);
  const rows = await prisma.entry.findMany({ where: { instanceId: collection.id }, include: { translations: true }, orderBy: orderBy(sort) });
  const view = rows.map((e) => ({ e, main: e.translations.find((tr) => tr.locale === config.defaultLocale) ?? e.translations[0] }));
  const entries = sort === "title" ? sortByTitle(view.map((v) => ({ ...v, title: v.main?.title ?? "", featured: v.e.featured })), config.defaultLocale) : view;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const newHref = `/admin/entries/new?c=${collection.key}`;
  const canConfigure = user.role !== "editor";
  const name = (await getInstanceLabeler(locale, config.defaultLocale)).label(collection);

  return (
    <div className="space-y-6">
      <InstanceTabs t={t} id={collection.id} keyName={collection.key} name={name}
        icon={(await getActiveInstances()).find((a) => a.instance.id === collection.id)?.mod.manifest.icon ?? "🧩"} active="entries" content canConfigure={canConfigure} />

      {entries.length === 0 ? (
        <div className={`${ui.card} flex flex-col items-center gap-4 py-12 text-center`}>
          <p className="text-lg font-semibold">{t("entries.emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted">{t("entries.emptyHelp")}</p>
          <a href={newHref} className={ui.btnPrimary}>{t("entries.createFirst")}</a>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {t("entries.count", { n: entries.length })} · {t("entries.orderedBy", { sort: t(`sort.${sort}`) })}
              {canConfigure && <> · <a href={`/admin/instances/${collection.id}`} className="underline hover:text-accent">{t("entries.changeOrder")}</a></>}
            </p>
            <a href={newHref} className={ui.btnPrimary}>{t("entries.new")}</a>
          </div>
          <ul className={`${ui.card} divide-y divide-line !p-0`}>
            {entries.map(({ e, main }) => {
              const state = entryState(e);
              const note =
                state === "scheduled" && e.publishedAt ? t("entries.scheduledFor", { date: fmt.format(e.publishedAt) })
                : state === "expired" && e.expiresAt ? t("entries.expiredOn", { date: fmt.format(e.expiresAt) })
                : state === "published" && e.expiresAt ? t("entries.expiresOn", { date: fmt.format(e.expiresAt) })
                : null;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:px-6">
                  <div className="min-w-0 flex-1 basis-56">
                    <a href={`/admin/entries/${e.id}`} className="font-medium hover:text-accent">
                      {e.featured && <span title={t("field.featured")} aria-label={t("field.featured")}>★ </span>}{main?.title ?? "—"}
                    </a>
                    <p className="mt-0.5 text-xs text-muted">{t("entries.updatedOn", { date: fmt.format(e.updatedAt) })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={CHIP[state]}>{t(`entries.state.${state}`)}</span>
                    {note && <span className="text-xs text-muted">{note}</span>}
                  </div>
                  {config.locales.length > 1 && (
                    <div className="flex gap-1">
                      {e.translations.map((tr) => (
                        <a key={tr.locale} href={`/admin/entries/${e.id}?locale=${tr.locale}`} title={localeName(tr.locale)} className="rounded bg-bg px-1.5 py-0.5 text-xs uppercase hover:text-accent">{tr.locale}</a>
                      ))}
                    </div>
                  )}
                  <a href={`/admin/entries/${e.id}`} className={ui.btn}>{t("entries.edit")}</a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
