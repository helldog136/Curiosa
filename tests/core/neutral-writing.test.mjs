// Écriture neutre : aucun texte visible ne doit supposer le genre de la personne qui gère le site ni de son public.
// Ce test échoue si un texte visible contient un terme genré connu (liste ci-dessous). Pour ajouter un terme : une ligne dans TERMES. Pour tolérer un
// emploi légitime : une ligne dans LISTE_BLANCHE, AVEC la raison (« pourquoi c'est correct »), jamais « pour faire passer le test ».
// Règles d'écriture : docs/ideas/ecriture-neutre-audit.md (formulations épicènes : « la personne qui gère le site », « votre public », « l'équipe » ;
// ni point médian ni doublets lourds ; pas d'adjectif ou de participe accordé au genre de la personne ; en anglais « they/them »).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Le \b de JavaScript ne connaît pas les lettres accentuées (« connecté\b » ne se termine jamais) : on le remplace par des bornes Unicode.
const W0 = "(?<![\\p{L}\\p{N}_])", W1 = "(?![\\p{L}\\p{N}_])";
const mot = (src, flags = "iu") => new RegExp(src.replace(/\\b/g, (m, i) => (i === 0 || /[(|:]/.test(src[i - 1]) ? W0 : W1)), flags);

// ── 1. Termes genrés connus ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// langue : "fr" | "en" | "*" ; re : expression régulière (insensible à la casse sauf indication) ; pourquoi : ce que ça suppose.
const TERMES = [
  { id: "feminin-metier", langue: "fr", re: mot("\\b(cr[ée]atrices?|vendeuses?|streameuses?|utilisatrices?|(?<!personnes? )clientes?|autrices?|propriétaires? (?:elle|accordée))\\b", "iu"), pourquoi: "féminin supposé (la personne ou son public)" },
  { id: "masculin-metier", langue: "fr", re: mot("\\b(cr[ée]ateurs?|vendeurs?|utilisateurs? (?:final|finale|lambda)|streame(?:ur|urs)|youtubeurs?|influenceurs?)\\b", "iu"), pourquoi: "masculin générique pour la personne ou son public" },
  { id: "doublet-ou-point-median", langue: "fr", re: mot("\\p{L}·\\p{L}|(?<=\\s|^)\\p{L}{3,}\\((?:e|es|ée|ées|ne|se|le|trice|rice|euse)\\)", "iu"), pourquoi: "point médian ou parenthèse (« connecté(e) », « créateur·rice »)" },
  { id: "doublet-lourd", langue: "fr", re: mot("\\b(?:créateurs et créatrices|celles et ceux|ceux et celles|toutes et tous|tous et toutes|utilisateurs et utilisatrices|lecteurs et lectrices|visiteurs et visiteuses|clients et clientes)\\b", "iu"), pourquoi: "doublet lourd : préférer « les personnes qui… », « le public », « l'équipe »" },
  { id: "accord-vous", langue: "fr", re: mot("\\b(?:vous|tu) (?:êtes|es|serez|seras|restez|resterez|étiez) (?:connecté|déconnecté|invité|inscrit|abonné|prêt|seul|certain|sûr|content|ravi|désolé|bloqué|redirigé|informé|averti|autorisé|identifié)s?\\b|\\b(?:vous|tu) seul\\b|\\bConnecté\\(e\\)", "iu"), pourquoi: "adjectif ou participe accordé au genre de la personne (reformuler : « Connexion active », « Invitation envoyée »)" },
  { id: "adresse-genree", langue: "fr", re: mot("\\b(?:Madame|Monsieur|Mme|Cher|Chère|Chers|Chères)\\b", "u"), pourquoi: "formule d'appel genrée" },
  { id: "emoji-genre", langue: "*", re: /[\u{1F468}\u{1F469}]/u, pourquoi: "emoji genré (👨 👩) : préférer 🧑 ou un emoji neutre" },
  { id: "proprietaire-masculin", langue: "fr", re: mot("\\b(?:le|un|ce|du|au) propriétaire\\b|\\b(?:la|une|de la|à la) propriétaire\\b", "iu"), pourquoi: "« le/la propriétaire » : écrire « la personne propriétaire »" },
  { id: "visiteur-masculin", langue: "fr", re: mot("\\b(?:le|un|ce|du|au|les|des|aux|vos|ses|leurs|chaque) visiteurs?\\b", "iu"), pourquoi: "masculin générique pour le public : « le public », « les personnes qui visitent »" },
  { id: "utilisateur-masculin", langue: "fr", re: mot("\\b(?:le|un|ce|du|au|les|des|aux|vos|ses|chaque) utilisateurs?\\b", "iu"), pourquoi: "masculin générique : « la personne », « le compte », « l'équipe »" },
  { id: "auteur-masculin", langue: "fr", re: mot("\\b(?:l'|un |une? |son |leur |les |des |aux |cet |chaque )auteurs?\\b", "iu"), pourquoi: "masculin générique : « la personne qui a écrit… »" },
  { id: "developpeur-masculin", langue: "fr", re: mot("\\b(?:un|des|aux|les|ce|du) développeurs?\\b", "iu"), pourquoi: "masculin générique : « la personne qui développe », « l'équipe technique »" },
  { id: "technicien", langue: "fr", re: mot("\\b(?:non[- ]techniciens?|techniciens?|technicienne)\\b", "iu"), pourquoi: "genre supposé : « sans bagage technique », « technique »" },
  { id: "archetype-prenom-genre", langue: "fr", re: mot("\\bEmma\\b", "u"), pourquoi: "archétype « Emma » (personne non technique) : le cliché est le problème" },
  { id: "attaquant", langue: "fr", re: mot("\\b(?:l'|un )attaquants?\\b", "iu"), pourquoi: "masculin générique : « une personne malveillante »" },
  { id: "pronoms-en", langue: "en", re: mot("\\b(?:he|she|his|hers?|him|himself|herself|he\\/she|s\\/he|his\\/her|chairman|chairmen|mankind|manpower|man-hours?|salesman|salesmen|businessman|businessmen|guys|ladies|gentlemen)\\b", "iu"), pourquoi: "anglais : « they/them », « chair », « people », « workforce »" },
];

// ── 2. Liste blanche (emplois légitimes) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// { id: terme, fichier: préfixe de chemin ("" = partout), contient: extrait de ligne, pourquoi: justification }
const LISTE_BLANCHE = [
  { id: "proprietaire-masculin", fichier: "", contient: "propriétaire de la donnée", pourquoi: "sens technique : le module qui possède une donnée (pas une personne)" },
  { id: "proprietaire-masculin", fichier: "", contient: "propriétaire de chaque fichier", pourquoi: "sens technique : l'instance qui a revendiqué un fichier" },
  { id: "proprietaire-masculin", fichier: "", contient: "propriétaire est l'", pourquoi: "sens technique : l'instance propriétaire d'un fichier" },
  { id: "proprietaire-masculin", fichier: "", contient: "propriétaire des fichiers", pourquoi: "sens technique : l'instance propriétaire des fichiers revendiqués" },
  { id: "proprietaire-masculin", fichier: "", contient: "ropriétaire par donnée", pourquoi: "intitulé de l'exigence « srp.single » du kit de test (une donnée, un module)" },
  { id: "proprietaire-masculin", fichier: "", contient: "Une donnée, un propriétaire", pourquoi: "sens technique : un seul module possède une donnée (choix du service)" },
  { id: "proprietaire-masculin", fichier: "", contient: "propriétaire (l'**instance**", pourquoi: "sens technique : l'instance qui a revendiqué un fichier peut seule le supprimer" },
  { id: "proprietaire-masculin", fichier: "", contient: "un seul propriétaire", pourquoi: "sens technique : un seul module possède une donnée" },
  { id: "proprietaire-masculin", fichier: "", contient: "qu'un propriétaire", pourquoi: "sens technique : une donnée n'a qu'un module propriétaire" },
  { id: "proprietaire-masculin", fichier: "", contient: "a un propriétaire", pourquoi: "sens technique : une donnée a un module propriétaire" },
  { id: "proprietaire-masculin", fichier: "", contient: "ce propriétaire (service)", pourquoi: "sens technique : le module qui possède la donnée" },
  { id: "proprietaire-masculin", fichier: "", contient: "sans propriétaire", pourquoi: "sens technique : fichier ancien sans module propriétaire" },
  { id: "proprietaire-masculin", fichier: "", contient: "un propriétaire,", pourquoi: "sens technique (Un module = propriétaire de ses données)" },
  { id: "proprietaire-masculin", fichier: "", contient: "change de propriétaire", pourquoi: "sens technique : un réglage passe d'un module à un autre" },
  { id: "proprietaire-masculin", fichier: "", contient: "le propriétaire vérifie lui-même son droit", pourquoi: "sens technique : le module propriétaire de la donnée (contrat de service)" },
  { id: "proprietaire-masculin", fichier: "", contient: "« propriétaire »", pourquoi: "mention d'un mot de licence (MIT, propriétaire, payant : licence non libre) ou d'un nom de rôle cité tel quel" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur dédié", pourquoi: "compte système Linux (option --user de install.sh), pas une personne" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur système", pourquoi: "compte système Linux, pas une personne" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur du site", pourquoi: "compte système Linux qui fait tourner le service" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur du service", pourquoi: "compte système Linux qui fait tourner le service" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur qui fait tourner", pourquoi: "compte système Linux qui fait tourner le site" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur qui a lancé", pourquoi: "compte système Linux qui a lancé pm2" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur administrateur", pourquoi: "compte système Linux avec droits d'administration" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur choisi", pourquoi: "compte système Linux choisi à l'installation" },
  { id: "utilisateur-masculin", fichier: "", contient: "utilisateur Linux", pourquoi: "compte système Linux" },
  { id: "utilisateur-masculin", fichier: "", contient: "l'utilisateur «", pourquoi: "compte système Linux cité dans les messages de install.sh" },
  { id: "utilisateur-masculin", fichier: "scripts/install.sh", contient: "utilisateur", pourquoi: "install.sh : compte système Linux (option --user), pas une personne" },
  { id: "utilisateur-masculin", fichier: "docs/AGENT-INSTALL.md", contient: "utilisateur", pourquoi: "guide d'installation : compte système Linux" },
  { id: "utilisateur-masculin", fichier: ".claude/skills/install-curiosa/SKILL.md", contient: "utilisateur", pourquoi: "compte système Linux (option --user de install.sh)" },
  { id: "utilisateur-masculin", fichier: "README.md", contient: "utilisateur", pourquoi: "installation manuelle : compte système Linux dédié" },
  { id: "utilisateur-masculin", fichier: "docs/INSTALL.md", contient: "utilisateur", pourquoi: "installation : compte système Linux dédié" },
  { id: "utilisateur-masculin", fichier: "docs/MESURES.md", contient: "utilisateur", pourquoi: "installation : compte système Linux dédié" },
  { id: "utilisateur-masculin", fichier: "docs/SECURITE.md", contient: "utilisateur du service", pourquoi: "compte système Linux qui lance la commande de secours" },
  { id: "utilisateur-masculin", fichier: "docs/IMPORT-GRAV.md", contient: "utilisateur@serveur", pourquoi: "exemple de commande scp (compte système distant)" },
  { id: "utilisateur-masculin", fichier: "scripts/update-proc.mjs", contient: "utilisateur", pourquoi: "message de diagnostic : compte système Linux" },
  { id: "auteur-masculin", fichier: "", contient: "auteur\"", pourquoi: "nom de champ (« author ») ou de clé cité tel quel" },
  { id: "auteur-masculin", fichier: "", contient: "droit d'auteur", pourquoi: "expression juridique figée (copyright), données d'exemple" },
  { id: "auteur-masculin", fichier: "", contient: "github.com/auteur/", pourquoi: "exemple d'adresse de dépôt (segment d'URL)" },
  { id: "developpeur-masculin", fichier: "CHANGELOG.md", contient: "Pour les développeurs", pourquoi: "intitulé de rubrique lu par un test et par l'outil de notes de version (à renommer avec eux, pas ici)" },
  { id: "developpeur-masculin", fichier: "", contient: "« Pour les développeurs »", pourquoi: "cite l'intitulé de rubrique du CHANGELOG, lu par un test (à renommer avec lui)" },
  { id: "developpeur-masculin", fichier: "", contient: "pour les développeurs|côté technique", pourquoi: "expression régulière du kit de test : reconnaît l'ancien intitulé de rubrique des README de modules déjà publiés" },
  { id: "developpeur-masculin", fichier: "", contient: "pour les développeurs", pourquoi: "ligne du kit de test qui reconnaît l'ancien intitulé de rubrique des README de modules déjà publiés" },
  { id: "pronoms-en", fichier: "src/core/i18n/locales.ts", contient: "he", pourquoi: "code de langue (hébreu), pas un pronom" },
];

// ── 3. Périmètre : textes VISIBLES (jamais l'historique du CHANGELOG, les idées de conception, les tests, les dépendances) ──────────────────────
const EXCLUS = [/^docs\/ideas\//, /^CHANGELOG\.md$/, /^THIRD-PARTY-NOTICES\.md$/, /^package-lock\.json$/, /^tests\//, /^docs\/changelog-parts\//, /^prisma\/migrations\//, /^node_modules\//];
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean).filter((f) => fs.existsSync(f));
const inScope = (f) => !EXCLUS.some((re) => re.test(f));

function stripComments(src, f) {
  if (f.endsWith(".sh")) return src.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l)).join("\n");
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  s = s.replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
  return s;
}
const CODE = /=>|\bfunction\b|\bdocument\.|\breturn\b|\bconst\b|\bgetComputedStyle\b/; // un littéral qui est du code (script envoyé au navigateur), pas un texte
/** Chaînes de caractères d'un fichier de code : [ligne, texte]. */
function literals(src, f) {
  const s = stripComments(src, f); const out = []; const lit = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g; let m;
  while ((m = lit.exec(s))) { const t = m[1] ?? m[2] ?? m[3] ?? ""; if (CODE.test(t)) continue; out.push([s.slice(0, m.index).split("\n").length, t]); }
  return out;
}
/** Valeurs d'un fichier de locale : [clé, texte]. */
function localeValues(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8")); const out = [];
  const walk = (p, v) => { if (typeof v === "string") out.push([p, v]); else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(p ? `${p}.${k}` : k, v[k]); };
  walk("", j); return out;
}

