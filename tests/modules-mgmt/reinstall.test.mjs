import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const db = await useTestDb();
const I = await import("@/core/modules/installer");
const X = await import("@/core/modules/reinstall");
const R = await import("@/core/modules/registry");
const D = await import("@/core/modules/dataMigrations");
const C = await import("@/core/modules/compat");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");

// Le cœur n'embarque aucun module : le catalogue est un faux dépôt curiosa-extras local. Une ligne `bundled` est celle d'un SITE ANCIEN (compatibilité) :
// son dossier est déjà sur le disque, le catalogue est sa seule source.
const cat = createCatalogue();
beforeEach(async () => { await db.reset(); await cat.clear(); C.setCoreVersionForTests(null); });
after(() => { cat.close(); return db.close(); });

const manifest = (over = {}) => ({ apiVersion: 2, id: "planning", name: "Planning", version: "1.1.0", main: "index.mjs", ...over });
const code = (marker) => `export default { marker: ${JSON.stringify(marker)} };\n`;
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const installed = (id = "planning") => R.moduleDir(id);
const read = (f, id = "planning") => fs.readFileSync(path.join(installed(id), f), "utf8");
const row = (id = "planning") => db.prisma.module.findUnique({ where: { id } });
const leftovers = () => fs.readdirSync(path.dirname(installed())).filter((n) => /previous|incoming/.test(n));

/** Un dossier de module jetable (pour l'empreinte). */
function makeDir(files) {
  const dir = makeTempDir("curiosa-fp-");
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}
/** Ce que le catalogue publie pour « planning » (ou un autre id) : le code « nouveau », éventuellement avec d'autres fichiers ou un autre manifeste. */
const publish = (over = {}, id = "planning") => cat.add(id, { manifest: { name: "Planning", version: "1.1.0", ...over.manifest }, marker: over.marker ?? "nouveau", files: over.files ?? {} });
/** Un site d'avant : dossier posé sur le disque (ancien code) + ligne `bundled`, comme les anciennes versions du cœur l'ont laissés. */
function legacyFolder(id = "planning", { files = { "index.mjs": code("ancien") }, manifest: m = {}, enabled = true } = {}) {
  const dir = installed(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest({ id, ...m })));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return db.prisma.module.create({ data: { id, source: "bundled", version: manifest({ id, ...m }).version, enabled } });
}

/** Site d'avant : module `bundled` installé, activé, avec une instance, des réglages et des données ; le catalogue publie le nouveau code (même numéro de version). */
async function bundledWithData(extra = {}) {
  await legacyFolder("planning", { manifest: extra.manifest });
  await publish({ manifest: extra.manifest });

  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("planning")).manifest, nickname: "Agenda", names: { fr: "Agenda" } });
  await setSetting(`instance.${inst.id}.titre`, "Mon planning");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "events", data: JSON.stringify({ t: "x" }) } });
  return inst;
}
/** Le clash : le code installé n'est plus celui de la source, sous le même numéro de version. */
const tamper = () => fs.writeFileSync(path.join(installed(), "index.mjs"), code("ancien"));

test("empreinte : stable, sensible au moindre octet, ignore .git", () => {
  const dir = makeDir({ "module.json": manifest(), "index.mjs": code("a") });
  const a = X.fingerprintDir(dir).hash;
  assert.equal(X.fingerprintDir(dir).hash, a);
  fs.mkdirSync(path.join(dir, ".git")); fs.writeFileSync(path.join(dir, ".git", "x"), "1");
  assert.equal(X.fingerprintDir(dir).hash, a);
  fs.writeFileSync(path.join(dir, "index.mjs"), code("b"));
  assert.notEqual(X.fingerprintDir(dir).hash, a);
});

