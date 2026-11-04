import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// MODULE I18N: English and French are always supported; any other language may be partial; a missing text falls back
// (requested language -> site main language -> English) and NEVER shows another language by accident.
const db = await useTestDb();
const cat = createCatalogue();
const A = await import("@/core/i18n/audit.mjs");
const { DICTIONARIES, UI_LOCALES, makeTranslator } = await import("@/core/i18n/dictionary");
const { localized } = await import("@/core/modules/types");
const { parseManifest } = await import("@/core/modules/manifest");
const R = await import("@/core/modules/recognized");
const S = await import("@/core/modules/starter");
const M = await import("@/core/modules/catalogue");
const { moduleI18nReport } = await import("@/core/i18n/moduleStatus");
const { toolDescription } = await import("@/core/modules/mcpProvider");
const { initialSetupLanguage } = await import("@/app/admin/(auth)/setup/language");
const { setupView } = await import("@/app/admin/(auth)/setup/view");
const { getAllSetupStrings } = await import("@/app/admin/(auth)/setup/strings");
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { SetupWizard } = await import("@/app/admin/(auth)/setup/SetupWizard");
const { KNOWN_LOCALES, languageStatus } = await import("@/core/i18n/locales");

beforeEach(async () => { await db.reset(); await cat.clear(); });
after(() => { cat.close(); return db.close(); });

const read = (p) => fs.readFileSync(p, "utf8");
const EF = (en, fr) => ({ en, fr });

/* ───────────── the fallback chain ───────────── */

test("pickText: requested language, then the site main language, then English; never the first language of the object, never French by default", () => {
  assert.equal(A.pickText({ en: "Hello", fr: "Bonjour", nl: "Hallo" }, "nl", "fr"), "Hallo");
  assert.equal(A.pickText({ en: "Hello", fr: "Bonjour" }, "nl", "fr"), "Bonjour", "partial language: the site main language comes next");
  assert.equal(A.pickText({ en: "Hello", fr: "Bonjour" }, "nl", "de"), "Hello", "then English");
  assert.equal(A.pickText({ fr: "Bonjour", nl: "Hallo" }, "en", "en"), "", "no English text: nothing, not the French one");
  assert.equal(A.pickText({ fr: "Bonjour", nl: "Hallo" }, "de", "nl"), "Hallo", "the site main language is a legitimate second choice");
  assert.equal(A.pickText({ en: "Hello", fr: "  " }, "fr", "fr"), "Hello", "an empty text is a missing text");
  assert.equal(A.pickText({ en: "Hello", pt: "Olá" }, "pt-BR", "en"), "Olá", "pt-BR also tries pt");
  assert.equal(A.pickText("as written", "fr", "fr"), "as written", "an older module's plain string is returned as written");
  assert.equal(A.pickText(undefined, "fr", "fr"), "");
  assert.deepEqual(A.chain("pt-BR", "fr"), ["pt-BR", "pt", "fr", "en"]);
});

test("language labels: community languages are partial, an official language below 100% is incomplete", () => {
  assert.deepEqual(A.languageLabel({ status: "community", percent: 82 }), { status: "community", coverage: "partial: 82%" });
  assert.equal(A.languageLabel({ status: "official", percent: 99 }).coverage, "incomplete: 99%");
  assert.equal(A.languageLabel({ status: "official", percent: 100 }).coverage, "complete");
});

test("localized (module values) follows the same chain", () => {
  assert.equal(localized({ en: "Blog", fr: "Journal" }, "fr", "en"), "Journal");
  assert.equal(localized({ en: "Blog", fr: "Journal" }, "de", "en"), "Blog");
  assert.equal(localized({ fr: "Journal" }, "en", "en"), "", "never French when English is missing");
});

test("translator: a partial language falls back to the site main language, then English; an empty text counts as missing; plurals follow the language used", () => {
  DICTIONARIES.xx = { "a.only": "xx only", "a.empty": "", "p.one": "un" };
  DICTIONARIES.xy = { "a.mid": "xy mid" };
  try {
    const t = makeTranslator("xx", "fr");
    assert.equal(t("a.only"), "xx only");
    assert.equal(t("action.save"), "Enregistrer", "missing in xx -> the site main language (French here)");
    assert.equal(makeTranslator("xx", "xy")("a.mid"), "xy mid");
    assert.equal(makeTranslator("xx")("action.save"), "Save", "no main language given -> English");
    assert.equal(makeTranslator("xx", "xy")("action.save"), "Save", "main language without the text -> English");
    assert.equal(t("a.empty"), "a.empty", "an empty text in a skeleton is not shown: key as last resort");
    assert.equal(makeTranslator("fr", "fr")("cle.inconnue"), "cle.inconnue");
    assert.equal(makeTranslator("fr")("setup.samples.summary", { n: 1 }), makeTranslator("fr")("setup.samples.summary.one", { n: 1 }));
  } finally { delete DICTIONARIES.xx; delete DICTIONARIES.xy; }
});

