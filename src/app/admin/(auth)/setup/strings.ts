import { makeTranslator } from "@/core/i18n/dictionary";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { RESTORE_KEYS } from "@/components/admin/restoreKeys";
import { PROGRESS_LABEL_KEYS } from "@/components/admin/progressLabelKeys";

// Every text of the page is in the language the person chose in the wizard (not the language the admin layout resolved): the action buttons and error messages included.
const PROGRESS_KEYS = PROGRESS_LABEL_KEYS.map((k) => `progress.${k}`);
const BASE_KEYS = [
  "setup.title", "setup.step", "setup.next", "setup.back", "setup.finish",
  "setup.language.title", "setup.language.default", "setup.language.defaultHelp", "setup.language.extra", "setup.language.extraHelp",
  "setup.identity.title", "setup.identity.name", "setup.identity.tagline",
  "setup.modules.title", "setup.modules.help", "setup.modules.skipButton", "setup.modules.none", "setup.modules.unreachable",
  "setup.profile.title", "setup.profile.help", "setup.profile.other", "setup.profile.skipButton",
  "setup.samples.title", "setup.samples.help", "setup.samples.summary", "setup.samples.summary.one",
  "setup.links.title", "setup.links.help", "setup.links.label", "setup.links.url", "setup.links.icon", "setup.links.iconHelp", "setup.links.add", "setup.links.shortcut",
  "setup.welcome.title", "setup.welcome.text", "setup.welcome.name", "setup.welcome.nameHelp", "setup.account.help",
  "setup.account.title", "setup.account.name", "setup.account.email", "setup.account.password", "setup.account.passwordHelp", "setup.account.token", "setup.account.tokenHelp", "setup.account.emailExample", "setup.account.confirm", "progress.showPassword", "progress.hidePassword",
  "setup.restore.link", "setup.restore.title", "setup.restore.help", "setup.restore.back", "setup.restore.token",
];
const RESTORE = RESTORE_KEYS.map((k) => `backup.${k}`);
const KEYS = [...new Set([...PROGRESS_KEYS, ...RESTORE, ...BASE_KEYS])];

/** Textes de l'assistant, dans chaque langue d'interface disponible (l'assistant change de langue en direct). */
export function getAllSetupStrings(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of UI_LOCALES) {
    const t = makeTranslator(locale); // a missing text of a partial language falls back to English
    out[locale] = Object.fromEntries(KEYS.map((k) => [k, t(k)]));
  }
  return out;
}
