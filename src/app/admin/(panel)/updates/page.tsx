import { adminCtx } from "@/core/admin";
import { checkForUpdate, getInstallInfo, getUpdateCheck, isAutoUpdateEnabled, readUpdateLog, readUpdateState } from "@/core/updates/service";
import { describeProgress, failureKey, hasRemaining } from "@/core/updates/progress";
import { ActionForm } from "@/components/admin/ActionForm";
import { UpdateButton } from "@/components/admin/UpdateButton";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Markdown } from "@/components/site/Markdown";
import { Checkbox } from "@/components/admin/Field";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { checkNow, saveAutoUpdate, saveChannel } from "./actions";

export const dynamic = "force-dynamic";

/** Une version dans le parcours « ma version → la nouvelle ». */
function VersionCard({ label, version, tone, children }: { label: string; version: string; tone: "now" | "next"; children?: React.ReactNode }) {
  return (
    <div className={`flex-1 rounded-2xl border p-4 ${tone === "next" ? "border-accent bg-accent/5" : "border-line bg-bg"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{version}</p>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/** Mettre le site à jour, dans l'ordre où on y pense : où j'en suis, ce qui existe, ce que ça change, puis un seul bouton ; pendant l'installation, où on en est. */
export default async function UpdatesPage() {
  const { t, locale, advanced } = await adminCtx("owner");
  const info = getInstallInfo();
  // Première visite : on interroge le dépôt une fois pour ne pas montrer « jamais vérifié ».
  let check = await getUpdateCheck();
  if (check.checkedAt === null && info.canUpdate) check = await checkForUpdate();
  const state = readUpdateState();
  const running = state.status === "running";
  const auto = await isAutoUpdateEnabled();
  const log = readUpdateLog();
  const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString(locale) : "—");
  const progress = running ? describeProgress(state) : null;
  const partial = hasRemaining(state);
  const failed = state.status === "failed";
  const fail = failed ? failureKey(state.error) : null;
  const finished = state.status === "success" || failed;
  const current = `v${info.version}`;
  const updateLabels = { idle: t("updates.apply", { version: check.latest ?? "" }), working: t("updates.working"), done: t("updates.done"), failed: t("updates.failedShort", { version: check.latest ?? "" }) };

  return (
    <div className="space-y-8">
      <AutoRefresh active={running} />
      <PageHeader title={t("nav.updates")} intro={t("updates.intro")} />

      {!info.canUpdate && (
        <Panel title={t("updates.yourVersion")}>
          <p className="text-2xl font-bold">{current}</p>
          <Callout tone="warn">{t(`updates.mode.${info.mode}`)}</Callout>
        </Panel>
      )}

      {info.canUpdate && progress && (
        <section className={`${ui.card} space-y-5`} data-testid="update-running" aria-live="polite">
          <div>
            <h2 className="text-lg font-semibold">⏳ {t("updates.runningTitle", { version: state.target ?? "" })}</h2>
            <p className="mt-1 text-sm text-muted">{t("updates.runningHelp")}</p>
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{progress.total > 1 ? t("updates.versionOf", { index: progress.index, total: progress.total }) : t("updates.installing")}</span>
              <span className="text-muted">{progress.stepKey ? t(progress.stepKey) : ""}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
              <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(4, progress.percent)}%` }} />
            </div>
          </div>
          {progress.chain.length > 0 && (
            <ol className="space-y-1.5 text-sm" data-testid="update-chain">
              {progress.chain.map((c) => (
                <li key={c.tag} className={`flex items-center gap-2 ${c.status === "waiting" ? "text-muted" : ""} ${c.status === "current" ? "font-semibold" : ""}`}>
                  <span aria-hidden>{c.status === "done" ? "✅" : c.status === "current" ? "⏳" : "○"}</span>
                  {c.tag}
                  <span className="text-xs font-normal text-muted">{t(`updates.chain.${c.status}`)}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex justify-center"><UpdateButton running confirm="" labels={updateLabels} /></div>
          <Callout tone="info">{t("updates.dontClose")}</Callout>
        </section>
      )}

      {info.canUpdate && !running && failed && fail && (
        <Panel tone="danger" title={`❌ ${t("updates.failedTitle")}`} testid="update-failed">
          <p className="text-sm leading-6">{t(fail.key)}{state.rolledBack ? ` ${t("updates.rolledBack")}` : ""}</p>
          {advanced && state.error && <p className="font-mono text-xs text-muted">{state.error}</p>}
        </Panel>
      )}

      {info.canUpdate && !running && partial && (
        <Callout tone="warn" testid="update-partial">
          <p className="font-semibold">⏸️ {t("updates.partialTitle", { version: state.target ?? "" })}</p>
          <p className="mt-1">{t("updates.partialHelp", { n: state.remaining?.length ?? 0 })}</p>
          <p className="mt-1 text-muted">{(state.remaining ?? []).join(" → ")}</p>
        </Callout>
      )}

      {info.canUpdate && finished && !running && state.restart === "needed" && <Callout tone="warn">{t("updates.restartNeeded")}</Callout>}

      {info.canUpdate && !running && (
        <section className={`${ui.card} space-y-5`} data-testid="update-journey">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <VersionCard label={t("updates.yourVersion")} version={current} tone="now" />
            {check.available && check.latest ? (
              <>
                <span className="self-center text-2xl text-muted" aria-hidden>→</span>
                <VersionCard label={t("updates.newVersion")} version={check.latest} tone="next">
                  {check.level && <span className={check.level === "major" ? ui.chipWarn : ui.chip}>{t(`updates.level.${check.level}`)}</span>}
                </VersionCard>
              </>
            ) : (
              <p className="flex-1 text-lg font-semibold" data-testid="update-uptodate">✅ {t("updates.upToDate")}</p>
            )}
          </div>

          {check.error && <Callout tone="warn">{t("updates.unreachable")}</Callout>}
          {check.available && check.prerelease && <Callout tone="warn">{t("updates.rcWarning")}</Callout>}
          {check.available && check.level === "major" && <Callout tone="warn">{t("updates.majorWarning")}</Callout>}

          {check.available && (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">{t("updates.whatChanges")}</h2>
              {check.notes ? (
                <div className="max-h-80 overflow-auto rounded-xl border border-line bg-bg p-4 text-sm" data-testid="update-notes" aria-label={t("updates.whatsNew", { version: check.latest ?? "" })}>
                  <Markdown text={check.notes} />
                </div>
              ) : <p className="text-sm text-muted">{t("updates.noNotes")}</p>}
            </div>
          )}

          {check.available && (
            <div className="space-y-3 border-t border-line pt-5">
              <h2 className="text-base font-semibold">{t("updates.whatHappens")}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
                <li>{t("updates.happens.backup")}</li>
                <li>{t("updates.happens.rollback")}</li>
                <li>{t(`updates.restart.${info.restart}`)}</li>
                <li>{t("updates.chainNote")}</li>
              </ul>
              <div className="flex justify-center sm:justify-start"><UpdateButton running={false} confirm={check.prerelease ? `${t("updates.rcWarning")}\n\n${t("updates.confirm")}` : t("updates.confirm")} labels={updateLabels} /></div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-muted">{t("updates.checkedAt")} {when(check.checkedAt)}</p>
            <ActionForm action={checkNow} submitLabel={t("updates.check")} secondary className="space-y-2">{null}</ActionForm>
          </div>
        </section>
      )}

      {info.canUpdate && (
        <Panel title={t("updates.autoTitle")}>
          <ActionForm action={saveAutoUpdate} submitLabel={t("action.save")} className="space-y-3">
            <Checkbox name="auto" label={t("updates.auto")} help={t("updates.autoHelp")} defaultChecked={auto} />
          </ActionForm>
        </Panel>
      )}

      {info.canUpdate && advanced && (
        <Panel title={t("updates.channelTitle")} help={t("updates.channelHelp")}>
          <ActionForm action={saveChannel} submitLabel={t("action.save")} className="space-y-3">
            <Checkbox name="rc" label={t("updates.channelRc")} defaultChecked={check.channel === "rc"} />
            <Checkbox name="rcRisk" label={t("updates.channelRisk")} help={t("updates.channelRiskHelp")} defaultChecked={check.channel === "rc"} />
          </ActionForm>
        </Panel>
      )}

      {info.canUpdate && finished && !running && (
        <Panel title={t("updates.last")} testid="update-last">
          <p className="text-sm">
            {state.status === "success" && (partial ? <>⏸️ {t("updates.partialShort", { version: state.target ?? "" })}</> : <>✅ {t("updates.success", { version: state.target ?? "" })}</>)}
            {failed && <>❌ {t("updates.failedShort", { version: state.target ?? "" })}</>}
            <span className="ml-2 text-muted">{when(state.finishedAt ?? state.startedAt)}</span>
          </p>
          {log && (advanced || failed) && (
            <details className="text-sm">
              <summary className="cursor-pointer">{t("updates.technicalDetails")}</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface p-3 text-xs">{log}</pre>
            </details>
          )}
        </Panel>
      )}
    </div>
  );
}
