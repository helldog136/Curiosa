import type { Translator } from "@/core/i18n/dictionary";
import type { SettingsSearchLabels } from "./SettingsSearch";

/** The texts of the settings search, from the language files (the component is a client component and receives them as data). */
export const settingsSearchLabels = (t: Translator): SettingsSearchLabels => ({
  placeholder: t("settingsSearch.placeholder"), label: t("settingsSearch.label"), none: t("settingsSearch.none"), clear: t("settingsSearch.clear"), count: t("settingsSearch.count", { n: "{n}" }),
  moduleAll: t("settingsSearch.moduleAll"), moduleLabel: t("settingsSearch.moduleLabel"), advanced: t("settingsSearch.advanced"), modified: t("settingsSearch.modified"), all: t("settingsSearch.all"),
  filters: t("settingsSearch.filters"), seeAll: t("settingsSearch.seeAll"), setting: t("settingsSearch.setting"), section: t("settingsSearch.section"), empty: t("settingsSearch.empty"),
  loading: t("settingsSearch.loading"), failed: t("settingsSearch.failed"), more: t("search.more", { n: "{n}" }),
});
