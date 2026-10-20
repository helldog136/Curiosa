import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const S = await import("@/core/services/store");
const T = await import("@/core/backup/tar");
const C = await import("@/core/backup/crypto");

const FIX = path.join(import.meta.dirname, "..", "fixtures", "backup");
const PW = "un-mot-de-passe-solide";
beforeEach(() => db.reset());
after(() => db.close());

const sample = () => [
  { path: "README.txt", content: Buffer.from("bonjour\n") },
  { path: "readable/é/ü.md", content: Buffer.from("---\ntitle: \"Été\"\n---\n") },
  { path: "data/gros.bin", content: crypto.randomBytes(3 * 1024 * 1024 + 17) },
  { path: "vide.txt", content: Buffer.alloc(0) },
];
const same = (a, b) => assert.deepEqual(a.map((f) => [f.path, f.content.toString("hex")]), b.map((f) => [f.path, f.content.toString("hex")]));

test("archive : la version asynchrone écrit EXACTEMENT les mêmes octets que la version synchrone, et inversement pour la lecture", async () => {
  const files = sample();
  const syncBytes = T.createTarGz(files, 1_700_000_000);
  const asyncBytes = await T.createTarGzAsync(files, 1_700_000_000);
  assert.ok(syncBytes.equals(asyncBytes));
  same(await T.readTarGzAsync(syncBytes), files);
  same(T.readTarGz(asyncBytes), files);
  await assert.rejects(T.readTarGzAsync(Buffer.from("pas un gzip")));
  await assert.rejects(T.readTarGzAsync(syncBytes, { maxBytes: 1000 }), "la borne de décompression tient aussi en asynchrone");
});

test("chiffrement : synchrone et asynchrone se lisent l'un l'autre ; mauvais mot de passe et fichier étranger refusés", async () => {
  const plain = T.createTarGz(sample(), 5);
  const a = await C.encryptBackupAsync(plain, PW, 2000);
  const b = C.encryptBackup(plain, PW, 2000);
  assert.deepEqual([a.length, b.length], [b.length, a.length]);
  for (const enc of [a, b]) {
    for (const dec of [C.decryptBackup(enc, PW, 2000), await C.decryptBackupAsync(enc, PW, 2000)]) { assert.equal(dec.ok, true); assert.ok(dec.plain.equals(plain)); }
    assert.deepEqual(await C.decryptBackupAsync(enc, "un-autre-mot-de-passe", 2000), C.decryptBackup(enc, "un-autre-mot-de-passe", 2000));
    assert.equal((await C.decryptBackupAsync(enc, "un-autre-mot-de-passe", 2000)).error, "wrong-password");
  }
  assert.equal((await C.decryptBackupAsync(Buffer.from("x".repeat(100)), PW)).error, "not-a-backup");
  await assert.rejects(C.encryptBackupAsync(plain, "court"), /password-too-short/);
});

test("compatibilité : une archive fabriquée par l'ANCIEN code (fixture) se lit, et ce que l'on écrit se lit avec openssl (format inchangé)", async () => {
  const enc = fs.readFileSync(path.join(FIX, "ancien-code.tar.gz.enc"));
  const dec = await C.decryptBackupAsync(enc, "mot-de-passe-de-reference");
  assert.equal(dec.ok, true);
  assert.ok(dec.plain.equals(fs.readFileSync(path.join(FIX, "ancien-code.tar.gz"))));
  const files = await T.readTarGzAsync(dec.plain);
  assert.deepEqual(files.map((f) => f.path), ["README.txt", "readable/a/é-1.md", "data/big.json"]);
  assert.equal(JSON.parse(files[2].content.toString()).length, 300);
  // Le code actuel réécrit la même archive, octet pour octet (même tar, même gzip).
  assert.ok((await T.createTarGzAsync(files, 1_700_000_000)).equals(dec.plain));
  assert.equal((C.decryptBackup(enc, "mot-de-passe-de-reference")).ok, true);
  // Écrit maintenant, relu par openssl.
  if (spawnSync("openssl", ["version"]).status === 0) {
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "bk-"));
    try {
      const out = await C.encryptBackupAsync(dec.plain, "mot-de-passe-de-reference", 1000);
      fs.writeFileSync(path.join(tmp, "b.enc"), out);
      const plain = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "1000", "-md", "sha256", "-in", path.join(tmp, "b.enc"), "-pass", "pass:mot-de-passe-de-reference"]);
      assert.ok(plain.equals(dec.plain));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
});

