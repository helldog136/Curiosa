// ENTRETIEN rendu visible (0.6.4) : trois états par ligne (à faire / gardé par prudence / terminé), une entrée du menu d'administration avec sa pastille
// d'état, une page lisible, des textes vrais pour les copies de sécurité, et l'outil MCP `maintenance_legacy` (additif).
// Les copies de sécurité d'anciennes données ne sont JAMAIS « à faire » : elles ne comptent pas dans la pastille et ne montrent aucun bouton.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const Rp = await import("@/core/modules/legacyReport");
const U = await import("@/core/modules/legacyUpkeep");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { administrationEntries } = await import("@/core/modules/adminMenu");
const { forbiddenWords, labelProblems, toneProblems } = await import("../../testsupport/ergonomics.mjs");
const { maintenanceToolProvider } = await import("@/core/maintenance/tools");

after(() => db.close());
const read = (f) => fs.readFileSync(f, "utf8");
const PANEL = "../../src/app/admin/(panel)";

/** Un rapport d'héritage vide, que chaque test complète. */
const report = (over = {}) => ({
  marker: { version: "0.6.3", at: "2026-11-01T10:00:00.000Z", counts: {} }, sourceRows: [], keptRows: [], switchedOff: { modules: [], instances: [] }, behind: [], failed: [], newer: [],
  seedsMissing: [], collections: [], legacyValues: [], orphans: [],
  totals: { sourceRows: 0, keptRows: 0, switchedOffModules: 0, switchedOffInstances: 0, behind: 0, failed: 0, newer: 0, seedsMissing: 0, collections: 0, legacyValues: 0, orphans: 0 },
  converted: true, clean: true, ...over,
});
const groupOf = (rows, id) => rows.filter((r) => r.id === id).map((r) => r.group);

/* ───────────── 1 : le classement (logique pure) ───────────── */

test("site propre : tout est « terminé », la pastille dit « à jour »", () => {
  const rows = U.upkeepRows(report());
  assert.ok(rows.every((r) => r.group === "done"), JSON.stringify(rows.filter((r) => r.group !== "done")));
  assert.deepEqual(U.upkeepSummary(rows), { state: "clean", todo: 0, kept: 0 });
});

test("la copie de sécurité d'une extension (Partenariats : 5 éléments + l'état de la reprise) est « gardée », jamais « à faire »", () => {
  const r = report({
    collections: [{ key: "partenariats", module: "partnerships", collection: "legacyContacts", count: 1 }, { key: "partenariats", module: "partnerships", collection: "meta", count: 1 }],
    totals: { ...report().totals, collections: 2 }, clean: false,
  });
  const rows = U.upkeepRows(r);
  assert.deepEqual(groupOf(rows, "collections"), ["kept"]);
  assert.deepEqual(U.upkeepSummary(rows), { state: "kept", todo: 0, kept: 1 });
});

test("ce qui demande une action est « à faire » et compte dans la pastille ; une ligne gardée à côté ne change pas ce nombre", () => {
  const r = report({
    marker: null, converted: false, clean: false,
    sourceRows: [{ id: "agenda", source: "bundled", version: "1.0.0", state: "convertible" }, { id: "vieux", source: "builtin", version: "0.1.0", state: "absent" }, { id: "autre", source: "builtin", version: "0.2.0", state: "absent" }],
    behind: [{ key: "a", module: "m", from: 1, to: 2 }],
    orphans: [{ key: "a", module: "m", settings: ["x"] }],
    totals: { ...report().totals, sourceRows: 3, behind: 1, orphans: 1 },
  });
  const rows = U.upkeepRows(r);
  assert.deepEqual(groupOf(rows, "finish"), ["todo"], "le marqueur de fin manque : la mise à niveau est à terminer");
  assert.deepEqual(groupOf(rows, "absent"), ["todo", "todo"], "une ligne par extension que le catalogue ne propose plus");
  assert.deepEqual(groupOf(rows, "sourceRows"), ["todo"]);
  assert.deepEqual(groupOf(rows, "behind"), ["todo"]);
  assert.deepEqual(groupOf(rows, "orphans"), ["kept"]);
  assert.deepEqual(U.upkeepSummary(rows), { state: "todo", todo: 5, kept: 1 });
});

