import type { OverlayElementDecl } from "./decl";

/**
 * PAGES D'OVERLAY (0.5.0) : types et bornes dures. Pur, sans base ni Next : testé directement.
 * Une page d'overlay a un nom, une résolution, des éléments (ordre = ordre de superposition : le premier est au fond), un style commun, un état actif/inactif,
 * une adresse secrète (voir secret.ts) et un mode test à échéance.
 */
export const MAX_PAGES = 20;
export const MAX_ACTIVE_PAGES = 10;
export const MAX_ELEMENTS_PER_PAGE = 30;
export const NAME_MAX = 60;
export const MIN_SIDE = 320;
export const MAX_SIDE = 7680;
/** Durée du mode test (constatée à la lecture : aucun minuteur côté serveur) et plafond de prolongation (reste avant l'échéance). */
export const TEST_MINUTES = 30;
export const TEST_MAX_MINUTES = 240;
/** Taille maximale d'une valeur de texte d'option gardée telle quelle pour un élément disparu (le reste est écarté). */
export const KEPT_OPTIONS_MAX_BYTES = 4000;

export const RESOLUTIONS: readonly (readonly [number, number])[] = [[1280, 720], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]];
export const DEFAULT_RESOLUTION = RESOLUTIONS[1]!;

export type OptionValue = string | number | boolean;
export type OptionValues = Record<string, OptionValue>;

/** Style commun (jetons `--ov-*`, voir tokens.ts). */
export type OverlayStyle = { text: "light" | "dark"; background: "transparent" | "soft"; corners: "round" | "square" };
export const DEFAULT_STYLE: OverlayStyle = { text: "light", background: "transparent", corners: "round" };

export type PageElement = {
  /** Identifiant de CETTE place dans la page (un même élément peut figurer deux fois). */
  uid: string;
  /** Clé de l'instance du module, et identifiant de l'élément dans sa déclaration. */
  instance: string;
  element: string;
  x: number; y: number; w: number; h: number;
  visible: boolean;
  options: OptionValues;
};

export type OverlayPageData = {
  id: string;
  name: string;
  width: number;
  height: number;
  active: boolean;
  style: OverlayStyle;
  elements: PageElement[];
  rev: number;
  testUntil: number | null;
};

export const UID_RE = /^[a-z0-9]{6,16}$/;
export const INSTANCE_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Un élément de page, tel que le catalogue des modules actifs le décrit (pour valider et dessiner). */
export type CatalogElement = {
  instance: string;
  moduleId: string;
  moduleName: string;
  instanceLabel: string;
  decl: OverlayElementDecl;
};
export const catalogKey = (instance: string, element: string): string => `${instance}\u0000${element}`;
export type Catalog = Map<string, CatalogElement>;

export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Mode test : actif tant que l'échéance n'est pas passée (constaté à la lecture). */
export const testActive = (testUntil: number | null | undefined, now: number): boolean => typeof testUntil === "number" && testUntil > now;

/** Nouvelle échéance : démarrer (maintenant + 30 min), prolonger (échéance + 30 min, plafonnée à 4 h devant soi), arrêter (null). */
export function nextTestUntil(action: "start" | "extend" | "stop", current: number | null, now: number): number | null {
  if (action === "stop") return null;
  const base = action === "extend" && testActive(current, now) ? (current as number) : now;
  return Math.min(base + TEST_MINUTES * 60_000, now + TEST_MAX_MINUTES * 60_000);
}