test("ligne `bundled` d'un site ancien : le diagnostic voit l'ancien code sous le même numéro, la réinstallation le CONVERTIT en module du catalogue et garde tout le reste", async () => {
  const inst = await bundledWithData();
  const early = await X.diagnoseModule("planning", { compare: "local" });
  assert.deepEqual([early.kind, early.comparison, early.catalogue.repoUrl, early.catalogue.version], ["bundled", null, cat.https, "1.1.0"], "pas de comparaison sans réseau ; la source affichée est le catalogue");
  // Le clash : le numéro est le même, la mise à jour du cœur dit « à jour ».
  assert.equal((await I.checkForUpdate("planning")).available, false, "le cœur ne voit rien : c'est le piège");
  const d = await X.diagnoseModule("planning", { compare: "network" });
  assert.equal(d.comparison.state, "different");
  assert.equal(d.comparison.sourceVersion, "1.1.0");
  const before = await row();
  await setSetting("autre.reglage", "garde");

  const r = await X.reinstallModule("planning");
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.before.version, "1.1.0"); assert.equal(r.after.version, "1.1.0");
  assert.notEqual(r.before.hash, r.after.hash);
  assert.match(read("index.mjs"), /nouveau/);
  assert.equal((await X.diagnoseModule("planning", { compare: "network" })).comparison.state, "identical");
  // Converti : module du catalogue (source git épinglée). Conservé : activé, instance, réglages, données.
  const after = await row();
  assert.deepEqual([after.source, after.repoUrl, after.subdir, after.ref], ["git", cat.https, "modules/planning", "planning-v1.1.0"]);
  assert.equal(after.enabled, true);
  assert.equal(after.installedAt.getTime(), before.installedAt.getTime());
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "planning" } }), 1);
  assert.equal(await getSetting(`instance.${inst.id}.titre`), "Mon planning");
  assert.equal(await getSetting("autre.reglage"), "garde");
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id } }), 1);
  assert.deepEqual(leftovers(), []);
});

test("idempotent : une deuxième réinstallation ne change rien", async () => {
  await bundledWithData();
  assert.equal((await X.reinstallModule("planning")).changed, true);
  const h = X.fingerprintDir(installed()).hash;
  const again = await X.reinstallModule("planning");
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(again.before.hash, again.after.hash);
  assert.equal(X.fingerprintDir(installed()).hash, h);
  assert.match(X.reinstallAuditTarget(again), /\(identique\)/);
});

test("cache d'imports : le nouveau code sert tout de suite, sans redémarrage (même numéro de version)", async () => {
  // Id propre à ce test : le cache d'imports de Node est celui du processus, il ne doit rien hériter des autres tests.
  await legacyFolder("cachemod", { files: { "index.mjs": code("ancien") } });
  assert.equal((await R.getModule("cachemod")).def.marker, "ancien", "le processus a chargé l'ancien code");
  await publish({ marker: "nouveau" }, "cachemod");   // le catalogue publie un autre code, le numéro de version ne change pas
  const key = R.importVersionKey("cachemod", await row("cachemod"));
  const r = await X.reinstallModule("cachemod");
  assert.equal(r.ok, true);
  assert.notEqual(R.importVersionKey("cachemod", await row("cachemod")), key, "l'adresse importée change");
  assert.equal((await R.getModule("cachemod")).def.marker, "nouveau", "sans ce compteur Node resservirait l'ancien code en mémoire");
});

test("un fichier secondaire modifié est rechargé avec le reste : plus aucun redémarrage conseillé (cœur 0.2.13)", async () => {
  const withLib = (marker) => `import { v } from "./lib.mjs";\nexport default { marker: ${JSON.stringify(marker)}, v };\n`;   // import STATIQUE : le cas qui exigeait un redémarrage
  await legacyFolder("planning", { files: { "index.mjs": withLib("a"), "lib.mjs": "export const v = 0;\n" } });
  assert.equal((await R.getModule("planning")).def.v, 0);
  await publish({ marker: "a", files: { "index.mjs": withLib("a"), "lib.mjs": "export const v = 1;\n" } });
  const r = await X.reinstallModule("planning");
  assert.equal(r.restartAdvised, false);
  assert.equal((await R.getModule("planning")).def.v, 1, "le voisin importé statiquement est celui de la source, sans redémarrage");
  tamper();
  assert.equal((await X.reinstallModule("planning")).restartAdvised, false);
});

