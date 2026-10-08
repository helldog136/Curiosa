import { makeTranslator } from "@/core/i18n/dictionary";
import { UI_LOCALES } from "@/core/i18n/dictionary";

const KEYS = [
  "setup.title", "setup.step", "setup.next", "setup.back", "setup.finish",
  "setup.language.title", "setup.language.default", "setup.language.defaultHelp", "setup.language.extra", "setup.language.extraHelp",
  "setup.identity.title", "setup.identity.name", "setup.identity.tagline",
  "setup.modules.title", "setup.modules.help", "setup.modules.skip", "setup.modules.skipButton", "setup.modules.none",
  "setup.links.title", "setup.links.help", "setup.links.label", "setup.links.url", "setup.links.icon", "setup.links.iconHelp", "setup.links.add", "setup.links.shortcut",
  "setup.welcome.title", "setup.welcome.text", "setup.welcome.name", "setup.welcome.nameHelp", "setup.account.help",
  "setup.account.title", "setup.account.name", "setup.account.email", "setup.account.password", "setup.account.passwordHelp", "setup.account.token", "setup.account.tokenHelp",
  "setup.restore.link", "setup.restore.title", "setup.restore.help", "setup.restore.back", "setup.restore.token",
  "backup.file", "backup.password", "backup.check", "backup.apply", "backup.cancel", "backup.done", "backup.login", "backup.entries", "backup.users", "backup.instances", "backup.uploads", "backup.replaceWarning", "backup.confirmReplace", "backup.trustCustom", "backup.status.installed", "backup.status.catalogue", "backup.status.custom", "backup.status.unavailable", "backup.outcome.kept", "backup.outcome.installed", "backup.outcome.skipped", "backup.outcome.failed", "backup.outcome.unavailable", "backup.error.wrong-password", "backup.error.not-a-backup", "backup.error.corrupt", "backup.error.tampered", "backup.error.newer-format", "backup.error.newer-schema", "backup.error.no-owner", "backup.error.no-file", "backup.error.too-large", "backup.error.expired", "backup.error.failed", "backup.error.network", "backup.error.forbidden", "backup.error.unauthorized", "backup.error.already-configured", "backup.error.invalid-token", "backup.migrated", "backup.migrationFailed",
];

/** Textes de l'assistant, dans chaque langue d'interface disponible (l'assistant change de langue en direct). */
export function getAllSetupStrings(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of UI_LOCALES) {
    const t = makeTranslator(locale);
    out[locale] = Object.fromEntries(KEYS.map((k) => [k, t(k)]));
  }
  return out;
}
