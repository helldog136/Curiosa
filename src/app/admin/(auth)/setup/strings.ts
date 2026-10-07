import { makeTranslator } from "@/core/i18n/dictionary";
import { UI_LOCALES } from "@/core/i18n/dictionary";

const KEYS = [
  "setup.title", "setup.step", "setup.next", "setup.back", "setup.finish",
  "setup.language.title", "setup.language.default", "setup.language.defaultHelp", "setup.language.extra", "setup.language.extraHelp",
  "setup.identity.title", "setup.identity.name", "setup.identity.tagline",
  "setup.content.title", "setup.content.help",
  "setup.links.title", "setup.links.help", "setup.links.label", "setup.links.url", "setup.links.icon", "setup.links.iconHelp", "setup.links.add", "setup.links.shortcut",
  "setup.account.title", "setup.account.name", "setup.account.email", "setup.account.password", "setup.account.passwordHelp", "setup.account.token", "setup.account.tokenHelp",
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
