import { adminCtx } from "@/core/admin";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const { t, advanced } = await adminCtx("owner");
  const labels = Object.fromEntries(
    ["migrated", "migrationFailed", "file", "password", "check", "apply", "cancel", "done", "login", "entries", "users", "instances", "uploads", "replaceWarning", "confirmReplace", "trustCustom",
      "status.installed", "status.catalogue", "status.custom", "status.unavailable", "outcome.kept", "outcome.installed", "outcome.skipped", "outcome.failed", "outcome.unavailable",
      "error.wrong-password", "error.not-a-backup", "error.corrupt", "error.tampered", "error.newer-format", "error.newer-schema", "error.no-owner", "error.no-file", "error.too-large", "error.expired", "error.failed", "error.network", "error.forbidden", "error.unauthorized"]
      .map((k) => [k, t(`backup.${k}`)]),
  );
  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.backup")} intro={t("backup.intro")} />

      <Panel title={t("backup.createTitle")} help={t("backup.createHelp")}>
        <Callout tone="warn">{t("backup.passwordWarning", { n: MIN_PASSWORD_LENGTH })}</Callout>
        <form method="post" action="/api/admin/backup" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm"><span className={ui.label}>{t("backup.password")}</span><input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={ui.input} /></label>
            <label className="block text-sm"><span className={ui.label}>{t("backup.passwordConfirm")}</span><input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={ui.input} /></label>
          </div>
          <button className={ui.btnPrimary}>{t("backup.createButton")}</button>
        </form>
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
