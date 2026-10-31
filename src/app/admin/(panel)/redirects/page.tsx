import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { listInstances } from "@/core/instances";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { PendingButton } from "@/components/admin/PendingButton";
import { RedirectAddressFields } from "@/components/admin/RedirectAddressFields";
import { ui } from "@/components/admin/ui";
import { formatEnd } from "@/core/redirectEnd";
import { MAX_END_MESSAGE, listRedirects, redirectShortUrl, redirectState, siteUrlLooksLocal } from "@/core/redirects";
import { monthlyHits } from "@/core/redirectStats";
import { siteTimezone } from "@/core/siteTime";
import { DestinationList } from "@/components/admin/DestinationList";
import { destinationSummary } from "@/core/redirectGroups";
import { isMeasureEnabled } from "@/core/redirectMeasure";
import { hasRole } from "@/core/permissions";
import { createRedirect, deleteRedirect, saveMeasureLinks, suggestRedirectName, toggleRedirect } from "./actions";

export const dynamic = "force-dynamic";

const href = (q: string, page: number) => `/admin/redirects${q || page > 1 ? "?" : ""}${[q ? `q=${encodeURIComponent(q)}` : "", page > 1 ? `page=${page}` : ""].filter(Boolean).join("&")}`;

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, advanced, locale, user } = await adminCtx("editor");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const view = one(sp.view) === "destinations" ? "destinations" : "all";
  const list = await listRedirects({ q, page: Number(one(sp.page)) || 1 });
  const all = q ? null : list.total;
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
  const stateChip = { active: ui.chipOk, ended: ui.chipWarn, off: ui.chip } as const;

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
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("redirects.moreOptions")}</summary>
            <div className="mt-3 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="endDate" type="date" label={t("redirects.endDate")} help={t("redirects.endDateHelp", { zone: tz })} />
                {advanced && <TextField name="endTime" type="time" label={t("redirects.endTime")} help={t("redirects.endTimeHelp")} />}
              </div>
              <TextArea name="endMessage" rows={3} label={t("redirects.endMessage")} help={t("redirects.endMessageHelp", { max: MAX_END_MESSAGE })} />
              {advanced && withUrl.length > 0 && (
                <Select name="entryId" label={t("redirects.entryLabel")} help={t("redirects.orEntryHelp")}
                  options={[{ value: "", label: t("redirects.entryNone") }, ...withUrl.map((e) => ({ value: e.id, label: `${e.translations[0]?.title ?? e.id} — ${e.url}` }))]} />
              )}
              {advanced && <Checkbox name="permanent" label={t("redirects.permanent")} help={t("redirects.permanentHelp")} />}
            </div>
          </details>
        </ActionForm>
      </section>

      <section className="space-y-4" aria-labelledby="redirects-list">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="redirects-list" className="text-lg font-semibold">{t("redirects.listTitle")}{all !== null ? ` (${all})` : ""}</h2>
          {list.total > 0 || q ? <a href="/api/admin/redirects/export" className={`${ui.btn} min-h-11`} download>{t("redirects.export")}</a> : null}
        </div>
        {(list.total > 8 || q) && (
          <form method="get" action="/admin/redirects" role="search" className="flex gap-2">
            <input type="search" name="q" defaultValue={q} aria-label={t("redirects.search")} placeholder={t("redirects.search")} className={`${ui.input} min-h-11`} />
            <button type="submit" className={`${ui.btn} min-h-11 shrink-0`}>{t("redirects.searchButton")}</button>
          </form>
        )}

        {redirects.length === 0 ? (
          // État vide : on explique à quoi ça sert, avec des exemples, et le formulaire juste au-dessus est l'étape suivante.
          <div className={`${ui.card} space-y-1 text-[15px] leading-6`}>
            <p className="font-medium">{q ? t("redirects.noMatch") : advanced ? t("redirects.empty") : t("redirects.empty.simple")}</p>
            {!q && <p className="text-muted">{t("redirects.examples")}</p>}
          </div>
        ) : (
          <ul className="space-y-3">
            {redirects.map((r) => {
              const state = redirectState(r);
              const end = r.expiresAt ? formatEnd(r.expiresAt, tz, locale) : null;
              const target = linked.find((e) => e.id === r.entryId)?.url ?? r.targetUrl;
              return (
                <li key={r.id} className={`${ui.card} !p-4 ${state === "off" ? "opacity-70" : ""}`} data-testid="redirect-row">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/redirects/${r.id}`} className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere] hover:text-accent hover:underline">/{r.path}</Link>
                        <span className={stateChip[state]}>{t(`redirects.state.${state}`)}</span>
                        {r.entryId && <span className={ui.chip}>{t("redirects.followsEntry")}</span>}
                      </p>
                      <p className="break-all text-sm text-muted">{target}</p>
                      <p className="text-sm text-muted">
                        {t("redirects.hitsLine", { month: month.get(r.id) ?? 0, total: r.hits })}
                        {end && ` · ${state === "ended" ? t("redirects.endedOn", { date: end }) : t("redirects.untilDate", { date: end })}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/redirects/${r.id}`} className={`${ui.btn} min-h-11`}>{t("redirects.open")}</Link>
                      <form action={toggleRedirect.bind(null, r.id)}><PendingButton>{r.active ? t("action.disable") : t("action.enable")}</PendingButton></form>
                      <form action={deleteRedirect.bind(null, r.id)}><ConfirmButton message={t("redirects.deleteConfirm", { address: `${site}/${r.path}` })} confirmLabel={t("redirects.deleteYes")} dangerConfirm pendingLabel={t("progress.deleting")}>{t("action.delete")}</ConfirmButton></form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {list.pages > 1 && (
          <nav aria-label={t("redirects.pagination")} className="flex items-center justify-between gap-3">
            {list.page > 1 ? <Link href={href(q, list.page - 1)} className={`${ui.btn} min-h-11`} rel="prev">← {t("redirects.prev")}</Link> : <span />}
            <span className="text-sm text-muted">{t("redirects.pageOf", { page: list.page, pages: list.pages })}</span>
            {list.page < list.pages ? <Link href={href(q, list.page + 1)} className={`${ui.btn} min-h-11`} rel="next">{t("redirects.next")} →</Link> : <span />}
          </nav>
        )}
      </section>
      </>}

      <section className={`${ui.card} space-y-3`} aria-labelledby="redirects-measure" data-testid="measure-card">
        <h2 id="redirects-measure" className="text-lg font-semibold">{t("redirects.measure.title")}</h2>
        {canChange ? (
          <ActionForm action={saveMeasureLinks} submitLabel={t("action.save")} secondary className="space-y-3">
            <Checkbox name="measureLinks" label={t("redirects.measure.label")} help={t("redirects.measure.help")} defaultChecked={measure} />
            {advanced && <p className={ui.help}>{t("redirects.measure.advanced")}</p>}
          </ActionForm>
        ) : (
          <div className="space-y-1.5 text-[15px]">
            <p className={ui.help}>{t("redirects.measure.help")}</p>
            <p>{measure ? t("redirects.measure.on") : t("redirects.measure.off")} {t("redirects.measure.adminOnly")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
