// Fiche d'une extension : lecture directe (HTTPS) d'abord, copie sur disque qui survit au redémarrage, clonage seulement en dernier recours.
// Le réseau est simulé (un faux « raw.githubusercontent.com » avec latence) et un faux « git » espionne chaque appel : on prouve ce qui part sur le réseau
// et ce qui ne part PAS. Les durées sont comparées entre elles, jamais à un chiffre absolu.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-gitshim-")); // effacé dans after() // tmp-ok
const real = ["/usr/bin/git", "/bin/git", "/usr/local/bin/git"].find((p) => fs.existsSync(p));
// Espion : chaque appel de git est noté ; `map` redirige une adresse https vers un dépôt local (sans quoi le « dernier recours » irait sur le vrai réseau).
fs.writeFileSync(path.join(shimDir, "git"), `#!/bin/sh
if [ -s "${shimDir}/map" ]; then read from to < "${shimDir}/map"; export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$to.insteadOf" GIT_CONFIG_VALUE_0="$from"; fi
echo "$*" >> "${shimDir}/log"
exec ${real} "$@"
`, { mode: 0o755 });
process.env.PATH = `${shimDir}:${process.env.PATH}`;
const gitCalls = () => (fs.existsSync(path.join(shimDir, "log")) ? fs.readFileSync(path.join(shimDir, "log"), "utf8").split("\n").filter(Boolean) : []);
const clones = () => gitCalls().filter((l) => /(^| )(clone|fetch)( |$)/.test(l));
const resetGit = () => fs.rmSync(path.join(shimDir, "log"), { force: true });
const mapRepo = (from, dir) => fs.writeFileSync(path.join(shimDir, "map"), `${from} file://${dir}`);
// Par défaut le « dernier recours » mène à un dépôt qui n'existe pas (il échoue vite) : jamais le vrai réseau.
const unmapRepo = () => fs.writeFileSync(path.join(shimDir, "map"), "https://github.com/acme/extras file:///inexistant/depot");

const { default: test, beforeEach, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { useTestDb } = await import("../helpers/db.mjs");
const { makeRepo } = await import("../helpers/repo.mjs");
const zlib = await import("node:zlib");

const db = await useTestDb();
const R = await import("@/core/modules/readme");
const RAW = await import("@/core/modules/rawRead");
const CACHE = await import("@/core/modules/ficheCache");
const REC = await import("@/core/modules/recognized");

const REPO = "https://github.com/acme/extras";
const bad = []; // violations vues par le faux réseau (une assertion levée dans fetch serait avalée par le client)
beforeEach(async () => {
  await db.reset(); R.clearPreviewCache(); REC.clearRecognizedCache(); resetGit(); unmapRepo(); bad.length = 0; RAW.rawStats.requests = 0;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  delete process.env.CURIOSA_CATALOGUE_REPO; delete process.env.CURIOSA_CATALOGUE_REF; delete process.env.MODULES_INDEX_URL;
});
after(() => { RAW.setRawFetch(null); db.close(); fs.rmSync(shimDir, { recursive: true, force: true }); });

function png(w, h) {
  const crc = (b) => { let c, n, t = []; for (n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk("IEND", Buffer.alloc(0))]);
}
const decl = (file, n) => ({ file, caption: { fr: `Légende ${n}`, en: `Caption ${n}` }, alt: { fr: `Image ${n}`, en: `Picture ${n}` }, type: "admin" });
const base = { apiVersion: 2, id: "demo", name: "Démo", version: "1.2.0", license: "MIT", author: "Ada", permissions: ["storage"] };
const manifest = (n) => ({ ...base, previews: Array.from({ length: n }, (_, i) => decl(`previews/s${i}.png`, i)) });

/** Les fichiers d'un dépôt à une étiquette, sous le chemin que raw.githubusercontent.com leur donne. */
function repoFiles(ref, { images = 2, readme = "# Démo", other = true, version = "1.2.0" } = {}) {
  const f = { [`acme/extras/${ref}/modules/demo/module.json`]: { ...manifest(images), version } };
  if (readme !== null) f[`acme/extras/${ref}/modules/demo/README.md`] = readme;
  for (let i = 0; i < images; i++) f[`acme/extras/${ref}/modules/demo/previews/s${i}.png`] = png(300 + i, 260);
  if (other) { f[`acme/extras/${ref}/modules/autre/module.json`] = { ...base, id: "autre" }; f[`acme/extras/${ref}/modules/autre/README.md`] = "# Autre"; f[`acme/extras/${ref}/modules/autre/index.mjs`] = "export default {}"; }
  return f;
}

/** Faux raw.githubusercontent.com : journal des adresses, latence, pannes à la demande. */
function fakeRaw(files, { delay = 0, fail = null } = {}) {
  const log = [];
  const stats = { active: 0, peak: 0 };
  const impl = async (url, init = {}) => {
    log.push(url); stats.active++; stats.peak = Math.max(stats.peak, stats.active);
    try { return await serve(url, init); } finally { stats.active--; }
  };
  const serve = async (url, init) => {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "raw.githubusercontent.com") bad.push(`hôte non autorisé : ${url}`);
    if (init.redirect !== "manual") bad.push("redirections suivies");
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const f = fail?.(url);
    if (f instanceof Error) throw f;
    if (f) return f;
    const body = files[u.pathname.slice(1)];
    if (body === undefined) return new Response("Not Found", { status: 404 });
    const buf = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
    return new Response(buf, { status: 200, headers: { "content-length": String(buf.length) } });
  };
  RAW.setRawFetch(impl);
  return { log, files, stats };
}
const target = (ref = "v1.2.0", version = "1.2.0") => ({ kind: "repo", url: REPO, ref, subdir: "modules/demo", version });
const restart = () => R.resetPreviewMemory(); // le site redémarre : la mémoire est perdue, le disque reste
const cacheFiles = () => {
  const out = [];
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { if (e.isDirectory()) walk(path.join(d, e.name)); else out.push(path.relative(CACHE.root(), path.join(d, e.name))); } };
  walk(CACHE.root());
  return out;
};