/** Tous les textes visibles : { fichier, lieu, texte, langue }. */
function textes() {
  const out = [];
  for (const f of tracked.filter(inScope)) {
    if (/^src\/locales\/(fr|en)\.json$/.test(f)) { const langue = f.endsWith("fr.json") ? "fr" : "en"; for (const [k, v] of localeValues(f)) out.push({ fichier: f, lieu: k, texte: v, langue }); continue; }
    if (/\.(md|jsonc?)$/.test(f)) {
      const langue = /LICENSE|\.en\./.test(f) ? "en" : "fr";
      fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => out.push({ fichier: f, lieu: String(i + 1), texte: l, langue }));
      continue;
    }
    if (f === "LICENSE") { fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => out.push({ fichier: f, lieu: String(i + 1), texte: l, langue: "en" })); continue; }
    if (/\.(ts|tsx|mjs|js|sh)$/.test(f)) for (const [n, t] of literals(fs.readFileSync(f, "utf8"), f)) out.push({ fichier: f, lieu: String(n), texte: t, langue: "*" });
  }
  return out;
}

const tolere = (id, t) => LISTE_BLANCHE.some((w) => w.id === id && t.fichier.startsWith(w.fichier) && t.texte.includes(w.contient));

export function violations(ens = textes()) {
  const bad = [];
  for (const t of ens) for (const r of TERMES) {
    if (r.langue !== "*" && t.langue !== "*" && r.langue !== t.langue) continue;
    // fichier de code ("*") : le terme anglais ne s'applique qu'aux fichiers sans accent français
    if (t.langue === "*" && r.langue === "en" && /[àâçéèêëîïôûùœ]/i.test(t.texte)) continue;
    if (t.langue === "*" && r.langue === "fr" && !/[a-zàâçéèêëîïôûùœ]/i.test(t.texte)) continue;
    const m = r.re.exec(t.texte);
    if (m && !tolere(r.id, t)) bad.push(`${t.fichier}:${t.lieu} [${r.id}] « ${m[0]} » dans « ${t.texte.slice(Math.max(0, m.index - 30), m.index + 50).replace(/\n/g, " ")} » (${r.pourquoi})`);
  }
  return bad;
}

