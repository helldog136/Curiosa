/**
 * LES POLICES ENVOYÉES : formes et calculs PURS (aucun accès au disque ni à la base ; utilisable partout, y compris par le rendu des skins).
 * L'envoi, la liste en base et la suppression sont dans `uploads.ts`.
 */
import { cleanFontName } from "./woff2";
import { UPLOAD_LIMITS, UP_ID_RE, type UploadedFont } from "./types";

export const UPLOAD_NAME_RE = /^u-[0-9a-f]{16}\.woff2$/;
export const uploadFileName = (id: string): string => `u-${id}.woff2`;
export const uploadUrl = (id: string): string => `/fonts/${uploadFileName(id)}`;

const ID_RE = /^[0-9a-f]{16}$/;

/** Forme d'une entrée de la liste (réglage lu tel quel : tout ce qui n'a pas la bonne forme est ignoré). */
export function sanitizeUploads(raw: unknown): UploadedFont[] {
  if (!Array.isArray(raw)) return [];
  const out: UploadedFont[] = [];
  for (const r of raw as Partial<UploadedFont>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID_RE.test(r.id) || typeof r.family !== "string" || typeof r.slug !== "string" || !UP_ID_RE.test(r.slug)) continue;
    if (typeof r.weight !== "string" || !/^(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(r.weight)) continue;
    const family = cleanFontName(r.family);
    if (!family) continue;
    out.push({ id: r.id, family, slug: r.slug, weight: r.weight, style: r.style === "italic" ? "italic" : "normal", bytes: Math.max(0, Math.trunc(Number(r.bytes)) || 0), addedAt: typeof r.addedAt === "string" ? r.addedAt.slice(0, 40) : "" });
    if (out.length >= UPLOAD_LIMITS.maxFiles) break;
  }
  return out;
}

/** Les graisses qu'apporte une famille envoyée (pour les conseils) : 400 et/ou 700, ou celles couvertes par une plage. */
export function uploadWeights(files: readonly UploadedFont[]): number[] {
  const set = new Set<number>();
  for (const f of files) {
    const [lo, hi] = f.weight.split(" ").map(Number) as [number, number | undefined];
    if (hi === undefined) set.add(lo >= 600 ? 700 : 400);
    else { if (lo <= 400 && hi >= 400) set.add(400); if (hi >= 700 && lo <= 700) set.add(700); }
  }
  return [...set].sort((a, b) => a - b);
}

/** Une famille envoyée : toutes ses graisses. */
export function uploadFamilies(list: readonly UploadedFont[]): { slug: string; family: string; files: UploadedFont[] }[] {
  const by = new Map<string, { slug: string; family: string; files: UploadedFont[] }>();
  for (const f of list) {
    const g = by.get(f.slug) ?? { slug: f.slug, family: f.family, files: [] };
    g.files.push(f);
    by.set(f.slug, g);
  }
  return [...by.values()];
}

