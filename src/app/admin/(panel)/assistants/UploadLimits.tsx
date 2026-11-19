import type { Translator } from "@/core/i18n/dictionary";
import { DAILY_BYTES, DAILY_FILES, usedToday } from "@/core/mediaMcp";
import { DAILY_BYTES as FILES_DAILY_BYTES, DAILY_FILES as FILES_DAILY, usedToday as filesUsedToday } from "@/core/services/assistantUploads";
import { dailyWindowStart, DEFAULT_LIFT_MINUTES, LIFT_MINUTES, liftDeps, liftedUntil } from "@/core/services/mcp/uploadLift";
import { siteTimezone, timeKey } from "@/core/siteTime";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { HelpTip } from "@/components/admin/HelpTip";
import { Callout } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { Segmented } from "@/components/admin/Segmented";
import { MoreOptions } from "@/components/admin/MoreOptions";
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
 * "Uploads by assistants" (Admin > AI assistants > Settings), owner only. Lifting the limits and starting the count over are rare actions (R2, R3, R33.1), so
 * they live in a closed fold whose one-line summary gives the counts; nothing is drawn as a filled button. "Start over" is offered only when something was
 * counted. While the limits are lifted the fold is open (the stop button is also in the banner above). Both actions cover the images (media_upload,
 * media_import) AND, since 0.28.2, the files a module tool receives (ctx.api.files.upload). The megabytes are in the "?" (R32).
 */
export async function UploadLimits({ t, locale }: { t: Translator; locale: string }) {
  const [until, day, files, from, tz] = await Promise.all([liftedUntil(), usedToday(), filesUsedToday(), dailyWindowStart(), siteTimezone()]);
  const since = from > liftDeps.now() - 86_400_000 + 60_000; // the owner started over within the last 24 hours
  const usage = { images: day.files, maxImages: DAILY_FILES, files: files.files, maxFiles: FILES_DAILY };
  const detail = t("uploadLimits.usage.help", { imageMb: mb(day.bytes, locale), maxImageMb: mb(DAILY_BYTES, locale), fileMb: mb(files.bytes, locale), maxFileMb: mb(FILES_DAILY_BYTES, locale) });
  const counted = day.files > 0 || files.files > 0;
  const line = until !== null ? t("uploadLimits.lifted", { time: timeKey(new Date(until), tz) }) : since ? t("uploadLimits.since", { ...usage, time: timeKey(new Date(from), tz) }) : t("uploadLimits.today", usage);
  return (
    <div data-testid="upload-limits" aria-label={t("uploadLimits.title")}>
      <MoreOptions title={t("uploadLimits.title")} summary={line} defaultOpen={until !== null}>
        <p className="flex items-center gap-1 text-sm" data-testid="upload-limits-usage">
          {line}<HelpTip help={`${t("uploadLimits.help")} ${detail}`} name={t("uploadLimits.title")} always />
        </p>
        {until === null && (
          <ActionForm action={liftUploadLimitsAction} submitLabel={t("uploadLimits.lift")} pendingLabel={t("uploadLimits.lifting")} className="space-y-3" secondary>
            <Segmented label={t("uploadLimits.duration")} name="minutes" defaultValue={String(DEFAULT_LIFT_MINUTES)} options={LIFT_MINUTES.map((n) => ({ value: String(n), label: t("uploadLimits.minutes", { n }) }))} />
          </ActionForm>
        )}
        {counted && (
          <form action={resetDailyQuotaAction} className="border-t border-line pt-4">
            <ConfirmButton danger={false} message={t("uploadLimits.reset.confirm")} confirmLabel={t("uploadLimits.reset")} pendingLabel={t("uploadLimits.resetting")}>{t("uploadLimits.reset")}</ConfirmButton>
          </form>
        )}
      </MoreOptions>
    </div>
  );
}