test("fiche à froid : lecture directe, une requête par fichier, AUCUN git ; manifeste, README et images lus et validés", async () => {
  const net = fakeRaw(repoFiles("v1.2.0"));
  const p = await R.getModulePreview(target());
  assert.equal(p.readme, "# Démo");
  assert.equal(p.manifest.version, "1.2.0");
  const images = await R.getPreviewImages(target());
  assert.deepEqual(images.map((i) => [i.index, i.mime, i.width]), [[0, "image/png", 300], [1, "image/png", 301]]);
  assert.deepEqual(gitCalls(), [], "aucun appel à git quand le réseau direct répond");
  assert.equal(net.log.length, 4, "module.json + README.md + 2 images");
  assert.ok(net.log.includes("https://raw.githubusercontent.com/acme/extras/v1.2.0/modules/demo/module.json"));
  assert.deepEqual(bad, []);
  const tmp = path.join(process.env.DATA_DIR, "tmp");
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp) : [], [], "aucun dossier de clonage");
});

test("la copie sur disque ne contient QUE les fichiers de la fiche : aucun autre module, aucun code, aucun .git", async () => {
  const net = fakeRaw(repoFiles("v1.2.0"));
  await R.getModulePreview(target());
  await R.getPreviewImages(target());
  const files = cacheFiles();
  assert.equal(files.length, 4);
  assert.deepEqual(files.map((f) => path.basename(f)).sort(), ["README.md", "module.json", "previews__s0.png", "previews__s1.png"]);
  assert.ok(!files.some((f) => /autre|index\.mjs|\.git/.test(f)), "rien d'un autre module ni du code");
  assert.ok(!net.log.some((u) => /autre|index\.mjs/.test(u)), "rien d'un autre module n'est demandé");
  assert.equal(new Set(files.map((f) => f.split(path.sep).slice(0, 2).join("/"))).size, 1, "un seul dossier de fiche");
});

