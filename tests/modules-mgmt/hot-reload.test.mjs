import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// L'INCIDENT : une mise à jour de module dans le MÊME processus. Le fichier principal est rechargé avec `?v=<commit>`, mais un fichier voisin importé
// statiquement (`import … from "./source.mjs"`) restait à l'ancienne version dans le cache de Node : le nouveau fichier principal ne s'accordait plus avec lui,
// le module devenait « impossible à charger » et seul un redémarrage du processus réparait. Ici : le reproduire, puis montrer la protection.
const db = await useTestDb();
process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const R = await import("@/core/modules/registry");
const I = await import("@/core/modules/installer");
const X = await import("@/core/modules/reinstall");
const S = await import("@/core/modules/snapshot");
const C = await import("@/core/modules/loadCheck");
const B = await import("@/core/modules/blockedUpdate");
const N = await import("@/core/modules/staticImports");
const M = await import("@/core/maintenance/inspect");
const cat = createCatalogue();
after(() => { cat.close(); return db.close(); });
beforeEach(async () => { await db.reset(); await cat.clear(); });

const manifest = (version, over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version, main: "index.mjs", ...over });
function put(files, id = "demo") {
  const dir = R.moduleDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
}
const row = (version, commit) => ({ id: "demo", source: "git", version, commit, enabled: true });
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

/** Version d'un module à 2 fichiers avec IMPORT STATIQUE du voisin (la forme qui a cassé en production). */
const files = (version, { index, source } = {}) => ({
  "module.json": manifest(version),
  "index.mjs": index ?? 'import { greet, shout } from "./source.mjs";\nexport default { marker: greet(), loud: shout() };\n',
  "source.mjs": source ?? `export const greet = () => ${JSON.stringify(version)};\nexport const shout = () => ${JSON.stringify(`${version}!`)};\n`,
});
// La v1 de l'incident n'exportait pas `shout` : le nouveau index.mjs en a besoin, l'ancien source.mjs en mémoire n'en a pas.
const V1 = { "module.json": manifest("1.0.0"), "index.mjs": 'import { greet } from "./source.mjs";\nexport default { marker: greet() };\n', "source.mjs": 'export const greet = () => "v1";\n' };
const V2 = { "module.json": manifest("1.1.0"), "index.mjs": 'import { greet, shout } from "./source.mjs";\nexport default { marker: greet(), loud: shout() };\n', "source.mjs": 'export const greet = () => "v2";\nexport const shout = () => "V2!";\n' };

/* ───────────── 1. L'incident, reproduit puis corrigé ───────────── */

test("INCIDENT reproduit : module à 2 fichiers avec import statique, mis à jour dans le même processus, se charge avec le code NEUF des deux fichiers", async () => {
  put(V1);
  const a = await R.loadModule(row("1.0.0", "aaa"));
  assert.equal(a?.def.marker, "v1");
  put(V2);                       // la mise à jour remplace les fichiers…
  R.forgetModule("demo");        // …et le cœur oublie le module (installer.ts)
  const b = await quiet(() => R.loadModule(row("1.1.0", "bbb")));
  assert.ok(b, "avant la correction : « impossible à charger » (le voisin source.mjs est resté à la v1 : il n'exporte pas `shout`)");
  assert.deepEqual([b.def.marker, b.def.loud], ["v2", "V2!"]);
});

test("aller-retour : v1 → v2 → retour à v1 (retour arrière) → v3, chaque fois avec les bons fichiers voisins", async () => {
  put(V1); assert.equal((await R.loadModule(row("1.0.0", "a")))?.def.marker, "v1");
  put(V2); R.forgetModule("demo"); assert.equal((await R.loadModule(row("1.1.0", "b")))?.def.loud, "V2!");
  put(V1); R.forgetModule("demo"); const back = await R.loadModule(row("1.0.0", "a"));
  assert.deepEqual([back?.def.marker, back?.def.loud], ["v1", undefined], "le retour arrière charge la v1 telle qu'elle était, pas la v2 restée en mémoire");
  put(files("1.2.0")); R.forgetModule("demo"); assert.equal((await R.loadModule(row("1.2.0", "c")))?.def.loud, "1.2.0!");
});

