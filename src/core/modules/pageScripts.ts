import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MODULES_DIR } from "../config";

/**
 * Scripts rattachés à la page d'un module (`PageResult.scripts`). Le module nomme des fichiers de son dossier `scripts/` ; le cœur les sert LUI-MÊME
 * (même origine, jamais en ligne dans la page : compatible avec une politique `script-src 'self'` sans `unsafe-inline`, aucun nonce à gérer),
 * avec `defer` et une empreinte d'intégrité (SRI), uniquement sur la page qui les déclare.
 */
export const MAX_PAGE_SCRIPTS = 3;
export const MAX_SCRIPT_BYTES = 32 * 1024;
export const SCRIPT_NAME = /^[a-z0-9][a-z0-9._-]{0,62}\.js$/;
const MEMO_MAX = 64;

export type PageScriptTag = { src: string; integrity: string };
type Loaded = { body: Buffer; integrity: string };

// Mémoire bornée : (fichier, date, taille) → contenu et empreinte. Un fichier modifié change de clé ; le plus ancien est oublié au-delà de 64 entrées.
const memo = new Map<string, Loaded>();

/** Lit `<dossier du module>/scripts/<nom>` : fichier ordinaire (pas de lien symbolique), dans le dossier, de 32 Ko au plus. Null sinon. */
export function readModuleScript(moduleId: string, name: string, baseDir: string = path.join(MODULES_DIR, moduleId)): Loaded | null {
  if (typeof name !== "string" || !SCRIPT_NAME.test(name)) return null;
  try {
    const file = path.join(baseDir, "scripts", name);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_SCRIPT_BYTES) return null;
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(path.join(baseDir, "scripts")) + path.sep)) return null;
    const key = `${real}:${st.mtimeMs}:${st.size}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const body = fs.readFileSync(real);
    if (body.length > MAX_SCRIPT_BYTES) return null;
    const out = { body, integrity: `sha256-${crypto.createHash("sha256").update(body).digest("base64")}` };
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/** Étiquette d'adresse tirée de l'empreinte (lettres et chiffres seulement). */
export const scriptVersion = (integrity: string): string => integrity.slice(7, 19).replace(/[^A-Za-z0-9]/g, "x");

/** Les balises à écrire pour `scripts` (3 au plus, sans doublon). Un nom invalide ou un fichier absent, trop gros ou suspect est ignoré (la page reste affichée). */
export function pageScriptTags(moduleId: string, instanceKey: string, scripts: unknown, baseDir?: string): PageScriptTag[] {
  if (!Array.isArray(scripts)) return [];
  const out: PageScriptTag[] = [];
  for (const name of new Set(scripts.slice(0, 20))) {
    if (out.length >= MAX_PAGE_SCRIPTS) break;
    const file = readModuleScript(moduleId, name as string, baseDir);
    if (file) out.push({ src: `/m/${encodeURIComponent(instanceKey)}/page-script/${name}?v=${scriptVersion(file.integrity)}`, integrity: file.integrity });
  }
  return out;
}
