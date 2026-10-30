import { z } from "zod";

/**
 * CLÉ FACULTATIVE `overlayElements` DU module.json (cœur 0.5.0). Un module y déclare les ÉLÉMENTS qu'il propose aux pages d'overlay (docs/OVERLAY-ELEMENTS.md).
 * Sans cette clé, un module ne propose aucun élément : l'adoption est volontaire. Un cœur plus ancien ignore la clé : le module qui l'utilise indique `minCore: "0.5.0"`.
 *
 * Ce fichier ne contient que la FORME (zod) et les bornes dures ; il ne dépend de rien d'autre du cœur (le manifeste, l'éditeur et la page de rendu le lisent).
 * Vocabulaire interne : page d'overlay (canevas), élément (fragment), `scale` / `ratio` / `fluid` ; les personnes ne voient jamais ces noms (« garde ses proportions », « s'adapte à la taille choisie »).
 */

/** Version du cœur à partir de laquelle la clé existe. */
export const OVERLAY_ELEMENTS_MIN_CORE = "0.5.0";

export const FITS = ["scale", "ratio", "fluid"] as const;
export type Fit = (typeof FITS)[number];

/** Bornes dures (rien n'est lu ni dessiné sans borne). */
export const MAX_ELEMENTS_PER_MODULE = 20;
/** Borne dure technique du formulaire d'options d'un élément ; au-delà de `OPTIONS_FOLDED_AFTER`, le cœur range les suivantes sous « Plus d'options » (replié). */
export const MAX_OPTIONS = 20;
export const OPTIONS_FOLDED_AFTER = 8;
export const MAX_CHOICES = 30;
export const MAX_TEXT_LENGTH = 200;
export const MIN_PIXELS = 16;
export const MAX_PIXELS = 7680;

const localized = z.union([z.string().trim().min(1).max(300), z.record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), z.string().trim().min(1).max(300)).refine((r) => { const n = Object.keys(r).length; return n >= 1 && n <= 12; }, "1 to 12 languages")]);
const px = z.number().int().min(MIN_PIXELS).max(MAX_PIXELS);
const size = z.object({ width: px, height: px }).strict();

export const OPTION_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/;
export const ELEMENT_ID_RE = /^[a-z][a-z0-9-]{0,40}$/;

const optionBase = {
  id: z.string().regex(OPTION_ID_RE, "option id: letters, digits and _ (31 characters at most, starting with a letter)"),
  label: localized,
  help: localized.optional(),
  /** Exemple de valeur valable, montré dans le message d'erreur sous le champ (« Exemple : 20 »). */
  example: z.string().trim().min(1).max(60).optional(),
};

/** Une option : quatre types seulement (choix dans une liste, oui/non, nombre, texte court). */
const option = z.discriminatedUnion("type", [
  z.object({ ...optionBase, type: z.literal("choice"), choices: z.array(z.object({ value: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/), label: localized }).strict()).min(2).max(MAX_CHOICES), default: z.string().optional() }).strict(),
  z.object({ ...optionBase, type: z.literal("boolean"), default: z.boolean().optional() }).strict(),
  z.object({ ...optionBase, type: z.literal("number"), min: z.number().finite().optional(), max: z.number().finite().optional(), integer: z.boolean().optional(), default: z.number().finite().optional() }).strict(),
  z.object({ ...optionBase, type: z.literal("text"), maxLength: z.number().int().min(1).max(MAX_TEXT_LENGTH).optional(), default: z.string().max(MAX_TEXT_LENGTH).optional() }).strict(),
]);
export type OverlayOptionDecl = z.infer<typeof option>;

const ratioRange = z.object({ min: z.number().min(0.05).max(20), max: z.number().min(0.05).max(20) }).strict();