test("écriture neutre : le détecteur reconnaît les termes genrés connus (et laisse passer les formulations neutres)", () => {
  const essai = (texte, langue = "fr") => violations([{ fichier: "x.md", lieu: "1", texte, langue }]).length > 0 ? 1 : 0;
  for (const mal of ["Les créatrices et leurs clientes", "Un site pour les créateurs", "Vous êtes connecté sur cet appareil", "Connecté(e) avec x", "créateur·rice", "passionné·e", "Bonjour Madame", "👩 Bonjour", "Vos visiteurs voient la page", "Seul le propriétaire peut", "Emma, créatrice non technique", "écrivez pour quelqu'un qui n'est pas technicien"]) assert.equal(essai(mal), 1, mal);
  for (const mal of ["He sent it to her", "The chairman and his team", "mankind"]) assert.equal(essai(mal, "en"), 1, mal);
  for (const bien of ["Les personnes qui vous suivent", "Votre public voit la page", "Seule la personne propriétaire peut", "Connexion active avec x", "Invitation envoyée", "Appareils connectés", "Bienvenue sur {name}", "La clientèle", "They sent it to their team"]) assert.equal(essai(bien, bien.startsWith("They") ? "en" : "fr"), 0, bien);
  // la liste blanche ne tolère que ce qu'elle décrit
  assert.equal(violations([{ fichier: "docs/MODULES.md", lieu: "1", texte: "le propriétaire de la donnée choisit", langue: "fr" }]).length, 0);
  assert.equal(violations([{ fichier: "docs/MODULES.md", lieu: "1", texte: "le propriétaire du site choisit", langue: "fr" }]).length, 1);
});

