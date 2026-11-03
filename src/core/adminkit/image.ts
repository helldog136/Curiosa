/**
 * Vignette d'une cellule de tableau (`{ text, image: { src, alt } }`) : la VALIDATION, côté serveur, de ce que le navigateur aura le droit de charger.
 * Logique pure (testée sans navigateur ni réseau). Liste FERMÉE :
 *  - une page du site (`/uploads/…`, `/m/<clé>/image`…), sans `..`, sans `\`, jamais `/api/` ni `/admin` (un `<img>` envoie un GET avec les cookies de la personne connectée) ;
 *  - une adresse `https://` dont le nom d'hôte est EXACTEMENT l'un de ceux que le module déclare dans son manifeste (`imageHosts`) ; pas de port, d'identifiant,
 *    d'adresse numérique ni de nom interne (voir `hostProblem`). Aucun hôte arbitraire, aucun joker.
 * Rien n'est jamais exécuté : une image est une balise `<img>` (un SVG chargé ainsi n'exécute aucun script), jamais un cadre ni un `<object>`.
 */
import type { Block, TableCell } from "../blocks";
import { hostProblem } from "../url";

type TableBlock = Extract<Block, { type: "table" }>;
export type CellImage = { src: string; alt: string; fit?: "cover" | "contain" };

/** Bornes : « dézoom permanent », rien de non borné. */
export const MAX_IMAGE_HOSTS = 5;
export const MAX_IMAGE_SRC = 2000;
export const MAX_IMAGE_ALT = 160;

/** Un nom d'hôte déclarable : minuscules, au moins un point, ni adresse numérique ni nom interne (`localhost`, `.local`, `.lan`…). */
const HOST_NAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
export function isDeclarableImageHost(value: unknown): value is string {
  return typeof value === "string" && HOST_NAME.test(value) && hostProblem(`https://${value}/`) === null;
}

export type ImageSrcProblem = "empty" | "too-long" | "invalid" | "site-path" | "scheme" | "host-not-declared";
export type ImageSrcCheck = { ok: true; src: string } | { ok: false; problem: ImageSrcProblem };

const SITE = "https://site.invalid";
const BAD_CHARS = /[\u0000- \u007f\\]/;

/** `src` est-il une image que ce module a le droit d'afficher ? `hosts` : les hôtes déclarés (liste vide : seulement les pages du site). */
export function checkImageSrc(src: unknown, hosts: readonly string[] = []): ImageSrcCheck {
  if (typeof src !== "string" || src === "") return { ok: false, problem: "empty" };
  if (src.length > MAX_IMAGE_SRC) return { ok: false, problem: "too-long" };
  if (BAD_CHARS.test(src)) return { ok: false, problem: "invalid" };
  if (src.startsWith("//")) return { ok: false, problem: "invalid" };
  if (src.startsWith("/")) {
    let url: URL;
    try { url = new URL(src, SITE); } catch { return { ok: false, problem: "invalid" }; }
    if (url.origin !== SITE) return { ok: false, problem: "invalid" };
    let path: string;
    try { path = decodeURIComponent(url.pathname).toLowerCase(); } catch { return { ok: false, problem: "invalid" }; }
    if (path.includes("\\") || path.split("/").includes("..") || path === "/api" || path.startsWith("/api/") || path === "/admin" || path.startsWith("/admin/")) return { ok: false, problem: "site-path" };
    return { ok: true, src: url.pathname + url.search };
  }
  let url: URL;
  try { url = new URL(src); } catch { return { ok: false, problem: "invalid" }; }
  if (url.protocol !== "https:") return { ok: false, problem: "scheme" };
  if (hostProblem(url) !== null) return { ok: false, problem: "invalid" };
  if (!hosts.includes(url.hostname)) return { ok: false, problem: "host-not-declared" };
  return { ok: true, src: url.href };
}

/** Le texte alternatif : obligatoire (une image sans description n'est pas montrée), 160 caractères au plus. */
export function cleanAlt(alt: unknown): string | null {
  if (typeof alt !== "string") return null;
  const v = alt.replace(/\s+/g, " ").trim();
  return v === "" ? null : Array.from(v).slice(0, MAX_IMAGE_ALT).join("");
}

/** Une image de cellule validée, ou `null` (image absente, sans texte alternatif, ou adresse refusée). */
export function validCellImage(image: unknown, hosts: readonly string[] = []): CellImage | null {
  if (!image || typeof image !== "object") return null;
  const { src, alt, fit } = image as Record<string, unknown>;
  const a = cleanAlt(alt);
  if (a === null) return null;
  const s = checkImageSrc(src, hosts);
  if (!s.ok) return null;
  return { src: s.src, alt: a, ...(fit === "contain" ? { fit: "contain" as const } : {}) };
}

/** Le bloc `table` avec UNIQUEMENT des images validées : ce qui est refusé devient une cellule de texte (rien d'autre ne change). Appelé côté serveur, avant d'envoyer le bloc au navigateur. */
export function sanitizeTableImages(block: TableBlock, hosts: readonly string[] = []): TableBlock {
  let changed = false;
  const rows = block.rows.map((row) => row.map((cell): TableCell => {
    if (typeof cell !== "object" || cell === null || !("image" in cell)) return cell;
    changed = true;
    const { image, ...rest } = cell;
    const ok = validCellImage(image, hosts);
    return ok ? { ...rest, image: ok } : rest;
  }));
  return changed ? { ...block, rows } : block;
}
