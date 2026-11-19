/**
 * The MODEL the customization page is drawn from (docs/SKINS.md "Customization"): the skin's cleaned declaration, in the viewer's language, with the current values.
 * Pure: no database, no Next. The page is generic; this is the only place that knows how a control becomes something to draw. The skin supplies labels and hints only:
 * every other sentence of the page is the core's own, in the language files.
 */
import { CUSTOMIZE_LIMITS, type Control, type CustomizeDecl, type Loc, type UploadedPicture } from "@/core/skins/customizeSpec";
import type { Resolved, Signal } from "@/core/skins/customizeResolve";
import type { SkinOption } from "@/core/skins/types";
import { OPTION_PREFIX } from "./shared";

export type Lang = "fr" | "en";
const pick = (l: Loc, lang: Lang): string => l[lang];

export type CzControl = {
  id: string;
  type: "color" | "choice" | "toggle" | "slider" | "image";
  label: string;
  hint?: string;
  featured: boolean;
  default: unknown;
  /** The skin's own option shown as a choice: saved with the skin's options, not with the customization. */
  option?: boolean;
  swatches?: { id: string; label: string; light: string; dark: string }[];
  /** A free colour is allowed (inside the range the skin declares). */
  custom?: boolean;
  choices?: { id: string; label: string }[];
  segmented?: boolean;
  min?: number; max?: number; step?: number; unit?: string;
  pictures?: { id: string; label: string; url: string }[];
  upload?: { formats: string[]; ratio: [number, number]; minWidth: number; maxWidth: number; maxKb: number; focal: boolean; animated: boolean };
};
export type CzGroup = { id: string; label: string; folded: boolean; controls: CzControl[] };
export type CzModel = {
  skin: { id: string; name: string };
  looks: { id: string; label: string; values: Record<string, unknown> }[];
  groups: CzGroup[];
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  look: string | null;
  signals: Signal[];
  /** Pictures an owner uploaded whose file is gone. */
  missing: string[];
  /** Addresses of the uploaded pictures, by file name, for the thumbnails. */
  pictureCount: number;
  limits: { uploadFiles: number };
};

const assetUrl = (skinId: string, version: string, file: string): string => `/skins/${skinId}/${version}/${file}`;

function controlModel(c: Control, lang: Lang, skin: { id: string; version: string }): CzControl {
  const base = { id: c.id, label: pick(c.label, lang), ...(c.hint ? { hint: pick(c.hint, lang) } : {}), featured: c.featured, default: c.default };
  switch (c.type) {
    case "color": return { ...base, type: "color", swatches: c.palette.map((p) => ({ id: p.id, label: pick(p.label, lang), light: p.light, dark: p.dark })), custom: !!c.custom };
    case "choice": return { ...base, type: "choice", choices: c.values.map((v) => ({ id: v.id, label: pick(v.label, lang) })), segmented: c.display !== "chips" && c.values.length <= CUSTOMIZE_LIMITS.segmented };
    case "toggle": return { ...base, type: "toggle" };
    case "slider": return { ...base, type: "slider", min: c.min, max: c.max, step: c.step, unit: c.unit };
    case "image": return {
      ...base, type: "image",
      pictures: c.alternatives.map((a) => ({ id: a.id, label: pick(a.label, lang), url: assetUrl(skin.id, skin.version, a.file) })),
      ...(c.upload ? { upload: { formats: c.upload.formats, ratio: c.upload.ratio, minWidth: c.upload.minPx[0], maxWidth: c.upload.maxPx[0], maxKb: c.upload.maxKb, focal: c.upload.focal, animated: c.upload.animated } } : {}),
    };
  }
}

/** The skin's own `options` become one group of choices ("Variants"): the page treats them like any other choice. */
export function optionControls(options: readonly SkinOption[], chosen: Record<string, string>, lang: Lang): { controls: CzControl[]; values: Record<string, string>; defaults: Record<string, string> } {
  const controls: CzControl[] = [], values: Record<string, string> = {}, defaults: Record<string, string> = {};
  for (const o of options) {
    const id = `${OPTION_PREFIX}${o.id}`;
    controls.push({ id, type: "choice", label: pick(o.label, lang), featured: false, default: o.default, option: true, choices: o.values.map((v) => ({ id: v.id, label: pick(v.label, lang) })), segmented: o.values.length <= CUSTOMIZE_LIMITS.segmented });
    values[id] = o.values.some((v) => v.id === chosen[o.id]) ? chosen[o.id]! : o.default;
    defaults[id] = o.default;
  }
  return { controls, values, defaults };
}

export function buildModel(args: {
  skin: { id: string; version: string; name: Loc };
  decl: CustomizeDecl | null;
  resolved: Resolved | null;
  storedLook: string | null;
  signals: Signal[];
  options: { controls: CzControl[]; values: Record<string, string>; defaults: Record<string, string> };
  pictureCount: number;
  lang: Lang;
  variantsLabel: string;
}): CzModel {
  const { decl, resolved, lang } = args;
  const groups: CzGroup[] = (decl?.groups ?? []).map((g) => ({ id: g.id, label: pick(g.label, lang), folded: g.folded, controls: g.controls.map((c) => controlModel(c, lang, args.skin)) }));
  if (args.options.controls.length > 0) groups.push({ id: "variants", label: args.variantsLabel, folded: true, controls: args.options.controls });
  const defaults: Record<string, unknown> = { ...args.options.defaults };
  for (const g of decl?.groups ?? []) for (const c of g.controls) defaults[c.id] = c.default;
  return {
    skin: { id: args.skin.id, name: pick(args.skin.name, lang) },
    looks: (decl?.looks ?? []).map((l) => ({ id: l.id, label: pick(l.label, lang), values: l.values })),
    groups,
    values: { ...args.options.values, ...(resolved?.values ?? {}) },
    defaults,
    look: args.storedLook,
    signals: args.signals,
    missing: resolved?.missing ?? [],
    pictureCount: args.pictureCount,
    limits: { uploadFiles: CUSTOMIZE_LIMITS.uploadFiles },
  };
}

export type { UploadedPicture };
