import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb as openTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// Réglage « plusieurs choix » (`multichoice`, cœur 0.2.14) : manifeste, validation commune, lecture par le module (ctx.setting), enregistrement par l'administration
// (cases à cocher, erreur sous le champ, rien d'écrit en cas d'erreur), rendu (cibles tactiles, aucun JavaScript), assistant, graine, sauvegarde et restauration.
// Un réglage qui n'est pas multichoice se comporte exactement comme avant (les autres tests de réglages le prouvent ; ici : types voisins inchangés).
const db = await openTestDb();
const { prisma } = db;
const { parseManifest } = await import("@/core/modules/manifest");
const V = await import("@/core/modules/settingValues");
const G = await import("@/core/modules/groups");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { buildContext } = await import("@/core/modules/context");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { fieldSpan } = await import("@/core/modules/settingsLayout");

after(() => db.close());
beforeEach(() => db.reset());

const opts = ["news", "events", "photos", "videos"].map((v) => ({ value: v, label: { fr: `Étiquette ${v}`, en: `Label ${v}` } }));
const multi = (over = {}) => ({ key: "topics", type: "multichoice", label: { fr: "Sujets", en: "Topics" }, options: opts, ...over });
const base = (settings) => ({ apiVersion: 2, id: "demo-multi", name: "Demo", version: "1.0.0", main: "index.mjs", settings });

/* ───────────── manifeste ───────────── */

test("manifeste : un multichoice valide ; bornes, valeurs de départ et options contrôlées", () => {
  const ok = (over) => parseManifest(base([multi(over)])).ok;
  assert.equal(ok({}), true);
  assert.equal(ok({ minChoices: 1, maxChoices: 3, defaultValues: ["news", "events"] }), true);
  assert.equal(ok({ options: [opts[0]] }), false, "une seule option : une case à cocher (boolean)");
  assert.equal(ok({ options: undefined }), false, "options obligatoires");
  assert.equal(ok({ options: [opts[0], opts[0]] }), false, "valeurs en double");
  assert.equal(ok({ options: [{ value: "a b", label: "A" }, { value: "c", label: "C" }] }), false, "valeur avec espace");
  assert.equal(ok({ options: [{ value: "a\"onfocus=x", label: "A" }, { value: "c", label: "C" }] }), false, "valeur dangereuse");
  assert.equal(ok({ default: "news" }), false, "pas de « default » : defaultValues");
  assert.equal(ok({ translatable: true }), false, "pas traduisible");
  assert.equal(ok({ maxChoices: 5 }), false, "maxChoices > nombre d'options");
  assert.equal(ok({ maxChoices: 0 }), false);
  assert.equal(ok({ minChoices: 3, maxChoices: 2 }), false, "min > max");
  assert.equal(ok({ minChoices: 5 }), false, "min > nombre d'options");
  assert.equal(ok({ defaultValues: ["nope"] }), false, "départ hors options");
  assert.equal(ok({ defaultValues: ["news", "news"] }), false, "départ en double");
  assert.equal(ok({ maxChoices: 1, defaultValues: ["news", "events"] }), false, "départ au-delà du maximum");
  const other = (f) => parseManifest(base([{ key: "x", label: "X", ...f }])).ok;
  assert.equal(other({ type: "text", defaultValues: ["a"] }), false, "defaultValues seulement pour multichoice");
  assert.equal(other({ type: "select", options: opts, maxChoices: 2 }), false);
  assert.equal(other({ type: "select", options: opts, default: "news" }), true, "select inchangé");
  assert.equal(parseManifest({ ...base([]), sections: [{ id: "s", label: "S", options: [multi()] }] }).ok, false, "pas dans les options d'une section");
});

test("mise en page : un multichoice prend toute la largeur ; les autres types ne bougent pas", () => {
  assert.equal(fieldSpan({ type: "multichoice" }), "full");
  assert.equal(fieldSpan({ type: "select" }), "half");
  assert.equal(fieldSpan({ type: "boolean" }), "half");
});

/* ───────────── validation commune ───────────── */