test("les extensions gardées telles quelles par la personne sont « gardées » ; plus rien d'autre à faire", () => {
  const rows = U.upkeepRows(report({ keptRows: [{ id: "vieux", version: "0.1.0" }], totals: { ...report().totals, keptRows: 1 }, clean: false }));
  assert.deepEqual(groupOf(rows, "keptRows"), ["kept"]);
  assert.equal(U.upkeepSummary(rows).state, "kept");
});

test("chaque rubrique du rapport est classée une fois, et les rubriques « à faire » sont celles qui ont un geste possible", () => {
  assert.deepEqual(Object.entries(U.UPKEEP_GROUP).filter(([, g]) => g === "todo").map(([k]) => k).sort(), ["behind", "failed", "newer", "sourceRows", "switchedOff"]);
  assert.deepEqual(Object.entries(U.UPKEEP_GROUP).filter(([, g]) => g === "kept").map(([k]) => k).sort(), ["collections", "legacyValues", "orphans", "seedsMissing"]);
  const ids = new Set(U.upkeepRows(report()).map((r) => r.id));
  for (const id of U.UPKEEP_ORDER) assert.ok(ids.has(id), id);
});

/* ───────────── 2 : sur une vraie base ───────────── */

let owner, admin, editor;
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
const setMode = (u, advanced) => prisma.user.update({ where: { id: u.id }, data: { advanced } });
const setMarker = () => prisma.setting.upsert({ where: { key_locale: { key: Rp.LEGACY_MARKER, locale: "" } }, create: { key: Rp.LEGACY_MARKER, locale: "", value: JSON.stringify({ version: "0.6.3", at: "2026-11-01T10:00:00.000Z", counts: {} }) }, update: {} });

/** Écrit une extension sur le disque (dossier des modules installés) et sa ligne en base. */
async function extension(id, manifest = {}, row = {}) {
  const dir = path.join(db.dir, "modules", id);
  fs.mkdirSync(dir, { recursive: true });
  const full = { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...manifest };
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, "index.mjs"), "export default {};");
  await prisma.module.create({ data: { id, source: "git", repoUrl: "https://github.com/exemple/perso", version: full.version, enabled: true, ...row } });
  R.forgetModule(id);
  return full;
}
async function instanceOf(id, nickname) {
  const mod = await R.getModule(id);
  return createInstance(prisma, { manifest: mod.manifest, nickname, names: { fr: nickname } });
}