test("English and French are always available in the interface, official, and registered as languages", () => {
  assert.ok(UI_LOCALES.includes("en") && UI_LOCALES.includes("fr"));
  assert.equal(languageStatus("en"), "official"); assert.equal(languageStatus("fr"), "official"); assert.equal(languageStatus("nl"), "community");
  for (const code of UI_LOCALES) assert.ok(KNOWN_LOCALES[code], `${code} is registered in src/locales/languages.json`);
  const files = fs.readdirSync("src/locales").filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual([...UI_LOCALES].sort(), files, "src/locales/index.ts lists exactly the language files (node scripts/i18n-add-language.mjs --sync)");
  assert.match(read("src/locales/index.ts"), /GENERATED/);
});

test("interface dictionaries: English and French complete, same {variables}; every other language is allowed to be partial", () => {
  const audit = A.auditDictionaries(DICTIONARIES);
  for (const l of ["en", "fr"]) { assert.deepEqual([audit[l].missing, audit[l].empty, audit[l].variables], [[], [], []], l); assert.equal(audit[l].percent, 100); }
  for (const [l, r] of Object.entries(audit)) if (!["en", "fr"].includes(l)) assert.deepEqual(r.variables, [], `${l}: a translated text keeps the variables of English`);
});

/* ───────────── manifest audit ───────────── */

const GOOD = {
  id: "demo", name: EF("Demo", "Démo"), description: EF("A demo", "Une démo"),
  settings: [{ key: "title", type: "text", label: EF("Title", "Titre"), help: EF("Shown on top, for example Welcome", "Affiché en haut, par exemple Bienvenue"), options: [] }],
  mcp: [{ name: "list_items", description: "List the items." }],
};

test("audit: a complete manifest has no error; MCP descriptions are advisory only", () => {
  const r = A.auditManifest(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.advisories.length, 1, "the tool description has no French translation yet");
  assert.equal(r.advisories[0].severity, "advisory");
  assert.deepEqual(A.auditManifest({ ...GOOD, i18n: { fr: { "mcp.list_items": "Liste les éléments." } } }).advisories, []);
});

test("audit: plain strings, a missing language, an empty text, other {variables}, a bad language code are all reported", () => {
  const r = A.auditManifest({
    id: "x", name: "Plain name", description: { en: "Hello {name}", fr: "Bonjour {nom}" },
    settings: [
      { key: "a", label: { en: "A" } },
      { key: "b", label: { en: "B", fr: "  " } },
      { key: "c", label: { en: "C", fr: "C", "not a code": "x" } },
    ],
  });
  const by = Object.fromEntries(r.errors.map((g) => [g.key, g.problem]));
  assert.equal(by["name[*] untagged"], "untagged");
  assert.equal(by["description[fr] variables"], "variables");
  assert.equal(by["setting:a.label[fr] missing"], "missing");
  assert.equal(by["setting:b.label[fr] empty"], "empty");
  assert.equal(by["setting:c.label[not a code] code"], "code");
});

test("audit: another language may be partial and is reported with its coverage; it is never an error", () => {
  const man = { name: { en: "A", fr: "A", nl: "A" }, description: { en: "B", fr: "B" }, settings: [{ key: "k", label: { en: "C", fr: "C", nl: "C" } }] };
  const r = A.auditManifest(man);
  assert.deepEqual(r.errors, []);
  assert.equal(r.languages.nl.percent, 66, "2 of 3 texts, rounded down: never shown as complete");
  assert.equal(r.languages.fr.percent, 100);
});