test("le catalogue propose plus récent : la réinstallation remet la version PROPOSÉE (jamais l'ancienne), catalogue injoignable → erreur claire et rien ne bouge", async () => {
  await bundledWithData();
  await publish({ manifest: { version: "1.2.0" }, marker: "v12" });
  const r = await X.reinstallModule("planning");
  assert.equal(r.ok, true);
  assert.equal((await row()).version, "1.2.0");
  assert.match(read("index.mjs"), /v12/);
  // Un autre site d'avant, catalogue en panne : aucun repli local.
  await legacyFolder("autre", { files: { "index.mjs": code("ancien") } });
  await publish({}, "autre");
  const hash = X.fingerprintDir(installed("autre")).hash;
  await cat.down({ forget: true });
  const down = await quiet(() => X.reinstallModule("autre"));
  assert.deepEqual([down.ok, down.error, down.rolledBack], [false, "modules.error.catalogue", false]);
  assert.equal(X.fingerprintDir(installed("autre")).hash, hash);
  assert.equal((await row("autre")).source, "bundled", "la ligne n'a pas bougé");
  assert.equal((await R.getModule("autre")).def.marker, "ancien", "le module continue de fonctionner");
  // Le catalogue répond mais ne liste plus ce module : « source inconnue ».
  await cat.up(); await cat.unlist("autre");
  assert.equal((await quiet(() => X.reinstallModule("autre"))).error, "modules.error.unknownSource");
  assert.equal((await row("autre")).source, "bundled");
});

test("module git en sous-dossier : code identique, puis différent sous le même numéro ; commit et empreinte git suivent", async () => {
  const repo = makeRepo({ "carnet/module.json": manifest({ id: "carnet" }), "carnet/index.mjs": code("v1"), "autre/x.txt": "x" });
  assert.equal((await I.installModule(`${repo.url}#:carnet`)).ok, true);
  const first = await row("carnet");
  const same = await X.reinstallModule("carnet");
  assert.equal(same.ok, true); assert.equal(same.changed, false);
  assert.equal(X.sourceKind(first), "git");
  // Le dossier installé est un ancien code ; la source, elle, a changé sans changer de version.
  fs.writeFileSync(path.join(installed("carnet"), "index.mjs"), code("vieux"));
  assert.equal((await X.diagnoseModule("carnet", { compare: "local" })).comparison, null, "git : pas de comparaison sans réseau");
  assert.equal((await X.diagnoseModule("carnet", { compare: "network" })).comparison.state, "different");
  fs.writeFileSync(path.join(repo.dir, "carnet/index.mjs"), code("v2"));
  repo.g("commit", "-qam", "v2");
  const r = await X.reinstallModule("carnet");
  assert.equal(r.ok, true); assert.equal(r.changed, true);
  assert.match(read("index.mjs", "carnet"), /v2/);
  assert.deepEqual(fs.readdirSync(installed("carnet")).sort(), ["index.mjs", "module.json"]);
  const after = await row("carnet");
  assert.notEqual(after.commit, first.commit);
  assert.notEqual(after.tree, first.tree);
  assert.equal(after.ref, first.ref);
  assert.equal((await X.diagnoseModule("carnet", { compare: "network" })).comparison.state, "identical");
  // Audit : ni adresse de dépôt ni chemin.
  const line = X.reinstallAuditTarget(r);
  assert.ok(!line.includes(repo.dir) && !line.includes("file:"), line);
  assert.match(line, /^carnet 1\.1\.0@[0-9a-f]{7} -> 1\.1\.0@[0-9a-f]{7}$/);
});

test("module git à la racine d'un dépôt : le dossier garde son .git", async () => {
  const repo = makeRepo({ "module.json": manifest({ id: "racine" }), "index.mjs": code("v1") });
  assert.equal((await I.installModule(repo.url)).ok, true);
  fs.writeFileSync(path.join(installed("racine"), "index.mjs"), code("vieux"));
  const r = await X.reinstallModule("racine");
  assert.equal(r.ok, true); assert.equal(r.changed, true);
  assert.match(read("index.mjs", "racine"), /v1/);
  assert.ok(fs.existsSync(path.join(installed("racine"), ".git")));
});