test("un voisin qui en importe un autre (graphe à 3 niveaux, sous-dossier) est lui aussi rechargé", async () => {
  const tree = (n) => ({
    "module.json": manifest(`1.0.${n}`),
    "index.mjs": 'import { top } from "./lib/top.mjs";\nexport default { marker: top() };\n',
    "lib/top.mjs": 'import { deep } from "../deep.mjs";\nexport const top = () => "top>" + deep();\n',
    "deep.mjs": `export const deep = () => "deep${n}";\n`,
  });
  put(tree(1)); assert.equal((await R.loadModule(row("1.0.1", "1")))?.def.marker, "top>deep1");
  put(tree(2)); R.forgetModule("demo");
  assert.equal((await R.loadModule(row("1.0.2", "2")))?.def.marker, "top>deep2");
});

test("la même version rechargée sans changement de numéro (réinitialisation du module) prend aussi le code neuf des voisins", async () => {
  put(files("1.0.0")); assert.equal((await R.loadModule(row("1.0.0", "x")))?.def.marker, "1.0.0");
  put(files("1.0.0", { source: 'export const greet = () => "retouché";\nexport const shout = () => "RETOUCHÉ";\n' }));
  R.forgetModule("demo");
  assert.equal((await R.loadModule(row("1.0.0", "x")))?.def.marker, "retouché");
});

test("copies de chargement : un dossier neuf par chargement, jamais de .git ni node_modules, 4 générations gardées, un dossier par processus", () => {
  const dataDir = makeTempDir("curiosa-snap-");
  try {
    const src = path.join(dataDir, "src"); fs.mkdirSync(path.join(src, ".git"), { recursive: true }); fs.mkdirSync(path.join(src, "node_modules")); fs.writeFileSync(path.join(src, "a.mjs"), "1"); fs.writeFileSync(path.join(src, ".git", "x"), "1"); fs.writeFileSync(path.join(src, "node_modules", "y"), "1");
    // un processus disparu a laissé son dossier ; un autre vivant (le nôtre, simulé par pid 1 ou ppid) est conservé
    fs.mkdirSync(path.join(S.runRoot(dataDir), "999999999", "old"), { recursive: true });
    const dirs = [];
    for (let i = 0; i < 6; i++) dirs.push(S.snapshotModule("demo", src, dataDir));
    S.pruneSnapshots("demo", dataDir);
    assert.equal(new Set(dirs).size, 6, "chaque chargement a SON dossier");
    assert.deepEqual(fs.readdirSync(path.join(src, "..", "src")).sort(), [".git", "a.mjs", "node_modules"]);
    assert.deepEqual(fs.readdirSync(dirs[5]), ["a.mjs"], "ni .git ni node_modules dans la copie");
    assert.deepEqual(fs.readdirSync(path.dirname(dirs[5])).sort(), ["3", "4", "5", "6"], "4 générations gardées");
    assert.equal(fs.existsSync(path.join(S.runRoot(dataDir), "999999999")), false, "le dossier d'un processus disparu est nettoyé");
    assert.equal(path.basename(path.dirname(path.dirname(dirs[0]))), String(process.pid));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); S.resetSnapshotsForTests(dataDir); }
});

test("deux requêtes simultanées sur un module froid partagent UN chargement (une seule copie, le code de tête n'est exécuté qu'une fois)", async () => {
  globalThis.__reloadLoads = 0;
  put({ "module.json": manifest("1.0.0"), "index.mjs": "globalThis.__reloadLoads++;\nexport default { marker: 'ok' };\n" });
  const [a, b, c] = await Promise.all([R.loadModule(row("1.0.0", "z")), R.loadModule(row("1.0.0", "z")), R.loadModule(row("1.0.0", "z"))]);
  assert.deepEqual([a?.def.marker, b?.def.marker, c?.def.marker], ["ok", "ok", "ok"]);
  assert.equal(globalThis.__reloadLoads, 1);
  delete globalThis.__reloadLoads;
});

