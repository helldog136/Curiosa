import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/readme");

beforeEach(async () => { await db.reset(); P.clearPreviewCache(); process.env.VITRINE_ALLOW_LOCAL_MODULES = "1"; });
after(() => db.close());

const MANIFEST = { apiVersion: 2, id: "demo-mod", name: { en: "Demo", fr: "Démo" }, version: "1.2.0", license: "MIT", author: "Ada", permissions: ["storage", "routes"], requires: [{ service: "contact.store" }] };

test("module livré : README et permissions lus dans son dossier ; sans README → null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-prev-"));
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, "README.md"), "# Démo\n\nÇa sert à ça. Soutenez l'auteur : https://exemple.org/don");
  const p = await P.getModulePreview({ kind: "bundled", dir });
  assert.match(p.readme, /Soutenez l'auteur/);
  assert.deepEqual([p.manifest.id, p.manifest.permissions, p.manifest.requires[0].service], ["demo-mod", ["storage", "routes"], "contact.store"]);
  fs.rmSync(path.join(dir, "README.md"));
  P.clearPreviewCache();
  assert.equal((await P.getModulePreview({ kind: "bundled", dir })).readme, null);
});

test("dépôt git : README (nom insensible à la casse) et module.json lus SANS installer ; rien n'est installé ni laissé sur le disque", async () => {
  const repo = makeRepo({ "module.json": MANIFEST, "readme.md": "# Mon module\n\nTexte", "index.mjs": "export default {};" });
  const p = await P.getModulePreview({ kind: "repo", url: repo.url });
  assert.equal(p.readme, "# Mon module\n\nTexte");
  assert.equal(p.manifest.version, "1.2.0");
  assert.equal(await db.prisma.module.count(), 0, "aucun module installé");
  const tmp = path.join(process.env.DATA_DIR, "tmp");
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => f.startsWith("preview-")) : [], [], "dossier temporaire nettoyé");
});

test("dépôt : une étiquette précise est lue (pas la branche), un dépôt sans README ou sans manifeste valide donne un aperçu partiel", async () => {
  const repo = makeRepo({ "module.json": MANIFEST, "README.md": "version un" });
  repo.g("tag", "v1.0.0");
  fs.writeFileSync(path.join(repo.dir, "README.md"), "version deux"); repo.g("commit", "-qam", "deux");
  assert.equal((await P.getModulePreview({ kind: "repo", url: repo.url, ref: "v1.0.0" })).readme, "version un");
  assert.equal((await P.getModulePreview({ kind: "repo", url: repo.url })).readme, "version deux");
  const bare = makeRepo({ "index.mjs": "x" });
  const p = await P.getModulePreview({ kind: "repo", url: bare.url });
  assert.deepEqual([p.readme, p.manifest], [null, null]);
  const broken = makeRepo({ "module.json": "{ pas du json", "README.md": "ok" });
  const q = await P.getModulePreview({ kind: "repo", url: broken.url });
  assert.deepEqual([q.readme, q.manifest], ["ok", null]);
});

test("dépôt : commit épinglé lu", async () => {
  const repo = makeRepo({ "module.json": MANIFEST, "README.md": "au commit" });
  const first = repo.commit;
  fs.writeFileSync(path.join(repo.dir, "README.md"), "plus tard"); repo.g("commit", "-qam", "x");
  assert.equal((await P.getModulePreview({ kind: "repo", url: repo.url, ref: first })).readme, "au commit");
});

test("README énorme tronqué ; adresses refusées comme à l'installation (hôte non autorisé, schéma) ; résultat mis en cache", async () => {
  const big = makeRepo({ "module.json": MANIFEST, "README.md": "x".repeat(250_000) });
  const p = await P.getModulePreview({ kind: "repo", url: big.url });
  assert.deepEqual([p.readme.length, p.truncated], [100_000, true]);
  delete process.env.VITRINE_ALLOW_LOCAL_MODULES;
  P.clearPreviewCache();
  await assert.rejects(P.getModulePreview({ kind: "repo", url: "https://evil.example/owner/repo" }), /modules\.error\.host/);
  await assert.rejects(P.getModulePreview({ kind: "repo", url: "ssh://git@github.com/owner/repo" }), /modules\.error\.url/);
  await assert.rejects(P.getModulePreview({ kind: "repo", url: big.url }), /modules\.error\.local/);
  process.env.VITRINE_ALLOW_LOCAL_MODULES = "1";
  const repo = makeRepo({ "module.json": MANIFEST, "README.md": "v1" });
  const a = await P.getModulePreview({ kind: "repo", url: repo.url });
  fs.writeFileSync(path.join(repo.dir, "README.md"), "v2"); repo.g("commit", "-qam", "x");
  assert.equal((await P.getModulePreview({ kind: "repo", url: repo.url })).readme, a.readme, "servi par le cache");
});
