// Texte de release : la section du CHANGELOG.md qui correspond à une version.
//   node scripts/changelog.mjs 0.1.2          → section « ## 0.1.2 »
//   node scripts/changelog.mjs 0.1.3-rc.1     → section « ## 0.1.3-rc.1 », à défaut « Prochaine version (non publiée) »
// Écrit le texte sur la sortie standard ; rien (code 1) si aucune section ne convient.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const UNRELEASED = /^prochaine version/i;

/** Sections du fichier : [{ title, body }] dans l'ordre. Un titre = une ligne « ## … ». */
export function sections(markdown) {
  const out = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) { current = { title: m[1], body: [] }; out.push(current); continue; }
    if (current) current.body.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.body.join("\n").trim() }));
}

/** Le texte de la version (« ## 0.1.2 », « ## [0.1.2] — date »…) ; à défaut, la section « Prochaine version » (instantanés de dev). */
export function changelogFor(version, markdown) {
  const all = sections(markdown);
  const exact = all.find((s) => s.title.replace(/^\[|\]/g, "").split(/\s+/)[0] === version);
  return (exact ?? all.find((s) => UNRELEASED.test(s.title)))?.body || "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = changelogFor(process.argv[2] ?? "", fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  if (!text) process.exit(1);
  process.stdout.write(text + "\n");
}
