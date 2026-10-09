// Règles de neutralité chargées depuis la configuration locale (variable NEUTRALITY_TERMS ou fichier .neutrality-terms).
// Format, une règle par ligne (lignes vides et « # » ignorés) :
//   terme                         interdit partout
//   terme => fichier1, fichier2   toléré seulement dans ces fichiers
// Le terme est une expression régulière, insensible à la casse.
import fs from "node:fs";

export function parseNeutralityRules(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [term, files = ""] = line.split("=>").map((s) => s.trim());
    if (!term) continue;
    rules.push({ term, re: new RegExp(term, "i"), allowed: new Set(files.split(",").map((s) => s.trim()).filter(Boolean)) });
  }
  return rules;
}

/** files : { chemin: texte } ou tableau [chemin, texte]. Retourne [{ file, term }]. */
export function findViolations(files, rules) {
  const out = [];
  for (const [file, text] of Array.isArray(files) ? files : Object.entries(files)) {
    for (const r of rules) if (!r.allowed.has(file) && r.re.test(text)) out.push({ file, term: r.term });
  }
  return out;
}

/** Texte des règles : variable d'environnement, sinon fichier local ; "" si aucun des deux. */
export function loadNeutralityText(file = ".neutrality-terms") {
  if (process.env.NEUTRALITY_TERMS?.trim()) return process.env.NEUTRALITY_TERMS;
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
