import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { hasRole } from "@/core/auth/access";
import { getInstanceByKey } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import { getActiveInstances } from "@/core/modules/registry";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { getInstanceLabeler } from "@/core/modules/labels";
import { cleanQuery, listAdminEntries, parseAdminState, SEARCH_MAX } from "@/core/content/adminList";
import { parsePageParam } from "@/core/content/pagination";
import { entryState, type EntryState } from "@/core/content/state";
import { entryStateCounts } from "@/core/content/dashboardCounts";
import { ui } from "@/components/admin/ui";
import { Pagination } from "@/components/site/Pagination";
import { ENTRIES_HREF, entriesHref, entryHref, entryNewHref, entryTemplatesHref, instanceHref } from "@/core/adminLinks";

const CHIP: Record<EntryState, string> = { draft: ui.chipWarn, scheduled: ui.chip, expired: ui.chipWarn, published: ui.chipOk };

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ c?: string; page?: string | string[]; q?: string | string[]; state?: string | string[] }> }) {
  const { t, locale, config, user } = await adminCtx("editor");
  const { c, page: pageRaw, q: qRaw, state: stateRaw } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();

  // Même ordre que sur le site : ce qu'on voit ici en premier est ce que le visiteur voit en premier. 50 par page ; recherche et état se font dans la requête.
  const q = cleanQuery(typeof qRaw === "string" ? qRaw : "");
  const state = parseAdminState(stateRaw);
  const param = parsePageParam(pageRaw);
  const list = await listAdminEntries({ instance: collection, defaultLocale: config.defaultLocale, page: param.kind === "page" ? param.page : 1, q, state });
  const { sort } = list;
  const counts = await entryStateCounts(collection.id);
  const chips = (["all", "published", "draft", "scheduled", "expired"] as const).filter((st) => st === "all" || st === "published" || st === "draft" || counts[st] > 0 || st === state);
  const chipHref = (st: string) => entriesHref(collection.key, { ...(q ? { q } : {}), ...(st !== "all" ? { state: st } : {}) });
  const entries = list.rows.map((e) => ({ e, main: e.translations.find((tr) => tr.locale === config.defaultLocale) ?? e.translations[0] }));
  const filtered = q !== "" || state !== "all";
  const base = entriesHref(collection.key, { ...(q ? { q } : {}), ...(state !== "all" ? { state } : {}) });
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const newHref = entryNewHref(collection.key);
  const canConfigure = hasRole(user, "admin");
  const active = (await getActiveInstances()).find((a) => a.instance.id === collection.id);
  // Modèles déclarés par le module (`content.templates`) : un lien « Partir d'un modèle », jamais une obligation.
  const templatesHref = (active?.mod.manifest.content?.templates ?? []).length ? entryTemplatesHref(collection.key) : null;
  const name = (await getInstanceLabeler(locale, config.defaultLocale)).label(collection);

  return (
    <div className="space-y-6">
      <InstanceTabs t={t} id={collection.id} keyName={collection.key} name={name}
        icon={active?.mod.manifest.icon ?? "🧩"} active="entries" content canConfigure={canConfigure} />

      {list.total === 0 && !filtered ? (
        <div className={`${ui.card} flex flex-col items-center gap-4 py-12 text-center`}>
          <p className="text-lg font-semibold">{t("entries.emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted">{t("entries.emptyHelp")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={newHref} className={ui.btnPrimary}>{t("entries.createFirst")}</a>
            {templatesHref && <a href={templatesHref} className={ui.btn} data-testid="entries-templates-link">{t("entries.templates.open")}</a>}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {list.pages > 1 ? t("entries.rangeCount", { from: (list.page - 1) * list.perPage + 1, to: (list.page - 1) * list.perPage + entries.length, n: list.total }) : t("entries.count", { n: list.total })} · {t("entries.orderedBy", { sort: t(`sort.${sort}`) })}
              {canConfigure && <> · <a href={instanceHref(collection.id)} className="underline hover:text-accent">{t("entries.changeOrder")}</a></>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {templatesHref && <a href={templatesHref} className={ui.btn} data-testid="entries-templates-link">{t("entries.templates.open")}</a>}
              <a href={newHref} className={ui.btnPrimary}>{t("entries.new")}</a>
            </div>
          </div>
          {list.titleSortCapped && <p className={`${ui.card} border-amber-500/40 text-sm`} role="status" data-testid="title-sort-capped">{t("entries.titleSortCapped")}</p>}
          <nav aria-label={t("entries.stateLabel")} data-testid="entries-state-chips" className="flex flex-wrap gap-2">
            {chips.map((st) => (
              <a key={st} href={chipHref(st)} aria-current={state === st ? "true" : undefined} data-state={st}
                className={`${ui.btn} ${state === st ? "!border-accent !bg-accent/10 font-semibold" : ""}`}>{t(`entries.chip.${st}`)} <span className="text-muted">{counts[st]}</span></a>
            ))}
          </nav>
          <form method="get" action={ENTRIES_HREF} role="search" className="flex flex-wrap items-end gap-3" data-testid="entries-filter">
            <input type="hidden" name="c" value={collection.key} />
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor="entries-q" className={ui.label}>{t("entries.searchLabel")}</label>
              <input id="entries-q" name="q" type="search" defaultValue={q} maxLength={SEARCH_MAX} placeholder={t("entries.searchPlaceholder")} className={ui.input} />
            </div>
            {state !== "all" && <input type="hidden" name="state" value={state} />}
            <button type="submit" className={ui.btn}>{t("entries.filter")}</button>
            {filtered && <a href={entriesHref(collection.key)} className="self-center text-sm underline hover:text-accent">{t("entries.clearFilter")}</a>}
          </form>
          {entries.length === 0 && <p className="text-sm text-muted" role="status">{t("entries.noMatch")}</p>}
          {entries.length > 0 && <ul className={`${ui.card} divide-y divide-line !p-0`}>
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
                    <a href={entryHref(e.id)} className="font-medium hover:text-accent">
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
                        <a key={tr.locale} href={entryHref(e.id, { locale: tr.locale })} title={localeName(tr.locale)} className="rounded bg-bg px-1.5 py-0.5 text-xs uppercase hover:text-accent">{tr.locale}</a>
                      ))}
                    </div>
                  )}
                  <a href={entryHref(e.id)} className={ui.btn}>{t("entries.edit")}</a>
                </li>
              );
            })}
          </ul>}
          <Pagination page={list.page} pages={list.pages} base={base} t={t} label={t("entries.pagesLabel")} />
        </>
      )}
    </div>
  );
}
