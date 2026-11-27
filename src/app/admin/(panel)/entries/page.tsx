import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { hasRole } from "@/core/auth/access";
import { getInstanceByKey } from "@/core/instances";
import { localeName } from "@/core/i18n/locales";
import { getActiveInstances } from "@/core/modules/registry";
import { InstanceTabs } from "@/components/admin/InstanceTabs";
import { getInstanceLabeler } from "@/core/modules/labels";
import { cleanQuery, listAdminEntries, parseAdminState } from "@/core/content/adminList";
import { parsePageParam } from "@/core/content/pagination";
import { entryState, type EntryState } from "@/core/content/state";
import { entryStateCounts } from "@/core/content/dashboardCounts";
import { ui } from "@/components/admin/ui";
import { EmptyState } from "@/components/admin/EmptyState";
import { HelpTip } from "@/components/admin/HelpTip";
import { StatusPill } from "@/components/admin/StatusPill";
import type { BadgeTone } from "@/core/blocks";
import { LiveSearch, NoResults } from "@/components/admin/LiveSearch";
import { Pagination } from "@/components/site/Pagination";
import { ENTRIES_HREF, entriesHref, entryHref, entryNewHref, entryTemplatesHref, instanceHref } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

const TONE: Record<EntryState, BadgeTone> = { draft: "warn", scheduled: "info", expired: "warn", published: "ok" };

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ c?: string }> }): Promise<Metadata> {
  const { c } = await searchParams;
  return adminTitle(async ({ locale, config }) => {
    const collection = c ? await getInstanceByKey(c) : undefined;
    return collection ? (await getInstanceLabeler(locale, config.defaultLocale)).label(collection) : "";
  }, { need: "editor" });
}

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ c?: string; page?: string | string[]; q?: string | string[]; state?: string | string[] }> }) {
  const { t, locale, config, user } = await adminCtx("editor");
  const { c, page: pageRaw, q: qRaw, state: stateRaw } = await searchParams;
  const collection = c ? await getInstanceByKey(c) : undefined;
  if (!collection) notFound();

  // Même ordre que sur le site : ce qu'on voit ici en premier est ce que le visiteur voit en premier. 50 par page ; recherche et état se font dans la requête.
  const q = cleanQuery(typeof qRaw === "string" ? qRaw : "");
  const state = parseAdminState(stateRaw);
  const stateFilter = state;
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
        // R18: one sentence and one button; the templates are a way in, never an obligation.
        <EmptyState title={t("entries.emptyTitle")} action={<a href={newHref} className={ui.btnPrimary}>{t("entries.createFirst")}</a>}
          example={templatesHref ? <a href={templatesHref} className={ui.btn} data-testid="entries-templates-link">{t("entries.templates.open")}</a> : undefined} testid="entries-empty" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {list.pages > 1 ? t("entries.rangeCount", { from: (list.page - 1) * list.perPage + 1, to: (list.page - 1) * list.perPage + entries.length, n: list.total }) : t("entries.count", { n: list.total })}
              <HelpTip help={t("entries.orderedBy", { sort: t(`sort.${sort}`) })} name={t("entries.count", { n: list.total })} always />
              {canConfigure && <a href={instanceHref(collection.id)} className="inline-flex min-h-11 items-center underline hover:text-accent">{t("entries.changeOrder")}</a>}
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
          <LiveSearch mode="server" scope="entries" action={ENTRIES_HREF} keep={{ c: collection.key, ...(state !== "all" ? { state } : {}) }} initialQuery={q}
            serverCount={filtered ? t("search.count", { shown: list.total, total: counts.all }) : undefined} placeholder={t("entries.searchPlaceholder")} noneLabel={t("search.none")} clearLabel={t("search.clear")} busyLabel={t("search.busy")} />
          {entries.length === 0 && <NoResults message={t("entries.noMatch")} clearLabel={t("search.clear")} href={entriesHref(collection.key, state !== "all" ? { state } : {})} />}
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
                    <a href={entryHref(e.id)} className="block truncate font-medium hover:text-accent" title={main?.title || undefined}>
                      {e.featured && <span title={t("field.featured")} aria-label={t("field.featured")}>★ </span>}{main?.title ?? "—"}
                    </a>
                    <p className="mt-0.5 text-xs text-muted">{t("entries.updatedOn", { date: fmt.format(e.updatedAt) })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Only what sets the row apart (R14): "Published" is the norm, and the active state filter already says it. */}
                    {state !== "published" && state !== stateFilter && <StatusPill tone={TONE[state]} testid="entry-state">{t(`entries.state.${state}`)}</StatusPill>}
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