test("un module cassé, ré-essayé à chaque requête, ne laisse pas une copie par requête", async () => {
  put(files("1.0.0", { index: "export default {" }));
  const copies = () => { const root = path.join(S.runRoot(db.dir), String(process.pid), "demo"); return fs.existsSync(root) ? fs.readdirSync(root).length : 0; };
  const before = copies();
  for (let i = 0; i < 6; i++) assert.equal(await quiet(() => R.loadModule(row("1.0.0", "cassé"))), null);
  assert.equal(copies(), before, "chaque essai raté efface sa copie");
});

/* ───────────── 2. Contrôle de chargement ───────────── */

test("verifyModuleLoad : accepte un module sain ; refuse un fichier cassé, un voisin manquant, un export absent, un export par défaut mal formé", async () => {
  put(files("1.0.0")); assert.deepEqual(await R.verifyModuleLoad(row("1.0.0", "a")), { ok: true });
  put(files("1.0.1", { index: "export default {" })); const syntax = await R.verifyModuleLoad(row("1.0.1", "b"));
  assert.equal(syntax.ok, false); assert.match(syntax.reason, /SyntaxError/);
  put(files("1.0.2", { source: "export const greet = () => 1;\n" })); const missingExport = await R.verifyModuleLoad(row("1.0.2", "c"));
  assert.equal(missingExport.ok, false); assert.match(missingExport.reason, /shout/);
  put(files("1.0.3")); fs.rmSync(path.join(R.moduleDir("demo"), "source.mjs"), { force: true });
  const missingFile = await R.verifyModuleLoad(row("1.0.3", "d"));
  assert.equal(missingFile.ok, false); assert.match(missingFile.reason, /source\.mjs/);
  assert.equal(missingFile.reason.includes(R.moduleDir("demo")), false, "aucun chemin du serveur dans la raison");
  put(files("1.0.4", { index: "export const x = 1;\n" })); const noDefault = await R.verifyModuleLoad(row("1.0.4", "e"));
  assert.equal(noDefault.ok, false); assert.match(noDefault.reason, /default/);
  put(files("1.0.5", { index: "export default { routes: { go: 'pas une fonction' }, page: 3 };\n" })); const shape = await R.verifyModuleLoad(row("1.0.5", "f"));
  assert.equal(shape.ok, false); assert.match(shape.reason, /routes\.go must be a function/);
  put(files("1.0.6", { index: "throw new Error('boum au chargement');\n" })); const boom = await R.verifyModuleLoad(row("1.0.6", "g"));
  assert.equal(boom.ok, false); assert.match(boom.reason, /boum au chargement/);
});

test("un module qui échoue au contrôle n'est PAS gardé en mémoire ; un module sain l'est (pas de second chargement)", async () => {
  put(files("1.0.0", { index: "export const x = 1;\n" }));
  assert.equal((await R.verifyModuleLoad(row("1.0.0", "bad"))).ok, false);
  put(files("1.0.1")); assert.deepEqual(await R.verifyModuleLoad(row("1.0.1", "good")), { ok: true });
  R.forgetModule("demo", row("1.0.1", "good"));
  put(files("1.0.1", { index: "throw new Error('ne doit pas être relu');\n" }));
  assert.equal((await R.loadModule(row("1.0.1", "good")))?.def.marker, "1.0.1", "servi depuis la mémoire, sans relire le disque");
});

