// Balayage de conversion au démarrage, réglages hérités, plancher des données, rapport d'héritage et garde (0.2.0, contrat 10).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

process.env.CURIOSA_CATALOGUE_REPO = "https://github.com/exemple/modules";
const db = await useTestDb();
const S = await import("@/core/modules/legacySweep");
const Rp = await import("@/core/modules/legacyReport");
const D = await import("@/core/modules/dataMigrations");
const R = await import("@/core/modules/registry");
const { parseManifest } = await import("@/core/modules/manifest");
const { buildContext } = await import("@/core/modules/context");
const { createInstance } = await import("@/core/instanceService");
const { getInstanceById } = await import("@/core/instances");
const { setSetting } = await import("@/core/settings");
const { resolveIndexRepo, clearRecognizedCache } = await import("@/core/modules/recognized");
const { maintenanceToolProvider } = await import("@/core/maintenance/tools");

const SECRET = "s3cr3t-NE-JAMAIS-AFFICHER";
const prisma = db.prisma;
beforeEach(async () => { await db.reset(); fs.rmSync(path.join(db.dir, "cache"), { recursive: true, force: true }); clearRecognizedCache(); R.resetModuleRegistry(); });
after(() => db.close());

/** Écrit un module sur le disque (dossier des modules installés) et sa ligne en base. */
async function module(id, manifest = {}, code = "export default {};", row = {}) {
  const dir = path.join(db.dir, "modules", id);
  fs.mkdirSync(dir, { recursive: true });
  const full = { apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...manifest };
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, "index.mjs"), code);
  await prisma.module.create({ data: { id, source: "git", repoUrl: "https://github.com/exemple/perso", version: full.version, enabled: true, ...row } });
  R.forgetModule(id);
  return full;
}
async function instance(id, nickname, enabled = true) {
  const mod = await R.getModule(id);
  const inst = await createInstance(prisma, { manifest: mod.manifest, nickname, names: { fr: nickname } });
  if (!enabled) await prisma.moduleInstance.update({ where: { id: inst.id }, data: { enabled: false } });
  return inst;
}
/** Dernière copie reçue du catalogue (sans réseau). */
function cachedCatalogue(modules) {
  fs.mkdirSync(path.join(db.dir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(db.dir, "cache", "recognized-index.json"), JSON.stringify({ version: 1, fetchedAt: Date.now(), origin: resolveIndexRepo(), modules, suggested: [] }));
  clearRecognizedCache();
}
const silent = { log: () => {} };
const marker = () => Rp.readLegacyMarker();

/* ───────────── Base d'avant : lignes bundled / builtin ───────────── */

test("base d'avant : lignes bundled/builtin comptées et laissées telles quelles par le démarrage (plus de conversion) ; marqueur absent tant qu'il en reste", async () => {
  await module("carnet", { version: "1.2.0" }, "export default {};", { source: "bundled", repoUrl: null });
  await module("agenda", { version: "2.0.0" }, "export default {};", { source: "bundled", repoUrl: null });
  await module("vieux", { version: "0.1.0" }, "export default {};", { source: "builtin", repoUrl: null });
  await module("allume");
  // même avec une copie du catalogue qui propose le module à la MÊME version : le démarrage ne convertit plus rien
  cachedCatalogue([
    { id: "carnet", repo: "https://github.com/exemple/modules", ref: "v5.0.0", subdir: "modules/carnet", version: "1.2.0", apiVersion: 2 },
    { id: "agenda", repo: "https://github.com/exemple/modules", ref: "v5.0.0", subdir: "modules/agenda", version: "2.1.0", apiVersion: 2 },
  ]);

  const before = await Rp.legacyReport();
  assert.deepEqual(before.sourceRows.map((r) => [r.id, r.source]), [["agenda", "bundled"], ["carnet", "bundled"], ["vieux", "builtin"]]);
  assert.deepEqual(before.switchedOff, { modules: [], instances: [] }, "champ gardé, toujours vide");
  assert.equal(before.converted, false);

  const lines = [];
  const r = await S.runLegacySweep({ log: (l) => lines.push(l) });
  assert.equal(r.done, false, "il reste trois lignes héritées : pas de marqueur");
  assert.deepEqual(Object.keys(r.counts).sort(), ["emptied", "migrated", "setAside"]);
  for (const [id, source] of [["carnet", "bundled"], ["agenda", "bundled"], ["vieux", "builtin"]]) assert.equal((await prisma.module.findUnique({ where: { id } })).source, source, `${id} : aucune conversion au démarrage`);
  assert.equal(await marker(), null);
  assert.equal((await prisma.auditLog.findMany()).filter((a) => a.action === "module.legacy.convert").length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /not complete/);
  assert.doesNotMatch(lines[0], /github|https?:/, "jamais d'adresse de dépôt dans le journal");

  const after1 = await Rp.legacyReport();
  assert.equal(after1.totals.sourceRows, 3);
  assert.equal(await Rp.legacyConversionPending(), true, "garde : l'admin prévient");

  // La personne retire ce qui reste : le balayage suivant pose le marqueur.
  await prisma.module.deleteMany({ where: { id: { in: ["carnet", "agenda", "vieux"] } } });
  const r2 = await S.runLegacySweep(silent);
  assert.equal(r2.done, true);
  const m = await marker();
  assert.equal(typeof m.at, "string");
  assert.equal(m.version, JSON.parse(fs.readFileSync("package.json", "utf8")).version);
  assert.equal(await Rp.legacyConversionPending(), false);
});

test("un module éteint d'avant la 0.1.20 n'est plus compté ni rangé au démarrage (la 0.2.0 l'a fait) ; le site démarre et pose le marqueur", async () => {
  await module("eteint", {}, "export default {};", { enabled: false });
  await module("allume");
  const rep = await Rp.legacyReport();
  assert.deepEqual([rep.totals.switchedOffModules, rep.totals.switchedOffInstances], [0, 0]);
  const r = await S.runLegacySweep(silent);
  assert.equal(r.done, true);
  assert.ok(await prisma.module.findUnique({ where: { id: "eteint" } }), "rien n'est touché");
});

/* ───────────── Migrations en attente, idempotence, reprise, délai ───────────── */

const MIGRATING = "export default { migrations: { 2: async (ctx) => { await ctx.api.store.add('journal', { step: 2 }); } } };";

test("migrations en attente : une instance à la fois, puis marqueur ; idempotent (rien de refait, date du marqueur inchangée)", async () => {
  await module("carnet", { dataVersion: 2 }, MIGRATING);
  const a = await instance("carnet", "Un"), b = await instance("carnet", "Deux");
  await setSetting(`instance.${a.id}.__dataVersion`, 1); await setSetting(`instance.${b.id}.__dataVersion`, 1);
  assert.equal((await Rp.legacyReport()).totals.behind, 2);

  const r = await S.runLegacySweep(silent);
  assert.equal(r.done, true);
  assert.equal(r.counts.migrated, 2);
  assert.equal(await D.dataVersionOf(a.id), 2);
  assert.equal(await D.dataVersionOf(b.id), 2);
  const first = await marker();
  assert.equal(first.counts.migrated, 2);

  const again = await S.runLegacySweep(silent);
  assert.equal(again.done, true);
  assert.deepEqual(again.counts, { migrated: 0, setAside: 0, emptied: 0 });
  assert.equal((await prisma.moduleRecord.count({ where: { collection: "journal" } })), 2, "chaque migration n'a tourné qu'une fois");
  assert.deepEqual(await marker(), first, "le marqueur garde la date de la fin de la conversion");
  assert.equal((await Rp.legacyReport()).clean, true);
});

test("reprise après interruption : le temps s'épuise entre deux instances → pas de marqueur ; le démarrage suivant reprend où il s'est arrêté", async () => {
  await module("carnet", { dataVersion: 2 }, MIGRATING);
  const a = await instance("carnet", "Un"), b = await instance("carnet", "Deux");
  await setSetting(`instance.${a.id}.__dataVersion`, 1); await setSetting(`instance.${b.id}.__dataVersion`, 1);
  let clock = 1_000_000;
  const slow = async (mod, inst) => { const out = await D.migrateInstance(mod, inst); clock += 30_000; return out; };   // chaque instance « prend » 30 s
  const r = await S.runLegacySweep({ ...silent, now: () => clock, migrate: slow });
  assert.equal(r.done, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.counts.migrated, 1, "une seule instance dans le budget");
  assert.equal(await marker(), null);
  assert.equal((await Rp.legacyReport()).totals.behind, 1);

  const r2 = await S.runLegacySweep(silent);
  assert.equal(r2.done, true);
  assert.equal(r2.counts.migrated, 1, "seule celle qui restait");
  assert.equal(await D.dataVersionOf(a.id), 2);
  assert.equal(await D.dataVersionOf(b.id), 2);
});

test("délai dur : une migration qui ne répond jamais (trou noir) n'empêche pas le site de démarrer ; l'instance est mise de côté, sans marqueur", async () => {
  await module("carnet", { dataVersion: 2 }, MIGRATING);
  const a = await instance("carnet", "Un");
  await setSetting(`instance.${a.id}.__dataVersion`, 1);
  const started = Date.now();
  const lines = [];
  const r = await S.runLegacySweep({ log: (l) => lines.push(l), budgetMs: 300, migrate: () => new Promise(() => {}) });
  assert.ok(Date.now() - started < 3_000, `rendu en ${Date.now() - started} ms`);
  assert.equal(r.done, false);
  assert.equal(r.timedOut, true);
  assert.equal(await marker(), null);
  assert.deepEqual(await D.dataStatusOf(a.id), { status: "failed", error: "timeout" });
  const report = await Rp.legacyReport();
  assert.deepEqual(report.failed.map((f) => [f.key, f.reason]), [[a.key, "timeout"]]);
  assert.equal(report.converted, false);
  assert.equal(lines.length, 1);

  // Une instance mise de côté n'est pas relancée d'office (« Réessayer » reste au propriétaire).
  const r2 = await S.runLegacySweep(silent);
  assert.equal(r2.counts.migrated, 0);
  assert.equal(r2.done, false);
  assert.equal((await D.retryInstanceMigration(a.id)).status, "ok");
  assert.equal((await S.runLegacySweep(silent)).done, true);
});

test("deux balayages en même temps : le second ne fait rien (« déjà en cours »)", async () => {
  await module("carnet", { dataVersion: 2 }, MIGRATING);
  const a = await instance("carnet", "Un");
  await setSetting(`instance.${a.id}.__dataVersion`, 1);
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = S.runLegacySweep({ ...silent, migrate: async (mod, inst) => { await gate; return D.migrateInstance(mod, inst); } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await S.runLegacySweep(silent)).busy, true);
  release();
  assert.equal((await first).done, true);
});

test("une sauvegarde ancienne restaurée ramène des lignes héritées : le marqueur est retiré, la garde réapparaît", async () => {
  assert.equal((await S.runLegacySweep(silent)).done, true);
  await module("carnet", {}, "export default {};", { source: "bundled", repoUrl: null });
  assert.equal((await S.runLegacySweep(silent)).done, false);
  assert.equal(await marker(), null);
});

/* ───────────── Plancher des données ───────────── */

test("dataFloor : manifeste (≤ dataVersion) ; une instance sous le plancher est mise à l'écart, jamais étiquetée « à jour » ; au plancher, elle migre", async () => {
  const m = (extra) => parseManifest({ apiVersion: 2, id: "x1", name: "X", version: "1.0.0", ...extra });
  assert.ok(m({ dataVersion: 3, dataFloor: 2 }).ok);
  assert.ok(m({ dataVersion: 3, dataFloor: 3 }).ok);
  assert.equal(m({ dataVersion: 2, dataFloor: 3 }).ok, false);
  assert.equal(m({ dataFloor: 2 }).ok, false, "sans dataVersion, le plancher ne peut dépasser 1");
  assert.equal(m({ dataVersion: 3, dataFloor: 0 }).ok, false);

  await module("carnet", { dataVersion: 3, dataFloor: 2 }, "export default { migrations: { 3: async (ctx) => { await ctx.api.store.add('journal', { step: 3 }); } } };");
  const old = await instance("carnet", "Vieux"), ok = await instance("carnet", "Pret");
  await setSetting(`instance.${old.id}.__dataVersion`, 1);
  await setSetting(`instance.${ok.id}.__dataVersion`, 2);
  await prisma.moduleRecord.create({ data: { instanceId: old.id, collection: "notes", data: JSON.stringify({ v: 1 }) } });

  const r = await S.runLegacySweep(silent);
  assert.equal(r.done, false);
  assert.equal(await D.dataVersionOf(old.id), 1, "rien n'a avancé");
  assert.deepEqual(await D.dataStatusOf(old.id), { status: "failed", error: "floor", floor: 2, from: 1 });
  assert.equal(await prisma.moduleRecord.count({ where: { instanceId: old.id } }), 1, "données intactes");
  assert.equal(await D.dataVersionOf(ok.id), 3);
  assert.equal(await D.dataStatusOf(ok.id), null);
  const report = await Rp.legacyReport();
  assert.deepEqual(report.failed.map((f) => [f.key, f.reason, f.floor]), [[old.key, "floor", 2]]);
  // « Réessayer » sans version intermédiaire : toujours à l'écart.
  assert.equal((await D.retryInstanceMigration(old.id)).status, "failed");
  // Données plus récentes que le module (ne jamais abaisser dataVersion) : « newer », pas « à jour ».
  await setSetting(`instance.${ok.id}.__dataVersion`, 4);
  assert.equal((await D.retryInstanceMigration(ok.id)).status, "newer");
});

/* ───────────── Réglages hérités ───────────── */

test("legacySettings : manifeste (≤ 20, jamais aussi dans settings) ; ctx.legacy lit et efface SA clé déclarée seulement", async () => {
  const m = (extra) => parseManifest({ apiVersion: 2, id: "x1", name: "X", version: "1.0.0", ...extra });
  assert.ok(m({ legacySettings: [{ key: "clientSecret", secret: true }, { key: "channel" }] }).ok);
  assert.equal(m({ settings: [{ key: "channel", label: "C", type: "text" }], legacySettings: [{ key: "channel" }] }).ok, false);
  assert.equal(m({ legacySettings: [{ key: "a" }, { key: "a" }] }).ok, false);
  assert.equal(m({ legacySettings: Array.from({ length: 21 }, (_, i) => ({ key: `k${i}` })) }).ok, false);
  assert.equal(m({ legacySettings: [{ key: "__dataVersion" }] }).ok, false);

  await module("carnet", { settings: [{ key: "title", label: "T", type: "text" }], legacySettings: [{ key: "clientSecret", secret: true }, { key: "channel" }] });
  const a = await instance("carnet", "Un");
  await setSetting(`instance.${a.id}.clientSecret`, SECRET);
  await setSetting(`instance.${a.id}.channel`, "  ");
  await setSetting(`instance.${a.id}.title`, "Titre");
  const ctx = await buildContext(await R.getModule("carnet"), await getInstanceById(a.id));
  assert.deepEqual(ctx.legacy.keys(), ["clientSecret", "channel"]);
  assert.equal(await ctx.legacy.get("clientSecret"), SECRET);
  assert.equal(await ctx.legacy.get("channel"), null, "vide = rien à reprendre");
  await assert.rejects(() => ctx.legacy.get("title"), /not declared in legacySettings/, "un réglage affiché n'est pas un réglage hérité");
  await assert.rejects(() => ctx.legacy.clear("title"), /not declared in legacySettings/);
  await assert.rejects(() => ctx.legacy.clear("autre"), (e) => e.code === "undeclared" && !String(e.message).includes(SECRET));
  assert.equal(ctx.setting("clientSecret"), undefined, "jamais par ctx.setting");

  await ctx.legacy.clear("clientSecret");
  assert.equal(await ctx.legacy.get("clientSecret"), null);
  assert.equal(await prisma.setting.count({ where: { key: `instance.${a.id}.title` } }), 1, "les autres réglages ne bougent pas");
  const audits = await prisma.auditLog.findMany({ where: { action: "module.legacy.clear" } });
  assert.deepEqual(audits.map((x) => x.target), ["carnet: clientSecret"]);
});

test("secret hérité : jamais dans le rapport, l'outil MCP, le journal du balayage, ni l'audit", async () => {
  await module("carnet", { settings: [{ key: "title", label: "T", type: "text" }], legacySettings: [{ key: "clientSecret", secret: true }] });
  const a = await instance("carnet", "Un");
  await setSetting(`instance.${a.id}.clientSecret`, SECRET);
  await setSetting(`instance.${a.id}.oublie`, `${SECRET}-orphelin`);

  const lines = [];
  const errors = [];
  const log = console.log, err = console.error;
  console.log = (...x) => lines.push(x.join(" ")); console.error = (...x) => errors.push(x.join(" "));
  try { await S.runLegacySweep(); } finally { console.log = log; console.error = err; }
  const report = await Rp.legacyReport();
  assert.deepEqual(report.legacyValues, [{ key: a.key, module: "carnet", settings: ["clientSecret"] }], "le nom de la clé, pas la valeur");
  assert.deepEqual(report.orphans, [{ key: a.key, module: "carnet", settings: ["oublie"] }]);
  const tool = (await maintenanceToolProvider.list()).find((t) => t.name === "maintenance_legacy");
  assert.equal(tool.readOnly, true);
  const viaMcp = await tool.call({}, { name: "test" });
  assert.deepEqual(viaMcp.keptSettingsWithValue, report.legacyValues);
  for (const text of [JSON.stringify(report), JSON.stringify(viaMcp), lines.join("\n"), errors.join("\n"), JSON.stringify(await prisma.auditLog.findMany()), JSON.stringify(await Rp.readLegacyMarker())]) {
    assert.ok(!text.includes(SECRET), `fuite : ${text.slice(0, 200)}`);
  }
  // Le formulaire d'admin ne connaît que `settings` : la clé héritée n'y est pas, même en mode avancé.
  const mod = await R.getModule("carnet");
  assert.deepEqual(mod.manifest.settings.map((f) => f.key), ["title"]);
});

test("balayeuse : valeurs VIDES des réglages hérités et orphelins effacées ; valeurs remplies et réglages déclarés jamais touchés", async () => {
  await module("carnet", { settings: [{ key: "title", label: "T", type: "text" }], legacySettings: [{ key: "channel" }, { key: "token", secret: true }] });
  const a = await instance("carnet", "Un");
  await setSetting(`instance.${a.id}.channel`, "");
  await setSetting(`instance.${a.id}.token`, "garde");
  await setSetting(`instance.${a.id}.vide`, null);
  await setSetting(`instance.${a.id}.plein`, "x");
  await setSetting(`instance.${a.id}.title`, "");
  const r = await S.runLegacySweep(silent);
  assert.equal(r.counts.emptied, 2);
  const keys = (await prisma.setting.findMany({ where: { key: { startsWith: `instance.${a.id}.` } } })).map((s) => s.key.split(".").slice(2).join(".")).sort();
  assert.deepEqual(keys.filter((k) => !k.startsWith("__")), ["plein", "title", "token"]);
  assert.equal(r.done, true, "réglages hérités et orphelins remplis : signalés, ils ne retiennent pas la conversion");
});

/* ───────────── Rapport et garde ───────────── */

test("rapport à zéro sur une base propre ; reprises pas faites et collections à vider comptées", async () => {
  const clean = await Rp.legacyReport();
  assert.equal(clean.clean, true);
  assert.ok(Object.values(clean.totals).every((n) => n === 0));

  await module("fournisseur", { offers: [{ service: "agenda.source" }] });
  await module("carnet", { requires: [{ service: "agenda.source" }], seeds: [{ module: "fournisseur", reason: "adresse" }], legacyCollections: ["vieuxContacts"] });
  const a = await instance("carnet", "Un");
  await prisma.moduleRecord.create({ data: { instanceId: a.id, collection: "vieuxContacts", data: "{}" } });
  const r = await Rp.legacyReport();
  assert.deepEqual(r.seedsMissing, [{ key: a.key, module: "carnet" }]);
  assert.deepEqual(r.collections, [{ key: a.key, module: "carnet", collection: "vieuxContacts", count: 1 }]);
  await setSetting(`instance.${a.id}.__seeds.adresse`, { module: "fournisseur", instance: "x" });
  assert.equal((await Rp.legacyReport()).totals.seedsMissing, 0);
});

test("garde : marqueur absent → avertissement dans l'admin seulement ; le site public ne dépend pas du marqueur", () => {
  const layout = fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8");
  assert.match(layout, /legacyConversionPending\(\)/);
  assert.match(layout, /<LegacyBanner /);
  assert.match(fs.readFileSync("src/components/admin/LegacyBanner.tsx", "utf8"), /data-testid="legacy-banner"/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const pub = walk("src/app").filter((f) => !f.includes(`${path.sep}admin${path.sep}`) && /\.(ts|tsx)$/.test(f));
  for (const f of pub) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /legacyCleared|legacyConversionPending|legacyReport/, `${f} : le site public ne doit pas dépendre de la conversion`);
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of Object.keys(fr).filter((x) => x.startsWith("legacy.") || x.startsWith("migration."))) assert.ok(en[k], `${k} sans anglais`);
  for (const [k, v] of Object.entries(fr).filter(([x]) => x.startsWith("legacy."))) assert.doesNotMatch(v, /\bancien(ne)?s?\b|legacy/i, `${k} : pas de « ancien » visible`);
});