test("checkMultiInput : options actuelles seulement, doublons fusionnés, ordre des options, bornes", () => {
  const f = multi({ minChoices: 1, maxChoices: 2 });
  assert.deepEqual(V.checkMultiInput(f, ["events", "news"]), { ok: true, value: ["news", "events"] }, "ordre des options, pas des clics");
  assert.deepEqual(V.checkMultiInput(f, ["news", "news"]), { ok: true, value: ["news"] });
  assert.deepEqual(V.checkMultiInput(f, [" news "]), { ok: true, value: ["news"] });
  assert.deepEqual(V.checkMultiInput(f, ["nope"]), { ok: false, reason: "multichoice" });
  assert.deepEqual(V.checkMultiInput(f, "news"), { ok: false, reason: "multichoice" });
  assert.deepEqual(V.checkMultiInput(f, [1]), { ok: false, reason: "multichoice" });
  assert.deepEqual(V.checkMultiInput(f, [null]), { ok: false, reason: "multichoice" });
  assert.deepEqual(V.checkMultiInput(f, ["__proto__"]), { ok: false, reason: "multichoice" });
  assert.deepEqual(V.checkMultiInput(f, []), { ok: false, reason: "multichoiceMin" });
  assert.deepEqual(V.checkMultiInput(f, ["news", "events", "photos"]), { ok: false, reason: "multichoiceMax" });
  assert.deepEqual(V.checkMultiInput(multi(), []), { ok: true, value: [] }, "sans minimum, rien de coché est permis");
  assert.deepEqual(V.checkMultiInput(multi(), Array(10_000).fill("news")), { ok: false, reason: "multichoice" }, "liste démesurée refusée");
});

test("readMulti : ramenée aux options actuelles ; jamais une valeur inconnue ni un type inattendu", () => {
  const f = multi({ defaultValues: ["news"], maxChoices: 3 });
  assert.deepEqual(V.readMulti(f, undefined), ["news"], "jamais enregistré : les cases du départ");
  assert.deepEqual(V.readMulti(f, []), [], "décoché volontairement : rien (pas le départ)");
  assert.deepEqual(V.readMulti(f, ["videos", "gone", "news"]), ["news", "videos"], "option retirée par une mise à jour : disparaît");
  assert.deepEqual(V.readMulti(f, "news"), ["news"], "valeur d'un autre type : retour au départ");
  assert.deepEqual(V.readMulti(f, { 0: "videos" }), ["news"]);
  assert.deepEqual(V.readMulti(multi({ maxChoices: 2 }), ["news", "events", "photos"]), ["news", "events"], "plafonnée");
  assert.deepEqual(V.readMulti(multi(), undefined), []);
});

test("groupe facultatif : un multichoice vide ne compte pas comme renseigné", () => {
  assert.equal(G.hasValue(multi(), []), false);
  assert.equal(G.hasValue(multi(), ["news"]), true);
  assert.equal(G.hasValue({ type: "text" }, ""), false);
  assert.equal(G.hasValue({ type: "boolean", default: false }, true), true);
});

/* ───────────── de bout en bout : module installé, administration, assistant ───────────── */

