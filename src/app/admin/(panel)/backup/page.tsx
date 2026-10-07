import { adminCtx } from "@/core/admin";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { ui } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const { t } = await adminCtx("owner");
  const labels = Object.fromEntries(
    ["migrated", "migrationFailed", "file", "password", "check", "apply", "cancel", "done", "login", "entries", "users", "instances", "uploads", "replaceWarning", "confirmReplace", "trustCustom",
      "status.installed", "status.marketplace", "status.custom", "status.unavailable", "outcome.kept", "outcome.installed", "outcome.skipped", "outcome.failed", "outcome.unavailable",
      "error.wrong-password", "error.not-a-backup", "error.corrupt", "error.tampered", "error.newer-format", "error.no-owner", "error.no-file", "error.too-large", "error.expired", "error.failed", "error.network", "error.forbidden", "error.unauthorized"]
      .map((k) => [k, t(`backup.${k}`)]),
  );
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">💾 {t("nav.backup")}</h1>
        <p className="mt-1 text-sm text-muted">{t("backup.intro")}</p>
      </div>

      <section className={`${ui.card} space-y-3`}>
        <h2 className="text-lg font-semibold">{t("backup.createTitle")}</h2>
        <p className="text-sm">{t("backup.createHelp")}</p>
        <form method="post" action="/api/admin/backup" className="space-y-3">
          <label className="block text-sm"><span className={ui.label}>{t("backup.password")}</span><input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={ui.input} /></label>
          <label className="block text-sm"><span className={ui.label}>{t("backup.passwordConfirm")}</span><input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={ui.input} /></label>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("backup.passwordWarning", { n: MIN_PASSWORD_LENGTH })}</p>
          <button className={ui.btnPrimary}>{t("backup.createButton")}</button>
        </form>
        <details className="text-sm">
          <summary className="cursor-pointer">{t("backup.readWithout")}</summary>
          <p className="mt-2">{t("backup.readWithoutHelp")}</p>
          <pre className="mt-2 overflow-auto rounded-lg bg-surface p-3 text-xs">{`openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in backup.tar.gz.enc -out backup.tar.gz\ntar xzf backup.tar.gz`}</pre>
        </details>
      </section>

      <section className={`${ui.card} space-y-3`}>
        <h2 className="text-lg font-semibold">{t("backup.restoreTitle")}</h2>
        <p className="text-sm">{t("backup.restoreHelp")}</p>
        <RestorePanel labels={labels} />
      </section>
    </div>
  );
}