test("preflightModule (processus tout neuf) : sain, erreur d'import, export manquant, délai dépassé, programme introuvable, environnement vide", async () => {
  const dir = makeTempDir("curiosa-pre-");
  const write = (f) => { fs.rmSync(dir, { recursive: true, force: true }); for (const [n, c] of Object.entries(f)) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), typeof c === "string" ? c : JSON.stringify(c)); } };
  try {
    write(files("1.0.0")); assert.deepEqual(await C.preflightModule(dir, { main: "index.mjs" }), { ok: true, ran: true });
    assert.deepEqual(await C.preflightModule(dir, {}), { ok: true, ran: false }, "module à contenu : rien à importer");
    write(files("1.0.1", { source: "export const greet = () => 1;\n" }));
    const r = await C.preflightModule(dir, { main: "index.mjs" });
    assert.equal(r.ok, false); assert.match(r.reason, /shout/); assert.equal(r.reason.includes(dir), false);
    write(files("1.0.2", { index: "export const x = 1;\n" })); assert.match((await C.preflightModule(dir, { main: "index.mjs" })).reason, /no default export/);
    write(files("1.0.3", { index: "export default { mcp: { a: 1 } };\n" })); assert.match((await C.preflightModule(dir, { main: "index.mjs" })).reason, /mcp\.a must be a function/);
    write(files("1.0.4", { index: "while (true) {}\n" }));
    const slow = await C.preflightModule(dir, { main: "index.mjs" }, { timeoutMs: 1200 });
    assert.equal(slow.ok, false); assert.match(slow.reason, /in time/);
    write(files("1.0.5")); assert.deepEqual(await C.preflightModule(dir, { main: "index.mjs" }, { execPath: "/nonexistent/node" }), { ok: true, ran: false }, "contrôle impossible à lancer : il ne bloque pas (le contrôle dans le site reste)");
    process.env.CURIOSA_SECRET_PROBE = "secret";
    write(files("1.0.6", { index: 'if (process.env.CURIOSA_SECRET_PROBE || process.env.DATABASE_URL) throw new Error("secret visible");\nexport default {};\n' }));
    assert.deepEqual(await C.preflightModule(dir, { main: "index.mjs" }), { ok: true, ran: true }, "le processus de contrôle n'a ni les secrets ni la base du site");
  } finally { delete process.env.CURIOSA_SECRET_PROBE; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("le script du processus de contrôle et describeShape donnent la même forme", async () => {
  const dir = makeTempDir("curiosa-shape-");
  try {
    const code = 'export default { routes: { a() {} }, tasks: { t: { everyMinutes: 5, run() {} } }, entryPanels: { p: { render() {}, actions: { x() {} } } }, page() {}, flag: true, list: [1], nothing: null };\n';
    fs.writeFileSync(path.join(dir, "index.mjs"), code);
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", C.CHILD_SCRIPT, "--", "file://" + path.join(dir, "index.mjs")], { encoding: "utf8" });
    const child = JSON.parse(/@@(.*)@@/s.exec(out)[1]);
    const mine = C.describeShape((await import("file://" + path.join(dir, "index.mjs"))).default);
    assert.deepEqual(child.shape, mine);
    assert.deepEqual(C.shapeProblems(mine), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ───────────── 3. Installation, mise à jour, réinstallation ───────────── */

const GOOD = (v) => ({ "module.json": manifest(v), "index.mjs": 'import { greet } from "./source.mjs";\nexport default { marker: greet() };\n', "source.mjs": `export const greet = () => "v${v}";\n` });
const BROKEN = (v) => ({ ...GOOD(v), "index.mjs": 'import { greet, disparu } from "./source.mjs";\nexport default { marker: greet(), disparu };\n' });
function repoOf(f) {
  const repo = makeRepo(f); repo.g("tag", `v${f["module.json"].version}`);
  repo.release = (f2) => {
    for (const [n, c] of Object.entries(f2)) fs.writeFileSync(path.join(repo.dir, n), typeof c === "string" ? c : JSON.stringify(c));
    repo.g("add", "-A"); repo.g("commit", "-q", "-m", `release ${f2["module.json"].version}`); repo.g("tag", `v${f2["module.json"].version}`);
  };
  return repo;
}
const rowNow = () => db.prisma.module.findUnique({ where: { id: "demo" } });
const audits = (action) => db.prisma.auditLog.findMany({ where: { action } });
const leftovers = () => fs.readdirSync(path.dirname(R.moduleDir("demo"))).filter((n) => /previous|incoming/.test(n));

test("INSTALLATION d'un module qui ne se charge pas : refusée AVANT d'installer quoi que ce soit", async () => {
  const repo = repoOf(BROKEN("1.0.0"));
  const r = await quiet(() => I.installModule(`${repo.url}#v1.0.0`));
  assert.equal(r.ok, false); assert.equal(r.error, "modules.error.loadCheck"); assert.match(r.loadError, /disparu/);
  assert.equal(await rowNow(), null, "aucune ligne en base");
  assert.equal(fs.existsSync(R.moduleDir("demo")), false, "aucun dossier");
  assert.deepEqual(leftovers(), []);
  assert.equal((await audits("module.update.blocked")).length, 1);
});

test("INSTALLATION d'un module sain à 2 fichiers (imports statiques) : installé, avec la remarque sur les imports statiques", async () => {
  const repo = repoOf(GOOD("1.0.0"));
  const r = await I.installModule(`${repo.url}#v1.0.0`);
  assert.equal(r.ok, true); assert.deepEqual(r.warnings, [{ code: "staticImports", files: ["index.mjs"] }]);
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");
});

test("MISE À JOUR vers une v2 volontairement cassée : retour AUTOMATIQUE à la v1, rien n'a changé, message, mémoire et audit", async () => {
  const repo = repoOf(GOOD("1.0.0"));
  assert.equal((await I.installModule(`${repo.url}#v1.0.0`)).ok, true);
  const before = await rowNow();
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");
  repo.release(BROKEN("1.1.0"));
  const r = await quiet(() => I.updateModule("demo"));
  assert.deepEqual([r.ok, r.error, r.rolledBack], [false, "modules.error.loadCheck", true]);
  assert.match(r.loadError, /disparu/);
  const after = await rowNow();
  assert.deepEqual([after.version, after.commit, after.ref], [before.version, before.commit, before.ref], "la ligne en base n'a pas bougé");
  assert.match(fs.readFileSync(path.join(R.moduleDir("demo"), "source.mjs"), "utf8"), /v1\.0\.0/, "les fichiers sont ceux de la v1");
  assert.equal(fs.readFileSync(path.join(R.moduleDir("demo"), "index.mjs"), "utf8"), GOOD("1.0.0")["index.mjs"]);
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0", "le module tourne toujours, en v1");
  const blocked = await B.readBlockedUpdate("demo");
  assert.deepEqual([blocked.from, blocked.to, blocked.kind], ["1.0.0", "1.1.0", "update"]);
  const line = (await audits("module.update.blocked")).at(0);
  assert.match(line.target, /demo 1\.0\.0 -> 1\.1\.0/); assert.equal(line.actor, "system");
  assert.deepEqual(leftovers(), []);
  // L'assistant le sait : modules, mises à jour, diagnostic.
  const mods = await M.modules();
  assert.deepEqual(mods.modules[0].lastRefusedUpdate && [mods.modules[0].lastRefusedUpdate.stayedOn, mods.modules[0].lastRefusedUpdate.refusedVersion], ["1.0.0", "1.1.0"]);
  const diag = await M.diagnose();
  const p = diag.problems.find((x) => x.problem.includes("was refused"));
  assert.ok(p, JSON.stringify(diag.problems)); assert.match(p.proposedAction, /Do not try this version again/); assert.equal(p.needsHuman, true);
  assert.notEqual(diag.verdict, "healthy");
});

test("…puis une v3 saine : la mise à jour bascule, la mémoire du refus est effacée, et le voisin statique est bien celui de la v3", async () => {
  const repo = repoOf(GOOD("1.0.0"));
  await I.installModule(`${repo.url}#v1.0.0`);
  repo.release(BROKEN("1.1.0")); await quiet(() => I.updateModule("demo"));
  assert.ok(await B.readBlockedUpdate("demo"));
  repo.release({ ...GOOD("1.2.0"), "source.mjs": 'export const greet = () => "v1.2.0 corrigée";\n' });
  const r = await I.updateModule("demo");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([(await rowNow()).version, (await rowNow()).ref], ["1.2.0", "v1.2.0"]);
  assert.equal((await R.getModule("demo")).def.marker, "v1.2.0 corrigée");
  assert.equal(await B.readBlockedUpdate("demo"), null);
});

test("MISE À JOUR saine d'un module à import statique, dans le même processus (le scénario de l'incident, par le vrai chemin de mise à jour)", async () => {
  const repo = repoOf(GOOD("1.0.0"));
  await I.installModule(`${repo.url}#v1.0.0`);
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");   // v1 chargée : son voisin est en mémoire
  repo.release({ "module.json": manifest("1.1.0"), "index.mjs": 'import { greet, shout } from "./source.mjs";\nexport default { marker: greet(), loud: shout() };\n', "source.mjs": 'export const greet = () => "v1.1.0";\nexport const shout = () => "NEUF";\n' });
  const r = await I.updateModule("demo");
  assert.equal(r.ok, true, JSON.stringify(r));
  const mod = await R.getModule("demo");
  assert.deepEqual([mod.def.marker, mod.def.loud], ["v1.1.0", "NEUF"]);
});

test("v2 cassée par un problème qu'un autre processus ne voit pas (le fichier principal ne s'importe pas) : refusée AVANT l'échange, dossier intact", async () => {
  const repo = repoOf(GOOD("1.0.0"));
  await I.installModule(`${repo.url}#v1.0.0`);
  const hash = X.fingerprintDir(R.moduleDir("demo")).hash;
  repo.release({ ...GOOD("1.1.0"), "index.mjs": "export default {\n" });
  const r = await quiet(() => I.updateModule("demo"));
  assert.deepEqual([r.ok, r.error], [false, "modules.error.loadCheck"]); assert.match(r.loadError, /SyntaxError/);
  assert.equal(X.fingerprintDir(R.moduleDir("demo")).hash, hash, "le dossier du module n'a pas été touché");
  assert.deepEqual(leftovers(), []);
});

test("MISE À JOUR d'un module du catalogue (dossier d'un dépôt) : v2 cassée → retour à la v1 ; v2 saine → bascule", async () => {
  await cat.add("demo", { manifest: { name: "Demo", version: "1.0.0" }, files: GOOD("1.0.0") });
  assert.equal((await I.installFromCatalogue("demo")).ok, true);
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");
  const hash = X.fingerprintDir(R.moduleDir("demo")).hash;
  await cat.add("demo", { manifest: { name: "Demo", version: "1.1.0" }, files: BROKEN("1.1.0") });
  const bad = await quiet(() => I.updateModule("demo"));
  assert.deepEqual([bad.ok, bad.error, bad.rolledBack], [false, "modules.error.loadCheck", true]);
  assert.equal(X.fingerprintDir(R.moduleDir("demo")).hash, hash);
  assert.equal((await rowNow()).version, "1.0.0");
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");
  assert.equal((await B.readBlockedUpdate("demo")).to, "1.1.0");
  assert.deepEqual(leftovers(), []);
  await cat.add("demo", { manifest: { name: "Demo", version: "1.2.0" }, files: { ...GOOD("1.2.0"), "source.mjs": 'export const greet = () => "saine";\n' } });
  const good = await I.updateModule("demo");
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal((await R.getModule("demo")).def.marker, "saine");
  assert.equal(await B.readBlockedUpdate("demo"), null);
});

test("RÉINSTALLATION : une source qui ne se charge pas est refusée, l'ancien code reste ; une source saine remplace", async () => {
  await cat.add("demo", { manifest: { name: "Demo", version: "1.0.0" }, files: GOOD("1.0.0") });
  assert.equal((await I.installFromCatalogue("demo")).ok, true);
  const hash = X.fingerprintDir(R.moduleDir("demo")).hash;
  await cat.add("demo", { manifest: { name: "Demo", version: "1.0.0" }, files: BROKEN("1.0.0") });   // même numéro, code cassé
  const bad = await quiet(() => X.reinstallModule("demo"));
  assert.equal(bad.ok, false); assert.equal(bad.error, "modules.error.loadCheck"); assert.equal(bad.rolledBack, true); assert.match(bad.loadError, /disparu/);
  assert.equal(X.fingerprintDir(R.moduleDir("demo")).hash, hash);
  assert.equal((await R.getModule("demo")).def.marker, "v1.0.0");
  assert.equal((await B.readBlockedUpdate("demo")).kind, "reinstall");
  assert.deepEqual(leftovers(), []);
  const lines = X.describeReinstall(bad, (k) => k).lines;
  assert.deepEqual(lines, ["modules.error.loadCheck", "maintenance.rolledBack"]);
  await cat.add("demo", { manifest: { name: "Demo", version: "1.0.0" }, files: { ...GOOD("1.0.0"), "source.mjs": 'export const greet = () => "réinstallée";\n' } });
  const ok = await X.reinstallModule("demo");
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.changed, true);
  assert.equal((await R.getModule("demo")).def.marker, "réinstallée");
  assert.equal(await B.readBlockedUpdate("demo"), null);
});

test("désinstaller un module efface la mémoire d'un refus ; un module à contenu (sans fichier principal) n'a rien à contrôler", async () => {
  const repo = repoOf(GOOD("1.0.0")); await I.installModule(`${repo.url}#v1.0.0`);
  repo.release(BROKEN("1.1.0")); await quiet(() => I.updateModule("demo"));
  assert.ok(await B.readBlockedUpdate("demo"));
  assert.equal((await I.uninstallModule("demo", { keepData: false })).ok, true);
  assert.equal(await B.readBlockedUpdate("demo"), null);
  const pages = JSON.parse(fs.readFileSync(new URL("../fixtures/extras/modules/pages/module.json", import.meta.url), "utf8"));
  const content = repoOf({ "module.json": { ...pages, id: "demo", version: "1.0.0" } });
  assert.equal((await I.installModule(`${content.url}#v1.0.0`)).ok, true);
});

/* ───────────── 4. Imports statiques de fichiers voisins ───────────── */

test("détection des imports statiques de voisins : les formes d'import, sans faux positifs (dynamique, commentaire, texte, scripts du navigateur)", () => {
  const found = (code) => N.staticRelativeImports(code);
  assert.deepEqual(found('import { a } from "./x.mjs";'), ["./x.mjs"]);
  assert.deepEqual(found("import * as P from './pure.mjs'"), ["./pure.mjs"]);
  assert.deepEqual(found('import "./effet.mjs";'), ["./effet.mjs"]);
  assert.deepEqual(found('export { a } from "../lib/y.mjs";'), ["../lib/y.mjs"]);
  assert.deepEqual(found('import {\n  a,\n  b,\n} from "./multi.mjs";'), ["./multi.mjs"]);
  assert.deepEqual(found('import def, { z } from "./d.mjs"'), ["./d.mjs"]);
  assert.deepEqual(found('const m = await import(new URL("./x.mjs" + q, import.meta.url).href);'), [], "import dynamique versionné : la bonne pratique");
  assert.deepEqual(found('const m = await import("./x.mjs");'), []);
  assert.deepEqual(found('// import { a } from "./x.mjs";\n/* import "./y.mjs" */'), [], "commentaires");
  assert.deepEqual(found('import { a } from "node:fs";\nimport b from "some-package";'), [], "modules intégrés et paquets");
  assert.deepEqual(found('export const from = "./x.mjs";\nexport default "./y.mjs";'), []);
  assert.deepEqual(found('const html = `<p>import x from "./z.mjs"</p>`;'), [], "texte au milieu d'une ligne");
});

test("staticNeighbourImports : parcourt le dossier (sous-dossiers compris), ignore scripts/ et node_modules", () => {
  const dir = makeTempDir("curiosa-static-");
  try {
    for (const [n, c] of Object.entries({
      "index.mjs": 'import { a } from "./lib/a.mjs";\n', "lib/a.mjs": "export const a = 1;\n", "lib/b.mjs": 'export * from "./a.mjs";\n',
      "scripts/ui.js": 'import "./autre.js";\n', "web/main.js": 'import "./engine.js";\n', "node_modules/p/i.mjs": 'import "./x.mjs";\n', "propre.mjs": 'const m = await import("./lib/a.mjs");\n',
    })) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), c); }
    assert.deepEqual(N.staticNeighbourImports(dir), [{ file: "index.mjs", specifier: "./lib/a.mjs" }, { file: "lib/b.mjs", specifier: "./a.mjs" }]);
    assert.deepEqual(N.staticImportsWarning(dir), { code: "staticImports", files: ["index.mjs", "lib/b.mjs"] });
    assert.equal(N.staticImportsWarning(path.join(dir, "inexistant")), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
