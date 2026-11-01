// La feuille de style du CŒUR (src/app/globals.css : Tailwind et les règles de coquille, de menu et de pièces), compilée comme le fait Next : PostCSS + @tailwindcss/postcss.
// Le banc n'a pas de build Next ; cette compilation prend ~0,3 s et se garde en mémoire.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let cached = null;

export async function coreCss() {
  if (cached) return cached;
  const file = path.join(ROOT, "src/app/globals.css");
  const postcss = (await import("postcss")).default;
  const tailwind = (await import("@tailwindcss/postcss")).default;
  const result = await postcss([tailwind({ base: ROOT })]).process(fs.readFileSync(file, "utf8"), { from: file });
  cached = result.css;
  return cached;
}