test("refus : inconnu, sans source, mise à jour du site en cours, autre identifiant, trop gros, cœur trop ancien, nouvelles permissions", async () => {
  assert.equal((await X.reinstallModule("inconnu")).error, "modules.error.notfound");

  await db.prisma.module.create({ data: { id: "manuel", source: "manual", version: "1.0.0", enabled: true } });
  assert.equal((await X.reinstallModule("manuel")).error, "modules.error.reinstallNoSource");

  await bundledWithData();
  const hash = X.fingerprintDir(installed()).hash;
  const dataDir = makeTempDir("curiosa-upd-");
  fs.mkdirSync(path.join(dataDir, "update"));
  fs.writeFileSync(path.join(dataDir, "update", "state.json"), JSON.stringify({ status: "running" }));
  assert.equal((await X.reinstallModule("planning", { dataDir })).error, "modules.error.reinstallBusy");
  fs.rmSync(dataDir, { recursive: true, force: true });

  const refused = async (over, error, extra = {}) => {
    await publish(over);
    const r = await quiet(() => X.reinstallModule("planning", { ...extra }));
    assert.equal(r.ok, false, error);
    assert.equal(r.error, error);
    assert.equal(r.rolledBack, false, "refusé AVANT de toucher au dossier");
    assert.equal(X.fingerprintDir(installed()).hash, hash, "le module installé n'a pas bougé");
    return r;
  };
  await refused({ manifest: { main: "absent.mjs" } }, "modules.error.nomain");
  await refused({ files: { "gros.bin": "x".repeat(10 * 1024 * 1024 + 1) } }, "modules.error.size");
  const core = await refused({ manifest: { minCore: "99.0.0" } }, "modules.error.core");
  assert.equal(core.needsCore, "99.0.0");
  const perms = await refused({ manifest: { permissions: ["mail"] } }, "modules.error.reinstallPerms");
  assert.equal(perms.detail, "mail");
  assert.deepEqual(leftovers(), []);
});

test("refus : le dépôt sert un autre module que celui installé", async () => {
  const repo = makeRepo({ "module.json": manifest({ id: "carnet" }), "index.mjs": code("v1") });
  await I.installModule(repo.url);
  const hash = X.fingerprintDir(installed("carnet")).hash;
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(manifest({ id: "intrus" })));
  repo.g("commit", "-qam", "autre id");
  const r = await quiet(() => X.reinstallModule("carnet"));
  assert.deepEqual([r.ok, r.error, r.rolledBack], [false, "modules.error.idmismatch", false]);
  assert.equal(X.fingerprintDir(installed("carnet")).hash, hash);
  assert.deepEqual(leftovers(), []);
});

test("permissions : celles déjà accordées ou moins ne bloquent pas", async () => {
  await legacyFolder("planning", { manifest: { permissions: ["storage", "mail"] }, files: { "index.mjs": code("a") } });
  await publish({ manifest: { permissions: ["storage"] }, marker: "b" });
  assert.equal((await X.reinstallModule("planning")).ok, true);
});

test("échec en cours d'échange : retour arrière complet (fichiers et base), le module reste chargeable", async () => {
  await bundledWithData();
  const hash = X.fingerprintDir(installed()).hash;
  const before = await row();
  const r = await quiet(() => X.reinstallModule("planning", { afterSwap: () => { throw new Error("panne"); } }));
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.equal(X.fingerprintDir(installed()).hash, hash, "l'ancien dossier est revenu tel quel");
  const after = await row();
  assert.equal(after.version, before.version); assert.equal(after.enabled, true); assert.equal(after.source, "bundled", "la ligne d'avant est rétablie telle quelle");
  assert.deepEqual(leftovers(), []);
  assert.equal((await R.getModule("planning")).def.marker, "ancien");
  assert.match(X.describeReinstall(r, (k) => k).lines.join(), /maintenance\.rolledBack/);
  // Une fois la panne passée, la réinstallation réussit.
  assert.equal((await X.reinstallModule("planning")).changed, true);
});

