// Skins et sauvegarde (docs/SKINS.md §10.7) : la liste des skins (dépôt, étiquette) est sauvegardée, les fichiers sont réinstallés depuis le dépôt à la
// restauration, repli sur basic sans perte, format rétrocompatible (sauvegarde fabriquée par le VRAI 0.3.0 restaurée par ce code).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, SKINS_HTTPS, TEST_CORE } from "../helpers/skins.mjs";

const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { readTarGz } = await import("@/core/backup/tar");
const S = await import("@/core/skins/service");
const R = await import("@/core/skins/registry");
const K = await import("@/core/skins/restore");
const { setSetting, getSetting } = await import("@/core/settings");
const cat = createSkinsRepo();

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
const SKINS = path.join(db.dir, "skins");
const FIXTURE_030 = path.resolve(import.meta.dirname, "../fixtures/backup/site-030.chiffre.bin");

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
  S.setServiceHooksForTests({});
});
after(() => { db.close(); cat.close(); });

async function owner() {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
}
const make = () => B.createBackup(PW, { iterations: FAST });
const filesOf = (b) => Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
const restore = (b, confirmCustom = []) => Rs.applyRestore(Rs.openBackup(b.buffer, PW, FAST).backup, { confirmCustom, actor: "owner@example.org" });
const personalUrl = (id) => `${cat.url}#${id}-v1.0.0:skins/${id}`;

/** Un site avec deux skins (un du catalogue, un personnel), le premier actif, des retouches et des options. */
async function seedSkins({ active = "plain-light" } = {}) {
  await owner();
  await cat.publish("plain-light");
  await cat.publish("perso", { listed: false });
  assert.equal((await S.installFromCatalogue("plain-light")).ok, true);
  assert.equal((await S.install(personalUrl("perso"), { confirmPersonal: true })).ok, true);
  await setSetting("skin.active", active);
  await setSetting("skin.options", { density: "airy" });
  await setSetting("theme.accent", "#ff00aa");
  await setSetting("header.layout", "centered");
}
/** Le site « neuf » où l'on restaure : base vide, aucun fichier de skin. */
async function freshSite() {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  S.clearSkinCaches();
}

test("une sauvegarde sans skin est identique à avant : pas de clé « skins », mêmes compteurs", async () => {
  await owner();
  const b = await make();
  assert.equal("skins" in b.manifest, false);
  assert.equal("skins" in b.manifest.counts, false);
  assert.equal(b.manifest.formatVersion, 1);
});

test("la sauvegarde contient la liste des skins (dépôt, étiquette, commit) et leurs réglages, PAS leurs fichiers", async () => {
  await seedSkins();
  const b = await make();
  assert.equal(b.manifest.counts.skins, 2);
  const skins = b.manifest.skins;
  assert.deepEqual(skins.map((s) => [s.id, s.version, s.repoUrl, s.ref, s.subdir, s.source, s.name]), [
    ["perso", "1.0.0", cat.url, "perso-v1.0.0", "skins/perso", "personal", "Plain light"],
    ["plain-light", "1.0.0", SKINS_HTTPS, "plain-light-v1.0.0", "skins/plain-light", "catalogue", "Plain light"],
  ]);
  assert.match(skins[0].commit, /^[0-9a-f]{40}$/);
  const files = filesOf(b);
  const settings = JSON.parse(files["data/settings.json"].toString());
  const val = (k) => settings.find((s) => s.key === k)?.value;
  assert.equal(val("skin.active"), "plain-light");
  assert.deepEqual(val("skin.options"), { density: "airy" });
  assert.equal(val("theme.accent"), "#ff00aa");
  assert.equal(val("skin.installed").length, 2);
  assert.deepEqual(Object.keys(files).filter((p) => /skin|font|\.woff2|\.css/.test(p) && !p.startsWith("data/")), [], "aucun fichier de skin dans la sauvegarde");
  assert.ok(!Object.keys(files).some((p) => p.startsWith("readable/") && /skins\//.test(p)));
});

test("restauration sur un site neuf : le skin du catalogue est réinstallé depuis son dépôt, le personnel seulement s'il est confirmé ; réglages et retouches intacts", async () => {
  await seedSkins();
  const b = await make();
  await freshSite();
  const opened = Rs.openBackup(b.buffer, PW, FAST).backup;
  const plan = await Rs.planBackupSkins(opened);
  assert.deepEqual(plan.map((p) => [p.id, p.status, p.needsConfirmation]), [["perso", "personal", true], ["plain-light", "catalogue", false]]);

  const report = await restore(b);   // pas de confirmation du dépôt personnel
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.skins, [{ id: "perso", outcome: "skipped" }, { id: "plain-light", outcome: "installed" }]);
  assert.ok(fs.existsSync(path.join(SKINS, "plain-light", "1.0.0", "skin.json")));
  assert.ok(!fs.existsSync(path.join(SKINS, "perso")));
  assert.equal(await getSetting("skin.active"), "plain-light");
  assert.equal(await S.activeSkinId(), "plain-light");
  assert.equal(await getSetting("theme.accent"), "#ff00aa");
  assert.deepEqual(await getSetting("skin.options"), { density: "airy" });
  const list = await S.installed();
  assert.deepEqual(list.map((s) => [s.id, s.status, s.active]), [["perso", "missing", false], ["plain-light", "ok", true]]);
  // La personne confirme le dépôt personnel plus tard (ou au moment de la restauration) : il revient.
  const again = await S.reinstall("perso");
  assert.equal(again.ok, true);
  assert.equal((await S.installed())[0].status, "ok");
});

test("restauration avec confirmation d'un dépôt personnel (« skin:<id> ») : réinstallé", async () => {
  await seedSkins({ active: "perso" });
  const b = await make();
  await freshSite();
  const report = await restore(b, ["skin:perso"]);
  assert.deepEqual(report.skins, [{ id: "perso", outcome: "installed" }, { id: "plain-light", outcome: "installed" }]);
  assert.equal(await S.activeSkinId(), "perso");
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "skin.install" } })).length >= 2, true);
});

