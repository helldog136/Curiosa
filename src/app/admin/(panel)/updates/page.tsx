import { adminCtx } from "@/core/admin";
import { MaintenanceHeader, TabIntro } from "@/components/admin/MaintenanceHeader";
import { inspectHosting } from "@/core/updates/hosting";
import { checkForUpdate, dockerUpdatePlan, getInstallInfo, getUpdateCheck, isAutoUpdateEnabled, readStartupState, readUpdateLog, readUpdateState } from "@/core/updates/service";
import { describeProgress, failureKey, hasRemaining } from "@/core/updates/progress";
import { ActionForm } from "@/components/admin/ActionForm";
import { UpdateButton } from "@/components/admin/UpdateButton";
import { CoreUpdateProgress } from "@/components/admin/CoreUpdateProgress";
import { coreUpdateSnapshot } from "@/core/operations/coreUpdate";
import { Markdown } from "@/components/site/Markdown";
import { Checkbox } from "@/components/admin/Field";
import { Callout, Panel } from "@/components/admin/Page";
import { StatusPill } from "@/components/admin/StatusPill";
import { HelpTip } from "@/components/admin/HelpTip";
import { ui } from "@/components/admin/ui";
import { loadModulesUpdates } from "@/components/admin/ModulesUpdatesSection";
import { checkNow, saveAutoUpdate, saveChannel } from "./actions";
import { EXTENSIONS_UPDATES_HREF } from "@/core/modules/extensionsLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

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

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("maint.tab.updates"));
}