test("échec d'écriture de la base après l'échange : les fichiers et la ligne du module reviennent", async () => {
  const repo = makeRepo({ "module.json": manifest({ id: "carnet", version: "1.0.0" }), "index.mjs": code("v1") });
  await I.installModule(repo.url);
  fs.writeFileSync(path.join(installed("carnet"), "index.mjs"), code("vieux"));
  const hash = X.fingerprintDir(installed("carnet")).hash;
  const real = db.prisma.module.update;
  db.prisma.module.update = () => { throw new Error("base"); };
  let r;
  try { r = await quiet(() => X.reinstallModule("carnet")); } finally { db.prisma.module.update = real; }
  assert.equal(r.ok, false); assert.equal(r.rolledBack, true);
  assert.equal(X.fingerprintDir(installed("carnet")).hash, hash);
});

test("migration relancée si la dataVersion de la source est plus haute", async () => {
  const migr = "export default { migrations: { 2: async (ctx) => { for (const r of await ctx.api.store.list('events')) await ctx.api.store.update(r.id, { ...r.data, migre: true }); } } };\n";
  const inst = await bundledWithData();
  await publish({ manifest: { dataVersion: 2 }, files: { "index.mjs": migr } });
  assert.equal(await D.dataVersionOf(inst.id), 1);
  const r = await X.reinstallModule("planning");
  assert.equal(r.ok, true);
  assert.equal(r.migrations.length, 1);
  assert.equal(r.migrations[0].status, "ok");
  assert.equal(await D.dataVersionOf(inst.id), 2);
  assert.equal(JSON.parse((await db.prisma.moduleRecord.findFirst({ where: { instanceId: inst.id } })).data).migre, true);
});

test("réinstaller laisse le module installé et actif, et ne touche pas à ses instances", async () => {
  await legacyFolder("planning", { files: { "index.mjs": code("a") } });
  await publish({ marker: "b" });
  assert.equal((await X.reinstallModule("planning")).ok, true);
  assert.equal((await row()).enabled, true);
});

test("bilan lisible et i18n : toutes les clés existent en français et en anglais", async () => {
  const t = (k, p) => `${k}|${JSON.stringify(p ?? {})}`;
  const results = [
    { ok: true, id: "p", changed: true, before: { version: "1", hash: "a".repeat(64), commit: null }, after: { version: "1", hash: "b".repeat(64), commit: null }, migrations: [{ status: "failed" }], restartAdvised: true },
    { ok: true, id: "p", changed: false, before: { version: "1", hash: "a", commit: null }, after: { version: "1", hash: "a", commit: null }, migrations: [], restartAdvised: false },
    { ok: false, id: "p", error: "modules.error.reinstallPerms", detail: "mail", rolledBack: true },
    { ok: false, id: "p", error: "autre", rolledBack: false },
  ];
  const used = new Set(["modules.error.reinstallNoSource", "modules.error.reinstallBusy", "modules.error.reinstallPerms", "modules.error.catalogue", "modules.error.unknownSource", "maintenance.source.unknown", "error.generic"]);
  for (const r of results) for (const l of X.describeReinstall(r, t).lines) used.add(l.split("|")[0]);
  for (const f of ["src/components/admin/ModuleMaintenance.tsx", "src/components/admin/ReinstallButton.tsx", "src/core/modules/reinstall.ts"]) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/"(maintenance\.[\w.]+)"/g)) used.add(m[1]);
  }
  for (const lang of ["fr", "en"]) {
    const dict = JSON.parse(fs.readFileSync(`src/locales/${lang}.json`, "utf8"));
    for (const k of used) assert.ok(dict[k], `clé « ${k} » manquante en ${lang}`);
  }
  assert.ok(used.size > 15);
});

test("réservé au propriétaire : chaque action serveur de maintenance exige le rôle owner", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/modules/maintenanceActions.ts", "utf8");
  const actions = [...src.matchAll(/export async function (\w+)[\s\S]*?\n}\n/g)];
  assert.equal(actions.length, 2);
  for (const a of actions) assert.match(a[0], /adminCtx\(\{ right: "core:[a-z.]+" \}\)/, a[1]);
  const page = fs.readFileSync("src/app/admin/(panel)/modules/[id]/ModuleView.tsx", "utf8");
  assert.match(page, /isOwner && <ModuleMaintenance/);
});
