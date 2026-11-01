// Les pièces de skin des modules (docs/SKINS.md §8), lues dans un dossier de modules (`--modules <dossier>`) : le dépôt `curiosa-extras` entier, son dossier
// `modules/`, ou un seul module. Réutilise la bibliothèque du cœur (`buildModuleSkinLayer`) : mêmes règles que le site.
import fs from "node:fs";
import path from "node:path";

/** Les dossiers de modules (qui contiennent un module.json) sous `dir`. */
export function moduleDirs(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  if (fs.existsSync(path.join(dir, "module.json"))) return [dir];
  const base = fs.existsSync(path.join(dir, "modules")) ? path.join(dir, "modules") : dir;
  return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(base, e.name)).filter((d) => fs.existsSync(path.join(d, "module.json"))).sort();
}

/** Lit les modules : `[{ id, dir, skin?, demo?: string }]` (le HTML d'exemple est lu ici, borné à 20 Ko, sans script). */
export function readModules(dir) {
  const out = [];
  for (const d of moduleDirs(dir)) {
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(d, "module.json"), "utf8")); } catch { continue; }
    if (!json || typeof json.id !== "string") continue;
    const entry = { id: json.id, dir: d, skin: json.skin };
    if (json.skin?.demo) {
      try {
        const file = path.join(d, String(json.skin.demo));
        if (path.dirname(path.resolve(file)) === path.resolve(d) && fs.statSync(file).size <= 20 * 1024) entry.demo = fs.readFileSync(file, "utf8");
      } catch { /* pas d'exemple : gabarit générique */ }
    }
    out.push(entry);
  }
  return out;
}

/** La couche « pièces de modules » (jetons, paires, pièces) pour ces modules. */
export async function moduleLayer(modules) {
  const { buildModuleSkinLayer } = await import("../../src/core/skins/moduleSkin.ts");
  return buildModuleSkinLayer(modules.map((m) => ({ id: m.id, skin: m.skin })));
}