test("kit de test : fakeCtx({ legacy }) imite ctx.legacy (clé non déclarée refusée, effacements notés)", async () => {
  const { fakeCtx } = await import("../../testsupport/fakeCtx.mjs");
  assert.equal(fakeCtx().legacy, undefined, "sans l'option : comme un cœur plus ancien");
  const ctx = fakeCtx({ legacy: { clientSecret: "x", vide: "" } });
  assert.deepEqual(ctx.legacy.keys(), ["clientSecret", "vide"]);
  assert.equal(await ctx.legacy.get("clientSecret"), "x");
  assert.equal(await ctx.legacy.get("vide"), null);
  await assert.rejects(() => ctx.legacy.get("autre"), (e) => e.code === "undeclared");
  await ctx.legacy.clear("clientSecret");
  assert.deepEqual(ctx.calls.legacyCleared, ["clientSecret"]);
  assert.equal(await ctx.legacy.get("clientSecret"), null);
});

/* ───────────── D4 : un module hérité que le catalogue ne propose plus ───────────── */

test("module hérité absent du catalogue : état « absent » (jamais « convertible ») ; sans copie du catalogue : « unknown »", async () => {
  await module("vieux", { version: "0.1.0" }, "export default {};", { source: "builtin", repoUrl: null });
  await module("agenda", { version: "2.0.0" }, "export default {};", { source: "bundled", repoUrl: null });
  assert.deepEqual((await Rp.legacyReport()).sourceRows.map((r) => [r.id, r.state]), [["agenda", "unknown"], ["vieux", "unknown"]], "pas de catalogue reçu : on ne suppose rien");
  cachedCatalogue([{ id: "agenda", repo: "https://github.com/exemple/modules", ref: "v5.0.0", subdir: "modules/agenda", version: "2.1.0", apiVersion: 2 }]);
  assert.deepEqual((await Rp.legacyReport()).sourceRows.map((r) => [r.id, r.state]), [["agenda", "convertible"], ["vieux", "absent"]]);
});

