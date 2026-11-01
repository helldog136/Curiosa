// Où est le dépôt des modules (curiosa-extras) ? Les tests du cœur ne supposent JAMAIS un chemin de machine : ils le cherchent, et s'ignorent
// proprement (skip + raison) quand il est absent, comme sur l'intégration continue du cœur.
//   1. la variable d'environnement CURIOSA_EXTRAS_DIR (un dossier qui contient modules/) ;
//   2. à côté du cœur : ../curiosa-extras, puis ../../curiosa-extras (cœur cloné dans un sous-dossier de travail).
// Le catalogue est lu dans <dépôt>/catalogue/index.json, ou à l'endroit donné par CURIOSA_CATALOGUE_INDEX (fichier).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Dossier du dépôt des modules, ou null. */
export function findExtrasDir() {
  const candidates = [process.env.CURIOSA_EXTRAS_DIR, path.join(root, "..", "curiosa-extras"), path.join(root, "..", "..", "curiosa-extras")].filter(Boolean);
  return candidates.map((d) => path.resolve(d)).find((d) => fs.existsSync(path.join(d, "modules"))) ?? null;
}

/** Identifiants des modules du catalogue (index.json), ou null si le catalogue est absent ou illisible. */
export function catalogueIds() {
  const dir = findExtrasDir();
  const file = process.env.CURIOSA_CATALOGUE_INDEX ?? (dir ? path.join(dir, "catalogue", "index.json") : "");
  try {
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    const ids = (Array.isArray(index) ? index : index.modules ?? []).map((m) => m?.id).filter((id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(id));
    return ids.length > 0 ? [...new Set(ids)] : null;
  } catch { return null; }
}
