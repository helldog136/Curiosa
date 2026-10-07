import { adminCtx } from "@/core/admin";
import { checkForUpdate, getInstallInfo, getUpdateCheck, isAutoUpdateEnabled, readUpdateLog, readUpdateState } from "@/core/updates/service";
import { ActionForm } from "@/components/admin/ActionForm";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { Checkbox } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { applyUpdate, checkNow, saveAutoUpdate, saveChannel } from "./actions";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-8">
      <AutoRefresh active={running} />
      <h1 className="text-2xl font-bold">{t("nav.updates")}</h1>

      <section className={`${ui.card} space-y-2`}>
        <p>{t("updates.current")} <strong>v{info.version}</strong></p>
        {!info.canUpdate && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t(`updates.mode.${info.mode}`)}</p>}
        {info.canUpdate && (
          <>
            <p>
              {check.available
                ? <>{t("updates.available")} <strong>{check.latest}</strong> <span className={ui.help}>({t(`updates.level.${check.level}`)})</span></>
                : t("updates.upToDate")}
            </p>
            <p className={ui.help}>{t("updates.checkedAt")} {when(check.checkedAt)}{check.error && <> — <span className="text-red-600">{t("updates.unreachable")}</span></>}</p>
            {check.prerelease && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("updates.rcWarning")}</p>}
            {check.level === "major" && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("updates.majorWarning")}</p>}
            <p className={ui.help}>{t(`updates.restart.${info.restart}`)}</p>
          </>
        )}
      </section>

      {info.canUpdate && (
        <div className="flex flex-wrap gap-3">
          <ActionForm action={checkNow} submitLabel={t("updates.check")} className="space-y-2">{null}</ActionForm>
          {check.available && !running && (
            <ActionForm action={applyUpdate} submitLabel={t("updates.apply", { version: check.latest ?? "" })} confirm={check.prerelease ? `${t("updates.rcWarning")}\n\n${t("updates.confirm")}` : t("updates.confirm")} className="space-y-2">{null}</ActionForm>
          )}
        </div>
      )}

      {(running || state.status !== "idle") && (
        <section className={`${ui.card} space-y-2`}>
          <h2 className="text-lg font-semibold">{t("updates.last")}</h2>
          <p>
            {running && <>⏳ {t("updates.running", { version: state.target ?? "", step: state.step ?? "" })}</>}
            {state.status === "success" && <>✅ {t("updates.success", { version: state.target ?? "" })}</>}
            {state.status === "failed" && <>❌ {t("updates.failed", { error: state.error ?? "" })}{state.rolledBack ? ` — ${t("updates.rolledBack")}` : ""}</>}
          </p>
          {(state.status === "success" || state.status === "failed") && state.restart === "needed" && (
            <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("updates.restartNeeded")}</p>
          )}
          <p className={ui.help}>{when(state.startedAt)} → {when(state.finishedAt)}</p>
          {log && <pre className="max-h-72 overflow-auto rounded-lg bg-surface p-3 text-xs">{log}</pre>}
        </section>
      )}

      {info.canUpdate && (
        <ActionForm action={saveAutoUpdate} submitLabel={t("action.save")} className="space-y-3">
          <h2 className="text-lg font-semibold">{t("updates.autoTitle")}</h2>
          <Checkbox name="auto" label={t("updates.auto")} help={t("updates.autoHelp")} defaultChecked={auto} />
        </ActionForm>
      )}
    
      {info.canUpdate && advanced && (
        <ActionForm action={saveChannel} submitLabel={t("action.save")} className="space-y-3">
          <h2 className="text-lg font-semibold">{t("updates.channelTitle")}</h2>
          <p className={ui.help}>{t("updates.channelHelp")}</p>
          <Checkbox name="rc" label={t("updates.channelRc")} defaultChecked={check.channel === "rc"} />
          <Checkbox name="rcRisk" label={t("updates.channelRisk")} help={t("updates.channelRiskHelp")} defaultChecked={check.channel === "rc"} />
        </ActionForm>
      )}
    </div>
  );
}