test("après un redémarrage, la même version ne fait AUCUN appel (ni réseau ni git), texte comme images", async () => {
  const net = fakeRaw(repoFiles("v1.2.0"));
  await R.getModulePreview(target()); await R.getPreviewImages(target());
  restart();
  net.log.length = 0; resetGit(); RAW.rawStats.requests = 0;
  RAW.setRawFetch(async () => { throw new Error("le réseau ne doit pas être touché"); });
  const p = await R.getModulePreview(target());
  assert.equal(p.readme, "# Démo");
  assert.equal((await R.getPreviewImages(target())).length, 2);
  assert.equal(RAW.rawStats.requests, 0, "aucune requête partie");
  assert.deepEqual(gitCalls(), []);
  // Même après des mois : une version immuable n'expire pas.
  const old = new Date(Date.now() - 90 * 86400_000);
  for (const f of cacheFiles()) fs.utimesSync(path.join(CACHE.root(), f), old, old);
  restart();
  assert.equal((await R.getModulePreview(target())).readme, "# Démo");
});

test("nouvelle version du catalogue : la fiche est relue, et la plus ancienne version est effacée (deux gardées au plus)", async () => {
  const net = fakeRaw({ ...repoFiles("v1.0.0", { readme: "un", version: "1.0.0" }), ...repoFiles("v1.1.0", { readme: "deux", version: "1.1.0" }), ...repoFiles("v1.2.0", { readme: "trois" }) });
  assert.equal((await R.getModulePreview(target("v1.0.0", "1.0.0"))).readme, "un");
  assert.equal((await R.getModulePreview(target("v1.1.0", "1.1.0"))).readme, "deux");
  assert.equal(new Set(cacheFiles().map((f) => f.split(path.sep)[1])).size, 2, "deux versions gardées");
  net.log.length = 0;
  assert.equal((await R.getModulePreview(target("v1.2.0", "1.2.0"))).readme, "trois");
  assert.ok(net.log.length >= 2, "la nouvelle version est lue sur le réseau");
  const dirs = [...new Set(cacheFiles().map((f) => f.split(path.sep)[1]))];
  assert.equal(dirs.length, 2);
  assert.ok(!dirs.some((d) => d.startsWith("v1.0.0")), "v1.0.0 a été supprimée");
  restart(); net.log.length = 0;
  assert.equal((await R.getModulePreview(target("v1.1.0", "1.1.0"))).readme, "deux");
  assert.equal(net.log.length, 0, "la version précédente reste servie sans réseau");
});

test("sans version immuable (branche, dépôt personnel) : 10 minutes sans réseau, puis la copie ancienne est servie TOUT DE SUITE et relue en coulisse", async () => {
  const files = repoFiles("main", { readme: "v1" });
  const net = fakeRaw(files);
  const t = { kind: "repo", url: REPO, subdir: "modules/demo" };
  const mut = { ...t, ref: "main" };
  assert.equal((await R.getModulePreview(mut)).readme, "v1");
  await R.getPreviewImages(mut);
  restart(); net.log.length = 0;
  assert.equal((await R.getModulePreview(mut)).readme, "v1");
  assert.equal(net.log.length, 0, "copie récente : pas de réseau");
  // La copie vieillit ; le réseau est très lent : l'affichage n'attend pas.
  const old = new Date(Date.now() - 11 * 60_000);
  for (const f of cacheFiles()) fs.utimesSync(path.join(CACHE.root(), f), old, old);
  files["acme/extras/main/modules/demo/README.md"] = "v2";
  restart();
  const slow = fakeRaw(files, { delay: 400 });
  const t0 = Date.now();
  assert.equal((await R.getModulePreview(mut)).readme, "v1", "copie ancienne affichée tout de suite");
  assert.ok(Date.now() - t0 < 300, `sans attendre le réseau (${Date.now() - t0} ms)`);
  await new Promise((r) => setTimeout(r, 1600));
  assert.ok(slow.log.length >= 2, "relue en coulisse");
  restart();
  assert.equal((await R.getModulePreview(mut)).readme, "v2", "la copie a été renouvelée");
  assert.deepEqual(gitCalls(), [], "jamais de clonage pour rafraîchir");
});