export const overlayElementSchema = z.object({
  id: z.string().regex(ELEMENT_ID_RE, "element id: lowercase letters, digits and dashes (41 characters at most, starting with a letter)"),
  label: localized,
  description: localized.optional(),
  /** « scale » (défaut) : taille naturelle `size`, mise à l'échelle, ratio verrouillé. « ratio » : `referenceHeight`, la largeur suit le cadre. « fluid » : taille réelle du cadre. */
  fit: z.enum(FITS).default("scale"),
  /** scale : taille naturelle. */
  size: size.optional(),
  /** ratio : hauteur de référence (la fenêtre virtuelle a cette hauteur et la largeur du ratio du cadre). */
  referenceHeight: px.optional(),
  /** ratio / fluid : plage de ratios largeur/hauteur acceptée. Obligatoire pour « ratio » ; facultative pour « fluid ». */
  ratios: ratioRange.optional(),
  /** ratio / fluid : taille minimale du cadre. */
  minSize: size.optional(),
  /** L'élément suit le style commun de la page (`--ov-*`). Défaut : oui. `false` : l'élément ne sait pas (ex. une scène 3D) et reste tel quel. */
  followsStyle: z.boolean().default(true),
  options: z.array(option).max(MAX_OPTIONS).default([]),
  /** L'élément sait montrer un contenu d'exemple quand l'adresse reçoit `ov-demo=1` (mode test). */
  demo: z.boolean().optional(),
}).strict().superRefine((e, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (e.fit === "scale") {
    if (!e.size) bad("size", "a scale element needs its natural size: size { width, height }");
    for (const k of ["referenceHeight", "ratios", "minSize"] as const) if (e[k] !== undefined) bad(k, `${k} is only for ratio and fluid elements`);
  }
  if (e.fit === "ratio") {
    if (e.referenceHeight === undefined) bad("referenceHeight", "a ratio element needs referenceHeight (e.g. 1080)");
    if (!e.ratios) bad("ratios", "a ratio element needs the range of ratios it supports: ratios { min, max }");
    if (e.size) bad("size", "size is only for scale elements");
  }
  if (e.fit === "fluid") {
    if (e.size) bad("size", "size is only for scale elements");
    if (e.referenceHeight !== undefined) bad("referenceHeight", "referenceHeight is only for ratio elements");
  }
  if (e.ratios && e.ratios.min > e.ratios.max) bad("ratios", "ratios.min cannot exceed ratios.max");
  const seen = new Set<string>();
  for (const [i, o] of e.options.entries()) {
    if (seen.has(o.id)) ctx.addIssue({ code: "custom", path: ["options", i, "id"], message: `duplicate option id "${o.id}"` });
    seen.add(o.id);
    if (o.type === "choice") {
      const values = o.choices.map((c) => c.value);
      if (new Set(values).size < values.length) ctx.addIssue({ code: "custom", path: ["options", i, "choices"], message: "choice values must be unique" });
      if (o.default !== undefined && !values.includes(o.default)) ctx.addIssue({ code: "custom", path: ["options", i, "default"], message: "the default must be one of the choices" });
    }
    if (o.type === "number") {
      if (o.min !== undefined && o.max !== undefined && o.min > o.max) ctx.addIssue({ code: "custom", path: ["options", i, "min"], message: "min cannot exceed max" });
      if (o.default !== undefined && ((o.min !== undefined && o.default < o.min) || (o.max !== undefined && o.default > o.max))) ctx.addIssue({ code: "custom", path: ["options", i, "default"], message: "the default must be between min and max" });
    }
  }
});

export type OverlayElementDecl = z.infer<typeof overlayElementSchema>;
export const overlayElementsSchema = z.array(overlayElementSchema).min(1).max(MAX_ELEMENTS_PER_MODULE);

/** Problèmes de cohérence entre la déclaration et le reste du manifeste (identifiants uniques, `minCore` ≥ 0.5.0). Pur. */
export function overlayElementIssues(elements: readonly OverlayElementDecl[] | undefined, minCore: string | undefined): { path: (string | number)[]; message: string }[] {
  if (!elements) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const ids = elements.map((e) => e.id);
  if (new Set(ids).size < ids.length) out.push({ path: [], message: "duplicate element id" });
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(minCore ?? "");
  const ok = m && (Number(m[1]) > 0 || Number(m[2]) >= 5);
  if (!ok) out.push({ path: [], message: `overlayElements needs minCore ${OVERLAY_ELEMENTS_MIN_CORE} or later (an older core ignores the key)` });
  return out;
}
