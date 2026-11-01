import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { listInstances } from "@/core/instances";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea } from "@/components/admin/Field";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { DateTimeField } from "@/components/admin/DateTimeField";
import { LiveSearch, NoResults } from "@/components/admin/LiveSearch";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { RowMenu } from "@/components/admin/RowMenu";
import { Switch } from "@/components/admin/Switch";
import { searchText } from "@/core/adminkit/search";
import { RedirectAddressFields } from "@/components/admin/RedirectAddressFields";
import { ui } from "@/components/admin/ui";
import { formatEnd } from "@/core/redirectEnd";
import { MAX_END_MESSAGE, listRedirects, redirectShortUrl, redirectState, siteUrlLooksLocal, type RedirectStateFilter } from "@/core/redirects";
import { monthlyHits } from "@/core/redirectStats";
import { siteTimezone } from "@/core/siteTime";
import { DestinationList } from "@/components/admin/DestinationList";
import { destinationSummary } from "@/core/redirectGroups";
import { isMeasureEnabled } from "@/core/redirectMeasure";
import { hasRole } from "@/core/permissions";
import { createRedirect, deleteRedirect, saveMeasureLinks, setRedirectActive, suggestRedirectName } from "./actions";

export const dynamic = "force-dynamic";

const STATES: RedirectStateFilter[] = ["active", "off", "ended"];
/** L'adresse de la liste pour une recherche, un état et une page. */
const href = (q: string, page: number, state = "") => {
  const parts = [q ? `q=${encodeURIComponent(q)}` : "", state ? `state=${state}` : "", page > 1 ? `page=${page}` : ""].filter(Boolean);
  return `/admin/redirects${parts.length ? `?${parts.join("&")}` : ""}`;
};

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, advanced, locale, user } = await adminCtx("editor");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const view = one(sp.view) === "destinations" ? "destinations" : "all";
  const state = (STATES as string[]).includes(one(sp.state)) ? (one(sp.state) as RedirectStateFilter) : undefined;
  const list = await listRedirects({ q, page: Number(one(sp.page)) || 1, state });
  const all = q || state ? null : list.total;
  const redirects = list.items;
  const month = await monthlyHits(redirects.map((r) => r.id));
  const tz = await siteTimezone();
  const entryIds = redirects.map((r) => r.entryId).filter((x): x is string => !!x);
  const linked = await prisma.entry.findMany({ where: { id: { in: entryIds } }, select: { id: true, url: true } });
  const collections = await listInstances();
  const withUrl = advanced
    ? await prisma.entry.findMany({ where: { url: { not: null }, instanceId: { in: collections.filter((c) => c.features.includes("url")).map((c) => c.id) } }, include: { translations: { take: 1 } }, take: 200 })
    : [];
  const site = new URL(redirectShortUrl("x")).host;
  const dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const measure = await isMeasureEnabled();
  const canChange = hasRole(user, "admin");
  // Les états ne comptent que s'il y a autre chose que des liens actifs (R15) : alors des pastilles « Tout · Actifs · Désactivés · Terminés » avec leur nombre.
  const showStates = list.counts.off + list.counts.ended > 0 || !!state;
  const endLabels = { date: t("redirects.endDate.date"), time: t("redirects.endDate.time"), timePlaceholder: t("redirects.endDate.noTime"), clear: t("redirects.endDate.clear"), at: t("datetime.at"), preview: t("redirects.endDate.preview") };

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>{advanced ? t("nav.redirects") : t("nav.redirects.simple")}</h1>
        <p className={ui.pageIntro}>{advanced ? t("redirects.intro") : t("redirects.introSimple", { site })}</p>
      </div>

      {siteUrlLooksLocal() && <p role="alert" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800">{t("redirects.localWarning", { site })}</p>}
      {sp.deleted && <p role="status" className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{t("redirects.deleted")}</p>}

      <nav aria-label={t("redirects.view.label")} className="flex flex-wrap gap-2" data-testid="redirects-views">
        {([["all", "/admin/redirects", t("redirects.view.all")], ["destinations", "/admin/redirects?view=destinations", t("redirects.view.byDestination")]] as const).map(([id, to, label]) => (
          <Link key={id} href={to} aria-current={view === id ? "page" : undefined} className={`${view === id ? ui.btnPrimary : ui.btn} min-h-11`}>{label}</Link>
        ))}
      </nav>

      {view === "destinations" && (
        <section className="space-y-4" aria-labelledby="redirects-destinations">
          <div>
            <h2 id="redirects-destinations" className="text-lg font-semibold">{t("redirects.dest.title")}</h2>
            <p className={ui.help}>{t("redirects.dest.intro")}</p>
          </div>
          <DestinationList summary={await destinationSummary()} t={t} format={(d) => dayFormat.format(new Date(`${d}T12:00:00Z`))} />
        </section>
      )}

      {view === "all" && <>
      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{advanced ? t("redirects.add") : t("redirects.add.simple")}</h2>
        <ActionForm action={createRedirect} submitLabel={t("redirects.addButton")} pendingLabel={t("progress.creating")} reset>
          <RedirectAddressFields suggest={suggestRedirectName} site={site} advanced={advanced}
            labels={{ address: t("redirects.address"), addressHelp: t("redirects.addressHelp"), name: t("redirects.name"), nameHelp: advanced ? t("redirects.nameHelpAdvanced") : t("redirects.nameHelp"), namePlaceholder: t("redirects.namePlaceholder"), proposing: t("redirects.proposing") }} />
          <MoreOptions title={t("instances.s.more")} summary={t("redirects.moreHint")}>
            <DateTimeField name="end" optionalTime label={t("redirects.endDate")} help={t("redirects.endDateHelp", { zone: tz })} locale={locale} labels={endLabels} />
            <TextArea name="endMessage" rows={3} label={t("redirects.endMessage")} help={t("redirects.endMessageHelp", { max: MAX_END_MESSAGE })} />
            {advanced && withUrl.length > 0 && (
              <Select name="entryId" label={t("redirects.entryLabel")} help={t("redirects.orEntryHelp")}
                options={[{ value: "", label: t("redirects.entryNone") }, ...withUrl.map((e) => ({ value: e.id, label: `${e.translations[0]?.title ?? e.id} — ${e.url}` }))]} />
            )}
            {advanced && <Checkbox name="permanent" label={t("redirects.permanent")} help={t("redirects.permanentHelp")} />}
          </MoreOptions>
        </ActionForm>
      </section>

      <section className="space-y-4" aria-labelledby="redirects-list">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="redirects-list" className="text-lg font-semibold">{t("redirects.listTitle")}{all !== null ? ` (${all})` : ""}</h2>
          {list.total > 0 || q ? <a href="/api/admin/redirects/export" className={`${ui.btn} min-h-11`} download>{t("redirects.export")}</a> : null}
        </div>
        {(list.counts.all > 0 || q || state) && (
          <div className="space-y-3">
            {/* Recherche en direct, présente dès le premier lien (R15) : elle interroge le serveur pendant la frappe, donc toutes les pages, pas seulement celle qui est affichée. */}
            <LiveSearch mode="server" scope="redirects" action="/admin/redirects" keep={state ? { state } : {}} initialQuery={q}
              placeholder={t("redirects.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} busyLabel={t("search.busy")} />
            {showStates && (
              <nav aria-label={t("redirects.state.label")} className="flex flex-wrap gap-2" data-testid="redirects-states">
                {[["", t("table.all"), list.counts.all] as const, ...STATES.map((s) => [s, t(`redirects.state.pill.${s}`), list.counts[s]] as const)].map(([id, label, n]) => (
                  <Link key={id || "all"} href={href(q, 1, id)} aria-current={(state ?? "") === id ? "true" : undefined} scroll={false}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${(state ?? "") === id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent hover:text-accent"}`}>
                    {label}<span className={(state ?? "") === id ? "opacity-80" : "text-muted"}>{n}</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
        )}

        {redirects.length === 0 ? (
          q || state ? (
            <NoResults message={t("search.none")} clearLabel={t("search.clear")} href="/admin/redirects" />
          ) : (
            // État vide : on explique à quoi ça sert, avec des exemples, et le formulaire juste au-dessus est l'étape suivante.
            <div className={`${ui.card} space-y-1 text-[15px] leading-6`}>
              <p className="font-medium">{advanced ? t("redirects.empty") : t("redirects.empty.simple")}</p>
              <p className="text-muted">{t("redirects.examples")}</p>
            </div>
          )
        ) : (
          <ul className="space-y-3" aria-busy={undefined}>
            {redirects.map((r) => {
              const rowState = redirectState(r);
              const end = r.expiresAt ? formatEnd(r.expiresAt, tz, locale) : null;
              const target = linked.find((e) => e.id === r.entryId)?.url ?? r.targetUrl;
              return (
                <li key={r.id} className={`${ui.card} !p-4 ${rowState === "off" ? "opacity-80" : ""}`} data-testid="redirect-row" data-live-item="redirects" data-search={searchText([r.path, target])}>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/redirects/${r.id}`} className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere] hover:text-accent hover:underline">/{r.path}</Link>
                        {/* Une étiquette seulement quand la ligne sort de l'ordinaire (R14) : « actif » est la règle, « désactivé » se lit sur l'interrupteur. */}
                        {rowState === "ended" && <span className={ui.chipWarn}>{t("redirects.state.ended")}</span>}
                        {r.entryId && <span className={ui.chip}>{t("redirects.followsEntry")}</span>}
                      </p>
                      <p className="truncate text-sm text-muted" title={target}>{target}</p>
                      <p className="text-sm text-muted">
                        {t("redirects.hitsLine", { month: month.get(r.id) ?? 0, total: r.hits })}
                        {end && ` · ${rowState === "ended" ? t("redirects.endedOn", { date: end }) : t("redirects.untilDate", { date: end })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch label={t("redirects.switch.label", { address: `/${r.path}` })} checked={r.active} onText={t("redirects.state.active")} offText={t("redirects.state.off")}
                        failedText={t("switch.failed")} onToggle={setRedirectActive.bind(null, r.id)} testid="redirect-switch" />
                      <Link href={`/admin/redirects/${r.id}`} className={`${ui.btn} min-h-11`}>{t("redirects.open")}</Link>
                      <RowMenu label={t("table.menu")}>
                        <form action={deleteRedirect.bind(null, r.id)}>
                          <ConfirmButton menu message={t("redirects.deleteConfirm", { address: `${site}/${r.path}` })} confirmLabel={t("redirects.deleteYes")} dangerConfirm pendingLabel={t("progress.deleting")}>{t("redirects.deleteMenu")}</ConfirmButton>
                        </form>
                      </RowMenu>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {list.pages > 1 && (
          <nav aria-label={t("redirects.pagination")} className="flex items-center justify-between gap-3">
            {list.page > 1 ? <Link href={href(q, list.page - 1, state)} className={`${ui.btn} min-h-11`} rel="prev">← {t("redirects.prev")}</Link> : <span />}
            <span className="text-sm text-muted">{t("redirects.pageOf", { page: list.page, pages: list.pages })}</span>
            {list.page < list.pages ? <Link href={href(q, list.page + 1, state)} className={`${ui.btn} min-h-11`} rel="next">{t("redirects.next")} →</Link> : <span />}
          </nav>
        )}
      </section>
      </>}

      <section className={`${ui.card} space-y-3`} aria-labelledby="redirects-measure" data-testid="measure-card">
        <h2 id="redirects-measure" className="text-lg font-semibold">{t("redirects.measure.title")}</h2>
        {canChange ? (
          <ActionForm action={saveMeasureLinks} submitLabel={t("action.save")} secondary className="space-y-3">
            <p className="max-w-[70ch] text-[15px] leading-6 text-muted">{t("redirects.measure.help")}</p>
            <Checkbox name="measureLinks" label={t("redirects.measure.label")} defaultChecked={measure} />
            {advanced && <p className={ui.help}>{t("redirects.measure.advanced")}</p>}
          </ActionForm>
        ) : (
          <div className="space-y-1.5 text-[15px]">
            <p className="max-w-[70ch] text-muted">{t("redirects.measure.help")}</p>
            <p>{measure ? t("redirects.measure.on") : t("redirects.measure.off")} {t("redirects.measure.adminOnly")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