test("réseau en panne et copie ancienne : la copie est servie, aucune erreur, jamais de clonage", async () => {
  fakeRaw(repoFiles("main", { readme: "v1" }));
  const mut = { kind: "repo", url: REPO, ref: "main", subdir: "modules/demo" };
  await R.getModulePreview(mut); await R.getPreviewImages(mut);
  const old = new Date(Date.now() - 3 * 86400_000);
  for (const f of cacheFiles()) fs.utimesSync(path.join(CACHE.root(), f), old, old);
  restart();
  fakeRaw({}, { fail: () => new TypeError("fetch failed") });
  assert.equal((await R.getModulePreview(mut)).readme, "v1");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(gitCalls(), []);
  assert.equal((await R.getModulePreview(mut)).readme, "v1", "la copie reste en place");
});

test("DERNIER RECOURS : le réseau direct échoue → UN seul clonage temporaire, limité au module, effacé aussitôt ; le résultat est gardé pour la suite", async () => {
  const repo = makeRepo({
    "modules/demo/module.json": manifest(1), "modules/demo/README.md": "# Par git", "modules/demo/previews/s0.png": png(300, 260), "modules/demo/index.mjs": "export default {};",
    "modules/autre/module.json": { ...base, id: "autre" }, "modules/autre/README.md": "# Autre", "modules/autre/gros.bin": Buffer.alloc(50_000, 1),
  });
  repo.g("tag", "v1.2.0");
  mapRepo(REPO, repo.dir);
  const net = fakeRaw({}, { fail: () => new TypeError("fetch failed") });
  resetGit();
  const p = await R.getModulePreview(target());
  const images = await R.getPreviewImages(target());
  assert.equal(p.readme, "# Par git");
  assert.equal(images.length, 1);
  assert.equal(clones().length, 1, `un seul clonage : ${clones().join(" | ")}`);
  const cl = clones()[0];
  assert.match(cl, /--depth 1/); assert.match(cl, /--filter=blob:none/); assert.match(cl, /--no-checkout/);
  assert.ok(gitCalls().some((l) => /sparse-checkout set --no-cone \/modules\/demo\//.test(l)), "limité au dossier du module");
  assert.ok(!gitCalls().some((l) => /autre|gros\.bin/.test(l)), "aucun autre module n'est lu");
  assert.equal(net.log.length >= 1, true);
  const tmp = path.join(process.env.DATA_DIR, "tmp");
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp) : [], [], "clonage effacé");
  assert.ok(!cacheFiles().some((f) => /\.git|autre|index\.mjs|gros/.test(f)), "la copie ne contient que la fiche");
  // Suite : plus de git, plus de réseau.
  restart(); resetGit(); net.log.length = 0;
  assert.equal((await R.getModulePreview(target())).readme, "# Par git");
  assert.equal((await R.getPreviewImages(target())).length, 1);
  assert.deepEqual([gitCalls(), net.log], [[], []]);
});

test("un dépôt qui n'est pas sur GitHub : aucune requête directe, un seul clonage de secours", async () => {
  const repo = makeRepo({ "module.json": base, "README.md": "# Ailleurs" });
  mapRepo("https://gitlab.com/acme/extras", repo.dir);
  const net = fakeRaw({});
  resetGit();
  assert.equal((await R.getModulePreview({ kind: "repo", url: "https://gitlab.com/acme/extras" })).readme, "# Ailleurs");
  assert.equal(net.log.length, 0);
  assert.equal(clones().length, 1);
});

test("quand le réseau direct répond, même pour un fichier absent (404), git n'est JAMAIS lancé", async () => {
  const net = fakeRaw(repoFiles("v1.2.0", { readme: null, images: 1 }));
  const p = await R.getModulePreview(target());
  assert.equal(p.readme, null);
  assert.ok(p.manifest);
  assert.ok(net.log.some((u) => u.endsWith("/readme.md")), "readme.md essayé quand README.md n'existe pas");
  restart();
  assert.equal((await R.getModulePreview(target())).readme, null);
  assert.deepEqual(gitCalls(), []);
});

