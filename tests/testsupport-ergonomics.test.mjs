// Contrôles automatiques de docs/ERGONOMIE-ADMIN.md (testsupport/ergonomics.mjs + exigences admin.ergonomics*) :
// pour CHAQUE règle un module factice fautif ET un module conforme ; le cliquet (toléré / nouveau / disparu) ; l'aide des pages d'administration ; la parité FR/EN ; l'écriture neutre.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkModule } from "../testsupport/index.mjs";
import {
  analyzeModule, bubbleCount, compareToBaseline, baselineGrowth, countByRule, forbiddenWords, hasExample, toneProblems, labelProblems, errorMessageProblems,
  adminPageErgonomicsProblems, assertAdminPageErgonomics, JARGON_WHITELIST, FORBIDDEN_WORDS,
} from "../testsupport/ergonomics.mjs";
import { findBaseline } from "../testsupport/requirements/ergonomics.mjs";
import { makeModule, dispose, editManifest } from "./fixtures/testsupport/fullModule.mjs";
import { makeTempDir, removeTempDir } from "./helpers/tmp.mjs";

const made = [];
const mk = (edit) => { const d = makeModule(edit); made.push(d); return d; };
after(() => { for (const d of made) dispose(d); });

const L = (fr, en = fr) => ({ fr, en });
const field = (key, extra = {}) => ({ key, type: "text", default: "x", label: L(`Réglage ${key}`, `Setting ${key}`), ...extra });
const mod = (manifest, locales = {}) => ({ id: "demo", manifest: { id: "demo", name: L("Démo", "Demo"), ...manifest }, locales });
const rules = (gaps) => gaps.map((g) => g.rule);
const only = (m, rule) => analyzeModule(m).filter((g) => g.rule === rule);

test("un module factice conforme n'a aucun écart", () => {
  const good = mod({
    description: L("Affiche un message d'accueil.", "Shows a welcome message."),
    tabs: [{ id: "use", label: L("Utiliser", "Use") }],
    settings: [
      { key: "title", type: "text", label: L("Titre", "Title"), help: L("Par exemple : Mes vidéos.", "For example: My videos."), default: "Mes vidéos" },
      { key: "count", type: "number", label: L("Nombre de lignes", "Number of lines"), help: L("Entre 1 et 20, par exemple 10.", "Between 1 and 20, for example 10.") },
      { key: "show", type: "boolean", label: L("Afficher la date", "Show the date"), default: true },
    ],
  }, { fr: { hello: "Bonjour {name}", bye: "Au revoir" }, en: { hello: "Hello {name}", bye: "Goodbye" } });
  assert.deepEqual(analyzeModule(good), []);
});

/* ───────────── R5 ───────────── */
test("R5 : plus de 7 réglages simples par onglet échoue ; 7, les avancés et les groupes repliés ne comptent pas", () => {
  const many = (n, extra = {}) => Array.from({ length: n }, (_, i) => field(`k${i}`, extra));
  const bad = analyzeModule(mod({ settings: many(8) })).filter((g) => g.rule === "R5");
  assert.equal(bad.length, 1);
  assert.match(bad[0].key, /^R5 tab:settings \(8\)$/);
  assert.deepEqual(only(mod({ settings: many(7) }), "R5"), []);
  assert.deepEqual(only(mod({ settings: many(12, { advanced: true }) }), "R5"), []);
  const folded = mod({ settings: many(10), optionalGroups: [{ id: "g", label: L("Plus", "More"), addLabel: L("Ajouter", "Add"), fields: ["k0", "k1", "k2", "k3"] }] });
  assert.deepEqual(only(folded, "R5"), [], "10 réglages dont 4 repliés = 6 visibles");
  // chaque onglet a son propre budget
  const tabs = mod({ tabs: [{ id: "a", label: L("A", "A") }], settings: [...many(5), ...Array.from({ length: 5 }, (_, i) => field(`t${i}`, { tab: "a" }))] });
  assert.deepEqual(only(tabs, "R5"), []);
});

/* ───────────── R9 ───────────── */
test("R9 : mots interdits dans libellés, aides et messages FR et EN, hors réglages avancés ; liste blanche justifiée", () => {
  const bad = mod({ settings: [field("a", { label: L("Clé d'accès", "Access key"), help: L("Le jeton Twitch, par exemple abc", "The Twitch token, for example abc") }), field("b", { label: L("Adresse du webhook", "Webhook address") })] },
    { fr: { err: "L'identifiant est inconnu" }, en: { err: "The identifier is unknown" } });
  const found = only(bad, "R9");
  assert.ok(found.length >= 5);
  assert.ok(found.some((g) => g.where.startsWith("locale:fr:err")) && found.some((g) => g.where.startsWith("locale:en:err")));
  // un réglage avancé peut employer ces mots
  assert.deepEqual(only(mod({ settings: [field("a", { advanced: true, label: L("Clé d'API", "API key"), help: L("Le jeton OAuth", "The OAuth token") })] }), "R9"), []);
  // « for instance » n'est pas une « instance »
  assert.deepEqual(forbiddenWords("Choose a name, for instance Marie"), []);
  assert.deepEqual(forbiddenWords("Sujet du message envoyé", "x"), [], "liste blanche : le sujet d'un message");
  assert.deepEqual(forbiddenWords("Le sujet technique"), ["sujet"]);
  assert.ok(JARGON_WHITELIST.every((w) => w.term && w.why && w.why.length > 15), "chaque entrée de la liste blanche dit pourquoi");
  assert.ok(FORBIDDEN_WORDS.includes("webhook") && FORBIDDEN_WORDS.includes("oauth") && FORBIDDEN_WORDS.includes("eventsub"));
  // accolades non expliquées dans un libellé visible
  assert.equal(only(mod({ settings: [field("a", { label: L("Texte avec {nom}", "Text with {nom}") })] }), "R9").length, 2);
});