before(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); await setSetting("setup.completed", true);
  await setSetting("site.name", "Le site d'Emma", "fr");
  owner = await prisma.user.create({ data: { email: "emma@example.org", name: "Emma", role: "owner", passwordHash: "x", locale: "fr" } });
  admin = await prisma.user.create({ data: { email: "adam@example.org", name: "Adam", role: "admin", passwordHash: "x", locale: "fr" } });
  editor = await prisma.user.create({ data: { email: "lea@example.org", name: "Léa", role: "editor", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});

async function pageHtml(user = owner, advanced = false) {
  await setMode(user, advanced); as(user);
  const mod = await import(`${PANEL}/maintenance/legacy/page.tsx`);
  return renderAll(await mod.default({ searchParams: Promise.resolve({}) }));
}
async function menuHtml(user = owner, advanced = false) {
  await setMode(user, advanced); as(user); U.forgetUpkeepSummary();
  const Layout = (await import(`${PANEL}/layout.tsx`)).default;
  return renderAll(await Layout({ children: null }));
}
const link = (html) => /<a[^>]*href="\/admin\/maintenance\/legacy"[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";

test("site propre (marqueur posé) : la page dit « Tout est à jour », rien à faire, aucun bouton ; le menu dit « À jour »", async () => {
  await setMarker();
  const html = await pageHtml();
  assert.match(html, /data-testid="upkeep-status-clean"/);
  assert.match(html, /Tout est à jour/);
  assert.doesNotMatch(html, /upkeep-group-todo|upkeep-group-kept/);
  assert.match(html, /upkeep-group-done/, "le « terminé » est replié mais présent");
  const menu = link(await menuHtml());
  assert.match(menu, /Entretien/);
  assert.match(menu, /data-testid="admin-status"[^>]*>À jour/, "pastille écrite, pas seulement colorée");
  assert.doesNotMatch(menu, /data-testid="admin-badge"/);
});

test("copie gardée (Partenariats : 5 éléments + la reprise) : état « gardé par prudence », texte vrai, aucune action, pastille distincte, mode simple et avancé", async () => {
  await setMarker();
  await extension("partnerships", { legacyCollections: ["contacts", "legacyContacts", "meta"] });
  const inst = await instanceOf("partnerships", "partenariats");
  for (let i = 0; i < 5; i++) await prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "legacyContacts", data: "{}" } });
  await prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "meta", data: "{}" } });
  U.forgetUpkeepSummary();
  assert.deepEqual(await U.legacyUpkeepSummary(), { state: "kept", todo: 0, kept: 1 });

  const simple = await pageHtml(owner, false);
  assert.match(simple, /data-testid="upkeep-status-kept"/);
  assert.match(simple, /Rien à faire/);
  assert.match(simple, /Gardé par prudence/);
  assert.match(simple, /Copies de sécurité d(?:'|&#x27;)anciennes données/);
  assert.match(simple, /comprises dans vos sauvegardes/);
  assert.match(simple, /ne les supprime jamais de lui-même/);
  assert.match(simple, /partenariats · 6 éléments/, "mode simple : un total par extension, sans nom technique");
  assert.doesNotMatch(simple, /legacyContacts/, "le nom technique d'une collection n'est pas montré en mode simple");
  assert.doesNotMatch(simple, /les videra elle-même/, "l'ancien texte trompeur a disparu");
  assert.doesNotMatch(simple, /upkeep-group-todo/, "aucune section « à faire »");
  assert.doesNotMatch(simple, /<form/, "aucun bouton : une copie gardée ne demande rien (pas de suppression proposée)");
  const adv = await pageHtml(owner, true);
  assert.match(adv, /partenariats · legacyContacts \(5\)/, "mode avancé : où cela se trouve, précisément");
  assert.match(adv, /partenariats · meta \(1\)/);
  assert.match(await menuHtml(owner, false), /data-testid="admin-status"[^>]*>Copie gardée/);
  assert.doesNotMatch(link(await menuHtml(owner, false)), /data-testid="admin-badge"/, "une copie gardée n'est pas un nombre « à faire »");
});

test("une action à faire : section « À faire », pastille numérique dans le menu, bouton unique « Relancer la mise à niveau »", async () => {
  await extension("carnet", { dataVersion: 3 });
  const inst = await instanceOf("carnet", "carnet");
  await setSetting(`instance.${inst.id}.__dataVersion`, 1);
  U.forgetUpkeepSummary();
  const sum = await U.legacyUpkeepSummary();
  assert.equal(sum.state, "todo");
  assert.equal(sum.todo, 1);
  assert.equal(sum.kept, 1, "la copie de Partenariats est toujours là, à part");
  const html = await pageHtml(owner, false);
  assert.match(html, /data-testid="upkeep-status-todo"/);
  assert.match(html, /1 chose à faire/);
  assert.match(html, /upkeep-group-todo/);
  assert.match(html, /Relancer la mise à niveau/);
  assert.equal((html.match(/Relancer la mise à niveau/g) ?? []).length, 1, "un seul bouton principal");
  const menu = link(await menuHtml());
  assert.match(menu, /data-testid="admin-badge"[^>]*>1/);
  assert.doesNotMatch(menu, /data-testid="admin-status"/, "un nombre OU un état écrit, jamais les deux");
});