test("« garder tel quel » : un module hérité (listé ou non par le catalogue) ne retient plus la mise à niveau ; le marqueur est posé ; annuler le choix le fait retenir de nouveau", async () => {
  const { dismissLegacyRow, undoDismissLegacyRow, readDismissed } = await import("@/core/modules/legacyDismiss");
  await module("vieux", { version: "0.1.0" }, "export default {};", { source: "builtin", repoUrl: null });
  await module("agenda", { version: "2.0.0" }, "export default {};", { source: "bundled", repoUrl: null });
  cachedCatalogue([{ id: "agenda", repo: "https://github.com/exemple/modules", ref: "v5.0.0", subdir: "modules/agenda", version: "2.1.0", apiVersion: 2 }]);
  await S.runLegacySweep(silent);
  assert.equal(await marker(), null);
  await dismissLegacyRow("vieux");
  let r = await Rp.legacyReport();
  assert.deepEqual(r.sourceRows.map((x) => x.id), ["agenda"]);
  assert.deepEqual(r.keptRows, [{ id: "vieux", version: "0.1.0" }]);
  assert.equal(r.totals.keptRows, 1);
  assert.equal(r.converted, false, "agenda retient encore : plus aucun code ne le convertit, la personne choisit");
  assert.equal(Rp.legacyStatus(r), "pending");
  await dismissLegacyRow("agenda");   // listé par le catalogue : on peut le garder tel quel aussi
  r = await Rp.legacyReport();
  assert.deepEqual(r.keptRows.map((x) => x.id), ["agenda", "vieux"]);
  assert.equal(r.converted, true);
  assert.equal(r.clean, false, "gardé tel quel : pas « rien à signaler »");
  assert.equal(Rp.legacyStatus(r), "almost", "plus rien ne retient, marqueur pas encore posé");
  const done = await S.runLegacySweep(silent);
  assert.equal(done.done, true);
  assert.notEqual(await marker(), null);
  assert.equal(Rp.legacyStatus(await Rp.legacyReport()), "done");
  assert.equal((await Rp.legacyReportForAssistant()).oldModulesKeptAsTheyAre.length, 2);
  // Annuler le choix : la ligne retient de nouveau, le marqueur tombe au balayage suivant.
  await undoDismissLegacyRow("vieux");
  assert.deepEqual(await readDismissed(), ["agenda"]);
  r = await Rp.legacyReport();
  assert.deepEqual(r.sourceRows.map((x) => x.id), ["vieux"]);
  assert.equal(Rp.legacyStatus(r), "again", "marqueur posé mais un élément est revenu : jamais « terminée »");
  await S.runLegacySweep(silent);
  assert.equal(await marker(), null);
});