test("limite de débit (429 + Retry-After) : message clair, jamais gardé, pas d'acharnement ; le clonage prend le relais s'il peut", async () => {
  const limited = () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
  const net = fakeRaw(repoFiles("v1.2.0"), { fail: () => limited() });
  await assert.rejects(R.getModulePreview(target()), (e) => e instanceof R.PreviewFailure && e.reason === "rate-limit" && e.retryAfterSec === 120);
  const afterFirst = net.log.length;
  assert.ok(afterFirst <= 2, `pas de nouvel essai sur un refus de débit (${afterFirst} requêtes)`);
  assert.deepEqual(cacheFiles(), [], "l'erreur n'est pas gardée");
  // Pendant l'attente demandée, plus aucune requête n'est envoyée.
  await assert.rejects(R.getModulePreview(target()), (e) => e instanceof R.PreviewFailure);
  assert.equal(net.log.length, afterFirst, "aucune requête pendant le délai demandé par GitHub");
  // Le clonage de secours, lui, n'est pas concerné par cette limite.
  const repo = makeRepo({ "modules/demo/module.json": manifest(0), "modules/demo/README.md": "# Secours" });
  repo.g("tag", "v1.2.0"); mapRepo(REPO, repo.dir); resetGit();
  assert.equal((await R.getModulePreview(target())).readme, "# Secours");
  assert.equal(clones().length, 1);
  // 403 avec X-RateLimit-Remaining: 0 : même traitement ; 403 sans en-tête : simple refus.
  R.clearPreviewCache(); unmapRepo();
  fakeRaw({}, { fail: () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 30) } }) });
  await assert.rejects(R.getModulePreview(target()), (e) => e instanceof R.PreviewFailure && e.reason === "rate-limit");
  R.clearPreviewCache();
  fakeRaw({}, { fail: () => new TypeError("getaddrinfo ENOTFOUND") });
  await assert.rejects(R.getModulePreview(target()), (e) => e instanceof R.PreviewFailure && e.reason === "network");
  assert.deepEqual(cacheFiles(), [], "aucune erreur gardée en copie");
});

test("panne passagère : deux essais, la fiche s'affiche sans clonage", async () => {
  let n = 0;
  const net = fakeRaw(repoFiles("v1.2.0", { images: 0 }), { fail: (u) => (u.endsWith("module.json") && n++ === 0 ? new TypeError("fetch failed") : null) });
  assert.equal((await R.getModulePreview(target())).readme, "# Démo");
  assert.deepEqual(gitCalls(), []);
  assert.ok(net.log.length >= 3);
});

test("une redirection n'est jamais suivie (hôte non maîtrisé) : elle compte comme un échec", async () => {
  const net = fakeRaw({}, { fail: () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }) });
  await assert.rejects(R.getModulePreview(target()), (e) => !(e instanceof R.PreviewTimeout));
  assert.ok(net.log.every((u) => u.startsWith("https://raw.githubusercontent.com/")));
  assert.deepEqual(bad, []);
});

test("une demande, une requête : plusieurs lectures en même temps du même module ne partent qu'une fois", async () => {
  const net = fakeRaw(repoFiles("v1.2.0"), { delay: 60 });
  await Promise.all([R.getModulePreview(target()), R.getModulePreview(target()), R.getPreviewImages(target()), R.getPreviewImages(target()), R.getModulePreview(target())]);
  assert.equal(net.log.length, 4);
  assert.equal(new Set(net.log).size, 4, "chaque adresse une seule fois");
});

test("au plus 8 requêtes par fiche, 4 lectures en même temps", async () => {
  const net = fakeRaw(repoFiles("v1.2.0", { readme: null, images: 6 }), { delay: 40 });
  await R.getModulePreview(target()); await R.getPreviewImages(target());
  assert.equal(net.log.length, RAW.MAX_REQUESTS_PER_FICHE, `${net.log.length} requêtes`);
  assert.ok(net.stats.peak >= 2 && net.stats.peak <= 4, `pic de ${net.stats.peak} requêtes en même temps`);
  R.clearPreviewCache();
  const five = fakeRaw(repoFiles("v1.2.0", { readme: null, images: 5 }));
  await R.getModulePreview(target()); await R.getPreviewImages(target());
  assert.equal(five.log.length, 8, "5 visuels + manifeste + README.md + readme.md");
});