test("écriture neutre : toute entrée de la liste blanche est justifiée et se rapporte à un terme existant", () => {
  const ids = new Set(TERMES.map((t) => t.id));
  for (const w of LISTE_BLANCHE) { assert.ok(ids.has(w.id), `terme inconnu : ${w.id}`); assert.ok(w.pourquoi && w.pourquoi.length > 15, `raison manquante pour ${w.id} / ${w.contient}`); }
  for (const t of TERMES) assert.ok(t.pourquoi && t.re instanceof RegExp, t.id);
});

test("écriture neutre : aucun texte visible (locales fr/en, README, docs, guides, messages d'outils et de scripts) ne contient un terme genré connu", () => {
  const bad = violations();
  assert.equal(bad.length, 0, `\n${bad.length} texte(s) à reformuler (voir docs/ideas/ecriture-neutre-audit.md) :\n${bad.slice(0, 60).join("\n")}`);
});

test("écriture neutre : les locales fr et en gardent exactement les mêmes clés (parité)", () => {
  const fr = localeValues("src/locales/fr.json").map(([k]) => k).sort(); const en = localeValues("src/locales/en.json").map(([k]) => k).sort();
  assert.deepEqual(fr.filter((k) => !en.includes(k)), [], "clés seulement en français");
  assert.deepEqual(en.filter((k) => !fr.includes(k)), [], "clés seulement en anglais");
});
