/**
 * SERVICE DES POLICES : `GET|HEAD /fonts/<fichier>.woff2` (docs/POLICES.md). Deux sortes d'adresses seulement :
 *   /fonts/<famille>-<graisse>-<sous-ensemble>.<10 caractères d'empreinte>.woff2   la bibliothèque embarquée (l'empreinte doit être celle de l'inventaire)
 *   /fonts/u-<16 caractères d'empreinte>.woff2                                      une police envoyée (le nom EST l'empreinte du contenu)
 * Le type est fixé (`font/woff2`), jamais deviné ; `nosniff` ; cache éternel (`immutable`) puisque l'adresse change avec le contenu. Aucun autre fichier n'est servi :
 * ni l'inventaire, ni les licences, ni rien du dossier de données. Un nom qui ne ressemble pas à l'un des deux modèles est introuvable (404), sans plus d'explication.
 */
import fs from "node:fs";
import path from "node:path";
import { FONTS_DIR } from "../config";
import { loadLibrary } from "./library";
import { UPLOAD_NAME_RE } from "./registry";

export type FontAsset = { file: string; size: number };

const LIB_RE = /^[a-z0-9][a-z0-9-]*-(?:400|700)-(?:latin|latin-ext)\.[0-9a-f]{10}\.woff2$/;

function regular(abs: string, root: string): FontAsset | null {
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile()) return null;
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) return null;
    return { file: real, size: st.size };
  } catch { return null; }
}

/** Le fichier à servir pour ce nom, ou null. `uploadsDir` : pour les tests. */
export function resolveFontAsset(name: string, uploadsDir: string = FONTS_DIR): FontAsset | null {
  if (typeof name !== "string" || name.length > 90) return null;
  if (UPLOAD_NAME_RE.test(name)) return regular(path.join(uploadsDir, name), uploadsDir);
  if (!LIB_RE.test(name)) return null;
  const entry = loadLibrary().byUrlName.get(name);
  return entry ? regular(entry.abs, path.dirname(entry.abs)) : null;
}

export function fontHeaders(asset: FontAsset): Record<string, string> {
  return {
    "content-type": "font/woff2",
    "content-length": String(asset.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    // Une police ouverte directement dans un onglet ne charge rien d'autre.
    "content-security-policy": "default-src 'none'",
    "cross-origin-resource-policy": "same-origin",
  };
}
