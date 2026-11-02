// Fiche d'une extension : la lecture du dépôt ne fait plus attendre. Un faux « git » ajoute une attente réseau à chaque appel (clone, lecture d'un fichier) et note qui travaille quand :
// on vérifie ce qui compte pour la personne (le texte arrive avant les images, une seule lecture par module, un plafond de lectures, une attente bornée, une erreur qui se relit)
// sans dépendre de la vitesse de la machine (les durées sont comparées entre elles, jamais à un chiffre absolu).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-gitshim-")); // effacé dans after() // tmp-ok
const real = ["/usr/bin/git", "/bin/git", "/usr/local/bin/git"].find((p) => fs.existsSync(p));
fs.writeFileSync(path.join(shimDir, "git"), `#!/bin/sh
d=$(cat "${shimDir}/delay" 2>/dev/null || echo 0)
case " $* " in *" clone "*|*" show "*|*" cat-file "*|*" fetch "*) echo "S $(date +%s%N) $*" >> "${shimDir}/log"; sleep $(awk "BEGIN{print $d/1000}"); ${real} "$@"; rc=$?; echo "E $(date +%s%N) $*" >> "${shimDir}/log"; exit $rc;; esac
exec ${real} "$@"
`, { mode: 0o755 });
process.env.PATH = `${shimDir}:${process.env.PATH}`;
const delay = (ms) => fs.writeFileSync(path.join(shimDir, "delay"), String(ms));
const calls = () => (fs.existsSync(path.join(shimDir, "log")) ? fs.readFileSync(path.join(shimDir, "log"), "utf8").split("\n").filter(Boolean) : []);
const reset = () => fs.rmSync(path.join(shimDir, "log"), { force: true });

