/**
 * SERVICE DES RESSOURCES D'UN SKIN (docs/SKINS.md §5.6, §15) : `GET /skins/<id>/<version>/<dossier>/<fichier>`.
 *
 * Seules les POLICES (`fonts/*.woff2`) et les IMAGES (`images/*`) d'une version installée sont servies, avec un type fixé par l'extension, jamais deviné
 * du contenu. Jamais la feuille (`skin.css`), jamais les jetons, jamais le manifeste ni les aperçus : la feuille n'est servie que sous sa forme assainie,
 * écrite dans la page par le cœur. Les segments de l'adresse sont validés un à un (aucun `..`, aucun séparateur, aucun nom caché) et le fichier doit
 * être un fichier ordinaire (ni lien symbolique, ni dossier) dans le dossier de cette version.
 */
import fs from "node:fs";
import path from "node:path";
import { SKINS_DIR } from "../config";
import { SKIN_ID_RE } from "./allowlist";
import { SEMVER_RE } from "./semver";

const TYPES: Readonly<Record<string, string>> = {
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type SkinAsset = { file: string; type: string; size: number };

/** Le fichier à servir pour ces segments d'adresse, ou null (introuvable, refusé : on ne distingue pas). */
export function resolveSkinAsset(id: string, version: string, dir: string, name: string, root: string = SKINS_DIR): SkinAsset | null {
  if (!SKIN_ID_RE.test(id) || !SEMVER_RE.test(version) || !NAME_RE.test(name)) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const type = TYPES[ext];
  if (!type) return null;
  if (!((dir === "fonts" && ext === "woff2") || (dir === "images" && ext !== "woff2"))) return null;
  const file = path.join(root, id, version, dir, name);
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return null;
    // Défense en profondeur : même si un lien symbolique s'était glissé plus haut, le fichier réel doit rester sous le dossier des skins.
    const real = fs.realpathSync(file);
    const base = fs.realpathSync(root);
    if (!real.startsWith(base + path.sep)) return null;
    return { file: real, type, size: st.size };
  } catch { return null; }
}

/** En-têtes des ressources de skin : l'URL change avec la version, donc le cache est éternel. */
export function assetHeaders(asset: SkinAsset): Record<string, string> {
  return {
    "content-type": asset.type,
    "content-length": String(asset.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    // Un SVG ouvert directement dans un onglet ne doit rien pouvoir exécuter, même si le nettoyage avait une faille.
    ...(asset.type === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
  };
}
