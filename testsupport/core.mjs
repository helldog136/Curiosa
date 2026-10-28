// Accès au cœur : où il est, quelle version il a, et ses fonctions (parseManifest…) — que la suite tourne depuis le cœur ou depuis un autre dépôt.
//
// Le code du cœur est en TypeScript avec des alias « @/… » : pour l'importer hors d'un serveur Next, il faut le chargeur de test (tests/helpers/alias-hooks.mjs).
//  - lancée par `node testsupport/check.mjs` : on l'enregistre ici ;
//  - lancée par les tests d'un autre dépôt (`--import <cœur>/tests/helpers/register.mjs`) : il est déjà enregistré, on n'y touche pas.
// Le dossier du cœur se déduit de l'emplacement de CE fichier : aucune position relative à supposer côté appelant.
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CORE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const here = pathToFileURL(path.join(CORE_DIR, "tests/helpers/")).href;

let cached;
/** { dir, version, apiVersion, parseManifest, SLOTS, isCompatible, analyzeModuleSkin, skinParts } — chargé une fois. */
export async function loadCore() {
  if (cached) return cached;
  process.env.CURIOSA_CATALOGUE_RUNTIME ??= "0"; // jamais de réseau
  const attempt = () => Promise.all([import("@/core/modules/manifest"), import("@/core/config"), import("@/core/blocks"), import("@/core/modules/compat"), import("@/core/skins/moduleSkin"), import("@/core/skins/allowlist")]);
  let mods;
  try {
    mods = await attempt();
  } catch {
    register("./alias-hooks.mjs", here);
    mods = await attempt();
  }
  const [manifest, config, blocks, compat, moduleSkin, allowlist] = mods;
  const pkg = JSON.parse(fs.readFileSync(path.join(CORE_DIR, "package.json"), "utf8"));
  cached = { dir: CORE_DIR, version: pkg.version, apiVersion: config.MODULE_API_VERSION, parseManifest: manifest.parseManifest, SLOTS: blocks.SLOTS, parseCoreVersion: compat.parseCoreVersion, isCompatible: compat.isCompatible, analyzeModuleSkin: moduleSkin.analyzeModuleSkin, skinParts: [...allowlist.PARTS] };
  return cached;
}