test("droits : la personne propriétaire voit l'entrée en mode simple et avancé ; l'administration, l'édition et un rôle sans droit ne la voient pas ; la page est refusée", async () => {
  for (const advanced of [false, true]) {
    assert.ok(administrationEntries({ role: "owner", advanced }).includes("upkeep"));
    assert.ok(administrationEntries({ role: "coordinator", advanced }).includes("upkeep"));
    for (const role of ["admin", "editor", "none"]) assert.ok(!administrationEntries({ role, advanced }).includes("upkeep"), role);
  }
  assert.match(await menuHtml(owner, false), /href="\/admin\/maintenance\/legacy"/);
  assert.match(await menuHtml(owner, true), /href="\/admin\/maintenance\/legacy"/);
  assert.doesNotMatch(await menuHtml(admin, false), /href="\/admin\/maintenance\/legacy"/);
  assert.doesNotMatch(await menuHtml(editor, false), /href="\/admin\/maintenance\/legacy"/);
  for (const u of [admin, editor]) await assert.rejects(() => pageHtml(u), undefined, `${u.role} ne peut pas ouvrir la page`);
  await setMode(owner, false);
});

test("le menu reste simple : le calcul de la pastille ne lève jamais et se met à jour après un changement", async () => {
  U.forgetUpkeepSummary();
  const a = await U.legacyUpkeepSummary();
  await prisma.moduleInstance.deleteMany({ where: { moduleId: "carnet" } });
  assert.deepEqual(await U.legacyUpkeepSummary(), a, "mémoire courte : le même résultat pendant quelques secondes");
  U.forgetUpkeepSummary();
  assert.equal((await U.legacyUpkeepSummary()).todo, 0, "après « oublier », la nouvelle réalité");
});

/* ───────────── 3 : l'outil MCP (additif) ───────────── */