test("module retiré par l'administrateur (données gardées) : la ligne disparaît, le marqueur peut être posé", async () => {
  const { uninstallModule } = await import("@/core/modules/installer");
  await module("vieux", { version: "0.1.0" }, "export default {};", { source: "builtin", repoUrl: null });
  cachedCatalogue([{ id: "autre", repo: "https://github.com/exemple/modules", ref: "v5.0.0", subdir: "modules/autre", version: "1.0.0", apiVersion: 2 }]);
  assert.equal((await S.runLegacySweep(silent)).done, false);
  assert.equal((await uninstallModule("vieux", { keepData: true })).ok, true);
  assert.equal((await S.runLegacySweep(silent)).done, true);
});

test("page Entretien : un seul message, jamais « terminée » avec des éléments à faire ; le bandeau de l'admin est caché sur cette page ; actions réservées au propriétaire", () => {
  for (const [marker, converted, expected] of [[{ at: "x" }, true, "done"], [{ at: "x" }, false, "again"], [null, true, "almost"], [null, false, "pending"]]) assert.equal(Rp.legacyStatus({ marker, converted }), expected);
  const banner = fs.readFileSync("src/components/admin/LegacyBanner.tsx", "utf8");
  assert.match(banner, /usePathname/);
  assert.match(banner, /pathname === LEGACY_PAGE/);
  const actions = fs.readFileSync("src/app/admin/(panel)/maintenance/legacy/actions.ts", "utf8");
  for (const fn of ["keepLegacyRowAction", "undoKeepLegacyRowAction", "removeLegacyRowAction"]) assert.match(actions, new RegExp(`export async function ${fn}[^]*?adminCtx\\(\\{ right: "core:[a-z.]+" \\}\\)`), fn);
  const page = fs.readFileSync("src/app/admin/(panel)/maintenance/legacy/page.tsx", "utf8");
  assert.match(page, /legacyStatus\(r\)/);
  assert.match(page, /RemoveChoices/);
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of Object.keys(fr).filter((x) => x.startsWith("legacy.") || x.startsWith("audit.action.core.legacy"))) assert.ok(en[k], `${k} sans anglais`);
  for (const k of ["upkeep.row.seedsMissing", "upkeep.row.collections"]) for (const bad of [/reprise/i, /takeover/i]) { assert.doesNotMatch(fr[k], bad); assert.doesNotMatch(en[k], bad); }
});
