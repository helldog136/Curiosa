import { adminCtx } from "@/core/admin";
import { MaintenanceHeader } from "@/components/admin/MaintenanceHeader";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { BackupForm } from "@/components/admin/BackupForm";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { RESTORE_KEYS } from "@/components/admin/restoreKeys";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { AutoBackupPanel, type AutoPanelView } from "@/components/admin/AutoBackupPanel";
import { SETTINGS_HREF } from "@/core/adminLinks";
import { readConfig } from "@/core/backup/auto/config";
import { formatBytes } from "@/core/backup/auto/message";
import { autoBackupStatus, recipientForm } from "@/core/backup/auto/view";
import { siteTimezone } from "@/core/siteTime";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("maint.tab.backup"));
}

export default async function BackupPage() {
  const { t, advanced, user, locale } = await adminCtx({ right: "core:backup" });
  const labels = Object.fromEntries(RESTORE_KEYS.map((k) => [k, t(`backup.${k}`)]));
  const auto = await autoPanel(t, locale);
  return (
    <div className="space-y-8">
      <MaintenanceHeader t={t} level={user.level} advanced={advanced} current="backup" />
      <PageHeader level={2} title={t("maint.tab.backup")} intro={t("backup.intro")} />

      <Panel title={t("backup.createTitle")} help={t("backup.createHelp")}>
        <Callout tone="warn">{t("backup.passwordWarning", { n: MIN_PASSWORD_LENGTH })}</Callout>
        <BackupForm minLength={MIN_PASSWORD_LENGTH} labels={Object.fromEntries(["password", "passwordConfirm", "createButton", "working", "downloaded", "failed", "error.mismatch", "error.too-short", "error.busy", "error.forbidden", "error.unauthorized", "error.network"].map((k) => [k, t(`backup.${k}`)]))} />
        {advanced && (
          <details className="text-sm">
            <summary className="cursor-pointer">{t("backup.readWithout")}</summary>
            <p className="mt-2">{t("backup.readWithoutHelp")}</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-surface p-3 text-xs">{`openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in backup.tar.gz.enc -out backup.tar.gz\ntar xzf backup.tar.gz`}</pre>
          </details>
        )}
      </Panel>

      <Panel title={t("autobackup.title")} help={t("autobackup.help")} testid="autobackup-panel">
        <AutoBackupPanel view={auto} labels={Object.fromEntries(AUTO_LABELS.map((k) => [k, t(`autobackup.${k}`)]))} />
      </Panel>

      <Panel title={t("backup.restoreTitle")} help={t("backup.restoreHelp")} tone="danger">
        <RestorePanel labels={labels} />
      </Panel>
    </div>
  );
}

const AUTO_LABELS = [
  "state.configured", "state.degraded", "state.notConfigured", "switchLabel", "on", "off", "failed", "needMail", "openMail", "frequency", "frequency.daily", "frequency.weekly", "frequency.monthly", "edit",
  "now", "nowWorking", "more", "saveOptions", "recipient", "recipient.owner", "recipient.user", "recipient.address", "recipient.account", "recipient.typed", "recipient.example", "limit", "limitHint",
  "renew", "renewWorking", "renewConfirm", "secretTitle", "secretTitleNew", "secretKeep", "secretOnce", "secretRegenerate", "copy", "copied", "secretDone",
] as const;

type T = Awaited<ReturnType<typeof adminCtx>>["t"];

/** What the panel shows, in words: the state, the last result, the next run, the recipient (masked), what to do when it is degraded. Never a secret. */
async function autoPanel(t: T, locale: string): Promise<AutoPanelView> {
  const [status, config, tz] = [await autoBackupStatus(), await readConfig(), await siteTimezone()];
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: tz }).format(new Date(iso));
  const recipient = await recipientForm(config);
  const last = status.last;
  const lastLine = !last ? t("autobackup.last.none")
    : !last.ok ? t("autobackup.last.failed", { date: when(last.at) })
    : t(last.attached ? "autobackup.last.ok" : "autobackup.last.tooBig", { date: when(last.at), size: formatBytes(last.sizeBytes ?? 0, t) });
  return {
    enabled: status.enabled, state: status.state, mailConfigured: status.mailConfigured, mailHref: `${SETTINGS_HREF}#mail`,
    frequency: status.frequency, maxMb: status.maxMb,
    recipientSummary: t("autobackup.recipientLine", { to: status.recipient ?? "—" }),
    recipient: { kind: recipient.kind, userId: recipient.userId, address: recipient.address, accounts: recipient.accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.masked})` })) },
    problem: status.reason ? { reason: t(`autobackup.reason.${status.reason}`), fix: t(`autobackup.fix.${status.reason}`), toMailSettings: status.reason.startsWith("mail_") } : null,
    lastLine,
    nextLine: status.nextAt ? t("autobackup.next", { date: day(status.nextAt) }) : "",
    download: status.kept ? { href: "/api/admin/backup/auto", label: t("autobackup.download", { date: when(new Date(status.kept.at).toISOString()), size: formatBytes(status.kept.bytes, t) }) } : null,
    moreSummary: t("autobackup.moreSummary", { max: status.maxMb, unit: t("autobackup.unit.mb") }),
  };
}