/* ───────────── R10 ───────────── */
test("R10 : libellé de plus de 60 caractères, deux-points final ou parenthèse à rallonge échouent", () => {
  assert.ok(labelProblems("x".repeat(61)).length);
  assert.ok(labelProblems("Nom :").length);
  assert.ok(labelProblems("Début (seulement si la période ne revient pas)").length);
  assert.deepEqual(labelProblems("x".repeat(60)), []);
  assert.deepEqual(labelProblems("Attente (secondes)"), []);
  const bad = only(mod({ settings: [field("a", { label: L("Nom :", "Name:") })], sections: [{ id: "s", label: L("y".repeat(70), "ok") }] }), "R10");
  assert.equal(bad.length, 3);
  // un message de locale qui finit par « : » est un libellé mal écrit
  assert.equal(only(mod({}, { fr: { l: "Nom :" }, en: { l: "Name" } }), "R10").length, 1);
});

/* ───────────── R11 ───────────── */
test("R11 : un champ libre a une aide avec un exemple ; une aide ne répète pas le libellé ; l'aide longue passe en bulle", () => {
  const noExample = only(mod({ settings: [field("a", { default: undefined, help: L("Le nom affiché.", "The name shown.") })] }), "R11");
  assert.equal(noExample.length, 2);
  assert.equal(only(mod({ settings: [field("a", { default: undefined })] }), "R11").length, 1, "champ libre sans aucune aide");
  for (const [fr, en] of [["Par exemple : insta, ig.", "For example: insta, ig."], ["Écrivez « salut ».", "Write \"hi\"."], ["Une adresse comme https://exemple.org", "An address like https://example.org"], ["Votre pseudo, comme @marie", "Your nickname, like @marie"]]) {
    assert.deepEqual(only(mod({ settings: [field("a", { default: undefined, help: L(fr, en) })] }), "R11"), [], fr);
  }
  assert.deepEqual(only(mod({ settings: [field("n", { type: "number", default: undefined, help: L("Entre 5 et 3600.", "Between 5 and 3600.") })] }), "R11"), [], "un nombre vaut exemple pour un champ numérique");
  assert.deepEqual(only(mod({ settings: [field("a", { type: "boolean", default: undefined, help: L("Texte quelconque.", "Any text.") })] }), "R11"), [], "ce n'est pas un champ libre");
  assert.deepEqual(only(mod({ settings: [field("a", { default: undefined, advanced: true })] }), "R11"), []);
  assert.deepEqual(only(mod({ settings: [field("a", { default: "Mes vidéos" })] }), "R11"), [], "une valeur par défaut visible est un exemple");
  const repeat = only(mod({ settings: [field("a", { label: L("Nom de la chaîne", "Channel name"), help: L("Nom de la chaîne.", "Channel name."), type: "boolean" })] }), "R11");
  assert.equal(repeat.length, 2);
  // aide longue : pas un écart, une information
  const long = mod({ settings: [field("a", { type: "boolean", help: L("Une longue explication ".repeat(6), "A long explanation ".repeat(6)) })] });
  assert.deepEqual(only(long, "R11"), []);
  assert.equal(bubbleCount(long), 2);
  assert.equal(hasExample("rien", "text"), false);
});

/* ───────────── R13 ───────────── */
test("R13 : « ! », « Veuillez », MAJUSCULES, tutoiement, phrase de plus de 20 mots, genre supposé échouent", () => {
  const cases = [["Bravo !", "exclamation"], ["Veuillez patienter.", "Veuillez"], ["Le bot est COUPÉ.", "MAJUSCULES"], ["Tu peux changer ton nom.", "tutoiement"], ["Clique pour t'inscrire.", "tutoiement"], ["Les personnes connecté(e)s", "genre"], ["Les créateur·rices", "genre"],
    [Array.from({ length: 21 }, () => "mot").join(" ") + ".", "phrase"]];
  for (const [text, what] of cases) assert.ok(toneProblems(text, "fr").length, `${what} : ${text}`);
  for (const ok of ["Tapez !stop dans le chat.", "Votre nom, par exemple Marie.", "Vos pages HTML et JSON.", "Une phrase courte. Une autre phrase courte.", "Valeur de {date} sur OBS."]) assert.deepEqual(toneProblems(ok, "fr"), [], ok);
  assert.ok(toneProblems("Welcome!", "en").length);
  assert.deepEqual(toneProblems("Tu", "en"), [], "le tutoiement ne concerne que le français");
  assert.equal(only(mod({}, { fr: { a: "Bienvenue !" }, en: { a: "Welcome" } }), "R13").length, 1);
});

