import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { createTarGz, readTarGz, isSafeArchivePath } = await import("@/core/backup/tar");
const { encryptBackup, decryptBackup, MIN_PASSWORD_LENGTH } = await import("@/core/backup/crypto");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-fmt-"));
const files = [
  { path: "README.txt", content: Buffer.from("Bonjour — lisible.\n", "utf8") },
  { path: "data/a.json", content: Buffer.from('{"é":"ü"}') },
  { path: "uploads/img.bin", content: Buffer.from([0, 1, 2, 255, 254, 0]) },
  { path: "vide.txt", content: Buffer.alloc(0) },
  { path: "gros.txt", content: Buffer.alloc(100_000, "x") },
];

test("chemins d'archive : relatifs, sans « .. », sans antislash ni octet nul", () => {
  for (const ok of ["a.txt", "dossier/sous/fichier.json", "é/ü.md"]) assert.ok(isSafeArchivePath(ok), ok);
  for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "./a", "a\\b", "a\0b", "a/", "x".repeat(300)]) assert.ok(!isSafeArchivePath(bad), JSON.stringify(bad));
});

test("tar.gz : écriture puis lecture identiques (accents, binaire, vide, gros fichier)", () => {
  const back = readTarGz(createTarGz(files));
  assert.deepEqual(back.map((f) => f.path), files.map((f) => f.path));
  for (const [i, f] of files.entries()) assert.ok(back[i].content.equals(f.content), f.path);
});

test("tar.gz : reproductible (mêmes fichiers → mêmes octets) et chemins longs gérés", () => {
  assert.ok(createTarGz(files).equals(createTarGz(files)));
  const long = `${"dossier-assez-long/".repeat(6)}fichier.md`;
  assert.ok(Buffer.byteLength(long) > 100);
  assert.equal(readTarGz(createTarGz([{ path: long, content: Buffer.from("x") }]))[0].path, long);
});

test("tar.gz : l'outil `tar` standard lit notre archive", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "a.tar.gz"), createTarGz(files));
  execFileSync("tar", ["xzf", "a.tar.gz"], { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, "README.txt"), "utf8"), "Bonjour — lisible.\n");
  assert.equal(fs.readFileSync(path.join(dir, "data", "a.json"), "utf8"), '{"é":"ü"}');
  assert.equal(fs.statSync(path.join(dir, "gros.txt")).size, 100_000);
  fs.rmSync(dir, { recursive: true });
});

test("tar.gz : notre lecteur lit une archive faite par `tar` (sans dépendre de notre écriture)", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "src", "sous"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "sous", "f.txt"), "contenu");
  fs.writeFileSync(path.join(dir, "src", "g.txt"), "autre");
  execFileSync("tar", ["czf", path.join(dir, "x.tar.gz"), "-C", path.join(dir, "src"), "g.txt", "sous/f.txt"]);
  const back = Object.fromEntries(readTarGz(fs.readFileSync(path.join(dir, "x.tar.gz"))).map((f) => [f.path, f.content.toString()]));
  assert.deepEqual(back, { "g.txt": "autre", "sous/f.txt": "contenu" });
  fs.rmSync(dir, { recursive: true });
});

test("tar.gz : écriture refuse les chemins dangereux et les doublons", () => {
  assert.throws(() => createTarGz([{ path: "../x", content: Buffer.alloc(0) }]), /refusé/);
  assert.throws(() => createTarGz([{ path: "a", content: Buffer.alloc(0) }, { path: "a", content: Buffer.alloc(0) }]), /double/);
});

test("tar.gz : lecture refuse chemins hostiles, liens, archives corrompues ou démesurées", () => {
  const dir = tmp();
  // archive hostile fabriquée avec tar : lien symbolique
  fs.writeFileSync(path.join(dir, "f"), "x");
  fs.symlinkSync("/etc/passwd", path.join(dir, "lien"));
  execFileSync("tar", ["czf", path.join(dir, "l.tar.gz"), "-C", dir, "lien"]);
  assert.throws(() => readTarGz(fs.readFileSync(path.join(dir, "l.tar.gz"))), /non pris en charge/);
  // chemin « .. » (--transform pour le fabriquer)
  execFileSync("tar", ["czf", path.join(dir, "d.tar.gz"), "-C", dir, "--transform", "s,^f$,../evil,", "f"]);
  assert.throws(() => readTarGz(fs.readFileSync(path.join(dir, "d.tar.gz"))), /refusé/);
  // corrompue
  const good = createTarGz([{ path: "a.txt", content: Buffer.from("x") }]);
  assert.throws(() => readTarGz(good.subarray(0, good.length - 20)));
  assert.throws(() => readTarGz(Buffer.from("pas une archive")));
  // démesurée (bombe)
  const bomb = createTarGz([{ path: "z.bin", content: Buffer.alloc(5_000_000) }]);
  assert.throws(() => readTarGz(bomb, { maxBytes: 1_000_000 }));
  assert.throws(() => readTarGz(createTarGz([{ path: "a", content: Buffer.alloc(1) }, { path: "b", content: Buffer.alloc(1) }]), { maxFiles: 1 }), /volumineuse/);
  fs.rmSync(dir, { recursive: true });
});

