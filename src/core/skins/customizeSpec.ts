/**
 * SKIN CUSTOMIZATION (core 0.44.0, docs/SKINS.md "Customization"): the types and the fixed limits of the `customize` section of a site skin's `skin.json`.
 *
 * Principle: the core is a shell. A skin DECLARES what the owner may change (data only, never code); the core renders one generic page from that
 * declaration and applies VALIDATED values as `--sk-cz-<id>` custom properties. A skin cannot raise a limit, supply a sentence, or add a variable name.
 * PURE module: no file, database or network access.
 */

export type Loc = { fr: string; en: string };
export type Mode = "light" | "dark";

/** The version of the `customize` section this core reads. A skin written for a later one is read as "no customization" (with a warning), never refused. */
export const CUSTOMIZE_VERSION = 1;
/** The lowest `skinContract` of a site skin that may carry `customize` (older cores refuse such a skin cleanly: "contract newer"). */
export const CUSTOMIZE_CONTRACT = 4;

/** Limits fixed by the core: they keep the generic page inside the budgets R2, R4, R5 and R19 of docs/ERGONOMIE-ADMIN.md whatever a skin declares. */
export const CUSTOMIZE_LIMITS = {
  groups: 5,
  perGroup: 7,
  controls: 24,
  featured: 2,
  looks: 8,
  choices: 10,
  /** Up to this many choices are drawn as side-by-side buttons; more as chips. */
  segmented: 4,
  alternatives: 8,
  label: 40,
  hint: 60,
  contrastPairs: 4,
  was: 2,
  /** Pictures an owner may upload for one skin, and their total weight. */
  uploadFiles: 8,
  uploadBytes: 4 * 1024 * 1024,
  /** Most tokens one choice value or toggle side may set. */
  tokens: 12,
  /** Serialised size of the stored values of one skin. */
  storedBytes: 4096,
} as const;

export const CONTROL_ID_RE = /^[a-z][a-z0-9-]{0,24}$/;
export const VALUE_ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
export const HEX_RE = /^#[0-9a-f]{6}$/;
/** Names a contrast pair may point at: the common colours of the skin in the mode being checked. */
export const PALETTE_REF_RE = /^--v-[a-z0-9]+(?:-[a-z0-9]+)?$/;
/** The one family of variables the core writes for customization. */
export const CZ_VAR_RE = /^--sk-cz-[a-z0-9][a-z0-9-]{0,44}$/;

/** The closed list of units a slider may carry (the core formats the value itself: a skin never supplies a template). */
export const SLIDER_UNITS = ["", "px", "rem", "%", "deg", "ms"] as const;
export type SliderUnit = (typeof SLIDER_UNITS)[number];

export type ContrastPair =
  /** Text of this colour sits ON the control's colour. */
  | { kind: "text"; text: string; min: number }
  /** The control's colour sits ON the page, as a UI element: it is compared with each of these colours. */
  | { kind: "against"; against: string[]; min: number };

export type Swatch = { id: string; label: Loc; light: string; dark: string };
export type FreeRange = { l: [number, number]; c: [number, number]; dark?: { l: [number, number] } };
export type TokenMap = Record<string, string>;

type Base = { id: string; label: Loc; hint?: Loc; featured: boolean; was: string[] };

export type ColorControl = Base & { type: "color"; palette: Swatch[]; default: string; custom?: FreeRange; contrast: ContrastPair[] };
export type ChoiceControl = Base & { type: "choice"; display: "auto" | "chips"; values: { id: string; label: Loc; tokens: TokenMap }[]; default: string };
export type ToggleControl = Base & { type: "toggle"; default: boolean; on: TokenMap; off: TokenMap };
export type SliderControl = Base & { type: "slider"; min: number; max: number; step: number; unit: SliderUnit; default: number };

export type UploadRule = {
  formats: ("png" | "jpg" | "webp" | "gif" | "svg")[];
  maxKb: number;
  ratio: [number, number];
  ratioTolerance: number;
  minPx: [number, number];
  maxPx: [number, number];
  focal: boolean;
  animated: boolean;
};
export type ImageControl = Base & {
  type: "image";
  fit: "cover" | "contain" | "tile";
  default: string;
  alternatives: { id: string; file: string; label: Loc }[];
  upload?: UploadRule;
  /** A colour of text drawn on this picture: the page warns when an uploaded picture makes it hard to read. */
  textOver?: { color: string; min: number };
};

export type Control = ColorControl | ChoiceControl | ToggleControl | SliderControl | ImageControl;
export type Group = { id: string; label: Loc; folded: boolean; controls: Control[] };
export type Look = { id: string; label: Loc; values: Record<string, unknown> };
export type CustomizeDecl = { version: number; looks: Look[]; groups: Group[] };

/** A picture the owner uploaded for an image slot (names the files in /uploads: server-generated, checked again at every read). */
export type UploadedPicture = { upload: string; still?: string; lum?: [number, number] };

/** What is saved for one skin (setting `skin.custom.<skinId>`): only what differs from the skin's defaults. */
export type StoredCustom = { v: 1; skinVersion?: string; look?: string | null; values: Record<string, unknown> };

export const isGroupControls = (d: CustomizeDecl): Control[] => d.groups.flatMap((g) => g.controls);

/** The variable names one control writes (for collisions: two controls must never write the same variable). */
export function varNamesOf(c: Pick<Control, "id" | "type">): string[] {
  const base = `--sk-cz-${c.id}`;
  return c.type === "image" ? [base, `${base}-size`, `${base}-repeat`, `${base}-pos`] : [base];
}