test("octets des images : type RÉEL, poids et dimensions revérifiés ; un faux ou trop gros n'est ni servi ni gardé", async () => {
  const files = repoFiles("v1.2.0", { images: 3 });
  files["acme/extras/v1.2.0/modules/demo/previews/s0.png"] = Buffer.from("<html>pas une image</html>");
  files["acme/extras/v1.2.0/modules/demo/previews/s1.png"] = Buffer.concat([png(300, 260), Buffer.alloc(160 * 1024)]);
  fakeRaw(files);
  await R.getModulePreview(target());
  const images = await R.getPreviewImages(target());
  assert.deepEqual(images.map((i) => i.index), [2], "seule la vraie image est servie");
  assert.ok(!cacheFiles().some((f) => /s0\.png$|s1\.png$/.test(f)), "ni le faux ni le trop gros ne sont gardés");
  // Une copie abîmée sur disque est revérifiée à la relecture.
  const kept = cacheFiles().find((f) => /s2\.png$/.test(f));
  fs.writeFileSync(path.join(CACHE.root(), kept), Buffer.from("corrompu"));
  restart();
  RAW.setRawFetch(async () => { throw new TypeError("hors ligne"); });
  assert.deepEqual(await R.getPreviewImages(target()), [], "octets corrompus : écartés");
});

test("« Actualiser » vide aussi la copie sur disque", async () => {
  const net = fakeRaw(repoFiles("v1.2.0"));
  await R.getModulePreview(target()); await R.getPreviewImages(target());
  assert.ok(cacheFiles().length > 0);
  R.clearPreviewCache();
  assert.deepEqual(cacheFiles(), []);
  fakeRaw(repoFiles("v1.2.0"));
  await R.getModulePreview(target());
  assert.ok(cacheFiles().length > 0, "relue sur le réseau");
  void net;
});

test("bornes de la copie : 200 fiches, 50 Mo, nettoyage à l'écriture, le plus ancien d'abord", async () => {
  fakeRaw({});
  const k = (i) => CACHE.ficheKey({ url: `${REPO}-${i}`, ref: "v1.0.0", version: "1.0.0", subdir: "modules/m" });
  for (let i = 0; i < 205; i++) { CACHE.writeEntry(k(i), "module.json", Buffer.from("{}")); CACHE.writeEntry(k(i), "README.md", Buffer.from("x")); const t = new Date(Date.now() - (300 - i) * 1000); fs.utimesSync(path.join(CACHE.root(), k(i).moduleDir, k(i).versionDir), t, t); }
  const dirs = fs.readdirSync(CACHE.root()).flatMap((m) => fs.readdirSync(path.join(CACHE.root(), m)));
  assert.ok(dirs.length <= CACHE.FICHE_CACHE_LIMITS.fiches, `${dirs.length} fiches`);
  assert.equal(CACHE.readEntry(k(0), "README.md", 100), null, "la plus ancienne est partie");
  assert.ok(CACHE.readEntry(k(204), "README.md", 100), "la plus récente reste");
  // Poids : un dossier trop lourd chasse les plus anciens.
  CACHE.writeEntry(k(300), "big.bin", Buffer.alloc(CACHE.FICHE_CACHE_LIMITS.bytes - 100));
  CACHE.writeEntry(k(301), "big.bin", Buffer.alloc(2000));
  const total = cacheFiles().reduce((n, f) => n + fs.statSync(path.join(CACHE.root(), f)).size, 0);
  assert.ok(total <= CACHE.FICHE_CACHE_LIMITS.bytes, `${total} octets`);
});

test("adresses : seul raw.githubusercontent.com, jamais d'adresse venue de la demande, chemins validés", () => {
  assert.equal(RAW.rawBase(REPO, "v1.2.0"), "https://raw.githubusercontent.com/acme/extras/v1.2.0");
  assert.equal(RAW.rawBase(`${REPO}.git`), "https://raw.githubusercontent.com/acme/extras/HEAD");
  assert.equal(RAW.rawBase("https://github.com/acme/extras", "feature/x"), "https://raw.githubusercontent.com/acme/extras/feature/x");
  for (const u of ["https://gitlab.com/a/b", "http://github.com/a/b", "https://evil.example/a/b", "https://github.com.evil.example/a/b", "https://user:pw@github.com/a/b", "https://github.com:444/a/b", "https://github.com/a/b?x=1", "https://github.com/a", "file:///tmp/x", "https://github.com/a/b/tree/main/x"]) assert.equal(RAW.rawBase(u), null, u);
  for (const ref of ["../x", "a/../b", "a b", "x?y"]) assert.equal(RAW.rawBase(REPO, ref), null, ref);
  const b = RAW.rawBase(REPO, "v1");
  assert.equal(RAW.rawFileUrl(b, "modules/demo", "module.json"), `${b}/modules/demo/module.json`);
  assert.equal(RAW.rawFileUrl(b, "modules/demo", "previews/a.webp"), `${b}/modules/demo/previews/a.webp`);
  for (const [sub, file] of [["../x", "module.json"], ["modules/demo", "../../etc/passwd"], ["modules/demo", "a/b/c"], ["modules/demo", "/abs"], ["modules/demo", "a?b"]]) assert.equal(RAW.rawFileUrl(b, sub, file), null, `${sub} ${file}`);
});

