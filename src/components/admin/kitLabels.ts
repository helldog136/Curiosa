import type { AdminField, Block } from "@/core/blocks";
import type { Translator } from "@/core/i18n/dictionary";
import { numberHint } from "@/core/adminkit/hints";
import { summarizeGroup } from "@/core/adminkit/summary";
import type { FormLabels } from "./AdminBlocks";
import type { TableLabels } from "./AdminTable";

/** Les textes (traduits côté serveur) du bloc `table` enrichi. */
export function tableLabels(t: Translator): TableLabels {
  return {
    search: t("search.placeholder"), none: t("search.none"), clear: t("search.clear"), all: t("table.all"), count: t("search.count"),
    prev: t("table.prev"), next: t("table.next"), page: t("table.page"), pages: t("table.pages"), actions: t("table.actions"), menu: t("table.menu"),
    saved: t("switch.saved"), failed: t("switch.failed"), on: t("switch.on"), off: t("switch.off"),
  };
}

/**
 * Les textes d'un formulaire d'administration d'un module (contrôles de la 0.6.0) et ce qui se calcule champ par champ : l'indication des nombres bornés,
 * le résumé du groupe replié « Plus d'options ».
 */
export function formLabels(t: Translator, locale: string, block: Extract<Block, { type: "adminForm" }>): FormLabels {
  const hints: Record<string, string> = {};
  for (const f of block.fields as AdminField[]) {
    if ((f.kind === "number" || f.kind === "duration") && (f.min !== undefined || f.max !== undefined || f.step !== undefined)) {
      hints[f.name] = numberHint(t, { type: f.kind, min: f.min, max: f.max, step: f.step }, f.kind === "number" ? f.unit : undefined);
    }
  }
  const folded = block.fields.filter((f) => f.folded && f.kind !== "hidden");
  const fold = folded.length
    ? summarizeGroup(folded.map((f) => ({ key: f.name, label: f.label, type: f.kind === "switch" || f.kind === "checkbox" ? "boolean" : f.kind === "select" || f.kind === "segmented" ? "select" : f.kind ?? "text", default: undefined, options: f.options, unit: f.unit })),
      (key) => { const f = folded.find((x) => x.name === key); const v = f?.value; return f && (f.kind === "switch" || f.kind === "checkbox") ? (["on", "1", "true"].includes(v ?? "") ? true : undefined) : v; }, locale, t)
    : undefined;
  return {
    locale, example: t("field.example", { example: "{example}" }), more: t("instances.s.more"),
    period: { from: t("period.from"), to: t("period.to"), yearly: t("period.yearly"), sentenceYearly: t("period.sentenceYearly"), sentenceOnce: t("period.sentenceOnce"), none: t("period.none"), clear: t("period.clear"), order: t("period.order") },
    datetime: { date: t("datetime.date"), time: t("datetime.time"), clear: t("datetime.clear"), at: t("datetime.at"), preview: t("datetime.preview") },
    duration: { s: t("unit.s"), min: t("unit.min"), h: t("unit.h"), d: t("unit.d"), day: t("unit.day") },
    hints, fold,
  };
}
