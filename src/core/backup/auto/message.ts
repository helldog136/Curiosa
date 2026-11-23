import type { Translator } from "@/core/i18n/dictionary";

/** `4.2 MB`, `830 KB` (`Mo`, `Ko` in French): decimal units, one decimal for the megabytes. */
export function formatBytes(bytes: number, t?: Translator): string {
  const mb = t ? t("autobackup.unit.mb") : "MB", kb = t ? t("autobackup.unit.kb") : "KB";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} ${mb}`;
  return `${Math.max(1, Math.round(bytes / 1000))} ${kb}`;
}

/**
 * The e-mail of an automatic backup, in the language of the admin. Plain words, no personal data (no name, no address), never the passphrase.
 * `attached` false: the file was over the limit, it is not in the mail and stays on the server.
 */
export function backupMail(t: Translator, v: { site: string; day: string; filename: string; sizeBytes: number; limitMb: number; attached: boolean; kept: boolean }): { subject: string; text: string } {
  const vars = { site: v.site, date: v.day, file: v.filename, size: formatBytes(v.sizeBytes, t), limit: `${v.limitMb} ${t("autobackup.unit.mb")}` };
  const lines = v.attached
    ? [t("autobackup.mail.intro", vars), t("autobackup.mail.attached", vars), "", t("autobackup.mail.encrypted"), t("autobackup.mail.restore"), t("autobackup.mail.off")]
    : [t("autobackup.mail.intro", vars), t("autobackup.mail.tooBig", vars), v.kept ? t("autobackup.mail.kept") : "", "", t("autobackup.mail.off")];
  return { subject: t(v.attached ? "autobackup.mail.subject" : "autobackup.mail.subjectNotice", vars), text: lines.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n") };
}
