import { adminCtx } from "@/core/admin";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { BackupForm } from "@/components/admin/BackupForm";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const { t, advanced } = await adminCtx("owner");
  const labels = Object.fromEntries(
    ["deps.missing", "deps.provided", "deps.note", "deps.title", "migrated", "migrationFailed", "file", "password", "check", "apply", "cancel", "done", "login", "entries", "users", "instances", "uploads", "replaceWarning", "confirmReplace", "trustCustom",
      "status.installed", "status.catalogue", "status.custom", "status.unavailable", "outcome.kept", "outcome.installed", "outcome.skipped", "outcome.failed", "outcome.unavailable", "skin", "status.skinPersonal", "trustCustomSkin", "skinOutcome.kept", "skinOutcome.installed", "skinOutcome.skipped", "skinOutcome.failed",
      "error.wrong-password", "error.not-a-backup", "error.corrupt", "error.tampered", "error.newer-format", "error.newer-schema", "error.no-owner", "error.no-file", "error.too-large", "error.expired", "error.failed", "error.network", "error.forbidden", "error.unauthorized"]
      .map((k) => [k, t(`backup.${k}`)]),
  );
  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.backup")} intro={t("backup.intro")} />

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

      <Panel title={t("backup.restoreTitle")} help={t("backup.restoreHelp")} tone="danger">
        <RestorePanel labels={labels} />
      </Panel>
    </div>
  );
}
