import type { Translator } from "@/core/i18n/dictionary";
import { DAILY_BYTES, DAILY_FILES, usedToday } from "@/core/mediaMcp";
import { dailyWindowStart, DEFAULT_LIFT_MINUTES, LIFT_MINUTES, liftDeps, liftedUntil } from "@/core/services/mcp/uploadLift";
import { siteTimezone, timeKey } from "@/core/siteTime";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { HelpTip } from "@/components/admin/HelpTip";
import { Callout } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { Segmented } from "@/components/admin/Segmented";
import { ui } from "@/components/admin/ui";
import { liftUploadLimitsAction, resetDailyQuotaAction, stopUploadLiftAction } from "./uploadLimitsActions";

const mb = (bytes: number, locale: string) => (Math.round((bytes / 1024 / 1024) * 10) / 10).toLocaleString(locale);

/**
 * Banner at the top of the Settings tab while the upload limits are lifted (R24: the stop is visible without scrolling). Owner only.
 */
export async function UploadLiftBanner({ t }: { t: Translator }) {
  const until = await liftedUntil();
  if (until === null) return null;
  const time = timeKey(new Date(until), await siteTimezone());
  return (
    <Callout tone="warn" role="status" testid="upload-lift-banner">
      <span className="flex flex-wrap items-center justify-between gap-3">
        <strong>{t("uploadLimits.lifted", { time })}</strong>
        <form action={stopUploadLiftAction}><PendingButton variant="primary" pendingLabel={t("uploadLimits.stopping")}>{t("uploadLimits.stop")}</PendingButton></form>
      </span>
    </Callout>
  );
}

/**
 * "Image uploads by assistants" card (Admin > AI assistants > Settings), owner only. One task: lift the limits for a while (one choice, prefilled at 10 minutes,
 * one click). The secondary action starts the daily count over (confirmed; the journal keeps every line). The state line says what is used; the details are in the "?".
 */
export async function UploadLimits({ t, locale }: { t: Translator; locale: string }) {
  const [until, day, from, tz] = await Promise.all([liftedUntil(), usedToday(), dailyWindowStart(), siteTimezone()]);
  const since = from > liftDeps.now() - 86_400_000 + 60_000; // the owner started over within the last 24 hours
  const usage = { files: day.files, maxFiles: DAILY_FILES, mb: mb(day.bytes, locale), maxMb: mb(DAILY_BYTES, locale) };
  return (
    <section className={`${ui.card} space-y-4`} aria-labelledby="upload-limits-title" data-testid="upload-limits">
      <h2 id="upload-limits-title" className="flex items-center gap-1 text-lg font-semibold">{t("uploadLimits.title")}<HelpTip help={t("uploadLimits.help")} name={t("uploadLimits.title")} always /></h2>
      <p className="text-sm" data-testid="upload-limits-usage">
        {until !== null
          ? <span className={ui.chipWarn}>{t("uploadLimits.lifted", { time: timeKey(new Date(until), tz) })}</span>
          : since ? t("uploadLimits.since", { ...usage, time: timeKey(new Date(from), tz) }) : t("uploadLimits.today", usage)}
      </p>
      {until === null && (
        <ActionForm action={liftUploadLimitsAction} submitLabel={t("uploadLimits.lift")} pendingLabel={t("uploadLimits.lifting")} className="space-y-3">
          <Segmented label={t("uploadLimits.duration")} name="minutes" defaultValue={String(DEFAULT_LIFT_MINUTES)} options={LIFT_MINUTES.map((n) => ({ value: String(n), label: t("uploadLimits.minutes", { n }) }))} />
        </ActionForm>
      )}
      <form action={resetDailyQuotaAction} className="border-t border-line pt-4">
        <ConfirmButton danger={false} message={t("uploadLimits.reset.confirm")} confirmLabel={t("uploadLimits.reset")} pendingLabel={t("uploadLimits.resetting")}>{t("uploadLimits.reset")}</ConfirmButton>
      </form>
    </section>
  );
}
