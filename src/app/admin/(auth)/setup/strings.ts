import { makeTranslator } from "@/core/i18n/dictionary";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { PROGRESS_LABEL_KEYS } from "@/components/admin/progressLabelKeys";

// Every text of the page is in the language the person chose in the wizard (not the language the admin layout resolved): the action buttons and error messages included.
const PROGRESS_KEYS = PROGRESS_LABEL_KEYS.map((k) => `progress.${k}`);
const BASE_KEYS = [
  "setup.title", "setup.step", "setup.next", "setup.back", "setup.finish",
  "setup.language.title", "setup.language.default", "setup.language.defaultHelp", "setup.language.extra", "setup.language.extraHelp",
  "setup.identity.title", "setup.identity.name", "setup.identity.tagline",
  "setup.modules.title", "setup.modules.help", "setup.modules.skip", "setup.modules.skipButton", "setup.modules.none", "setup.modules.unreachable",
  "setup.profile.title", "setup.profile.help", "setup.profile.other", "setup.profile.otherHelp", "setup.profile.skip", "setup.profile.skipButton",
  "setup.samples.title", "setup.samples.help", "setup.samples.summary", "setup.samples.summary.one",
  "setup.links.title", "setup.links.help", "setup.links.label", "setup.links.url", "setup.links.icon", "setup.links.iconHelp", "setup.links.add", "setup.links.shortcut",
  "setup.welcome.title", "setup.welcome.text", "setup.welcome.name", "setup.welcome.nameHelp", "setup.account.help",
  "setup.account.title", "setup.account.name", "setup.account.email", "setup.account.password", "setup.account.passwordHelp", "setup.account.token", "setup.account.tokenHelp", "setup.account.emailExample", "setup.account.confirm", "progress.showPassword", "progress.hidePassword",
  "setup.restore.link", "setup.restore.title", "setup.restore.help", "setup.restore.back", "setup.restore.token",
  "backup.file", "backup.password", "backup.check", "backup.apply", "backup.cancel", "backup.done", "backup.login", "backup.entries", "backup.users", "backup.instances", "backup.uploads", "backup.replaceWarning", "backup.confirmReplace", "backup.trustCustom", "backup.status.installed", "backup.status.catalogue", "backup.status.custom", "backup.status.unavailable", "backup.outcome.kept", "backup.outcome.installed", "backup.outcome.skipped", "backup.outcome.failed", "backup.outcome.unavailable", "backup.skin", "backup.status.skinPersonal", "backup.trustCustomSkin", "backup.skinOutcome.kept", "backup.skinOutcome.installed", "backup.skinOutcome.skipped", "backup.skinOutcome.failed", "backup.error.wrong-password", "backup.error.not-a-backup", "backup.error.corrupt", "backup.error.tampered", "backup.error.newer-format", "backup.error.newer-schema", "backup.error.no-owner", "backup.error.no-file", "backup.error.too-large", "backup.error.expired", "backup.error.failed", "backup.error.network", "backup.error.forbidden", "backup.error.unauthorized", "backup.error.already-configured", "backup.error.invalid-token", "backup.deps.missing", "backup.deps.provided", "backup.deps.note", "backup.deps.title", "backup.migrated", "backup.migrationFailed",
];
const KEYS = [...new Set([...PROGRESS_KEYS, ...BASE_KEYS])];

/** Textes de l'assistant, dans chaque langue d'interface disponible (l'assistant change de langue en direct). */
export function getAllSetupStrings(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of UI_LOCALES) {
    const t = makeTranslator(locale); // a missing text of a partial language falls back to English
    out[locale] = Object.fromEntries(KEYS.map((k) => [k, t(k)]));
  }
  return out;
}
