// Version du cœur qui juge `minCore` d'un skin. Les skins arrivent avec la version 0.4.0 du cœur (espace réservé, docs/SKINS.md §19 Q-A) : un dépôt plus ancien qui contient déjà le code
// des skins (une branche de développement) juge donc comme la 0.4.0, sinon aucun skin valide ne passerait. `--core-version` remplace tout.
import fs from "node:fs";
import path from "node:path";

export const SKINS_SINCE = "0.4.0";
const parts = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
export const atLeast = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return true; };

export function defaultCoreVersion(root, override) {
  if (override) return override;
  const v = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  return atLeast(v, SKINS_SINCE) ? v : SKINS_SINCE;
}