const PASSWORD = "un-mot-de-passe-solide";
const FAST = 1000; // itérations réduites pour les tests qui n'ont pas besoin de la vraie valeur

test("chiffrement : aller-retour, sel aléatoire, contenu illisible sans le mot de passe", () => {
  const plain = createTarGz(files);
  const a = encryptBackup(plain, PASSWORD, FAST), b = encryptBackup(plain, PASSWORD, FAST);
  assert.ok(!a.equals(b), "deux chiffrements du même contenu diffèrent (sel)");
  assert.ok(a.subarray(0, 8).equals(Buffer.from("Salted__")));
  assert.ok(!a.includes(Buffer.from("Bonjour")), "rien de lisible dans le fichier chiffré");
  const r = decryptBackup(a, PASSWORD, FAST);
  assert.ok(r.ok && r.plain.equals(plain));
});

test("chiffrement : mauvais mot de passe, fichier étranger ou tronqué → refus net, jamais de contenu", () => {
  const enc = encryptBackup(createTarGz(files), PASSWORD, FAST);
  for (const bad of ["un-autre-mot-de-passe", "", PASSWORD + " "]) assert.deepEqual(decryptBackup(enc, bad, FAST), { ok: false, error: "wrong-password" }, JSON.stringify(bad));
  assert.deepEqual(decryptBackup(Buffer.from("n'importe quoi, assez long pour passer la taille minimale"), PASSWORD, FAST), { ok: false, error: "not-a-backup" });
  assert.deepEqual(decryptBackup(Buffer.alloc(4), PASSWORD, FAST), { ok: false, error: "not-a-backup" });
  assert.equal(decryptBackup(enc.subarray(0, enc.length - 7), PASSWORD, FAST).ok, false);
});

test("chiffrement : mot de passe trop court refusé", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.throws(() => encryptBackup(Buffer.from("x"), "court", FAST), /password-too-short/);
});

test("LISIBLE SANS LE FRAMEWORK : `openssl enc -d` puis `tar xzf` retrouvent le contenu, avec la vraie valeur d'itérations", () => {
  const dir = tmp();
  const secret = "Mon texte confidentiel — dépenses 2026";
  const plain = createTarGz([{ path: "README.txt", content: Buffer.from("Lisez-moi\n") }, { path: "data/notes.md", content: Buffer.from(secret) }]);
  fs.writeFileSync(path.join(dir, "sauvegarde.tar.gz.enc"), encryptBackup(plain, PASSWORD));
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256", "-pass", `pass:${PASSWORD}`, "-in", path.join(dir, "sauvegarde.tar.gz.enc"), "-out", path.join(dir, "sauvegarde.tar.gz")]);
  execFileSync("tar", ["xzf", "sauvegarde.tar.gz"], { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, "data", "notes.md"), "utf8"), secret);
  assert.equal(fs.readFileSync(path.join(dir, "README.txt"), "utf8"), "Lisez-moi\n");
  fs.rmSync(dir, { recursive: true });
});

test("LISIBLE SANS LE FRAMEWORK : un fichier chiffré par `openssl enc` (sans nous) est déchiffré par nous", () => {
  const dir = tmp();
  const plain = createTarGz([{ path: "a.txt", content: Buffer.from("fait par openssl") }]);
  fs.writeFileSync(path.join(dir, "p.tar.gz"), plain);
  execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256", "-pass", `pass:${PASSWORD}`, "-in", path.join(dir, "p.tar.gz"), "-out", path.join(dir, "p.enc")]);
  const r = decryptBackup(fs.readFileSync(path.join(dir, "p.enc")), PASSWORD);
  assert.ok(r.ok);
  assert.equal(readTarGz(r.plain)[0].content.toString(), "fait par openssl");
  fs.rmSync(dir, { recursive: true });
});

test("documentation : la commande de déchiffrement affichée partout contient les vraies valeurs (itérations, algorithme)", async () => {
  const { KDF_ITERATIONS } = await import("@/core/backup/crypto");
  const { readmeText } = await import("@/core/backup/readme");
  const cmd = `openssl enc -d -aes-256-cbc -pbkdf2 -iter ${KDF_ITERATIONS} -md sha256`;
  assert.ok(readmeText({ siteName: "S", createdAt: "x", frameworkVersion: "1" }).includes(cmd), "README placé dans l'archive");
  assert.ok(fs.readFileSync("docs/BACKUP.md", "utf8").includes(cmd), "docs/BACKUP.md");
  assert.ok(fs.readFileSync("src/app/admin/(panel)/backup/page.tsx", "utf8").includes(cmd), "page d'admin");
  assert.ok(fs.readFileSync("src/core/backup/crypto.ts", "utf8").includes(cmd), "commentaire du code");
});
