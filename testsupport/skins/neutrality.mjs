// Neutralité des textes d'un skin (docs/SKINS.md §13) : aucun nom de site, d'association ou de ville dans le manifeste, le README et les commentaires de la feuille.
// Les termes viennent de la configuration LOCALE de l'équipe (variable NEUTRALITY_TERMS, fichier `.neutrality-terms` ou `--neutrality <fichier>`) : le kit n'en
// embarque aucun (les noms réels ne doivent pas se trouver dans le dépôt). Format : une expression régulière par ligne ; « terme => fichier1, fichier2 » = toléré dans ces fichiers.
import fs from "node:fs";

export function parseRules(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [term, files = ""] = line.split("=>").map((s) => s.trim());
    if (!term) continue;
    try { rules.push({ term, re: new RegExp(term, "i"), allowed: new Set(files.split(",").map((s) => s.trim()).filter(Boolean)) }); } catch { /* règle invalide : ignorée */ }
  }
  return rules;
}

/** Texte des règles : fichier donné, sinon variable d'environnement, sinon `.neutrality-terms` du dossier courant ; `null` si aucun. */
export function loadRulesText(file) {
  if (file) return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (process.env.NEUTRALITY_TERMS?.trim()) return process.env.NEUTRALITY_TERMS;
  return fs.existsSync(".neutrality-terms") ? fs.readFileSync(".neutrality-terms", "utf8") : null;
}

/** `files` : [[chemin, texte]]. Rend [{ file, term }]. */
export function violations(files, rules) {
  const out = [];
  for (const [file, text] of files) for (const r of rules) if (!r.allowed.has(file) && r.re.test(text)) out.push({ file, term: r.term });
  return out;
}
