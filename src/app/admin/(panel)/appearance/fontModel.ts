import type { Translator } from "@/core/i18n/dictionary";
import { previewStack } from "@/core/fonts/css";
import { loadLibrary } from "@/core/fonts/library";
import { FONT_GROUPS, SYSTEM_KEYS, type UploadedFont } from "@/core/fonts/types";
import { uploadFamilies, uploadWeights } from "@/core/fonts/registry";
import type { FontGroupModel, FontOption } from "./FontPickers";

/** Ce que les deux listes de polices montrent : « celle du skin », le système, la bibliothèque (par groupe), puis les polices envoyées. */
export function fontModel(t: Translator, uploads: readonly UploadedFont[]): { groups: FontGroupModel[]; options: FontOption[] } {
  const options: FontOption[] = [{ value: "", label: t("appearance.font.skin"), group: "", stack: null, info: null }];
  for (const k of SYSTEM_KEYS) options.push({ value: `sys:${k}`, label: t(`appearance.font.system.${k}`), group: "system", stack: previewStack(`sys:${k}`, []), info: { group: "system", weights: [400, 700] } });
  for (const f of loadLibrary().families) options.push({ value: `lib:${f.id}`, label: f.name, group: f.group, stack: previewStack(`lib:${f.id}`, []), info: { group: f.group, weights: f.weights } });
  const mine = uploadFamilies(uploads);
  for (const g of mine) options.push({ value: `up:${g.slug}`, label: g.family, group: "mine", stack: previewStack(`up:${g.slug}`, uploads), info: { group: "upload", weights: uploadWeights(g.files) } });
  const groups: FontGroupModel[] = [{ id: "system", label: t("appearance.font.group.system") }, ...FONT_GROUPS.map((id) => ({ id: id as string, label: t(`appearance.font.group.${id}`) })), ...(mine.length ? [{ id: "mine", label: t("appearance.font.group.mine") }] : [])];
  return { groups, options };
}
