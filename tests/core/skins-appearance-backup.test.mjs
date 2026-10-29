// Sauvegarde et restauration de l'apparence (lot S7, docs/SKINS.md §10.7) : skin.active, skin.options, skin.snapshot (« Annuler »), theme.palette et les retouches
// des deux modes sont des réglages ordinaires, donc emportés tels quels ; la restauration d'une ANCIENNE sauvegarde (sans skin) remet basic et ne laisse rien d'un
// skin de l'état précédent. Les fichiers des skins sont réinstallés depuis leur dépôt (lot S5).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const V = await import("@/core/skins/appearanceView");
const { setSetting, getSetting } = await import("@/core/settings");
const cat = createSkinsRepo();
const PW = "un-mot-de-passe-solide";
const SKINS = path.join(db.dir, "skins");
const FIXTURE_030 = path.resolve(import.meta.dirname, "../fixtures/backup/site-030.chiffre.bin");

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
});
after(() => { db.close(); cat.close(); });

async function owner() {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
}
const restore = (b) => Rs.applyRestore(Rs.openBackup(b.buffer, PW, 1000).backup, { confirmCustom: [], actor: "owner@example.org" });

test("l'apparence complète survit à une sauvegarde : skin, options, retouches des deux modes, « Annuler » ; le skin est réinstallé depuis son dépôt", async () => {
  await owner();
  await cat.publish("duo", { from: "duo" });
  assert.equal((await S.installFromCatalogue("duo")).ok, true);
  await setSetting("theme.accent", "#00aa00");                // une retouche d'avant le choix du skin, mise de côté dans le snapshot
  await setSetting("header.layout", "minimal");
  await A.chooseSkin("duo");
  await setSetting("skin.options", { density: "airy" });          // (enregistrer des options ou des retouches par l'écran retire le « Annuler » : ici on l'écrit à la main)
  await setSetting("theme.palette", "both");
  await setSetting("theme.dark.accent", "#aaccff");
  await setSetting("theme.light.text", "#222222");
  const before = await V.loadAppearanceView();
  assert.equal(before.snapshot?.kind, "choose");
  const b = await B.createBackup(PW, { iterations: 1000 });
  // un site neuf : base vide, aucun fichier de skin
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  S.clearSkinCaches();
  const report = await restore(b);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.skins, [{ id: "duo", outcome: "installed" }]);
  const after = await V.loadAppearanceView();
  assert.equal(after.activeId, "duo");
  assert.equal(after.palette, "both");
  assert.deepEqual(after.retouches, before.retouches);
  assert.deepEqual(after.options, before.options);
  assert.equal(after.options[0].chosen, "airy");
  assert.deepEqual(after.snapshot && { kind: after.snapshot.kind, from: after.snapshot.fromSkin }, { kind: "choose", from: "basic" }, "« Annuler » est encore possible après la restauration");
  assert.equal((await A.undoLastChange()).ok, true);
  assert.equal(await getSetting("theme.accent"), "#00aa00");
  assert.equal(await getSetting("header.layout"), "minimal");
  assert.equal(await getSetting("skin.active"), "basic");
});

test("restaurer une ANCIENNE sauvegarde (avant les skins) : basic, aucune retouche ni « Annuler » d'un skin de l'état précédent ; les skins installés ici restent installés", async () => {
  await owner();
  await cat.publish("duo", { from: "duo" });
  assert.equal((await S.installFromCatalogue("duo")).ok, true);
  await setSetting("theme.accent", "#00aa00");
  await A.chooseSkin("duo");
  await setSetting("theme.dark.accent", "#aaccff");
  await setSetting("theme.palette", "both");
  assert.equal((await V.loadAppearanceView()).activeId, "duo");
  const enc = fs.readFileSync(FIXTURE_030);
  const opened = Rs.openBackup(enc, "mot-de-passe-de-reference", 1000);
  assert.equal(opened.ok, true, opened.error);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true, JSON.stringify(report));
  const v = await V.loadAppearanceView();
  assert.equal(v.activeId, "basic", "l'ancienne sauvegarde ne connaît pas les skins : basic");
  assert.equal(v.snapshot, null, "le « Annuler » d'un skin de l'état d'avant ne revient pas");
  assert.equal(await getSetting("skin.active"), undefined);
  assert.equal(await getSetting("theme.palette"), undefined);
  assert.equal(await getSetting("theme.dark.accent"), undefined);
  assert.equal(await getSetting("skin.snapshot"), undefined);
  assert.equal(v.palette, "single");
  assert.equal(await getSetting("theme.accent"), "#ff00aa", "les retouches de la sauvegarde");
  assert.deepEqual((await S.installed()).map((s) => s.id), ["duo"], "le skin installé ici reste disponible");
});
