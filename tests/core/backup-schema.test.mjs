import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const S = await import("@/core/backup/schema");
const { createTarGz, readTarGz } = await import("@/core/backup/tar");
const { encryptBackup } = await import("@/core/backup/crypto");
const { setSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
beforeEach(async () => { await db.reset(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });
after(() => db.close());

async function base() {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  await setSetting("site.name", "Mon site", "fr");
  await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/x", permanent: true, hits: 7 } });
  return B.createBackup(PW, { iterations: FAST });
}
/** Refabrique une sauvegarde comme l'aurait faite une autre version du framework. */
function forge(b, mutate) {
  const files = readTarGz(b.plain).map((f) => ({ ...f }));
  const manifest = JSON.parse(files.find((f) => f.path === "backup.json").content.toString());
  const edit = (p, fn) => { const f = files.find((x) => x.path === p); f.content = Buffer.from(JSON.stringify(fn(JSON.parse(f.content.toString())))); return f; };
  mutate({ manifest, edit, files });
  files.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(manifest));
  // les empreintes suivent les fichiers modifiés
  return { manifest, files };
}
const repack = async ({ manifest, files }) => {
  const { createHash } = await import("node:crypto");
  for (const e of manifest.files) e.sha256 = createHash("sha256").update(files.find((f) => f.path === e.path).content).digest("hex");
  files.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(manifest));
  return encryptBackup(createTarGz(files), PW, FAST);
};

test("la sauvegarde note la version du schéma de base (dernière migration)", async () => {
  const b = await base();
  const v = await S.currentSchemaVersion();
  assert.match(v, /^\d{8,}_/);
  assert.equal(JSON.parse(readTarGz(b.plain).find((f) => f.path === "backup.json").content.toString()).schemaVersion, v);
});

test("sauvegarde d'un schéma PLUS RÉCENT : refusée, base intacte", async () => {
  const b = await base();
  const f = forge(b, ({ manifest }) => { manifest.schemaVersion = "99991231000000_futur"; });
  const opened = Rs.openBackup(await repack(f), PW, FAST);
  assert.ok(opened.ok);
  assert.equal(await Rs.checkSchema(opened.backup.manifest), "newer-schema");
  await setSetting("site.name", "Avant", "fr");
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o" });
  assert.deepEqual([report.ok, report.error], [false, "newer-schema"]);
  assert.equal(await db.prisma.setting.count({ where: { key: "site.name" } }) > 0, true);
});

test("sauvegarde d'un schéma plus ANCIEN : colonnes disparues ignorées, colonnes nouvelles à leur valeur par défaut", async () => {
  const b = await base();
  const f = forge(b, ({ manifest, edit }) => {
    manifest.schemaVersion = "20200101000000_ancien";
    edit("data/redirects.json", (rows) => rows.map((r) => { const { permanent, ...rest } = r; return { ...rest, ancienneColonne: "disparue", autreAncienne: 3 }; }));
  });
  const opened = Rs.openBackup(await repack(f), PW, FAST);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report));
  const r = await db.prisma.redirect.findFirst();
  assert.equal(r.path, "twitch");
  assert.equal(r.hits, 7);
});

test("transformation explicite : un schemaUpgrade s'applique aux seules sauvegardes plus anciennes que sa migration", () => {
  const mk = () => ({ redirects: [{ path: "a", target: "x" }] });
  const up = [{ before: "20300101000000_renomme", upgrade: (d) => { d.redirects = d.redirects.map(({ target, ...r }) => ({ ...r, targetUrl: target })); } }];
  const old = mk(); S.applyUpgrades(old, "20250101000000_x", up);
  assert.deepEqual(old.redirects, [{ path: "a", targetUrl: "x" }]);
  const unversioned = mk(); S.applyUpgrades(unversioned, undefined, up);
  assert.equal(unversioned.redirects[0].targetUrl, "x", "sans version notée = la plus ancienne");
  const recent = mk(); S.applyUpgrades(recent, "20300101000000_renomme", up);
  assert.equal(recent.redirects[0].target, "x", "déjà au nouveau schéma : intacte");
});