const CODE = `export default { sections: { s: async (ctx) => [{ type: "text", text: JSON.stringify(ctx.setting("topics")) }] } };`;
const manifest = (over = {}) => ({
  apiVersion: 2, id: "demo-multi", name: "Demo", version: "1.0.0", main: "index.mjs", permissions: ["sections"], sections: [{ id: "s", label: "S" }],
  settings: [multi({ minChoices: 1, maxChoices: 3, defaultValues: ["news"], help: { fr: "Choisissez.", en: "Choose." } }), { key: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" }, { key: "on", type: "boolean", label: "On", default: true }],
  ...over,
});
async function setup() {
  assert.equal((await installModule(makeRepo({ "module.json": manifest(), "index.mjs": CODE }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule("demo-multi");
  const inst = await createInstance(prisma, { manifest: mod.manifest, nickname: "Demo", names: { fr: "Demo" } });
  const admin = await prisma.user.create({ data: { email: "adam@example.org", name: "Adam", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: admin.id, sv: 0 } };
  return { mod, inst };
}
const stored = async (inst, key) => (await getSettingByLocale(`instance.${inst.id}.${key}`))[""];
const ctxValue = async (mod, inst) => (await buildContext(mod, await (await import("@/core/instances")).getInstanceById(inst.id), "fr")).setting("topics");
const form = (inst, entries) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of entries) fd.append(k, v); return fd; };

test("ctx.setting : les cases du départ tant que rien n'est enregistré, puis la liste enregistrée, ramenée aux options actuelles", async () => {
  const { mod, inst } = await setup();
  assert.deepEqual(await ctxValue(mod, inst), ["news"]);
  await setSetting(`instance.${inst.id}.topics`, ["videos", "events", "gone"]);
  assert.deepEqual(await ctxValue(mod, inst), ["events", "videos"]);
  await setSetting(`instance.${inst.id}.topics`, []);
  assert.deepEqual(await ctxValue(mod, inst), []);
});

test("administration : enregistre la liste (ordre des options), refuse sous le champ ce qui sort des bornes ou de la liste, n'écrit rien en cas d'erreur", async () => {
  const { inst } = await setup();
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const ok = await saveInstanceSettings(null, form(inst, [["s__topics__multi", "1"], ["s__topics", "videos"], ["s__topics", "news"], ["s__mode", "b"], ["s__on", "on"]]));
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.deepEqual(await stored(inst, "topics"), ["news", "videos"]);
  assert.equal(await stored(inst, "mode"), "b");

  const tooMany = await saveInstanceSettings(null, form(inst, [["s__topics__multi", "1"], ["s__topics", "news"], ["s__topics", "events"], ["s__topics", "photos"], ["s__topics", "videos"], ["s__mode", "a"]]));
  assert.match(tooMany.errors?.s__topics__group ?? "", /(at most|au plus) 3/);
  const none = await saveInstanceSettings(null, form(inst, [["s__topics__multi", "1"], ["s__mode", "a"]]));
  assert.match(none.errors?.s__topics__group ?? "", /(at least|au moins) 1/);
  const forged = await saveInstanceSettings(null, form(inst, [["s__topics__multi", "1"], ["s__topics", "<script>"], ["s__mode", "a"]]));
  assert.match(forged.errors?.s__topics__group ?? "", /(Topics|Sujets)/);
  assert.deepEqual(await stored(inst, "topics"), ["news", "videos"], "rien n'a changé");
  assert.equal(await stored(inst, "mode"), "b", "ni les autres réglages du même envoi");

  // Champ non montré (pas de marqueur) : valeur gardée.
  assert.ok((await saveInstanceSettings(null, form(inst, [["s__mode", "a"]]))).ok);
  assert.deepEqual(await stored(inst, "topics"), ["news", "videos"]);
  assert.equal(await stored(inst, "mode"), "a");
  // Sans minimum, tout décocher est une vraie valeur (liste vide), pas un retour au départ.
});

test("rendu : un groupe de cases à cocher accessible, cibles d'au moins 44 px, cochées d'après la valeur, aucun script ; ModuleSettings l'utilise pour ce type", async () => {
  // Les composants sont en .tsx : on transpile Field.tsx (et ui.ts) avec TypeScript dans un dossier jetable, puis on rend avec react-dom/server.
  const ts = (await import("typescript")).default;
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = makeTempDir("curiosa-field-");
  for (const [src, out] of [["src/components/admin/ui.ts", "ui.mjs"], ["src/components/admin/helpRule.ts", "helpRule.mjs"], ["src/components/admin/HelpTip.tsx", "HelpTip.mjs"], ["src/components/admin/Field.tsx", "Field.mjs"]]) {
    const js = ts.transpileModule(fs.readFileSync(src, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
      .replace('from "./ui"', 'from "./ui.mjs"').replace('from "./helpRule"', 'from "./helpRule.mjs"').replace('from "./HelpTip"', 'from "./HelpTip.mjs"');
    fs.writeFileSync(path.join(dir, out), js);
  }
  fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"));
  const { CheckboxGroup } = await import(path.join(dir, "Field.mjs"));
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const options = opts.map((o) => ({ value: o.value, label: o.label.fr }));
  const html = renderToStaticMarkup(React.createElement(CheckboxGroup, { name: "s__topics", label: "Sujets", options, checked: ["events"], help: "Choisissez.", hint: "Cochez entre 1 et 3 case(s)." }));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(html, /<fieldset[^>]*id="s__topics__group"[^>]*name="s__topics__group"[^>]*tabindex="-1"[^>]*aria-describedby="s__topics__note"/);
  assert.match(html, /<legend[^>]*>Sujets/);
  assert.equal((html.match(/<input type="checkbox"[^>]*name="s__topics"/g) ?? []).length, 4);
  assert.match(html, /name="s__topics" checked="" value="events"/);
  assert.doesNotMatch(html, /checked="" value="news"/);
  assert.match(html, /<input type="hidden" name="s__topics__multi" value="1"\/>/);
  assert.equal((html.match(/min-h-11/g) ?? []).length, 4, "chaque ligne est une cible tactile d'au moins 44 px");
  assert.match(html, /<label[^>]*><input[^>]*\/><span[^>]*>Étiquette news<\/span><\/label>/, "toute la ligne est l'étiquette de la case");
  assert.match(html, /id="s__topics__note"[^>]*>Choisissez\. Cochez entre 1 et 3 case\(s\)\./);
  assert.doesNotMatch(html, /<script|onclick|onchange/i);
  const settings = fs.readFileSync("src/components/admin/ModuleSettings.tsx", "utf8");
  assert.match(settings, /case "multichoice": \{[\s\S]*?<CheckboxGroup[\s\S]*?readMulti\(f, value\)/);
  assert.doesNotMatch(fs.readFileSync("src/components/admin/Field.tsx", "utf8").split("export function CheckboxGroup")[0].split("\n").slice(-1)[0] ?? "", /use client/);
});

test("assistant : lecture (options, bornes, départ), écriture d'une liste validée, refus lisibles, rien d'écrit en cas de problème", async () => {
  const { inst } = await setup();
  const { readSettings, applyConfigure, parseConfigureArgs } = await import("@/core/maintenance/moduleSettings");
  const read = await readSettings({ instance: inst.key });
  const s = read.settings.find((x) => x.key === "topics");
  assert.equal(s.type, "multichoice");
  assert.deepEqual(s.options.map((o) => o.value), ["news", "events", "photos", "videos"]);
  assert.match(s.allowed, /at least 1.*at most 3/);
  assert.equal(s.default, "news");

  assert.doesNotThrow(() => parseConfigureArgs({ instance: inst.key, changes: { topics: ["news", "events"] } }));
  assert.throws(() => parseConfigureArgs({ instance: inst.key, changes: { topics: [1, 2] } }), /must be a text/);
  assert.throws(() => parseConfigureArgs({ instance: inst.key, changes: { topics: Array(60).fill("news") } }), /must be a text/);
  // Une liste pour un réglage qui n'est pas « plusieurs choix » : le même refus d'appel qu'avant la 0.2.14 (rien n'est lu ni écrit).
  await assert.rejects(applyConfigure({ instance: inst.key, changes: { mode: ["a"] } }, false), /must be a text, a number/);
  await assert.rejects(applyConfigure({ instance: inst.key, changes: { nope: ["a"] } }, false), /must be a text, a number/);

  const done = await applyConfigure({ instance: inst.key, changes: { topics: ["videos", "events"] } }, false);
  assert.equal(done.reply.status, "saved", JSON.stringify(done.reply));
  assert.deepEqual(await stored(inst, "topics"), ["events", "videos"]);
  assert.deepEqual(done.reply.changed[0], { setting: "topics", label: "Topics", from: null, to: "events, videos" });
  const same = await applyConfigure({ instance: inst.key, changes: { topics: ["events", "videos"] } }, false);
  assert.deepEqual(same.reply.alreadySet, ["topics"]);

  for (const bad of [["nope"], [], ["news", "events", "photos", "videos"], "news"]) {
    const r = await applyConfigure({ instance: inst.key, changes: { topics: bad, mode: "b" } }, false);
    assert.equal(r.reply.status, "rejected", JSON.stringify(bad));
  }
  assert.deepEqual(await stored(inst, "topics"), ["events", "videos"]);
  assert.equal(await stored(inst, "mode"), undefined, "rien d'écrit, même pour un réglage voisin valide");
  const cleared = await applyConfigure({ instance: inst.key, changes: { topics: null } }, false);
  assert.equal(cleared.reply.status, "saved");
  assert.equal(await stored(inst, "topics"), undefined, "null : retour au départ");
});

test("graine de migration : la liste est contrôlée comme dans l'administration", async () => {
  // checkSettings n'est pas exportée : on vérifie la règle commune qu'elle appelle, sur le même champ.
  const f = manifest().settings[0];
  assert.equal(V.checkMultiInput(f, ["news"]).ok, true);
  assert.equal(V.checkMultiInput(f, ["x"]).ok, false);
  assert.equal(V.checkMultiInput(f, ["news", "events", "photos", "videos"]).ok, false);
});

test("sauvegarde et restauration : la liste enregistrée revient identique", async () => {
  const B = await import("@/core/backup/export");
  const Rs = await import("@/core/backup/restore");
  await prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$x", locale: "fr" } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); await setSetting("setup.completed", true);
  await setSetting("instance.abc.topics", ["events", "videos"]);
  await setSetting("instance.abc.none", []);
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  await db.reset();
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  assert.deepEqual((await getSettingByLocale("instance.abc.topics"))[""], ["events", "videos"]);
  assert.deepEqual((await getSettingByLocale("instance.abc.none"))[""], []);
});