test("languages added with files only: locales/<code>.json holds manifest.<path> keys, merged at load time; English and French stay in the manifest", () => {
  const man = JSON.parse(JSON.stringify(GOOD));
  const out = A.applyTranslations(man, { nl: { "manifest.name": "Demo NL", "manifest.setting:title.label": "Titel", "manifest.description": "" }, fr: { "manifest.name": "ignored" } });
  assert.equal(out.name.nl, "Demo NL");
  assert.equal(out.name.fr, "Démo", "French is written in the manifest, not overridden by a file");
  assert.equal(out.settings[0].label.nl, "Titel");
  assert.equal(out.description.nl, undefined, "an empty text is not translated");
  assert.equal(A.pickText(out.name, "nl", "en"), "Demo NL");
  const keys = A.manifestSkeleton(GOOD).map((x) => x.key);
  assert.ok(keys.includes("manifest.name") && keys.includes("manifest.setting:title.help") && keys.includes("manifest.mcp:list_items.description"));
  const report = moduleI18nReport(GOOD, { en: { hi: "Hi {n}" }, fr: { hi: "Salut {n}" }, nl: { "manifest.name": "Demo NL", hi: "" } });
  assert.equal(report.errors, 0);
  assert.ok(report.languages.nl > 0 && report.languages.nl < 100);
  const bad = moduleI18nReport(GOOD, { en: { hi: "Hi {n}", only: "x" }, fr: { hi: "Salut" } });
  assert.equal(bad.errors, 2, "one missing key and one different {variable}");
});

test("manifest: the `i18n` block is accepted and checked; unknown top-level keys are stripped (an older core simply ignores `i18n`)", () => {
  const base = { apiVersion: 2, id: "demo", name: EF("Demo", "Démo"), version: "1.0.0", mcp: [{ name: "list_items", description: "List." }] };
  const ok = parseManifest({ ...base, i18n: { fr: { "mcp.list_items": "Liste." } }, mystery: true });
  assert.ok(ok.ok);
  assert.deepEqual(ok.manifest.i18n, { fr: { "mcp.list_items": "Liste." } });
  assert.equal(ok.manifest.mystery, undefined, "unknown top-level keys are stripped, not refused");
  assert.equal(parseManifest({ ...base, i18n: { fr: { "mcp.nope": "x" } } }).ok, false, "a translation of a tool that does not exist is refused");
  assert.equal(parseManifest({ ...base, i18n: { "Not A Code": { "mcp.list_items": "x" } } }).ok, false);
  assert.equal(parseManifest({ ...base, i18n: { fr: { "mcp.list_items": "" } } }).ok, false);
});

test("MCP tool descriptions: the English string, translated by the i18n block along the same chain", () => {
  const man = { i18n: { fr: { "mcp.list_items": "Liste les éléments." }, nl: { "mcp.list_items": "Toon items." } } };
  assert.equal(toolDescription(man, "list_items", "List the items.", "fr", "en"), "Liste les éléments.");
  assert.equal(toolDescription(man, "list_items", "List the items.", "de", "fr"), "Liste les éléments.", "site main language");
  assert.equal(toolDescription(man, "list_items", "List the items.", "de", "es"), "List the items.", "English");
  assert.equal(toolDescription({}, "list_items", "List the items.", "fr", "fr"), "List the items.");
});

/* ───────────── the catalogue ───────────── */

test("catalogue index: `i18n` carries a name and a description per language; the plain text is English; damaged parts are dropped", () => {
  const items = R.sanitizeEntries({ modules: [
    { id: "alpha", repo: "https://github.com/test/x", name: "Alpha", description: "English text", i18n: { en: { name: "Alpha", description: "English text" }, fr: { name: "Alpha FR", description: "Texte français" }, "bad code": { name: "x" }, nl: "oops", de: { name: "" } } },
    { id: "beta", repo: "https://github.com/test/x", name: "Texte d'un index plus ancien", description: "Sans langue" },
  ] });
  assert.deepEqual(Object.keys(items[0].i18n).sort(), ["en", "fr"]);
  assert.deepEqual(R.entryText(items[0], "description"), { en: "English text", fr: "Texte français" });
  assert.equal(R.entryText(items[1], "name"), "Texte d'un index plus ancien", "an older index: the plain text, as written");
  assert.deepEqual(R.entryText({ name: "Plain EN", description: "", i18n: { fr: { name: "Simple" } } }, "name"), { fr: "Simple", en: "Plain EN" }, "the plain text of the index is the English one");
});

test("catalogue entries: names and descriptions are localized values (requested language, then English)", async () => {
  await cat.add("alpha", { manifest: { name: EF("Alpha notes", "Notes alpha"), description: EF("English sentence sentinel.", "Phrase française sentinelle.") } });
  const [entry] = await M.getCatalogue();
  assert.equal(localized(entry.name, "fr", "en"), "Notes alpha");
  assert.equal(localized(entry.name, "en", "fr"), "Alpha notes");
  assert.equal(localized(entry.description, "nl", "en"), "English sentence sentinel.", "a language without text -> English");
  assert.equal(localized(entry.description, "nl", "fr"), "Phrase française sentinelle.", "-> the site main language first");
});