/* ───────────── R17 ───────────── */
test("R17 : « Activer / désactiver » dans un texte échoue", () => {
  assert.equal(only(mod({}, { fr: { t: "Activer / désactiver" }, en: { t: "Enable / disable" } }), "R17").length, 2);
  assert.equal(only(mod({}, { fr: { t: "Activée" }, en: { t: "On" } }), "R17").length, 0);
});

/* ───────────── R19 ───────────── */
test("R19 : pas de liste oui/non pour un booléen, pas de case négative", () => {
  const yesNo = mod({ settings: [{ key: "a", type: "select", label: L("Actif", "Active"), default: "true", options: [{ value: "true", label: L("Oui", "Yes") }, { value: "false", label: L("Non", "No") }] }] });
  assert.equal(only(yesNo, "R19").length, 1);
  const choice = mod({ settings: [{ key: "a", type: "select", label: L("Style", "Style"), default: "a", options: [{ value: "a", label: L("Liste", "List") }, { value: "b", label: L("Grille", "Grid") }] }] });
  assert.deepEqual(only(choice, "R19"), []);
  assert.equal(only(mod({ settings: [field("a", { type: "boolean", default: false, label: L("Ne pas afficher la date", "Do not show the date") })] }), "R19").length, 2);
  assert.deepEqual(only(mod({ settings: [field("a", { type: "boolean", default: false, label: L("Masquer la date", "Hide the date") })] }), "R19"), []);
});

/* ───────────── R29 ───────────── */
test("R29 : parité exacte FR/EN des clés et des {variables}", () => {
  const gaps = only(mod({ settings: [field("a", { label: { fr: "Titre" }, help: L("Bonjour {nom}", "Hello {name}") })] }, { fr: { a: "A {x}", only_fr: "B" }, en: { a: "A {y}", only_en: "C" } }), "R29");
  const text = gaps.map((g) => g.message).join("\n");
  assert.match(text, /anglais manquant/);
  assert.match(text, /\{variables\} différentes/);
  assert.match(text, /only_fr/);
  assert.match(text, /only_en/);
  assert.equal(gaps.length, 5);
  assert.deepEqual(only(mod({}, { fr: { a: "A {x} {y}", b: "B" }, en: { a: "A {y} {x}", b: "B" } }), "R29"), []);
  assert.deepEqual(only(mod({}, { fr: { a: "Ex. {aleatoire oui | non}" }, en: { a: "Ex. {aleatoire yes | no}" } }), "R29"), [], "un exemple de saisie entre accolades n'est pas une variable");
});

/* ───────────── Le cliquet ───────────── */
test("cliquet : toléré / nouveau / disparu", () => {
  const gaps = [{ key: "R10 a", rule: "R10" }, { key: "R13 b", rule: "R13" }];
  assert.deepEqual(compareToBaseline(gaps, ["R10 a", "R13 b"]), { tolerated: gaps, fresh: [], stale: [] });
  const r = compareToBaseline(gaps, ["R10 a", "R9 vieux"]);
  assert.deepEqual(r.tolerated.map((g) => g.key), ["R10 a"]);
  assert.deepEqual(r.fresh.map((g) => g.key), ["R13 b"]);
  assert.deepEqual(r.stale, ["R9 vieux"]);
  assert.deepEqual(countByRule([{ rule: "R9" }, { rule: "R9" }, { rule: "R5" }]), { R9: 2, R5: 1 });
});

test("cliquet : la base ne peut que rétrécir (baselineGrowth)", () => {
  const before = { modules: { a: ["R10 x", "R13 y"] } };
  assert.deepEqual(baselineGrowth(before, { modules: { a: ["R10 x"] } }), []);
  assert.deepEqual(baselineGrowth(before, { modules: { a: ["R10 x", "R9 z"] } }), ["a : R9 z"]);
  assert.deepEqual(baselineGrowth(before, { modules: { neuf: ["R9 z"] } }), ["neuf : R9 z"], "un module nouveau n'a droit à aucun écart");
  assert.deepEqual(baselineGrowth(null, { modules: {} }), []);
});

test("R13 : les noms de fichiers en capitales et le « (es) » anglais ne sont pas des écarts", () => {
  assert.deepEqual(toneProblems("Un fichier SKILL.md pour votre assistant", "fr"), []);
  assert.deepEqual(toneProblems("address(es) ready", "en"), []);
});

const baselineFor = (dir, keys) => ({ version: 1, modules: { [path.basename(dir)]: keys } });
const ergo = async (dir, baseline) => {
  const rep = await checkModule(dir, { siblings: [], ...(baseline ? { ergonomicsBaseline: baseline } : {}) });
  return { hard: rep.results.find((r) => r.id === "admin.ergonomics"), soft: rep.results.find((r) => r.id === "admin.ergonomics.known"), rep };
};
const worse = (f) => editManifest(f, (m) => { m.settings[0].label.fr = "Titre de la page :"; });

