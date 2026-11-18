import type { AdminField, Block } from "@/core/blocks";
import type { Translator } from "@/core/i18n/dictionary";
import { numberHint, valueErrorKey } from "@/core/adminkit/hints";
import { summarizeGroup } from "@/core/adminkit/summary";
import type { FormLabels } from "./AdminBlocks";
import type { TableLabels } from "./TableView";
import type { ConnectionLabels } from "./ConnectionCard";
import { periodLabels } from "./periodLabels";
import en from "@/locales/en.json";

/** (0.19.0) Every `compose.*` text of the composition editor (sent only with a gallery that places text). */
const COMPOSE_KEYS = Object.keys(en).filter((k) => k.startsWith("compose."));

/** The `gallery.*` texts the gallery field needs, with their `{vars}` left for the field to fill. */
const GALLERY_KEYS = [
  "add", "empty", "count", "full", "item", "remove", "earlier", "later", "moved", "removed", "added", "caption", "captionFor", "sending", "retry", "drop",
  "name.image", "name.video", "name.audio", "kind.image", "kind.video", "kind.audio", "types.image", "types.video", "types.audio", "example.image", "example.video", "example.audio",
  "added.one", "error.limit.one", "library", "libSearch", "libNone", "libClear", "libAdd", "libTaken", "libMore", "libClose", "busy", "error.type", "error.size", "error.network", "error.limit",
].map((k) => `gallery.${k}`);

/** Les textes (traduits côté serveur) du bloc `table` enrichi. */
export function tableLabels(t: Translator): TableLabels {
  return {
    search: t("search.placeholder"), none: t("search.none"), clear: t("search.clear"), all: t("table.all"), count: t("search.count"),
    prev: t("table.prev"), next: t("table.next"), page: t("table.page"), pages: t("table.pages"), actions: t("table.actions"), menu: t("table.menu"),
    saved: t("switch.saved"), failed: t("switch.failed"), on: t("switch.on"), off: t("switch.off"),
  };
}

/** (0.36.0) The texts of the `connection` block: the three state words are written here, never by the module (R33). */
export function connectionLabels(t: Translator): ConnectionLabels {
  return { state: { configured: t("connection.state.configured"), degraded: t("connection.state.degraded"), notConfigured: t("connection.state.notConfigured") }, edit: t("connection.edit"), since: t("connection.since"), menu: t("connection.menu"), rows: t("connection.rowsMenu") };
}

/**
 * Les textes d'un formulaire d'administration d'un module (contrôles de la 0.6.0) et ce qui se calcule champ par champ : l'indication des nombres bornés,
 * le résumé du groupe replié « Plus d'options ».
 */
export function formLabels(t: Translator, locale: string, block: Extract<Block, { type: "adminForm" }>): FormLabels {
  const hints: Record<string, string> = {};
  const invalid: Record<string, string> = {};
  for (const f of block.fields as AdminField[]) {
    if ((f.kind === "number" || f.kind === "duration") && (f.min !== undefined || f.max !== undefined || f.step !== undefined)) {
      { const e = valueErrorKey("range", { type: f.kind, min: f.min, max: f.max, step: f.step, default: f.kind === "number" && f.placeholder !== undefined && Number.isFinite(Number(f.placeholder)) ? Number(f.placeholder) : undefined }, t); invalid[f.name] = t(e.key, { field: f.label, ...e.vars }); }
      hints[f.name] = numberHint(t, { type: f.kind, min: f.min, max: f.max, step: f.step }, f.kind === "number" ? f.unit : undefined);
    }
  }
  const folded = block.fields.filter((f) => f.folded && f.kind !== "hidden");
  const fold = folded.length
    ? summarizeGroup(folded.map((f) => ({ key: f.name, label: f.label, type: f.kind === "switch" || f.kind === "checkbox" ? "boolean" : f.kind === "select" || f.kind === "segmented" ? "select" : f.kind ?? "text", default: undefined, options: f.options, unit: f.unit, openEnded: f.openEnded })),
      (key) => { const f = folded.find((x) => x.name === key); const v = f?.value; return f && (f.kind === "switch" || f.kind === "checkbox") ? (["on", "1", "true"].includes(v ?? "") ? true : undefined) : v; }, locale, t)
    : undefined;
  return {
    locale, example: t("field.example", { example: "{example}" }), more: t("instances.s.more"),
    period: periodLabels(t),
    datetime: { date: t("datetime.date"), time: t("datetime.time"), clear: t("datetime.clear"), at: t("datetime.at"), preview: t("datetime.preview") },
    duration: { s: t("unit.s"), min: t("unit.min"), h: t("unit.h"), d: t("unit.d"), day: t("unit.day") },
    hints, invalid, fold,
    ...(block.fields.some((f) => f.valueHint) ? { valueHint: { kept: t("field.kept"), carried: t("field.carried", { source: "{source}" }) } } : {}),
    ...(block.fields.some((f) => f.kind === "gallery") ? { gallery: Object.fromEntries(GALLERY_KEYS.map((k) => [k, t(k)])) } : {}),
    ...(block.fields.some((f) => f.kind === "gallery" && f.compose) ? { compose: Object.fromEntries(COMPOSE_KEYS.map((k) => [k, t(k)])) } : {}),
    dialog: { close: t("modal.close"), cancel: t("editDialog.cancel"), saved: t("action.saved"), discard: { message: t("editDialog.message"), discard: t("editDialog.discard"), keep: t("editDialog.keep") } },
  };
}
