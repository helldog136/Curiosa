import Link from "next/link";
import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { listInstances } from "@/core/instances";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextArea, TextField } from "@/components/admin/Field";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { CopyBlock } from "@/components/admin/CopyBlock";
import { PendingButton } from "@/components/admin/PendingButton";
import { RedirectChart } from "@/components/admin/RedirectChart";
import { ui } from "@/components/admin/ui";
import { endFields, formatEnd } from "@/core/redirectEnd";
import { parseLevel } from "@/core/redirectQr";
import { MAX_END_MESSAGE, redirectShortUrl, redirectState, siteUrlLooksLocal } from "@/core/redirects";
import { redirectStats } from "@/core/redirectStats";
import { siteTimezone } from "@/core/siteTime";
import { deleteRedirect, reactivateRedirect, toggleRedirect, updateRedirect } from "../actions";

export const dynamic = "force-dynamic";

export default async function RedirectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, advanced, locale } = await adminCtx("editor");
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r) notFound();
  const tz = await siteTimezone();
  const stats = (await redirectStats(id))!;
  const state = redirectState(r);
  const address = redirectShortUrl(r.path);
  const level = advanced ? parseLevel(one(sp.level)) : "M";
  const qr = (fmt: "svg" | "png", dl = false) => `/api/admin/redirects/${id}/qr?fmt=${fmt}&level=${level}${dl ? "&dl=1" : ""}`;
  const end = endFields(r.expiresAt, tz);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const fmtDay = (d: string) => day.format(new Date(`${d}T12:00:00Z`));
  const collections = await listInstances();
  const withUrl = advanced
    ? await prisma.entry.findMany({ where: { url: { not: null }, instanceId: { in: collections.filter((c) => c.features.includes("url")).map((c) => c.id) } }, include: { translations: { take: 1 } }, take: 200 })
    : [];
  const stateChip = { active: ui.chipOk, ended: ui.chipWarn, off: ui.chip } as const;
  const justCreated = one(sp.created) === "1";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/admin/redirects" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-accent hover:underline">← {t("redirects.backToList")}</Link>
        <h1 className={`${ui.pageTitle} font-mono [overflow-wrap:anywhere]`}>/{r.path}</h1>
        <p className="flex flex-wrap items-center gap-2"><span className={stateChip[state]}>{t(`redirects.state.${state}`)}</span>{r.expiresAt && <span className="text-sm text-muted">{state === "ended" ? t("redirects.endedOn", { date: formatEnd(r.expiresAt, tz, locale) }) : t("redirects.untilDate", { date: formatEnd(r.expiresAt, tz, locale) })}</span>}</p>
      </div>

      {justCreated && <p role="status" className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-[15px] font-medium text-emerald-800">{t("redirects.createdBanner")}</p>}
      {siteUrlLooksLocal() && <p role="alert" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800">{t("redirects.localWarning", { site: new URL(address).host })}</p>}
      {state === "ended" && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="max-w-prose text-[15px]">{t("redirects.endedNotice")}</p>
          <form action={reactivateRedirect.bind(null, id)}><PendingButton variant="primary" pendingLabel={t("progress.saving")}>{t("redirects.reactivate")}</PendingButton></form>
        </div>
      )}

      <section className={`${ui.card} grid grid-cols-1 gap-6 md:grid-cols-[17rem_minmax(0,1fr)]`} aria-labelledby="qr-title">
        <div className="min-w-0 space-y-3">
          <h2 id="qr-title" className="text-lg font-semibold">{t("redirects.qrTitle")}</h2>
          {/* Le code est dessiné sur son propre fond blanc, avec sa zone de silence : il se lit aussi en thème sombre. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr("svg")} width={272} height={272} alt={t("redirects.qr.alt", { address })} className="block aspect-square w-full max-w-[17rem] rounded-xl border border-line" />
        </div>
        <div className="min-w-0 space-y-4">
          <CopyBlock text={address} label={t("redirects.shortAddress")} copyLabel={t("redirects.copy")} copiedLabel={t("redirects.copied")} />
          <div className="flex flex-wrap gap-2">
            <a href={address} target="_blank" rel="noopener noreferrer" className={`${ui.btnPrimary} min-h-11`}>{t("redirects.test")}</a>
            <a href={qr("svg", true)} className={`${ui.btn} min-h-11`} download>{t("redirects.downloadSvg")}</a>
            <a href={qr("png", true)} className={`${ui.btn} min-h-11`} download>{t("redirects.downloadPng")}</a>
          </div>
          <p className={ui.help}>{t("redirects.qrNeverChanges")}</p>
          <p className={ui.help}>{t("redirects.printTips")}</p>
          {advanced && (
            <form method="get" className="flex flex-wrap items-end gap-2">
              <Select name="level" label={t("redirects.qrLevel")} defaultValue={level} help={t("redirects.qrLevelHelp")} options={[{ value: "M", label: t("redirects.qrLevelM") }, { value: "Q", label: t("redirects.qrLevelQ") }]} />
              <button type="submit" className={`${ui.btn} min-h-11`}>{t("redirects.qrLevelApply")}</button>
            </form>
          )}
        </div>
      </section>

      <section className={`${ui.card} space-y-4`} aria-labelledby="stats-title">
        <h2 id="stats-title" className="text-lg font-semibold">{t("redirects.statsTitle")}</h2>
        <RedirectChart stats={stats} format={fmtDay}
          labels={{ today: t("redirects.stats.today"), week: t("redirects.stats.week"), month: t("redirects.stats.month"), total: t("redirects.stats.total"), none: t("redirects.stats.none"),
            summary: t("redirects.stats.summary", { month: stats.month, today: stats.today, from: fmtDay(stats.series[0]!.day), to: fmtDay(stats.series[29]!.day) }),
            table: t("redirects.stats.table"), day: t("redirects.stats.day"), hits: t("redirects.stats.hits"), max: t("redirects.stats.max") }} />
        <p className={ui.help}>{t("redirects.stats.privacy")}</p>
      </section>

      <section className={`${ui.card} space-y-4`} aria-labelledby="settings-title">
        <h2 id="settings-title" className="text-lg font-semibold">{t("redirects.settingsTitle")}</h2>
        <ActionForm action={updateRedirect.bind(null, id)} submitLabel={t("action.save")} pendingLabel={t("progress.saving")}>
          <TextField name="targetUrl" label={t("redirects.address")} help={t("redirects.targetChangeHelp")} defaultValue={r.targetUrl} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="endDate" type="date" label={t("redirects.endDate")} help={t("redirects.endDateHelp", { zone: tz })} defaultValue={end.date} />
            {advanced && <TextField name="endTime" type="time" label={t("redirects.endTime")} help={t("redirects.endTimeHelp")} defaultValue={end.time} />}
          </div>
          <TextArea name="endMessage" rows={3} label={t("redirects.endMessage")} help={t("redirects.endMessageHelp", { max: MAX_END_MESSAGE })} defaultValue={r.endMessage} />
          {advanced && withUrl.length > 0 && (
            <Select name="entryId" label={t("redirects.entryLabel")} help={t("redirects.orEntryHelp")} defaultValue={r.entryId ?? ""}
              options={[{ value: "", label: t("redirects.entryNone") }, ...withUrl.map((e) => ({ value: e.id, label: `${e.translations[0]?.title ?? e.id} — ${e.url}` }))]} />
          )}
          {advanced && <Checkbox name="permanent" label={t("redirects.permanent")} help={t("redirects.permanentHelp")} defaultChecked={r.permanent} />}
        </ActionForm>
      </section>

      <section className={`${ui.card} space-y-3`} aria-labelledby="danger-title">
        <h2 id="danger-title" className="text-lg font-semibold">{t("redirects.dangerTitle")}</h2>
        <p className="max-w-prose text-sm text-muted">{t("redirects.offHelp")}</p>
        <div className="flex flex-wrap gap-2">
          <form action={toggleRedirect.bind(null, id)}><PendingButton>{r.active ? t("action.disable") : t("action.enable")}</PendingButton></form>
          <form action={deleteRedirect.bind(null, id)}><ConfirmButton message={t("redirects.deleteConfirm", { address: address.replace(/^https?:\/\//, "") })} confirmLabel={t("redirects.deleteYes")} dangerConfirm pendingLabel={t("progress.deleting")}>{t("action.delete")}</ConfirmButton></form>
        </div>
      </section>
    </div>
  );
}