test("cliquet (exigence) : un écart de la base est un avertissement, un nouvel écart un échec, un écart disparu un échec", async () => {
  const dir = mk(worse);
  const first = await ergo(dir, baselineFor(dir, []));
  assert.equal(first.hard.status, "fail");
  assert.match(first.hard.problems[0], /NOUVEL écart R10/);
  assert.equal(first.rep.summary.ok, false);
  const key = analyzeModule({ id: "full-mod", manifest: JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")), locales: {} })[0].key;
  assert.match(key, /^R10 setting:title\.label\[fr\] #[0-9a-f]{6}$/);
  // l'écart est connu : tolérance, avertissement
  const known = await ergo(dir, baselineFor(dir, [key]));
  assert.equal(known.hard.status, "pass");
  assert.equal(known.soft.status, "fail");
  assert.equal(known.soft.level, "advice");
  assert.match(known.soft.problems.join("\n"), /R10 — .*1 écart/);
  assert.equal(known.rep.summary.ok, true);
  // un deuxième écart apparaît (nouveau texte fautif) : échec
  const m2 = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  m2.settings[0].help.fr = "Merci de patienter !";
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(m2));
  const fresh = await ergo(dir, baselineFor(dir, [key]));
  assert.equal(fresh.hard.status, "fail");
  assert.match(fresh.hard.problems.join("\n"), /NOUVEL écart R13/);
  // le texte fautif est corrigé : la ligne de la base est périmée
  const m3 = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  m3.settings[0].label.fr = "Titre de la page"; m3.settings[0].help.fr = "Affiché en haut de la page.";
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(m3));
  const stale = await ergo(dir, baselineFor(dir, [key]));
  assert.equal(stale.hard.status, "fail");
  assert.match(stale.hard.problems[0], /retirez cette ligne de la base/);
  assert.match(stale.hard.problems[0], new RegExp(key.replace(/[[\]]/g, "\\$&")));
  // base à jour : tout est propre
  assert.equal((await ergo(dir, baselineFor(dir, []))).hard.status, "pass");
});

test("cliquet : sans base, rien n'échoue (avertissements seulement) ; un module absent d'une base existante est strict ; la base se trouve dans <dépôt>/tests", async () => {
  const dir = mk(worse);
  const none = await ergo(dir);
  assert.equal(none.hard.status, "skip");
  assert.equal(none.soft.status, "fail");
  assert.equal(none.rep.summary.ok, true);
  assert.equal((await ergo(dir, { version: 1, modules: { autre: [] } })).hard.status, "fail", "module absent de la base : tolérance nulle");
  // détection automatique : <dépôt>/modules/<id> + <dépôt>/tests/ergonomics-baseline.json
  const repo = makeTempDir("ergo-repo-");
  fs.mkdirSync(path.join(repo, "modules"));
  fs.mkdirSync(path.join(repo, "tests"));
  fs.cpSync(dir, path.join(repo, "modules", "full-mod"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tests", "ergonomics-baseline.json"), JSON.stringify({ version: 1, modules: { "full-mod": [] } }));
  assert.equal((await checkModule(path.join(repo, "modules", "full-mod"), { siblings: [] })).results.find((r) => r.id === "admin.ergonomics").status, "fail");
  assert.deepEqual(findBaseline({ dir: path.join(repo, "modules", "full-mod"), opts: {} }).modules, { "full-mod": [] });
  assert.equal(findBaseline({ dir: path.join(repo, "modules", "full-mod"), opts: { ergonomicsBaseline: false } }), null);
  removeTempDir(repo);
});

/* ───────────── Pages produites par du code ───────────── */
const field_ = (name, extra = {}) => ({ name, label: `Champ ${name}`, kind: "text", ...extra });
const rowsOf = (n, cell = (i) => [`Commande ${i}`, `n${i}`]) => Array.from({ length: n }, (_, i) => cell(i));
const ruleOf = (blocks, opts) => adminPageErgonomicsProblems(blocks, opts).map((p) => p.rule);

test("page R4 : plus de 5 champs visibles par formulaire, plus de 7 par section", () => {
  const form = (n, extra) => ({ type: "adminForm", action: "add", submitLabel: "Ajouter la personne", fields: Array.from({ length: n }, (_, i) => field_(`c${i}`, extra)) });
  assert.deepEqual(ruleOf([form(5)]), []);
  assert.deepEqual(ruleOf([form(6)]), ["R4"]);
  assert.deepEqual(ruleOf([{ ...form(5), fields: [...form(5).fields, { name: "id", kind: "hidden" }] }]), [], "les champs cachés ne comptent pas");
  assert.deepEqual(ruleOf([form(9, { advanced: true })]), [], "les champs repliés ne comptent pas");
  assert.deepEqual(ruleOf([{ type: "heading", text: "A" }, form(4), form(4)]), ["R4"], "8 champs dans une section");
  assert.deepEqual(ruleOf([{ type: "heading", text: "A" }, form(4), { type: "heading", text: "B" }, form(4)]), []);
});

test("page R15 : une liste de plus de 10 lignes a un champ de recherche", () => {
  const table = (n) => ({ type: "table", columns: ["Nom", "Code"], rows: rowsOf(n) });
  assert.deepEqual(ruleOf([table(10)]), []);
  assert.deepEqual(ruleOf([table(11)]), ["R15"]);
  assert.deepEqual(ruleOf([{ type: "html", html: '<input type="search" placeholder="Rechercher">' }, table(30)]), []);
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "q", submitLabel: "Rechercher", fields: [field_("q", { label: "Rechercher" })] }, table(30)]), []);
  assert.deepEqual(ruleOf([{ ...table(30), searchable: true }]), []);
  assert.deepEqual(ruleOf([table(30)], { skip: ["R15"] }), []);
});