test("dépôt injoignable à la restauration : le site reste sur basic SANS PERTE (réglages gardés), message, et le skin revient dès qu'il est réinstallé", async () => {
  await seedSkins({ active: "plain-light" });
  const b = await make();
  await freshSite();
  const hidden = `${cat.dir}.cache`;
  fs.renameSync(cat.dir, hidden);
  try {
    const report = await restore(b, ["skin:perso"]);
    assert.equal(report.ok, true, "la restauration réussit quand même");
    assert.deepEqual(report.skins.map((s) => [s.id, s.outcome, s.error]), [["perso", "failed", "skins.error.clone"], ["plain-light", "failed", "skins.error.clone"]]);
    assert.equal(await getSetting("skin.active"), "plain-light", "le choix de la personne est gardé");
    assert.equal(await S.activeSkinId(), "basic", "basic s'applique en attendant");
    assert.equal(await getSetting("theme.accent"), "#ff00aa", "retouches intactes");
    const [, pl] = await S.installed();
    assert.deepEqual([pl.status, pl.problems[0].code], ["missing", "skin-files-missing"]);
    assert.match(pl.problems[0].message.fr, /sera réinstallé|le skin de base est utilisé/);
  } finally { fs.renameSync(hidden, cat.dir); }
  const back = await S.reinstall("plain-light");
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(await S.activeSkinId(), "plain-light", "réactivé tout seul");
});

test("restauration : cœur trop ancien pour le skin → basic, ligne gardée ; adresse trafiquée dans la sauvegarde → jamais contactée", async () => {
  await seedSkins();
  const b = await make();
  await freshSite();
  setCoreVersionForTests("0.3.0");
  try {
    const r1 = await restore(b, ["skin:perso"]);
    assert.deepEqual(r1.skins.map((s) => [s.id, s.outcome, s.error, s.needsCore]), [["perso", "failed", "skins.error.core", "0.4.0"], ["plain-light", "failed", "skins.error.core", "0.4.0"]]);
  } finally { setCoreVersionForTests(TEST_CORE); }
  assert.equal(await S.activeSkinId(), "basic");
  // Réglage trafiqué dans la sauvegarde : hôte interdit.
  await freshSite();
  await owner();
  await setSetting("skin.installed", [{ id: "pirate", version: "1.0.0", repo: "https://evil.example.org/o/r", ref: "v1", subdir: null, source: "catalogue", commit: "", tree: null, fingerprint: "", installedAt: "" }]);
  await setSetting("skin.active", "pirate");
  const evil = await make();
  await freshSite();
  const r2 = await restore(evil);
  assert.deepEqual(r2.skins, [{ id: "pirate", outcome: "failed", error: "skins.error.host" }]);
  assert.equal(await S.activeSkinId(), "basic");
});

