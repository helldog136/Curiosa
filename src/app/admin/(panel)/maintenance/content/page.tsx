import { adminCtx } from "@/core/admin";
import { ActionForm } from "@/components/admin/ActionForm";
import { ContentCheckButton } from "@/components/admin/ContentCheckButton";
import { Checkbox, TextArea } from "@/components/admin/Field";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { checkIsRunning, tally, visibleGroups } from "@/core/maintenance/content/run";
import { readHistory, readIgnored, readReport, readSettings } from "@/core/maintenance/content/store";
import { SEVERITIES, type Severity } from "@/core/maintenance/content/types";
import { describeGroup, notCheckedList, verdictOf } from "@/core/maintenance/content/view";
import { ignoreAction, saveContentSettings, unignoreAllAction } from "./actions";

export const dynamic = "force-dynamic";

const CHIP: Record<Severity, string> = { important: ui.chipDanger, advised: ui.chipWarn, info: ui.chip };

/**
 * Santé de mon site (Entretien) : le contrôle du contenu, en mots simples. Un résumé rassurant (jamais de note), des remarques regroupées par importance, chacune avec une phrase,
 * un « pourquoi », et par ligne « Corriger » (l'écran d'administration qui règle la chose) et « Ignorer ». Les visites de liens ne partent que sur « Vérifier maintenant ».
 */