test("page R17 : aucun bouton « Activer / désactiver »", () => {
  const t = { type: "table", columns: ["Nom"], rows: [["a"]], rowIds: ["1"], rowActions: [{ label: "Modifier", href: "?e={id}" }, { label: "Activer / désactiver", action: "toggle" }] };
  assert.deepEqual(ruleOf([t]), ["R17"]);
  assert.deepEqual(ruleOf([{ ...t, rowActions: [{ label: "Modifier", href: "?e={id}" }] }]), []);
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "x", submitLabel: "Enable / disable", fields: [] }]), ["R17"]);
});

test("page R14 : une étiquette identique sur toutes les lignes d'un tableau de plus de 5 lignes", () => {
  const t = (n, label) => ({ type: "table", columns: ["Nom", "Origine"], rows: rowsOf(n, (i) => [`Commande ${i}`, label(i)]) });
  assert.deepEqual(ruleOf([t(6, () => "La vôtre")]), ["R14"]);
  assert.deepEqual(ruleOf([t(5, () => "La vôtre")]), []);
  assert.deepEqual(ruleOf([t(6, (i) => (i === 2 ? "Partenaire" : "La vôtre"))]), []);
  assert.deepEqual(ruleOf([t(6, () => "<b>La vôtre</b>")]), ["R14"]);
});

test("page R22 : une erreur dit quoi faire avec un exemple, jamais de code ni de trace", () => {
  assert.deepEqual(errorMessageProblems("Écrivez un nombre entier, par exemple 500."), []);
  assert.ok(errorMessageProblems("Valeur invalide").length);
  assert.ok(errorMessageProblems("Erreur 500").length);
  assert.ok(errorMessageProblems("TypeError: x is undefined, par exemple").length);
  assert.deepEqual(ruleOf([], { errors: ["Écrivez un nombre entier, par exemple 500."] }), []);
  assert.deepEqual(ruleOf([], { errors: ["Valeur invalide"] }), ["R22"]);
});

test("page R3, R9, R10 : bouton « OK », mot du code, libellé trop long", () => {
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "a", submitLabel: "OK", fields: [] }]), ["R3"]);
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "a", submitLabel: "Valider", fields: [] }]), ["R3"]);
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "a", submitLabel: "Ajouter la personne", fields: [field_("a", { label: "Le jeton" })] }]), ["R9"]);
  assert.deepEqual(ruleOf([{ type: "adminForm", action: "a", submitLabel: "Ajouter la personne", fields: [field_("a", { label: "x".repeat(70) })] }]), ["R10"]);
});

test("assertAdminPageErgonomics : lève une erreur claire, ou passe", () => {
  assert.throws(() => assertAdminPageErgonomics([{ type: "table", columns: ["A"], rows: rowsOf(20, (i) => [`x${i}`]) }]), /R15/);
  assert.doesNotThrow(() => assertAdminPageErgonomics([{ type: "heading", text: "Commandes" }, { type: "html", html: '<input type="search">' }, { type: "table", columns: ["Nom"], rows: rowsOf(20, (i) => [`x${i}`]) }]));
  assert.doesNotThrow(() => assertAdminPageErgonomics(undefined));
});

/* ───────────── kit d'administration (cœur 0.6.0) : les nouvelles clés comptent pour les règles ───────────── */

test("réglage rare (« Plus d'options ») : ne compte plus dans les 7 réglages simples d'un onglet (R5)", () => {
  const settings = Array.from({ length: 9 }, (_, i) => field(`s${i}`));
  assert.equal(only(mod({ settings }), "R5").length, 1, "9 réglages simples : écart");
  const rare = settings.map((f, i) => (i >= 6 ? { ...f, rare: true } : f));
  assert.equal(only(mod({ settings: rare }), "R5").length, 0, "3 réglages rares : 6 simples, plus d'écart");
});

test("réglage avec « example » : un exemple concret (R11) ; ses textes sont contrôlés comme les autres (R9, R29)", () => {
  const bare = { key: "pseudo", type: "text", label: L("Pseudo", "Nickname") };
  assert.equal(only(mod({ settings: [bare] }), "R11").length, 1, "champ libre sans aide ni exemple");
  assert.equal(only(mod({ settings: [{ ...bare, example: L("insta, ig", "insta, ig") }] }), "R11").length, 0);
  assert.equal(only(mod({ settings: [{ ...bare, help: L("Votre nom affiché.", "Your display name."), example: L("insta", "insta") }] }), "R11").length, 0);
  const jargon = only(mod({ settings: [{ ...bare, example: L("votre token", "your token") }] }), "R9");
  assert.ok(jargon.some((g) => /example/.test(g.where)), "un mot du code dans l'exemple est repéré");
});