test("rawGet refuse toute adresse hors de l'hôte autorisé", async () => {
  const net = fakeRaw({});
  for (const u of ["https://evil.example/x", "http://raw.githubusercontent.com/x", "https://raw.githubusercontent.com.evil.example/x", "https://u:p@raw.githubusercontent.com/x"]) await assert.rejects(RAW.rawGet(u, 100), (e) => e instanceof RAW.RawError, u);
  assert.equal(net.log.length, 0, "rien n'est parti");
});

test("latence : la fiche à froid coûte un aller-retour pour le texte (pas deux), puis zéro une fois en copie", async () => {
  const rtt = 120;
  fakeRaw(repoFiles("v1.2.0", { images: 4 }), { delay: rtt });
  const t0 = Date.now();
  await R.getModulePreview(target());
  const text = Date.now() - t0;
  assert.ok(text < rtt * 2 - 10, `texte en parallèle : ${text} ms pour un aller-retour de ${rtt} ms`);
  await R.getPreviewImages(target());
  const all = Date.now() - t0;
  assert.ok(all < rtt * 3 - 20, `images en parallèle : ${all} ms au total`);
  restart();
  const t1 = Date.now();
  await R.getModulePreview(target()); await R.getPreviewImages(target());
  assert.ok(Date.now() - t1 < 80, `copie : ${Date.now() - t1} ms`);
});

test("l'index du catalogue se lit lui aussi en direct (git en dernier recours seulement)", async () => {
  process.env.CURIOSA_CATALOGUE_REPO = REPO;
  const entry = { id: "demo", name: "Démo", description: "d", repo: REPO, ref: "v1.2.0", subdir: "modules/demo", version: "1.2.0" };
  const net = fakeRaw({ "acme/extras/HEAD/catalogue/index.json": [entry], "acme/extras/HEAD/catalogue/suggested.json": ["demo"] });
  const r = await REC.getRecognizedDetailed();
  assert.deepEqual([r.source, r.items.map((i) => i.id), r.suggested], ["repository", ["demo"], ["demo"]]);
  assert.equal(net.log.length, 2);
  assert.deepEqual(gitCalls(), []);
  // Panne directe : git prend le relais (une seule fois).
  REC.clearRecognizedCache();
  const repo = makeRepo({ "catalogue/index.json": [{ ...entry, id: "autre" }], "catalogue/suggested.json": [] });
  mapRepo(REPO, repo.dir);
  fakeRaw({}, { fail: () => new TypeError("fetch failed") });
  resetGit();
  const r2 = await REC.getRecognizedDetailed();
  assert.deepEqual(r2.items.map((i) => i.id), ["autre"]);
  assert.equal(clones().length, 1);
  // Au redémarrage, la dernière copie reçue est servie tout de suite pour une fiche, pendant que l'index est relu.
  REC.clearRecognizedCache(); unmapRepo();
  const slow = fakeRaw({ "acme/extras/HEAD/catalogue/index.json": [entry] }, { delay: 300 });
  const t0 = Date.now();
  const stale = await REC.getRecognizedDetailed({ staleOk: true });
  assert.ok(Date.now() - t0 < 200, "la copie reçue est servie sans attendre le réseau");
  assert.deepEqual(stale.items.map((i) => i.id), ["autre"]);
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(slow.log.length >= 1, "relu en coulisse");
});