/* ───────────── the setup wizard ───────────── */

const FR_SENTINELS = /Phrase française|Notes alpha|Modèle|Bienvenue|Suivant|Retour|Enregistrer|Ajoutez|votre|Vous êtes/;
const EN_SENTINELS = /English sentence|Alpha notes|Template|Welcome|\bNext\b|\bBack\b|Your site|Add your/;

async function wizardHtml(lang, data) {
  const locales = Object.entries(KNOWN_LOCALES).map(([code, name]) => ({ code, name }));
  const view = setupView(data, locales.map((l) => l.code));
  return renderToStaticMarkup(React.createElement(SetupWizard, { strings: getAllSetupStrings(), uiLocales: UI_LOCALES, locales, initialLang: lang, presets: view.presets, profiles: view.profiles, needsToken: false }));
}

async function publishBilingual() {
  const content = { display: "list", clickAction: "detail", features: ["summary", "body"], basePath: "", templates: [{ id: "intro", name: EF("Template intro", "Modèle d'introduction"), description: EF("English template sentence.", "Phrase française du modèle."), title: EF("Intro", "Intro") }] };
  await cat.add("alpha", { manifest: { name: EF("Alpha notes", "Notes alpha"), description: EF("English sentence sentinel.", "Phrase française sentinelle."), content } });
  await cat.suggest(["alpha"]);
}

test("setup wizard in English: bilingual extensions show their English texts and no French sentinel word appears anywhere", async () => {
  await publishBilingual();
  const html = await wizardHtml("en", await S.setupModules());
  assert.match(html, /English sentence sentinel\./);
  assert.match(html, /Alpha notes/);
  assert.doesNotMatch(html, FR_SENTINELS);
  const view = setupView(await S.setupModules(), ["en", "fr", "nl"]);
  assert.equal(view.presets[0].templates[0].description.en, "English template sentence.");
  assert.equal(view.presets[0].templates[0].description.fr, "Phrase française du modèle.");
  assert.equal(view.presets[0].templates[0].description.nl, "English template sentence.", "no Dutch text: English");
  assert.match(html, /<h1[^>]*>Welcome/);
});

test("setup wizard in French: the French texts, no English sentinel word", async () => {
  await publishBilingual();
  const html = await wizardHtml("fr", await S.setupModules());
  assert.match(html, /Phrase française sentinelle\./);
  assert.match(html, /Notes alpha/);
  assert.doesNotMatch(html, EN_SENTINELS);
});

test("setup wizard: an older index (one plain text of unknown language) does not hide the texts of the manifest: the wizard reads the manifest", async () => {
  await publishBilingual();
  await cat.setIndex({ id: "alpha", name: "Notes alpha", description: "Phrase française sentinelle.", repo: cat.https, subdir: "modules/alpha", ref: "alpha-v1.0.0", version: "1.0.0", apiVersion: 2 });
  await cat.suggest(["alpha"]);
  const html = await wizardHtml("en", await S.setupModules());
  assert.match(html, /English sentence sentinel\./);
  assert.doesNotMatch(html, /Phrase française sentinelle/);
});

test("setup wizard: a language without text for an extension shows English, never another language; the first language comes from the browser, else English", async () => {
  await publishBilingual();
  const html = await wizardHtml("nl", await S.setupModules());
  assert.match(html, /English sentence sentinel\./);
  assert.doesNotMatch(html, /Phrase française sentinelle/);
  const known = Object.keys(KNOWN_LOCALES);
  assert.equal(initialSetupLanguage("de-DE,de;q=0.9,en;q=0.8", known), "de");
  assert.equal(initialSetupLanguage("xx,fr;q=0.5,nl;q=0.9", known), "nl");
  assert.equal(initialSetupLanguage("xx-YY", known), "en");
  assert.equal(initialSetupLanguage(null, known), "en", "never French by default");
});

test("setup wizard: no hard-coded text in the component; every text key exists in English and French", () => {
  const src = read("src/app/admin/(auth)/setup/SetupWizard.tsx");
  const hard = [...src.matchAll(/>\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ,.!?-]{3,})\s*</g)].map((m) => m[1]);
  assert.deepEqual(hard, [], "visible text must come from the language files");
  assert.ok(!/useState\("fr"\)/.test(src), "the wizard does not start in French by accident");
  const strings = getAllSetupStrings();
  const keys = Object.keys(strings.en);
  for (const k of keys) { assert.notEqual(strings.en[k], k, `en ${k}`); assert.notEqual(strings.fr[k], k, `fr ${k}`); }
  const used = [...new Set([...src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\)/g)].map((m) => m[1]), ...[...src.matchAll(/t\((?:[^"()]*\?\s*)?"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]))];
  for (const k of used) assert.ok(keys.includes(k), `the wizard uses "${k}" but does not receive it`);
  assert.ok(keys.includes("progress.working"), "the action buttons speak the language chosen in the wizard");
});