test("page produite par du code : un tableau enrichi (recherche, pastilles, interrupteurs) et un champ « example » respectent les règles", () => {
  const rows = Array.from({ length: 30 }, (_, i) => [`!cmd${i}`, { text: i % 2 ? "Partenaires" : "Les vôtres", badge: i % 2 ? "info" : "accent" }, { text: "Actif", switch: { on: true, action: "toggle", label: `Commande ${i} active` } }]);
  const table = { type: "table", columns: ["Commande", "Origine", "État"], rows, rowIds: rows.map((_, i) => String(i)), searchable: true, rowActions: [{ label: "Modifier", href: "?edit={id}" }, { label: "Supprimer", action: "del", danger: true, inMenu: true }] };
  assert.deepEqual(adminPageErgonomicsProblems([table]), [], "30 lignes avec recherche : aucun écart ; la colonne d'origine n'est pas uniforme");
  assert.ok(adminPageErgonomicsProblems([{ ...table, searchable: undefined }]).some((p) => p.rule === "R15"), "sans recherche : écart R15");
  const same = { ...table, rows: rows.map((r) => [r[0], { text: "Les vôtres", badge: "accent" }, r[2]]) };
  assert.ok(adminPageErgonomicsProblems([same]).some((p) => p.rule === "R14"), "une pastille identique sur toutes les lignes est un titre, pas une étiquette (R14)");
  const form = { type: "adminForm", action: "save", submitLabel: "Ajouter la commande", fields: [
    { name: "a", label: "Nom", example: "!bonjour" }, { name: "b", label: "Réponse", kind: "textarea" }, { name: "c", label: "Qui", kind: "segmented", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    { name: "d", label: "Attente", kind: "duration", folded: true }, { name: "e", label: "Fin", kind: "datetime", folded: true }, { name: "f", label: "Période", kind: "period", folded: true }, { name: "g", label: "Note", folded: true },
  ] };
  assert.deepEqual(adminPageErgonomicsProblems([form]), [], "3 champs visibles + 4 repliés : sous le budget de 5");
  assert.ok(adminPageErgonomicsProblems([{ ...form, fields: form.fields.map((f) => ({ ...f, folded: undefined })) }]).some((p) => p.rule === "R4"), "dépliés, ils dépassent");
});

test("exigences : un module qui utilise un contrôle de la 0.6.0 doit déclarer « minCore » 0.6.0", async () => {
  const { FEATURES } = await import("../testsupport/requirements/manifest.mjs");
  const news = FEATURES.filter((f) => f.since === "0.6.0" && !/journal/.test(f.label)); // le journal du cœur (ctx.api.log) a son propre test (tests/testsupport.test.mjs)
  assert.equal(news.length, 4);
  const code = (src, man = { settings: [] }) => news.filter((f) => f.test({ code: src }, man)).length;
  assert.equal(code("blocks.push({ type: 'table', columns: [], rows: [], searchable: true })"), 1);
  assert.equal(code("{ type: 'table', rows: [[{ text: 'a', badge: 'ok' }]] }"), 1);
  assert.equal(code("{ type: 'table', pageSize: 20 }"), 0, "« pageSize » seul est trop courant pour exiger quoi que ce soit");
  assert.equal(code("{ kind: 'switch', name: 'x' }"), 1);
  assert.equal(code("{ name: 'x', folded: true }"), 1);
  assert.equal(code("nothing"), 0);
  assert.equal(code("", { settings: [{ key: "k", type: "period" }] }), 1);
  assert.equal(code("", { settings: [{ key: "k", type: "number", min: 1 }] }), 1);
  assert.equal(code("", { settings: [{ key: "k", type: "number" }] }), 0);
});

/* ───────────── vignettes de tableau (cellule `image`) : R28 et R16 ───────────── */
test("vignette de tableau : sans texte alternatif (R28) ou sans adresse affichable (R16), la page est signalée ; une image valable passe", () => {
  const table = (image) => [{ type: "table", columns: ["Jeu"], rows: [[{ text: "Zelda", image }]] }];
  const rules = (image, opts) => adminPageErgonomicsProblems(table(image), opts).map((p) => p.rule);
  assert.deepEqual(rules({ src: "/uploads/z.webp", alt: "Jaquette de Zelda" }), []);
  assert.deepEqual(rules({ src: "https://media.example.org/z.jpg", alt: "Jaquette" }, { imageHosts: ["media.example.org"] }), []);
  assert.deepEqual(rules({ src: "/uploads/z.webp", alt: "" }), ["R28"]);
  assert.deepEqual(rules({ src: "/uploads/z.webp" }), ["R28"]);
  assert.deepEqual(rules({ src: "https://tiers.example.net/z.jpg", alt: "x" }, { imageHosts: ["media.example.org"] }), ["R16"], "hôte non déclaré");
  assert.deepEqual(rules({ src: "https://tiers.example.net/z.jpg", alt: "x" }), [], "sans liste d'hôtes, seule la forme est contrôlée");
  for (const src of ["/api/admin/x", "/admin/users", "/a/../b", "//x.example/y", "http://media.example.org/z", "javascript:alert(1)", "https://u@media.example.org/z", ""]) assert.deepEqual(rules({ src, alt: "x" }, { imageHosts: ["media.example.org"] }), ["R16"], src);
});

/* ───────────── R33 (a to g), core 0.36.0 ───────────── */
import { conditionalWording, fillerPhrases, forbiddenStatus, assertConnectionStates, STATE_VOCABULARY, CONNECTION_STATES, CONDITIONAL_WORDS, FILLER_PHRASES, FORBIDDEN_STATUS } from "../testsupport/ergonomics.mjs";

const page = (blocks, opts) => adminPageErgonomicsProblems(blocks, opts);
const has = (problems, rule) => problems.filter((p) => p.rule === rule);
const conn = (state, extra = {}) => ({ type: "connection", id: "app", title: "Application", state, edit: { href: "?edit=app" }, ...extra });

test("R33a : l'état se dit avec trois mots ; un mot interne est refusé dans une pastille, un bloc « connection » mal formé aussi", () => {
  assert.deepEqual(STATE_VOCABULARY.fr, { configured: "Configuré", degraded: "Dégradé", notConfigured: "Non configuré" });
  assert.deepEqual(STATE_VOCABULARY.en, { configured: "Configured", degraded: "Degraded", notConfigured: "Not configured" });
  assert.deepEqual(CONNECTION_STATES, ["configured", "degraded", "notConfigured"]);
  for (const w of ["Reprise", "Repris", "Prête", "Incomplète", "Pris ailleurs", "Legacy", "Hérité", "Carried over", "Taken over", "Bridged", "Adopté"]) assert.deepEqual(forbiddenStatus(w).length, 1, w);
  for (const w of ["Configuré", "Dégradé", "Non configuré", "En direct", "etoile_nord"]) assert.deepEqual(forbiddenStatus(w), [], w);
  assert.deepEqual(forbiddenStatus("Une page prête à être publiée après relecture complète"), [], "une phrase n'est pas une pastille");
  const cells = [[{ text: "Reprise", badge: "info" }], [{ text: "Configuré", badge: "ok" }]];
  assert.equal(has(page([{ type: "table", columns: ["État"], rows: cells }]), "R33a").length, 1);
  assert.ok(has(page([conn("ready", { summary: "x" })]), "R33a").length >= 1, "état inconnu");
  assert.equal(has(page([conn("degraded", { summary: "x" })]), "R33a").length >= 2, true, "dégradé sans raison ni marche à suivre");
  assert.equal(has(page([conn("degraded", { reason: "Refusé", primary: { label: "Autoriser", href: "/x" }, summary: "x" })]), "R33a").length, 0);
  assert.equal(has(page([conn("configured", { summary: "Client …a1b2" })]), "R33a").length, 0);
  assert.equal(has(page([conn("configured")]), "R33a").length, 1, "configuré sans résumé");
  assert.equal(has(page([conn("notConfigured", { reason: "Rien n'est enregistré", setup: [{ type: "copy", text: "x" }], edit: undefined })]), "R33a").length, 0);
  const locale = analyzeModule(mod({}, { fr: { chip_state_taken: "Reprise", note: "Reprise du direct" }, en: { chip_state_taken: "Taken over", note: "Resuming the stream" } })).filter((g) => g.rule === "R33a");
  assert.equal(locale.length, 2, "seules les clés d'état sont jugées");
});

test("R33b : une page configurée ne garde pas un formulaire dont tous les champs sont remplis ; une fenêtre, un formulaire vide ou non configuré passent", () => {
  const filled = { type: "adminForm", action: "save", submitLabel: "Enregistrer l'application", fields: [{ name: "id", label: "Application", value: "abc" }, { name: "key", label: "Code", kind: "secret", valueHint: "kept" }] };
  assert.equal(has(page([filled], { state: "configured" }), "R33b").length, 1);
  assert.equal(has(page([filled]), "R33b").length, 0, "sans état déclaré : pas de contrôle");
  assert.equal(has(page([filled], { state: "notConfigured" }), "R33b").length, 0);
  assert.equal(has(page([{ ...filled, presentation: "dialog", cancelHref: "?" }], { state: "configured" }), "R33b").length, 0, "derrière « Modifier »");
  assert.equal(has(page([{ ...filled, fields: [{ name: "id", label: "Application", value: "" }] }], { state: "configured" }), "R33b").length, 0);
  assert.equal(has(page([{ ...filled, fields: [{ name: "id", label: "Application", value: "abc", folded: true }] }], { state: "configured" }), "R33b").length, 0, "replié");
  // static: a secret or an identifier setting visible in simple mode
  const m = mod({ settings: [{ key: "clientId", type: "text", label: L("Application", "Application"), help: L("Par exemple : abc.", "For example: abc.") }, { key: "apiSecret", type: "secret", label: L("Code", "Code") }, { key: "apiKeyAdv", type: "secret", advanced: true, label: L("Code", "Code") }, { key: "title", type: "text", default: "x", label: L("Titre", "Title") }] });
  assert.deepEqual(only(m, "R33b").map((g) => g.where), ["setting:apiSecret", "setting:clientId"]);
});

test("R33c : deux lignes d'état identiques qui se suivent échouent ; des lignes différentes ou séparées passent", () => {
  const b = (text) => ({ type: "banner", text, href: "/x" });
  assert.equal(has(page([b("Twitch ne répond pas"), b("Twitch ne répond pas")]), "R33c").length, 1);
  assert.equal(has(page([b("Twitch ne répond pas"), { type: "heading", text: "Comptes" }, b("Twitch ne répond pas")]), "R33c").length, 0);
  assert.equal(has(page([b("Twitch ne répond pas"), b("YouTube ne répond pas")]), "R33c").length, 0);
  assert.equal(has(page([{ type: "markdown", text: "Un état  identique." }, { type: "markdown", text: "un état identique." }]), "R33c").length, 1, "casse, accents et espaces ignorés");
});

test("R33d : un bandeau de bonne nouvelle sans action échoue ; avec action, ou une alerte, il passe", () => {
  assert.equal(has(page([{ type: "banner", text: "Votre compte est enregistré", tone: "success" }]), "R33d").length, 1);
  assert.equal(has(page([{ type: "banner", text: "Tout fonctionne" }]), "R33d").length, 1);
  assert.equal(has(page([{ type: "banner", text: "Tout fonctionne", href: "/x" }]), "R33d").length, 0);
  assert.equal(has(page([{ type: "banner", text: "Le code a expiré", tone: "warning" }]), "R33d").length, 0);
});

test("R33e : la formulation conditionnelle ou approximative échoue (FR et EN), une exception justifiée passe", () => {
  for (const t of ["Ajoutez-la si ce n'est pas déjà fait", "Cela marche normalement", "En général, une minute", "C'est peut-être passager", "Au besoin, cliquez", "If not already done, add it", "It usually takes a minute", "Maybe later"]) assert.ok(conditionalWording(t).length >= 1, t);
  for (const t of ["Ajoutez cette adresse", "Le code a expiré", "Renewal is automatic"]) assert.deepEqual(conditionalWording(t), [], t);
  const m = mod({ settings: [field("a", { help: L("Collez le lien, normalement.", "Paste the link, normally.") })] }, { fr: { x: "Si ce n'est pas déjà fait" }, en: { x: "If not already done" } });
  assert.ok(only(m, "R33e").length >= 4);
  assert.ok(CONDITIONAL_WORDS.every((w) => w === w.toLowerCase() && !/[é-ï]/.test(w)), "la liste est pliée (minuscules, sans accents)");
});

test("R33f : une page configurée ne montre aucune consigne de mise en place ; l'état à configurer, oui", () => {
  const setup = [{ type: "copy", text: "https://exemple.test/retour" }];
  assert.equal(has(page(setup, { state: "configured" }), "R33f").length, 1);
  assert.equal(has(page(setup, { state: "notConfigured" }), "R33f").length, 0);
  assert.equal(has(page(setup), "R33f").length, 0);
  assert.equal(has(page([{ type: "markdown", text: "Collez cette adresse dans les Redirect URLs." }], { state: "configured" }), "R33f").length, 1);
  assert.equal(has(page([{ type: "markdown", text: "Compte etoile_nord connecté." }], { state: "configured" }), "R33f").length, 0);
  assert.equal(has(page([{ type: "suggestInstall", service: "x", reason: "y" }], { state: "configured" }), "R33f").length, 1);
  assert.equal(has(page([conn("configured", { summary: "Client …a1b2", setup })], { state: "configured" }), "R33f").length >= 1, true, "le bloc configuré ne porte pas de consignes");
});

test("R33g : les phrases de remplissage échouent (FR et EN)", () => {
  for (const t of ["Rien à faire : la reprise est automatique", "Tout va bien", "Vous n'avez rien à régler", "C'est normal", "Sans risque", "Nothing to do here", "Everything is fine", "Don't worry"]) assert.ok(fillerPhrases(t).length >= 1, t);
  for (const t of ["Ce lien expire demain", "Le compte etoile_nord est connecté"]) assert.deepEqual(fillerPhrases(t), [], t);
  const m = mod({ description: L("Tout fonctionne, rien à faire.", "All is well.") });
  assert.ok(only(m, "R33g").length >= 2);
  assert.ok([...FILLER_PHRASES, ...FORBIDDEN_STATUS].every((w) => w === w.toLowerCase() && !/[é-ï]/.test(w)));
});

test("assertConnectionStates : les trois états doivent être présents et corrects ; le configuré n'a ni mise en place ni formulaire rempli", () => {
  const okSetup = [conn("notConfigured", { reason: "Aucun identifiant n'est enregistré", edit: undefined, setup: [{ type: "copy", text: "https://exemple.test/retour" }] })];
  const okConf = [conn("configured", { summary: "Client …a1b2" })];
  const okDeg = [conn("degraded", { summary: "Client …a1b2", reason: "Le compte etoile_nord doit être autorisé", primary: { label: "Autoriser de nouveau", href: "/x" } })];
  assert.doesNotThrow(() => assertConnectionStates({ notConfigured: okSetup, configured: okConf, degraded: okDeg }));
  assert.throws(() => assertConnectionStates({ notConfigured: okSetup, configured: okConf }), /« degraded » manque|degraded/);
  assert.throws(() => assertConnectionStates({ notConfigured: okSetup, configured: okDeg, degraded: okDeg }), /dit « degraded »/);
  assert.throws(() => assertConnectionStates({ notConfigured: okSetup, configured: [...okConf, { type: "copy", text: "https://exemple.test/retour" }], degraded: okDeg }), /R33f/);
  assert.throws(() => assertConnectionStates({ notConfigured: [conn("notConfigured", { reason: "Rien", edit: undefined, primary: { label: "Commencer", href: "/x" } })], configured: okConf, degraded: okDeg }), /ni consignes/);
  assert.throws(() => assertConnectionStates({ notConfigured: okSetup, configured: [], degraded: okDeg }), /aucun bloc « connection »/);
});

test("l'exigence admin.ergonomics trie R33a… après R29 et décrit R33 ; chaque règle R33 a son texte", async () => {
  const { RULES } = await import("../testsupport/ergonomics.mjs");
  for (const r of ["R33a", "R33b", "R33c", "R33d", "R33e", "R33f", "R33g"]) assert.ok(RULES[r], r);
  const src = fs.readFileSync("testsupport/requirements/ergonomics.mjs", "utf8");
  assert.match(src, /parseInt\(a\.slice\(1\), 10\)/);
});
