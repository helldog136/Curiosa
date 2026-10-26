import { isHexColor } from "../color";
import type { SettingField } from "./types";

/**
 * Valeurs de réglages : fonctions pures (aucune base de données), partagées par l'admin, le serveur et `ctx.setting()`.
 */

/** Motif HTML (`pattern`) d'un lien : une page du site (/contact), une adresse https:// ou une adresse mailto:. */
export const LINK_PATTERN = String.raw`(\/|\/[^\/\s][^\s]*|https:\/\/[^\s\/][^\s]*|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)`;
const LINK_RE = new RegExp(`^${LINK_PATTERN}$`);

/** Un lien de réglage valide ? (valeur déjà « trimée ») */
export function isValidLink(raw: string): boolean {
  return raw.length <= 2000 && LINK_RE.test(raw);
}

/** Référence au site dans un défaut : `"site:name"` ou `"site:tagline"`. */
export const SITE_DEFAULTS = ["name", "tagline"] as const;
export type SiteDefault = (typeof SITE_DEFAULTS)[number];

export function siteDefaultRef(def: unknown): SiteDefault | null {
  if (typeof def !== "string" || !def.startsWith("site:")) return null;
  const ref = def.slice(5);
  return (SITE_DEFAULTS as readonly string[]).includes(ref) ? (ref as SiteDefault) : null;
}

/** Défaut d'un réglage une fois les références au site résolues (`site` : nom et accroche du site DANS LA LANGUE du champ). */
export function resolveDefault(field: Pick<SettingField, "default">, site: { name: string; tagline: string }): string | number | boolean | undefined {
  const ref = siteDefaultRef(field.default);
  return ref ? site[ref] : field.default;
}

/** Le réglage a-t-il un défaut qui suit le site ? */
export const followsSite = (field: Pick<SettingField, "default">): boolean => siteDefaultRef(field.default) !== null;

/**
 * Faut-il enregistrer la valeur saisie ? Non si elle est vide, ou si elle est identique au défaut qui suit le site :
 * le champ continue alors de suivre le site quand celui-ci change.
 */
export function shouldStore(field: Pick<SettingField, "default">, raw: string, resolved: string | number | boolean | undefined): boolean {
  if (raw === "") return false;
  return !(followsSite(field) && raw === String(resolved ?? ""));
}

/** Valeur d'une case d'un réglage `multichoice` (0.2.14) : stockée telle quelle dans une liste, lisible par l'assistant et sûre dans un formulaire. */
export const MULTI_VALUE_RE = /^[A-Za-z0-9_.-]{1,60}$/;

export type MultiCheck = { ok: true; value: string[] } | { ok: false; reason: "multichoice" | "multichoiceMin" | "multichoiceMax" };
type MultiField = Pick<SettingField, "options" | "minChoices" | "maxChoices">;

/**
 * Valide les cases cochées d'un réglage `multichoice` : LA règle commune à l'admin, à l'assistant et à une migration (`seedInstance`). `raw` : n'importe quoi ;
 * il faut une liste de textes, chacun une option actuelle (les doublons sont fusionnés), au moins `minChoices` et au plus `maxChoices` (défaut : toutes les options).
 * La valeur rendue suit l'ORDRE DES OPTIONS du module, pas celui des clics : deux enregistrements identiques donnent la même valeur.
 */
export function checkMultiInput(field: MultiField, raw: unknown): MultiCheck {
  const options = (field.options ?? []).map((o) => o.value);
  if (!Array.isArray(raw) || raw.length > options.length * 4 + 50 || raw.some((v) => typeof v !== "string")) return { ok: false, reason: "multichoice" };
  const chosen = new Set((raw as string[]).map((v) => v.trim()));
  if ([...chosen].some((v) => !options.includes(v))) return { ok: false, reason: "multichoice" };
  const value = options.filter((v) => chosen.has(v));
  if (value.length > (field.maxChoices ?? options.length)) return { ok: false, reason: "multichoiceMax" };
  if (value.length < (field.minChoices ?? 0)) return { ok: false, reason: "multichoiceMin" };
  return { ok: true, value };
}

/** Ce qu'un module lit de son réglage `multichoice` : la valeur enregistrée ramenée aux options ACTUELLES (une option retirée par une mise à jour disparaît), sinon les cases du départ. */
export function readMulti(field: Pick<SettingField, "options" | "defaultValues" | "maxChoices">, stored: unknown): string[] {
  const options = (field.options ?? []).map((o) => o.value);
  const start = (field.defaultValues ?? []).filter((v) => options.includes(v));
  if (stored === undefined) return start;
  if (!Array.isArray(stored)) return start;
  const chosen = new Set(stored.filter((v): v is string => typeof v === "string"));
  return options.filter((v) => chosen.has(v)).slice(0, field.maxChoices ?? options.length);
}

export type FieldCheck = { ok: true; value: unknown } | { ok: false; reason: "color" | "number" | "select" | "video" | "image" | "url" | "link" };

/**
 * Valide la saisie (texte déjà « trimé », non vide) d'un réglage selon son type — LA règle commune à l'admin (formulaire des réglages d'une instance)
 * et à la création d'une instance semée par une migration (`ctx.seedInstance`). Un booléen ne passe pas par ici (il vaut « coché » ou non).
 */
export function checkFieldInput(field: Pick<SettingField, "type" | "options">, raw: string): FieldCheck {
  switch (field.type) {
    case "color": return isHexColor(raw) ? { ok: true, value: raw.slice(0, 5000) } : { ok: false, reason: "color" };
    case "number": { const n = Number(raw); return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: "number" }; }
    case "select": return field.options?.some((o) => o.value === raw) ? { ok: true, value: raw } : { ok: false, reason: "select" };
    case "video": return /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/.test(raw) ? { ok: true, value: raw } : { ok: false, reason: "video" };
    case "image": return /^(https?:\/\/|\/uploads\/)/i.test(raw) ? { ok: true, value: raw } : { ok: false, reason: "image" };
    case "url": return /^https?:\/\//i.test(raw) ? { ok: true, value: raw } : { ok: false, reason: "url" };
    case "link": return isValidLink(raw) ? { ok: true, value: raw } : { ok: false, reason: "link" };
    default: return { ok: true, value: raw.slice(0, 5000) };   // text, textarea, secret
  }
}