test("aller-retour : une vraie sauvegarde exportée (asynchrone) se restaure avec la lecture synchrone ET asynchrone", async () => {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  await db.prisma.moduleInstance.create({ data: { id: "inst-1", moduleId: "carnet", key: "carnet-1", basePath: null, nickname: "i" } });
  await S.createStore("inst-1").addMany("notes", Array.from({ length: 50 }, (_, n) => ({ data: { n }, key: `k${n}` })));
  const made = await B.createBackup(PW, { iterations: 1000 });
  const viaSync = Rs.openBackup(made.buffer, PW, 1000);
  const viaAsync = await Rs.openBackupAsync(made.buffer, PW, 1000);
  assert.equal(viaSync.ok && viaAsync.ok, true);
  assert.deepEqual(viaAsync.backup.data.records, viaSync.backup.data.records);
  assert.equal(viaAsync.backup.data.records.length, 50);
  assert.equal((await Rs.openBackupAsync(made.buffer, "mauvais-mot-de-passe", 1000)).error, "wrong-password");
  await db.prisma.moduleRecord.deleteMany();
  assert.equal((await Rs.applyRestore(viaAsync.backup, { confirmCustom: [], actor: "o" })).ok, true);
  assert.equal(await db.prisma.moduleRecord.count(), 50);
  // Falsifier un fichier de l'archive est toujours détecté.
  const files = T.readTarGz(made.plain);
  files.find((f) => f.path === "data/users.json").content = Buffer.from("[]");
  assert.equal((await Rs.parseBackupAsync(T.createTarGz(files))).error, "tampered");
});

/** Mesure le plus long retard d'un minuteur de 10 ms pendant `work`. */
async function worstLag(work) {
  let worst = 0, last = performance.now(), run = true;
  const timer = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
  try { return { result: await work(), worst: (await new Promise((r) => setImmediate(r)), worst) }; } finally { run = false; clearInterval(timer); void run; }
}

test("boucle d'événements : exporter puis restaurer 20 000 enregistrements ne retarde jamais un minuteur de plus de ~200 ms", { timeout: 300_000 }, async () => {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  await db.prisma.moduleInstance.create({ data: { id: "inst-1", moduleId: "carnet", key: "carnet-1", basePath: null, nickname: "i" } });
  const s = S.createStore("inst-1");
  for (let i = 0; i < 20; i++) await s.addMany("big", Array.from({ length: 1000 }, (_, n) => ({ data: { n, i, texte: "lorem ipsum ".repeat(8) }, key: `k${i}-${n}` })));
  assert.equal(await db.prisma.moduleRecord.count(), 20_000);

  // Machine chargée (la suite tourne à plusieurs) : la gigue du système elle-même retarde un minuteur. On la mesure au repos et on la tolère en plus des 200 ms.
  const idle = await worstLag(() => new Promise((r) => setTimeout(r, 600)));
  const limit = 200 + 2 * idle.worst;
  console.log(`  gigue au repos ${Math.round(idle.worst)} ms, seuil ${Math.round(limit)} ms`);

  // Mot de passe réel : 600 000 itérations (c'est elles qui bloquaient 2 à 3 s).
  const exported = await worstLag(() => B.createBackup(PW));
  assert.equal(exported.result.manifest.counts.records, 20_000);
  console.log(`  export : retard maximal de la boucle ${Math.round(exported.worst)} ms`);
  assert.ok(exported.worst < limit, `export : la boucle d'événements a été bloquée ${Math.round(exported.worst)} ms`);

  const restored = await worstLag(async () => {
    const opened = await Rs.openBackupAsync(exported.result.buffer, PW);
    assert.equal(opened.ok, true);
    const again = await Rs.parseBackupAsync(opened.plain);
    assert.equal(again.ok, true);
    return opened;
  });
  console.log(`  lecture pour restauration : retard maximal ${Math.round(restored.worst)} ms`);
  assert.ok(restored.worst < limit, `restauration (lecture) : la boucle d'événements a été bloquée ${Math.round(restored.worst)} ms`);
  assert.equal(restored.result.backup.data.records.length, 20_000);

  await db.prisma.moduleRecord.deleteMany();
  const applied = await worstLag(() => Rs.applyRestore(restored.result.backup, { confirmCustom: [], actor: "o" }));
  console.log(`  écriture de la restauration : retard maximal ${Math.round(applied.worst)} ms`);
  assert.equal(applied.result.ok, true);
  assert.equal(await db.prisma.moduleRecord.count(), 20_000);
  assert.ok(applied.worst < limit, `restauration (écriture) : la boucle d'événements a été bloquée ${Math.round(applied.worst)} ms`);
});

test("la mesure est valable : la dérivation de clé SYNCHRONE (ancien code) retarde bien un minuteur de plus de 50 ms", async () => {
  const plain = Buffer.from("x".repeat(1000));
  const lag = await worstLag(async () => { await new Promise((r) => setTimeout(r, 20)); C.encryptBackup(plain, PW); await new Promise((r) => setTimeout(r, 20)); });
  assert.ok(lag.worst > 50, `retard mesuré ${Math.round(lag.worst)} ms`);
  const fine = await worstLag(() => C.encryptBackupAsync(plain, PW));
  assert.ok(fine.worst < 100, `asynchrone : ${Math.round(fine.worst)} ms`);
});
