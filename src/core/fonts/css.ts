/**
 * LE CSS DES POLICES CHOISIES (docs/POLICES.md) : piles de polices et règles `@font-face`, écrites par le cœur à partir de CHOIX validés, jamais de texte libre.
 *
 *  - la famille CSS de chaque police est un nom INTERNE (`cf-<id>`, `cf-up-<nom>`) : aucune collision avec une police installée chez la personne qui visite,
 *    aucun nom saisi dans la feuille (donc rien à échapper) ;
 *  - toutes les adresses sont celles du site (`/fonts/…`) : aucun site tiers, jamais ; `font-display: swap` (le texte s'affiche tout de suite, dans la police de repli) ;
 *  - une règle par fichier, avec `unicode-range` : le navigateur ne télécharge « latin étendu » que si une page en a besoin ;
 *  - la police choisie est TOUJOURS appliquée (les conseils ne bloquent rien).
 */
import { FONT_STACKS } from "../color";
import { fontUrl, loadLibrary, urlNameOf } from "./library";
import { parseChoice, SETTING_BODY, SETTING_FILES, SETTING_HEADING, type FontChoice, type LibraryFamily, type SystemKey, type UploadedFont } from "./types";
import { sanitizeUploads, uploadFamilies, uploadUrl } from "./registry";

export type FontApply = { stack: string; key: SystemKey };
export type ResolvedFonts = { body?: FontApply; heading?: FontApply; /** `@font-face` des seules polices utilisées (vide si aucune). */ faces: string };

const RANGES = {
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext": "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
} as const;

const GENERIC: Record<LibraryFamily["generic"], string> = {
  "sans-serif": FONT_STACKS.sans,
  serif: FONT_STACKS.serif,
  cursive: 'ui-rounded, "Comic Sans MS", "Segoe Print", cursive, sans-serif',
  monospace: FONT_STACKS.mono,
};
const KEY_OF: Record<LibraryFamily["generic"], SystemKey> = { "sans-serif": "sans", serif: "serif", cursive: "sans", monospace: "mono" };

export const libFamilyName = (id: string): string => `cf-${id}`;
export const upFamilyName = (slug: string): string => `cf-up-${slug}`;

const stackOf = (family: string, fallback: string) => `"${family}", ${fallback}`;

function libFaces(f: LibraryFamily): string {
  return f.files.map((x) => `@font-face{font-family:"${libFamilyName(f.id)}";font-style:normal;font-weight:${x.weight};font-display:swap;src:url(${fontUrl(urlNameOf(x))}) format("woff2");unicode-range:${RANGES[x.subset]}}`).join("");
}
function upFaces(slug: string, files: readonly UploadedFont[]): string {
  return files.map((x) => `@font-face{font-family:"${upFamilyName(slug)}";font-style:${x.style};font-weight:${x.weight};font-display:swap;src:url(${uploadUrl(x.id)}) format("woff2")}`).join("");
}

/** La pile d'un choix et ses règles `@font-face` ; `null` si le choix est « celle du skin » ou vise une police qui n'existe plus. */
function applyOf(choice: FontChoice, uploads: readonly UploadedFont[]): { apply: FontApply; faces: string; id: string } | null {
  if (choice.kind === "sys") return { apply: { stack: FONT_STACKS[choice.key], key: choice.key }, faces: "", id: `sys:${choice.key}` };
  if (choice.kind === "lib") {
    const f = loadLibrary().byId.get(choice.id);
    return f ? { apply: { stack: stackOf(libFamilyName(f.id), GENERIC[f.generic]), key: KEY_OF[f.generic] }, faces: libFaces(f), id: `lib:${f.id}` } : null;
  }
  if (choice.kind === "up") {
    const files = uploads.filter((u) => u.slug === choice.id);
    if (!files.length) return null;
    return { apply: { stack: stackOf(upFamilyName(choice.id), FONT_STACKS.sans), key: "sans" }, faces: upFaces(choice.id, files), id: `up:${choice.id}` };
  }
  return null;
}

/** Lit les réglages (`theme.fontHeading`, `theme.fontBody`, `theme.fontFiles`) et rend ce qu'il faut appliquer. Pur : ne lit que `get`, plus la bibliothèque (mémorisée). */
export function resolveFonts(get: (key: string) => unknown): ResolvedFonts {
  const uploads = sanitizeUploads(get(SETTING_FILES));
  const body = applyOf(parseChoice(get(SETTING_BODY)), uploads);
  const heading = applyOf(parseChoice(get(SETTING_HEADING)), uploads);
  const seen = new Set<string>();
  let faces = "";
  for (const r of [body, heading]) if (r && r.faces && !seen.has(r.id)) { seen.add(r.id); faces += r.faces; }
  return { ...(body ? { body: body.apply } : {}), ...(heading ? { heading: heading.apply } : {}), faces };
}

/** Toutes les règles de la bibliothèque et des polices envoyées, pour les APERÇUS de la page Apparence (le navigateur ne télécharge que ce que l'aperçu affiche). */
export function previewFaces(uploads: readonly UploadedFont[]): string {
  return loadLibrary().families.map(libFaces).join("") + uploadFamilies(uploads).map((g) => upFaces(g.slug, g.files)).join("");
}

/** La pile CSS d'un aperçu (`font-family`) pour un choix, ou `null` (celle du skin). */
export function previewStack(value: string, uploads: readonly UploadedFont[]): string | null {
  return applyOf(parseChoice(value), uploads)?.apply.stack ?? null;
}
