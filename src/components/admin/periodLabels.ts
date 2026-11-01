import type { Translator } from "@/core/i18n/dictionary";
import { PRESETS } from "@/core/adminkit/periodPresets";
import type { PeriodLabels } from "./PeriodField";

/** Les textes (traduits côté serveur) d'un champ période, y compris « Tout le mois de » et « Une période toute prête ». */
export function periodLabels(t: Translator): PeriodLabels {
  return {
    from: t("period.from"), to: t("period.to"), yearly: t("period.yearly"), sentenceYearly: t("period.sentenceYearly"), sentenceOnce: t("period.sentenceOnce"),
    none: t("period.none"), clear: t("period.clear"), order: t("period.order"), month: t("period.month"), monthPick: t("period.monthPick"), incomplete: t("period.incomplete"),
    preset: t("period.preset"), presetPick: t("period.presetPick"), presetSearch: t("period.presetSearch"), presetEmpty: t("period.presetEmpty"), presetClear: t("period.presetClear"),
    presetNote: t("period.presetNote"), presetMoon: t("period.presetMoon"), presetEve: t("period.presetEve"),
    groups: { season: t("period.presetGroup.season"), fixed: t("period.presetGroup.fixed"), movable: t("period.presetGroup.movable") },
    names: Object.fromEntries(PRESETS.map((p) => [p.id, t(`period.preset.${p.id}`)])),
  };
}