const { default: test, beforeEach, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { useTestDb } = await import("../helpers/db.mjs");
const { makeRepo } = await import("../helpers/repo.mjs");
const { makeTempDir } = await import("../helpers/tmp.mjs");
const zlib = await import("node:zlib");

const db = await useTestDb();
const R = await import("@/core/modules/readme");
beforeEach(async () => { await db.reset(); R.clearPreviewCache(); reset(); delay(0); process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1"; });
after(() => { db.close(); fs.rmSync(shimDir, { recursive: true, force: true }); });

function png(w, h) {
  const crc = (b) => { let c, n, t = []; for (n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const decl = (file, n) => ({ file, caption: { fr: `Légende ${n}`, en: `Caption ${n}` }, alt: { fr: `Image ${n}`, en: `Picture ${n}` }, type: "admin" });
const base = { apiVersion: 2, id: "demo-mod", name: "Démo", version: "1.0.0", license: "MIT", author: "Ada", permissions: ["storage"] };
const withImages = (n = 4) => makeRepo({
  "module.json": { ...base, previews: Array.from({ length: n }, (_, i) => decl(`previews/s${i}.png`, i)) }, "README.md": "# Démo",
  ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`previews/s${i}.png`, png(300 + i, 260)])),
});
const target = (repo) => ({ kind: "repo", url: repo.url });
const stamp = (line) => Number(line.split(" ")[1]);

test("le texte de la fiche arrive AVANT les images, qui se lisent ensuite toutes ensemble", async () => {
  const repo = withImages(4);
  delay(150);
  const t0 = Date.now();
  const preview = await R.getModulePreview(target(repo));
  const textMs = Date.now() - t0;
  assert.equal(preview.readme, "# Démo");
  assert.ok(preview.manifest, "le manifeste est lu");
  assert.equal("images" in preview, false, "la fiche ne porte plus les octets des images");
  const images = await R.getPreviewImages(target(repo));
  const allMs = Date.now() - t0;
  assert.equal(images.length, 4);
  assert.ok(allMs > textMs, "les images arrivent après le texte");
  // 4 images lues l'une après l'autre coûteraient 4 attentes de plus ; en parallèle, à peu près une.
  assert.ok(allMs - textMs < 3 * 150 + 400, `images en parallèle (${allMs - textMs} ms après le texte)`);
  const tmp = path.join(process.env.DATA_DIR, "tmp");
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => f.startsWith("preview-")) : [], [], "dossier temporaire effacé quand les images sont lues");
});

test("le manifeste et le README se lisent en même temps (pas l'un après l'autre)", async () => {
  const repo = makeRepo({ "module.json": base, "README.md": "# Démo" });
  delay(200);
  await R.getModulePreview(target(repo));
  const shows = calls().filter((l) => l.startsWith("S") && / show /.test(l)).map(stamp);
  assert.equal(shows.length, 2);
  assert.ok(Math.abs(shows[0] - shows[1]) < 150e6, "les deux lectures démarrent presque ensemble");
});

test("cache : une seconde ouverture ne relit rien ; trois demandes en même temps ne lisent le dépôt qu'une fois", async () => {
  const repo = withImages(2);
  delay(50);
  await Promise.all([R.getModulePreview(target(repo)), R.getModulePreview(target(repo)), R.getPreviewImages(target(repo))]);
  const clones = calls().filter((l) => l.startsWith("S") && / clone /.test(l)).length;
  assert.equal(clones, 1, "un seul clonage");
  reset();
  await R.getModulePreview(target(repo));
  await R.getPreviewImages(target(repo));
  assert.equal(calls().length, 0, "ouverture suivante : aucun appel à git");
  R.clearPreviewCache();
  await R.getModulePreview(target(repo));
  assert.ok(calls().some((l) => / clone /.test(l)), "« Actualiser » (clearPreviewCache) force une nouvelle lecture");
});

test("attente bornée : au-delà, PreviewTimeout ; la lecture continue et la tentative suivante est servie sans relire", async () => {
  const repo = makeRepo({ "module.json": base, "README.md": "# Lent" });
  delay(300);
  await assert.rejects(R.getModulePreview(target(repo), { waitMs: 100 }), (e) => e instanceof R.PreviewTimeout);
  const again = await R.getModulePreview(target(repo), { waitMs: 5000 });
  assert.equal(again.readme, "# Lent");
  assert.equal(calls().filter((l) => l.startsWith("S") && / clone /.test(l)).length, 1, "la tentative suivante reprend la lecture en cours");
});

test("échec : jamais gardé en mémoire (« Réessayer » relit vraiment) ; une adresse refusée est signalée tout de suite", async () => {
  const absent = path.join(makeTempDir("curiosa-depot-"), "absent");
  const url = "file://" + absent;
  await assert.rejects(R.getModulePreview({ kind: "repo", url }));
  const repo = makeRepo({ "module.json": base, "README.md": "# Enfin" });
  fs.renameSync(repo.dir, absent);
  assert.equal((await R.getModulePreview({ kind: "repo", url })).readme, "# Enfin", "le dépôt est apparu : la nouvelle tentative le lit");
  await assert.rejects(R.getModulePreview({ kind: "repo", url: "https://evil.example/o/r" }, { waitMs: 5000 }), /modules\.error\.host/);
});

test("plafond : au plus MAX_PARALLEL_READS clonages de secours en même temps (un seul)", async () => {
  const repos = Array.from({ length: 7 }, () => makeRepo({ "module.json": base, "README.md": "x" }));
  delay(120);
  await Promise.all(repos.map((r) => R.getModulePreview(target(r))));
  const events = calls().filter((l) => / clone /.test(l)).map((l) => [stamp(l), l[0] === "S" ? 1 : -1]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, peak = 0;
  for (const [, d] of events) { now += d; peak = Math.max(peak, now); }
  assert.ok(peak <= R.MAX_PARALLEL_READS, `pic de ${peak} lectures`);
  assert.equal(R.MAX_PARALLEL_READS, 1);
  assert.equal(events.length, 14, "mais chaque dépôt est bien lu (7 clonages, début et fin)");
});

test("images : lecture seule des fichiers déclarés ; un fichier absent n'empêche ni la fiche ni les autres", async () => {
  const repo = makeRepo({ "module.json": { ...base, previews: [decl("previews/a.png", 1), decl("previews/absent.png", 2)] }, "previews/a.png": png(300, 260) });
  const images = await R.getPreviewImages(target(repo));
  assert.deepEqual(images.map((i) => i.index), [0]);
  assert.deepEqual(await R.getPreviewImages({ kind: "repo", url: "https://evil.example/o/r" }), [], "adresse refusée : liste vide, jamais d'erreur");
});
