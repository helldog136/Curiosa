// Modules de TEST : de simples manifestes pour exercer le cœur (contenu, accueil, sauvegardes…) sans dépendre d'aucun vrai module.
// Le cœur ne livre aucun module ; les vrais vivent dans curiosa-extras et sont testés là-bas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/extras/modules");
const { parseManifest } = await import("@/core/modules/manifest");

// Les modules de contenu génériques (pas les démos du Catalogue, qui n'ont pas de contenu).
export const FIXTURE_IDS = fs.readdirSync(dir).filter((id) => !id.startsWith("demo-")).sort();
export const FIXTURE_MODULES = FIXTURE_IDS.map((id) => {
  const parsed = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, id, "module.json"), "utf8")));
  if (!parsed.ok) throw new Error(`fixture ${id}: ${parsed.error}`);
  return { manifest: parsed.manifest, definition: {} };
});

/** Copie le dossier d'une fixture vers le dossier des modules installés (même chemin qu'un module livré). */
export function installFixtureFiles(dataDir, id) {
  const target = path.join(dataDir, "modules", id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(dir, id), target, { recursive: true });
}