test("restauration : un skin installé ICI mais absent de la sauvegarde reste installé ; les dossiers sans propriétaire sont rangés", async () => {
  await owner();
  const noSkin = await make();                       // sauvegarde sans aucun skin
  await cat.publish("local");
  assert.equal((await S.installFromCatalogue("local")).ok, true);
  await setSetting("skin.active", "local");
  fs.mkdirSync(path.join(SKINS, "fantome", "1.0.0"), { recursive: true });
  fs.mkdirSync(path.join(SKINS, ".incoming-reste"), { recursive: true });
  fs.mkdirSync(path.join(SKINS, "local", "0.9.0"), { recursive: true });
  const report = await restore(noSkin);
  assert.equal(report.ok, true);
  assert.deepEqual(report.skins, []);
  assert.deepEqual((await S.installed()).map((s) => [s.id, s.status]), [["local", "ok"]], "le skin d'ici reste installé");
  assert.equal(await getSetting("skin.active"), undefined, "mais le choix actif est celui de la sauvegarde (aucun : basic)");
  assert.equal(await S.activeSkinId(), "basic");
  assert.deepEqual(fs.readdirSync(SKINS), ["local"], "fantôme et reste temporaire rangés");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "local")), ["1.0.0"]);
});

test("restauration d'un skin dont la version a changé depuis : réinstallé à l'étiquette notée (reproductible)", async () => {
  await seedSkins();
  const b = await make();
  await cat.publish("plain-light", { version: "1.0.1" });   // l'index pointe maintenant vers 1.0.1, la sauvegarde note plain-light-v1.0.0
  await freshSite();
  const report = await restore(b, ["skin:perso"]);
  assert.equal(report.skins.find((s) => s.id === "plain-light").outcome, "installed");
  assert.equal((await R.readRows()).find((r) => r.id === "plain-light").version, "1.0.0");
});

test("skinsOfBackup : une liste trafiquée est nettoyée (id, version, adresse), les doublons et « basic » écartés", () => {
  const list = K.skinsOfBackup([
    { id: "ok", version: "1.2.3", repoUrl: "https://github.com/o/r", ref: "v1.2.3", subdir: "s", commit: "abc", source: "personal", name: "Ok" },
    { id: "ok", version: "9.9.9", repoUrl: "https://github.com/o/r2" },
    { id: "basic", version: "1.0.0", repoUrl: "https://github.com/o/r" },
    { id: "../x", version: "1.0.0", repoUrl: "https://github.com/o/r" },
    { id: "v-casse", version: "1.0", repoUrl: "https://github.com/o/r" },
    { id: "sans-depot", version: "1.0.0" },
    null, 12, "texte",
  ], []);
  assert.deepEqual(list.map((s) => [s.id, s.version, s.source]), [["ok", "1.2.3", "personal"]]);
  assert.deepEqual(K.skinsOfBackup(undefined, [{ key: "skin.installed", locale: "", value: [{ id: "depuis-reglage", version: "1.0.0", repo: "https://github.com/o/r" }] }]).map((s) => s.id), ["depuis-reglage"], "sans backup.json.skins : lu dans les réglages");
  assert.deepEqual(K.skinsOfBackup(undefined, []), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Compatibilité avec le VRAI 0.3.0

test("sauvegarde fabriquée par le VRAI 0.3.0 (fixture) : lue et restaurée par ce code, aucun skin, retouches gardées, basic partout", async () => {
  const enc = fs.readFileSync(FIXTURE_030);
  const opened = Rs.openBackup(enc, "mot-de-passe-de-reference", FAST);
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.backup.manifest.frameworkVersion, "0.3.0", "fabriquée par le cœur 0.3.0");
  assert.equal("skins" in opened.backup.manifest, false);
  assert.deepEqual(await Rs.planBackupSkins(opened.backup), []);
  // Un skin installé ICI avant la restauration reste installé mais n'est plus actif (la sauvegarde ne connaît pas les skins).
  await cat.publish("local");
  assert.equal((await S.installFromCatalogue("local")).ok, true);
  await setSetting("skin.active", "local");
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.skins, []);
  assert.equal(await getSetting("theme.accent"), "#ff00aa", "retouches de la sauvegarde");
  assert.equal(await getSetting("header.layout"), "centered");
  assert.equal(await S.activeSkinId(), "basic");
  assert.deepEqual((await S.installed()).map((s) => s.id), ["local"]);
  assert.equal((await db.prisma.user.findMany()).length, 1);
});

test("une sauvegarde de ce code garde le format 1 et reste lisible par un cœur plus ancien : clés ajoutées seulement, tout le reste inchangé", async () => {
  await seedSkins();
  const b = await make();
  const m = b.manifest;
  assert.equal(m.format, "curiosa-backup");
  assert.equal(m.formatVersion, 1);
  // Un cœur 0.3.0 exige ces clés et ces fichiers, et ignore les autres.
  for (const k of ["format", "formatVersion", "createdAt", "frameworkVersion", "site", "counts", "modules", "files"]) assert.ok(k in m, k);
  assert.ok(Array.isArray(m.modules) && Array.isArray(m.files));
  assert.deepEqual(m.files.map((f) => f.path).filter((p) => !p.startsWith("data/") && !p.startsWith("readable/") && !p.startsWith("uploads/")), []);
  assert.ok(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
});