test("MCP maintenance_legacy : tous les anciens champs sont là, plus `upkeep` qui distingue « à faire » et « gardé par prudence »", async () => {
  const data = await Rp.legacyReportForAssistant();
  for (const k of ["conversionFinished", "totals", "oldModuleRows", "oldModulesKeptAsTheyAre", "switchedOff", "instancesBehind", "instancesSetAside", "instancesNewerThanModule", "takeoverNotDone", "collectionsToEmpty", "keptSettingsWithValue", "unknownSettings"]) assert.ok(k in data, k);
  assert.equal(data.collectionsToEmpty.length, 2, "le nom de champ est conservé");
  assert.equal(data.upkeep.state, "nothing_to_do_kept_as_precaution");
  assert.deepEqual(data.upkeep.toDo, []);
  assert.deepEqual(data.upkeep.keptAsPrecaution.map((x) => x.what), ["collections"]);
  assert.match(data.upkeep.note, /never deleted by the site itself/);
  const provider = maintenanceToolProvider;
  assert.ok(provider, "l'outil existe toujours");
  assert.match(read("src/core/maintenance/tools.ts"), /keptAsPrecaution/);
  assert.doesNotMatch(JSON.stringify(data), /legacyContacts[^"]*":\s*\{/, "des noms et des nombres, jamais de contenu");
});

/* ───────────── 4 : les textes ───────────── */

const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
const KEYS = Object.keys(fr).filter((k) => k.startsWith("upkeep.") || k.startsWith("nav.upkeep"));

test("textes : FR et EN à parité exacte (mêmes clés, mêmes {variables}), avant le groupe final theme.custom … settings.contrast.accent2", () => {
  assert.ok(KEYS.length > 30);
  const vars = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(",");
  for (const k of KEYS) { assert.ok(en[k], `${k} sans anglais`); assert.equal(vars(fr[k]), vars(en[k]), k); }
  for (const k of Object.keys(en).filter((x) => x.startsWith("upkeep.") || x.startsWith("nav.upkeep"))) assert.ok(fr[k], `${k} sans français`);
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    for (const k of KEYS) assert.ok(all.indexOf(k) < all.indexOf("theme.custom"), `${k} doit précéder theme.custom`);
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});

test("textes : aucun mot interdit (R9), libellés ≤ 60 caractères sans deux-points (R10), ton neutre et phrases courtes (R13)", () => {
  for (const [lang, d] of [["fr", fr], ["en", en]]) for (const k of KEYS) {
    assert.deepEqual(forbiddenWords(d[k]), [], `${lang} ${k} : ${d[k]}`);
    assert.doesNotMatch(d[k], /!|veuillez/i, `${lang} ${k}`);
    assert.deepEqual(toneProblems(d[k], lang), [], `${lang} ${k} : ${d[k]}`);
    assert.doesNotMatch(d[k], /collection|migration|h[ée]ritage|legacy|\bmodule\b/i, `${lang} ${k} : mot de développeur dans « ${d[k]} »`);
  }
  for (const k of KEYS.filter((x) => /^upkeep\.(row|group|filter|action|search)\.?[\w.]*$/.test(x) && !/\.(text|help)$/.test(x) && !x.endsWith("absent.named")))
    for (const lang of [fr, en]) assert.deepEqual(labelProblems(lang[k]), [], k);
  for (const k of ["nav.upkeep", "nav.upkeep.clean", "nav.upkeep.kept", "nav.upkeep.todo"]) for (const lang of [fr, en]) assert.ok(lang[k].length <= 14, `${k} : pastille courte`);
});

test("textes : le texte des copies de sécurité est vrai dans les deux cas (l'extension les vide seule, ou les garde) et ne promet rien", () => {
  for (const [lang, d] of [["fr", fr], ["en", en]]) {
    const t = d["upkeep.row.collections.text"];
    assert.doesNotMatch(t, /videra elle-même|will empty them itself/i, lang);
    assert.match(t, /sauvegardes|backups/i, lang);
    assert.match(t, /jamais|never/i, lang);
  }
  assert.ok(!Object.keys(fr).some((k) => k.startsWith("legacy.row.")), "l'ancien texte trompeur (legacy.row.collections) est retiré");
});

test("le menu et la page : Entretien est rangé entre Mises à jour et le Journal d'audit ; la page est dans le garde-fou du mode simple", () => {
  const layout = read(`src/app/admin/(panel)/layout.tsx`);
  assert.ok(layout.indexOf('"nav.updates"') < layout.indexOf('"nav.upkeep"') && layout.indexOf('"nav.upkeep"') < layout.indexOf('"nav.audit"'));
  assert.match(layout, /legacyUpkeepSummary\(\)/);
  assert.match(layout, /legacyConversionPending\(\)/, "le bandeau reste pour l'urgent");
  assert.match(read("tests/core/admin-simple-mode.test.mjs"), /maintenance\/legacy\/page\.tsx/);
});

test("textes : chaque clé que la page, le menu et la mise en page demandent existe en français et en anglais (aucune clé brute à l'écran)", () => {
  const files = ["src/app/admin/(panel)/maintenance/legacy/page.tsx", "src/app/admin/(panel)/layout.tsx"];
  const wanted = new Set();
  for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*["`]((?:upkeep|nav\.upkeep|legacy)[\w.${}]*)["`]/g)) wanted.add(m[1]);
  const ids = ["finish", "absent", "sourceRows", "switchedOff", "behind", "failed", "newer", "keptRows", "collections", "seedsMissing", "legacyValues", "orphans"];
  for (const k of wanted) {
    const keys = k.includes("${") ? (k.startsWith("upkeep.row.${row.id}") ? ids.map((i) => `upkeep.row.${i}`) : k.startsWith("upkeep.group.${id}") ? (k.endsWith(".help") ? ["todo", "kept"] : ["todo", "kept", "done"]).map((g) => k.replace("${id}", g)) : k.startsWith("upkeep.group.${g.id}") ? ["todo", "kept", "done"].map((g) => k.replace("${g.id}", g)) : []) : [k];
    for (const key of keys) for (const [lang, d] of [["fr", fr], ["en", en]]) assert.ok(d[key] !== undefined, `${lang} : clé « ${key} » absente`);
  }
  assert.ok(wanted.size > 15);
  for (const id of ids.filter((i) => !["finish", "absent"].includes(i))) for (const d of [fr, en]) assert.ok(d[`upkeep.row.${id}`] && d[`upkeep.row.${id}.text`], id);
});