export default async function ContentHealthPage() {
  const { t, locale, config, advanced } = await adminCtx("admin");
  const [report, ignored, history, settings, busy] = await Promise.all([readReport(), readIgnored(), readHistory(), readSettings(), checkIsRunning()]);
  const groups = visibleGroups(report, ignored);
  const counts = tally(groups);
  const verdict = report ? verdictOf(counts) : "none";
  const hidden = (report?.groups ?? []).reduce((n, g) => n + g.items.filter((i) => ignored.has(i.k)).length, 0);
  const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString(locale) : "");
  const unfinished = !!report && !report.finished && !!report.progress;
  const labels = {
    idle: t("content.check.button"), resume: t("content.check.resume"), working: t("content.check.working"), unit: t("content.check.unit", { index: "{index}", total: "{total}" }),
    busy: t("content.check.busy"), failed: t("content.check.failed"), stopped: t("content.check.stopped"),
  };
  const notChecked = notCheckedList(report, { linksOn: settings.checkLinks });

  return (
    <div className="space-y-6">
      <PageHeader title={t("content.title")} intro={t("content.intro")} icon="🩺" />

      {verdict === "none" ? (
        <Callout tone="info" role="status" testid="content-verdict-none">{t("content.verdict.none")}</Callout>
      ) : verdict === "good" ? (
        <Callout tone="ok" role="status" testid="content-verdict-good"><strong>{t("content.verdict.good")}</strong> {t("content.verdict.goodHelp", { date: when(report?.doneAt ?? report?.at) })}</Callout>
      ) : (
        <Callout tone="info" role="status" testid="content-verdict-look"><strong>{t("content.verdict.look")}</strong> {t("content.verdict.lookHelp", { date: when(report?.doneAt ?? report?.at) })}</Callout>
      )}

      {report && (
        <ul className="flex flex-wrap gap-2" aria-label={t("content.chips")} data-testid="content-chips">
          {SEVERITIES.map((s) => <li key={s} className={`${CHIP[s]} !px-3 !py-1 !text-sm`} data-testid={`content-chip-${s}`}>{t(`content.sev.${s}`)} · {counts[s]}</li>)}
        </ul>
      )}

      <Panel testid="content-run">
        <div className="flex flex-wrap items-start gap-4">
          {unfinished && <ContentCheckButton labels={labels} resume trackKey="content-check" />}
          <ContentCheckButton labels={labels} primary={!unfinished} trackKey={unfinished ? "content-check-new" : "content-check"} />
        </div>
        {unfinished && report?.progress && <p className="text-sm text-muted" data-testid="content-unfinished">{t("content.unfinished", { done: report.progress.done, total: report.progress.total })}</p>}
        {busy && !unfinished && <p className="text-sm text-muted">{t("content.runningElsewhere")}</p>}
        <p className={ui.help}>{t(settings.checkLinks ? "content.run.help" : "content.run.helpNoLinks")}</p>
      </Panel>

      {report && groups.length === 0 && verdict !== "none" && <Callout tone="ok" testid="content-empty">{t("content.nothing")}</Callout>}

      {SEVERITIES.map((sev) => {
        const here = groups.filter((g) => g.sev === sev);
        if (!here.length) return null;
        return (
          <section key={sev} className="space-y-3" data-testid={`content-section-${sev}`} aria-labelledby={`sev-${sev}`}>
            <div>
              <h2 id={`sev-${sev}`} className="flex items-center gap-2 text-lg font-semibold"><span className={CHIP[sev]}>{t(`content.sev.${sev}`)}</span></h2>
              <p className="mt-1 text-sm text-muted">{t(`content.sev.${sev}.help`)}</p>
            </div>
            {here.map((g) => {
              const v = describeGroup(g, t, config.defaultLocale);
              return (
                <article key={`${g.id}|${g.loc ?? ""}`} className={`${ui.card} space-y-3`} data-testid="content-group" data-group={g.id}>
                  <div>
                    <h3 className="text-base font-semibold">{v.sentence}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{v.why}</p>
                  </div>
                  <ul className="divide-y divide-line" data-testid={`content-items-${g.id}`}>
                    {v.items.map((i) => (
                      <li key={i.k} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="content-item">
                        <div className="min-w-0 space-y-0.5">
                          <p className="break-words font-medium">{i.title}{i.where && <span className="font-normal text-muted"> · {i.where}</span>}</p>
                          {i.detail && <p className="break-words text-sm text-muted">{i.detail}</p>}
                          {i.url && <p className="break-all text-xs text-muted">{i.url}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {i.fix && <a href={i.fix} className={`${ui.btn} min-h-11`} data-testid="content-fix">{t("content.fix")}</a>}
                          <form action={ignoreAction.bind(null, i.k)}><PendingButton variant="link" testid="content-ignore">{t("content.ignore")}</PendingButton></form>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {v.more > 0 && <p className="text-sm text-muted">{t("content.more", { n: v.more })}</p>}
                </article>
              );
            })}
          </section>
        );
      })}

      {hidden > 0 && (
        <Panel testid="content-ignored">
          <form action={unignoreAllAction} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{t("content.hidden", { n: hidden })}</p>
            <PendingButton testid="content-unignore">{t("content.showAll")}</PendingButton>
          </form>
        </Panel>
      )}

      <Panel title={t("content.notChecked.title")} help={t("content.notChecked.help")} testid="content-not-checked">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6">
          {notChecked.map((n) => <li key={n.key}>{t(`content.nc.${n.key}`, n.vars)}</li>)}
        </ul>
      </Panel>

      <Panel title={t("content.history.title")} testid="content-history">
        {history.length === 0 ? <p className="text-sm text-muted">{t("content.history.none")}</p> : (
          <ul className="divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.at} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span>{new Date(h.doneAt || h.at).toLocaleString(locale)}</span>
                <span className="text-muted">{t(h.ok ? "content.verdict.good" : "content.verdict.look")} · {t("content.history.counts", { important: h.counts.important, advised: h.counts.advised, info: h.counts.info })}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("content.settings.title")} testid="content-settings">
        <ActionForm action={saveContentSettings} submitLabel={t("action.save")} pendingLabel={t("progress.saving")} secondary className="space-y-4">
          <Checkbox name="checkLinks" label={t("content.settings.links")} help={t("content.settings.linksHelp")} defaultChecked={settings.checkLinks} />
          {advanced && <TextArea name="skipHosts" label={t("content.settings.skip")} help={t("content.settings.skipHelp")} defaultValue={settings.skipHosts} rows={3} mono />}
        </ActionForm>
      </Panel>
    </div>
  );
}