/** Mettre le site à jour, dans l'ordre où on y pense : où j'en suis, ce qui existe, ce que ça change, puis un seul bouton ; pendant l'installation, où on en est. */
export default async function UpdatesPage() {
  const { t, locale, advanced, config, user } = await adminCtx({ right: "core:updates" });
  const info = getInstallInfo();
  // Docker : même vérification, mêmes notes, mêmes étapes ; mais on ne peut rien installer d'ici, on montre la commande exacte à lancer.
  const docker = info.kind === "docker";
  // Première visite : on interroge le dépôt une fois pour ne pas montrer « jamais vérifié ».
  let check = await getUpdateCheck();
  if (check.checkedAt === null && info.canCheck) check = await checkForUpdate();
  const plan = docker && check.available && check.latest ? await dockerUpdatePlan(check.latest) : null;
  const startup = docker ? readStartupState() : null;
  const state = readUpdateState();
  // Avant d'installer : un second gestionnaire pour CE site, ou une unité lancée par npx (lecture de /proc, jamais bloquant).
  const hosting = info.canUpdate && state.status !== "running" ? await inspectHosting({ supervised: info.restart === "supervised" }) : [];
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
  const { report, rows: moduleRows } = await loadModulesUpdates(t, locale, config.defaultLocale);
  // Juste après une mise à jour réussie du site, c'est la suite logique : on met la section en avant.
  const recent = state.status === "success" && !!state.finishedAt && report.checkedAt - state.finishedAt < 14 * 24 * 3600_000;
  const highlightModules = recent && moduleRows.length > 0;
  // Les modules se gèrent dans l'onglet « Mises à jour » du hub Modules ; ici, seulement un rappel et le lien.
  const modulesSection = !running && (
    <section className={`${ui.card} flex flex-wrap items-center justify-between gap-4 ${highlightModules ? "border-accent bg-accent/5" : ""}`} data-testid="modules-updates-link">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{t("updates.modules.title")}</h2>
        {highlightModules && <p className="mt-1 text-sm font-semibold text-accent" data-testid="modules-remind">{t("updates.modules.remind")}</p>}
        {moduleRows.length > 0 && <p className="mt-1 text-sm leading-6 text-muted">{t("updates.modulesLink.behind", { n: moduleRows.length })}</p>}
      </div>
      <a href={EXTENSIONS_UPDATES_HREF} className={moduleRows.length > 0 ? ui.btnPrimary : ui.btn}>{t("updates.modulesLink.open")}</a>
    </section>
  );
  const updateLabels = { idle: t("updates.apply", { version: check.latest ?? "" }), working: t("updates.working"), done: t("updates.done"), failed: t("updates.failedShort", { version: check.latest ?? "" }) };

  return (
    <div className="space-y-8">
      <MaintenanceHeader t={t} level={user.level} advanced={advanced} current="updates" />
      <TabIntro title={t("maint.tab.updates")} intro={t(docker ? "updates.introDocker" : "updates.intro")} />

      {!info.canCheck && (
        <Panel title={t("updates.yourVersion")}>
          <p className="text-2xl font-bold">{current}</p>
          <Callout tone="warn">{t(`updates.mode.${info.mode}`)}</Callout>
        </Panel>
      )}

      {info.canUpdate && progress && (
        <section className={`${ui.card} space-y-5`} data-testid="update-running" aria-live="polite">
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">{t("updates.runningTitle", { version: state.target ?? "" })}<HelpTip help={t("updates.runningHelp")} name={t("updates.runningTitle", { version: state.target ?? "" })} always /></h2>
          </div>
          <CoreUpdateProgress initial={coreUpdateSnapshot(state)} unitTemplate={t("updates.versionOf", { index: "{index}", total: "{total}" })} />
          {progress.chain.length > 0 && (
            <ol className="space-y-1.5 text-sm" data-testid="update-chain">
              {progress.chain.map((c) => (
                <li key={c.tag} className={`flex items-center gap-2 ${c.status === "waiting" ? "text-muted" : ""} ${c.status === "current" ? "font-semibold" : ""}`}>
                  <span aria-hidden>{c.status === "done" ? "✓" : c.status === "current" ? "●" : "○"}</span>
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
        <Panel tone="danger" title={t("updates.failedTitle")} testid="update-failed">
          <p className="text-sm leading-6">{t(fail.key)}{state.rolledBack ? ` ${t("updates.rolledBack")}` : ""}</p>
          {state.diagnostic && (
            <Callout tone="warn" testid="update-diagnostic">
              <p className="font-semibold">{t("updates.diagnostic.title")}</p>
              <p className="mt-1">{t(`updates.diag.${state.diagnostic.code}`, { port: state.diagnostic.port ?? "", who: state.diagnostic.manager === "pm2" ? `pm2${state.diagnostic.unit ? `, ${state.diagnostic.unit}` : ""}` : state.diagnostic.unit ?? "?", cwd: state.diagnostic.cwd ?? "?" })}</p>
              <p className="mt-1 text-muted">{t("updates.diag.help")}</p>
            </Callout>
          )}
          {advanced && state.error && <p className="font-mono text-xs text-muted">{state.error}</p>}
        </Panel>
      )}

      {hosting.length > 0 && (
        <Callout tone="warn" testid="update-hosting">
          <p className="font-semibold">{t("updates.hosting.title")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {hosting.map((w) => <li key={`${w.code}-${w.unit ?? w.pid}`}>{t(`updates.hosting.${w.code}`, { who: w.manager === "pm2" ? `pm2${w.unit ? `, ${w.unit}` : ""}` : w.unit ?? "?" })}</li>)}
          </ul>
        </Callout>
      )}

      {info.canUpdate && !running && partial && (
        <Callout tone="warn" testid="update-partial">
          <p className="font-semibold">{t("updates.partialTitle", { version: state.target ?? "" })}</p>
          <p className="mt-1">{t("updates.partialHelp", { n: state.remaining?.length ?? 0 })}</p>
          <p className="mt-1 text-muted">{(state.remaining ?? []).join(" → ")}</p>
        </Callout>
      )}

      {info.canUpdate && finished && !running && state.restart === "needed" && <Callout tone="warn">{t("updates.restartNeeded")}</Callout>}

      {highlightModules && modulesSection}

      {info.canCheck && !running && (
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
              <p className="flex-1" data-testid="update-uptodate"><StatusPill tone="ok">{t("updates.upToDate")}</StatusPill></p>
            )}
          </div>

          {check.error && <Callout tone="warn">{t("updates.unreachable")}</Callout>}
          {check.available && check.prerelease && <Callout tone="warn">{t("updates.rcWarning")}</Callout>}
          {check.available && check.level === "major" && <Callout tone="warn">{t("updates.majorWarning")}</Callout>}

          {check.available && !docker && (
            <div className="space-y-2" data-testid="update-action">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <UpdateButton running={false} confirm={check.prerelease ? `${t("updates.rcWarning")}\n\n${t("updates.confirm")}` : t("updates.confirm")} labels={updateLabels} />
                <StatusPill tone="warn">{t("updates.status.available")}</StatusPill>
              </div>
              <p className="text-sm text-muted" data-testid="update-restart">{t(`updates.restart.${info.restart}`)}</p>
            </div>
          )}

          {check.available && (
            <details className="rounded-xl border border-line" data-testid="update-details" open={check.level === "major"}>
              <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 text-base font-semibold">{t("updates.whatChanges")}</summary>
              <div className="space-y-4 border-t border-line p-4">
                {check.notes ? (
                  <div className="max-h-80 overflow-auto rounded-xl border border-line bg-bg p-4 text-sm" data-testid="update-notes" aria-label={t("updates.whatsNew", { version: check.latest ?? "" })}>
                    <Markdown text={check.notes} anchors={false} />
                  </div>
                ) : <p className="text-sm text-muted">{t("updates.noNotes")}</p>}
                {!docker && (
                  <div className="space-y-2">
                    <h2 className="text-base font-semibold">{t("updates.whatHappens")}</h2>
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
                      <li>{t("updates.happens.backup")}</li>
                      <li>{t("updates.chainNote")}</li>
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}

          {plan && (
            <div className="space-y-3 border-t border-line pt-5" data-testid="update-docker">
              <h2 className="text-base font-semibold">{t("updates.docker.title")}</h2>
              <p className="text-sm leading-6 text-muted">{plan.tags.length > 1 ? t("updates.docker.many") : t("updates.docker.one")}</p>
              {/* The core's code block brings its own "Copy" button (44 px, announced): nothing custom here. */}
              <ol className="space-y-4" data-testid="update-docker-commands">
                {plan.commands.map((cmd, i) => (
                  <li key={cmd} className="list-none [&_div.relative]:!mt-1 [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere]">
                    {plan.tags.length > 1 && <p className="text-sm font-medium">{t("updates.docker.step", { index: i + 1, total: plan.tags.length, version: plan.tags[i] ?? "" })}</p>}
                    <Markdown text={"```sh\n" + cmd + "\n```"} />
                  </li>
                ))}
              </ol>
              {plan.tags.length > 1 && <p className="text-sm leading-6 text-muted">{t("updates.docker.wait")}</p>}
              {!plan.planned && <Callout tone="info">{t("updates.docker.unplanned")}</Callout>}
              <p className="text-sm leading-6 text-muted">{t("updates.docker.backup")}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-muted">{t("updates.checkedAt")} {when(check.checkedAt)}</p>
            <ActionForm action={checkNow} submitLabel={t("updates.check")} pendingLabel={t("progress.checking")} secondary className="space-y-2">{null}</ActionForm>
          </div>
        </section>
      )}

      {startup && (
        <Callout tone={startup.status === "ok" ? "info" : "warn"} testid="update-startup">
          {startup.status === "ok" ? t("updates.docker.lastOk") : (
            <>
              <p className="font-semibold">{t("updates.docker.lastRefused")}</p>
              <p className="mt-1">{startup.error && ["below-floor", "newer-than-image", "backup-failed", "migrate-failed"].includes(startup.error) ? t(`updates.docker.refused.${startup.error}`) : null}</p>
              {advanced && startup.message && <p className="mt-1 font-mono text-xs text-muted">{startup.message}</p>}
            </>
          )}
        </Callout>
      )}

      {!highlightModules && modulesSection}

      {info.canUpdate && (
        <details className="rounded-2xl border border-line bg-surface" data-testid="update-options">
          <summary className="flex min-h-11 cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-lg font-semibold">
            <span>{t("updates.optionsTitle")}</span>
            <StatusPill tone={auto ? "ok" : "neutral"}>{t(auto ? "updates.autoOn" : "updates.autoOff")}</StatusPill>
          </summary>
          <div className="space-y-5 border-t border-line px-5 py-4">
            <section className="space-y-3" data-testid="update-auto">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">{t("updates.autoTitle")}<HelpTip help={t("updates.autoHelp")} name={t("updates.autoTitle")} always /></h2>
              <ActionForm action={saveAutoUpdate} submitLabel={t("action.save")} className="space-y-3">
                <Checkbox name="auto" label={t("updates.auto")} defaultChecked={auto} />
              </ActionForm>
            </section>
            {advanced && (
              <section className="space-y-3 border-t border-line pt-5" data-testid="update-channel">
                <h2 className="flex items-center gap-1.5 text-base font-semibold">{t("updates.channelTitle")}<HelpTip help={t("updates.channelHelp")} name={t("updates.channelTitle")} always /></h2>
                <ActionForm action={saveChannel} submitLabel={t("action.save")} className="space-y-3">
                  <Checkbox name="rc" label={t("updates.channelRc")} defaultChecked={check.channel === "rc"} />
                  <Checkbox name="rcRisk" label={t("updates.channelRisk")} help={t("updates.channelRiskHelp")} defaultChecked={check.channel === "rc"} />
                </ActionForm>
              </section>
            )}
          </div>
        </details>
      )}

      {info.canUpdate && finished && !running && (
        <Panel title={t("updates.last")} testid="update-last">
          <p className="text-sm">
            {state.status === "success" && (partial ? <StatusPill tone="warn">{t("updates.partialShort", { version: state.target ?? "" })}</StatusPill> : <StatusPill tone="ok">{t("updates.success", { version: state.target ?? "" })}</StatusPill>)}
            {failed && <StatusPill tone="danger">{t("updates.failedShort", { version: state.target ?? "" })}</StatusPill>}
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