/* ───────────── the add-language script ───────────── */

test("i18n-add-language: a skeleton for the core and for every module, existing translations kept, nothing else to edit", () => {
  const root = makeTempDir("curiosa-lang-");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "src/core/i18n"), { recursive: true });
  fs.cpSync("src/locales", path.join(root, "src/locales"), { recursive: true });
  fs.copyFileSync("scripts/i18n-add-language.mjs", path.join(root, "scripts/i18n-add-language.mjs"));
  fs.copyFileSync("src/core/i18n/audit.mjs", path.join(root, "src/core/i18n/audit.mjs"));
  const repo = path.join(root, "modules-repo");
  fs.mkdirSync(path.join(repo, "modules/demo/locales"), { recursive: true });
  fs.writeFileSync(path.join(repo, "modules/demo/module.json"), JSON.stringify(GOOD));
  fs.writeFileSync(path.join(repo, "modules/demo/locales/en.json"), JSON.stringify({ hello: "Hello {n}" }));
  fs.writeFileSync(path.join(repo, "modules/demo/locales/fr.json"), JSON.stringify({ hello: "Salut {n}" }));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, "scripts/i18n-add-language.mjs"), ...args], { cwd: root, encoding: "utf8" });

  const r = run("id", "--modules", repo, "--only", "setup.welcome,manifest.name,hello");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const core = JSON.parse(read(path.join(root, "src/locales/id.json")));
  assert.deepEqual(Object.keys(core), ["setup.welcome.title", "setup.welcome.text", "setup.welcome.name", "setup.welcome.nameHelp"]);
  assert.ok(Object.values(core).every((v) => v === ""), "a skeleton is empty: nothing is pretended to be translated");
  const languages = JSON.parse(read(path.join(root, "src/locales/languages.json")));
  assert.equal(languages.id.status, "community");
  assert.match(languages.id.name, /^Indonesia/);
  assert.match(read(path.join(root, "src/locales/index.ts")), /import id from "\.\/id\.json"/);
  const mod = JSON.parse(read(path.join(repo, "modules/demo/locales/id.json")));
  assert.deepEqual(Object.keys(mod).sort(), ["hello", "manifest.name"]);

  // Running again keeps what was translated and only adds what is new.
  fs.writeFileSync(path.join(root, "src/locales/id.json"), JSON.stringify({ "setup.welcome.title": "Selamat datang" }));
  assert.equal(run("id", "--only", "setup.welcome").status, 0);
  const again = JSON.parse(read(path.join(root, "src/locales/id.json")));
  assert.equal(again["setup.welcome.title"], "Selamat datang");
  assert.equal(again["setup.welcome.text"], "");

  assert.notEqual(run("fr").status, 0, "French is official: always complete");
  assert.notEqual(run("english").status, 0, "a two-letter code is required");
  assert.match(run("--sync", "--dry-run").stdout, /up to date/);
});

/* ───────────── the test kit ───────────── */

test("kit: i18n.complete fails on a new gap, tolerates a known one, and asks to remove a known gap that disappeared", async () => {
  const { REQUIREMENTS } = await import("../../testsupport/requirements/index.mjs");
  const req = REQUIREMENTS.find((r) => r.id === "i18n.complete");
  const known = REQUIREMENTS.find((r) => r.id === "i18n.complete.known");
  assert.equal(req.level, "mandatory"); assert.equal(known.level, "advice");
  const man = { id: "demo", name: EF("Demo", "Démo"), description: "Plain English description" };
  const gaps = A.auditManifest(man).errors;
  const m = (baseline) => ({ name: "demo", manifest: man, dir: "/nonexistent/modules/demo", opts: { i18nBaseline: { version: 1, modules: { demo: baseline } } } });
  assert.equal(req.run(m([])).length, 1, "a new gap fails");
  assert.deepEqual(req.run(m(gaps.map((g) => g.key))), [], "a known gap is tolerated");
  assert.match(known.run(m(gaps.map((g) => g.key)))[0], /1 known gap/);
  assert.match(req.run(m(["name[fr] missing"]))[0] + req.run(m(["name[fr] missing"]))[1], /no longer exists/);
});
