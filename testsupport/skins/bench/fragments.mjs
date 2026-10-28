// Les fragments générés à partir des composants du cœur (voir refresh.mjs) : `fragments/<langue>/<nom>.html`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FRAGMENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fragments");
let cache = null;

/** `{ fr: { "header-classic": "<header…" }, en: {…} }` */
export function loadFragments(dir = FRAGMENTS_DIR) {
  if (cache && dir === FRAGMENTS_DIR) return cache;
  const out = {};
  for (const L of fs.readdirSync(dir)) {
    const sub = path.join(dir, L);
    if (!fs.statSync(sub).isDirectory()) continue;
    out[L] = {};
    for (const f of fs.readdirSync(sub)) if (f.endsWith(".html")) out[L][f.slice(0, -5)] = fs.readFileSync(path.join(sub, f), "utf8").replace(/\n$/, "");
  }
  if (dir === FRAGMENTS_DIR) cache = out;
  return out;
}

export function fragment(L, name, dir) {
  const all = loadFragments(dir);
  const html = all[L]?.[name] ?? all.fr?.[name];
  if (html === undefined) throw new Error(`fragment inconnu : ${L}/${name} (relancez npm run skin:bench:refresh)`);
  return html;
}
