// Visuels d'une extension (`previews` du manifeste) : schéma, vérification des images (type RÉEL, poids, dimensions, nombre), lecture dans un dépôt et dans un module
// installé, route de service (bornes), mémoire bornée. Le rendu de la fiche est dans tests/core/extension-fiche.test.mjs.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";
import { png, webp, padPng } from "../helpers/images.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/previews");
const { parseManifest } = await import("@/core/modules/manifest");
const R = await import("@/core/modules/readme");
const S = await import("@/core/modules/previewServe");
const { sanitizeEntries } = await import("@/core/modules/recognized");

beforeEach(async () => { await db.reset(); R.clearPreviewCache(); process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1"; });
after(() => db.close());

const decl = (file, over = {}) => ({ file, caption: { fr: "Votre page de commandes", en: "Your commands page" }, alt: { fr: "Liste de commandes de démonstration", en: "Sample list of commands" }, type: "public", ...over });
const base = { apiVersion: 2, id: "demo-mod", name: "Démo", version: "1.0.0" };
const parse = (previews) => parseManifest({ ...base, ...(previews === undefined ? {} : { previews }) });

/* ───────────── schéma du manifeste ───────────── */

test("manifeste : sans `previews` rien ne change ; avec, jusqu'à 6 visuels ; aucun `minCore` n'est exigé (un cœur plus ancien ignore la clé)", () => {
  const none = parse();
  assert.ok(none.ok);
  assert.equal(none.manifest.previews, undefined);
  const three = parse([decl("previews/a.webp"), decl("previews/b.png", { type: "admin" }), decl("previews/c.webp", { type: "overlay" })]);
  assert.ok(three.ok, three.error);
  assert.equal(three.manifest.previews.length, 3);
  assert.equal(three.manifest.minCore, undefined);
  assert.ok(parse(Array.from({ length: 6 }, (_, i) => decl(`previews/v${i}.webp`))).ok);
  assert.ok(!parse(Array.from({ length: 7 }, (_, i) => decl(`previews/v${i}.webp`))).ok, "7 visuels : refusé");
});

test("manifeste : légende ET texte alternatif obligatoires en français et en anglais ; type connu ; chemin dans previews/ en .webp ou .png ; pas de doublon", () => {
  assert.ok(!parse([decl("previews/a.webp", { alt: undefined })]).ok, "texte alternatif obligatoire");
  assert.ok(!parse([decl("previews/a.webp", { alt: { fr: "x", en: "  " } })]).ok, "texte alternatif vide");
  assert.ok(!parse([decl("previews/a.webp", { alt: "Une chaîne seule" })]).ok, "deux langues, pas un texte seul");
  assert.ok(!parse([decl("previews/a.webp", { caption: { fr: "Seulement en français" } })]).ok, "légende : anglais obligatoire");
  assert.ok(!parse([decl("previews/a.webp", { caption: { fr: "x".repeat(141), en: "y" } })]).ok, "légende de 140 caractères au plus");
  assert.ok(!parse([decl("previews/a.webp", { type: "mobile" })]).ok, "type inconnu");
  for (const bad of ["a.webp", "previews/A.webp", "previews/a.jpg", "previews/a.svg", "previews/../a.webp", "previews/sous/a.webp", "/previews/a.webp", "previews/.webp", `previews/${"x".repeat(70)}.webp`]) assert.ok(!parse([decl(bad)]).ok, `chemin refusé : ${bad}`);
  assert.match(parse([decl("previews/a.webp"), decl("previews/a.webp")]).error, /duplicate preview file/);
  assert.ok(parse([decl("previews/a.webp", { caption: { fr: "x", en: "y", de: "z" }, alt: { fr: "x", en: "y" } })]).ok, "d'autres langues sont permises en plus");
  assert.ok(parse([{ ...decl("previews/a.webp"), futur: 1 }]).ok, "une clé inconnue est ignorée (évolution sans casser)");
});

/* ───────────── images ───────────── */

test("image : le type RÉEL est lu dans les octets (PNG, WebP lossy / lossless / étendu), avec ses dimensions", () => {
  assert.deepEqual(P.sniffImage(png(800, 500)), { mime: "image/png", width: 800, height: 500 });
  assert.deepEqual(P.sniffImage(webp(1200, 750, "lossy")), { mime: "image/webp", width: 1200, height: 750 });
  assert.deepEqual(P.sniffImage(webp(1200, 750, "lossless")), { mime: "image/webp", width: 1200, height: 750 });
  assert.deepEqual(P.sniffImage(webp(1200, 750, "extended")), { mime: "image/webp", width: 1200, height: 750 });
  assert.equal(P.sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null, "un SVG n'est pas une image acceptée");
  assert.equal(P.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)])), null, "JPEG refusé");
  assert.equal(P.sniffImage(Buffer.from("GIF89a" + "\0".repeat(60), "latin1")), null, "GIF refusé");
  assert.equal(P.sniffImage(png().subarray(0, 60)), null, "PNG tronqué (sans IEND)");
  assert.equal(P.sniffImage(webp().subarray(0, 25)), null, "WebP tronqué");
  assert.equal(P.sniffImage(Buffer.alloc(0)), null);
});

test("image : poids (150 Ko), type réel égal à l'extension, dimensions (240 à 2400 px, 4 millions de pixels)", () => {
  assert.equal(P.checkPreviewImage(png(800, 500), "previews/a.png").ok, true);
  assert.equal(P.checkPreviewImage(webp(800, 500), "previews/a.webp").ok, true);
  assert.equal(P.checkPreviewImage(padPng(png(800, 500), 150 * 1024), "previews/a.png").ok, true, "150 Ko pile : accepté");
  assert.deepEqual(P.checkPreviewImage(padPng(png(800, 500), 150 * 1024 + 1), "previews/a.png"), { ok: false, problem: "too-large" });
  assert.deepEqual(P.checkPreviewImage(png(800, 500), "previews/a.webp"), { ok: false, problem: "type" }, "un PNG nommé .webp ment sur son type");
  assert.deepEqual(P.checkPreviewImage(Buffer.from("<svg/>"), "previews/a.png"), { ok: false, problem: "type" });
  for (const [w, h] of [[239, 400], [400, 239], [2401, 400], [400, 2401], [2400, 2400]]) assert.deepEqual(P.checkPreviewImage(webp(w, h), "previews/a.webp"), { ok: false, problem: "dimensions" }, `${w}x${h}`);
  assert.equal(P.checkPreviewImage(webp(2000, 2000), "previews/a.webp").ok, true, "4 millions de pixels : accepté");
  assert.equal(P.checkPreviewImage(webp(2400, 240), "previews/a.webp").ok, true);
});

test("loadPreviewImages : les fichiers absents ou non conformes sont écartés un à un (la fiche n'échoue jamais), le rang du manifeste est conservé, 6 au plus", async () => {
  const files = { "previews/a.png": png(800, 500), "previews/b.webp": Buffer.from("pas une image"), "previews/c.webp": webp(900, 600), "previews/d.png": padPng(png(), 200 * 1024) };
  const decls = ["a.png", "b.webp", "missing.png", "c.webp", "d.png"].map((f) => decl(`previews/${f}`));
  const seen = [];
  const out = await P.loadPreviewImages(decls, async (file, max) => { seen.push([file, max]); if (file.includes("missing")) throw new Error("absent"); return files[file] ?? null; });
  assert.deepEqual(out.map((i) => [i.index, i.decl.file, i.mime]), [[0, "previews/a.png", "image/png"], [3, "previews/c.webp", "image/webp"]]);
  assert.ok(seen.every(([, max]) => max === 150 * 1024), "la taille permise est transmise à la lecture");
  const many = await P.loadPreviewImages(Array.from({ length: 9 }, (_, i) => decl(`previews/v${i}.png`)), async () => png());
  assert.equal(many.length, 6);
  assert.deepEqual(await P.loadPreviewImages(undefined, async () => png()), []);
});

test("index du catalogue : `previews` repris tels quels ; une déclaration mal formée est écartée sans écarter le module ; 6 au plus", () => {
  const entry = (previews) => ({ id: "demo-mod", name: "Démo", repo: "https://github.com/o/r", previews });
  const [a] = sanitizeEntries([entry([decl("previews/a.webp"), { file: "evil.svg" }, decl("previews/a.webp"), decl("previews/b.png")])]);
  assert.deepEqual(a.previews.map((p) => p.file), ["previews/a.webp", "previews/b.png"]);
  assert.equal(sanitizeEntries([entry(undefined)])[0].previews, undefined);
  assert.equal(sanitizeEntries([entry("n'importe quoi")])[0].previews, undefined);
  assert.equal(sanitizeEntries([entry(Array.from({ length: 12 }, (_, i) => decl(`previews/v${i}.webp`)))])[0].previews.length, 6);
});

/* ───────────── lecture dans un dépôt (catalogue ou dépôt personnel) ───────────── */

const MANIFEST = (previews) => ({ ...base, previews });

test("dépôt : les visuels déclarés sont lus côté serveur et vérifiés ; un fichier trop lourd, mensonger ou absent est écarté ; rien n'est laissé sur le disque", async () => {
  const repo = makeRepo({
    "module.json": MANIFEST([decl("previews/ok.png"), decl("previews/lourd.png"), decl("previews/faux.webp"), decl("previews/absent.webp"), decl("previews/ok2.webp")]),
    "previews/ok.png": png(800, 500), "previews/lourd.png": padPng(png(800, 500), 160 * 1024), "previews/faux.webp": png(800, 500), "previews/ok2.webp": webp(1000, 600),
    "previews/non-declare.png": png(800, 500), "README.md": "# Démo",
  });
  const p = await R.getModulePreview({ kind: "repo", url: repo.url });
  assert.deepEqual(p.images.map((i) => [i.index, i.decl.file, i.mime, i.width, i.height]), [[0, "previews/ok.png", "image/png", 800, 500], [4, "previews/ok2.webp", "image/webp", 1000, 600]]);
  assert.ok(Buffer.isBuffer(p.images[0].bytes) && p.images[0].bytes.equals(png(800, 500)), "octets identiques, pas abîmés par un décodage en texte");
  const tmp = path.join(process.env.DATA_DIR, "tmp");
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp).filter((f) => f.startsWith("preview-")) : [], [], "dossier temporaire nettoyé");
});

test("dépôt : sans `previews`, ou module dans un sous-dossier, la fiche se lit comme avant", async () => {
  const none = makeRepo({ "module.json": base, "README.md": "x" });
  assert.deepEqual((await R.getModulePreview({ kind: "repo", url: none.url })).images, []);
  const grouped = makeRepo({ "mod/module.json": MANIFEST([decl("previews/a.png")]), "mod/previews/a.png": png(700, 400), "other/previews/a.png": png(300, 300) });
  const p = await R.getModulePreview({ kind: "repo", url: grouped.url, subdir: "mod" });
  assert.deepEqual(p.images.map((i) => [i.width, i.height]), [[700, 400]], "l'image du dossier du module, pas celle d'un voisin");
  const bad = makeRepo({ "module.json": "{ cassé" });
  assert.deepEqual((await R.getModulePreview({ kind: "repo", url: bad.url })).images, []);
});

test("mémoire : le cache des aperçus est borné en nombre ET en octets d'images (le plus ancien part d'abord, le dernier lu reste)", () => {
  const entry = (n) => ({ at: 0, value: { manifest: null, readme: null, truncated: false, images: n ? [{ index: 0, bytes: Buffer.alloc(n) }] : [] } });
  const m = new Map([["a", entry(500)], ["b", entry(500)], ["c", entry(500)]]);
  R.trimPreviewCache(m, 100, 1200);
  assert.deepEqual([...m.keys()], ["b", "c"]);
  R.trimPreviewCache(m, 100, 10);
  assert.deepEqual([...m.keys()], ["c"], "le dernier est gardé même s'il dépasse seul");
  const many = new Map(Array.from({ length: 5 }, (_, i) => [`k${i}`, entry(0)]));
  R.trimPreviewCache(many, 3, 1e9);
  assert.deepEqual([...many.keys()], ["k2", "k3", "k4"]);
  assert.ok(P.PREVIEW_CACHE_BYTES <= 16 * 1024 * 1024);
});

/* ───────────── module installé ───────────── */

test("module installé : visuels lus dans son dossier avec les mêmes vérifications ; lien symbolique, fichier trop lourd ou faux écartés", async () => {
  const dir = makeTempDir("curiosa-installed-");
  fs.mkdirSync(path.join(dir, "previews"));
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(MANIFEST([decl("previews/ok.png"), decl("previews/lien.png"), decl("previews/lourd.png"), decl("previews/faux.png"), decl("previews/absent.png")])));
  fs.writeFileSync(path.join(dir, "previews/ok.png"), png(800, 500));
  fs.writeFileSync(path.join(dir, "secret.txt"), "pas une image");
  fs.symlinkSync("../secret.txt", path.join(dir, "previews/lien.png"));
  fs.writeFileSync(path.join(dir, "previews/lourd.png"), padPng(png(800, 500), 160 * 1024));
  fs.writeFileSync(path.join(dir, "previews/faux.png"), "<svg/>");
  const out = await S.readInstalledPreviews("demo-mod", dir);
  assert.deepEqual(out.map((i) => i.decl.file), ["previews/ok.png"]);
  assert.deepEqual(await S.readInstalledPreviews("demo-mod", path.join(dir, "inexistant")), []);
  assert.deepEqual(await S.readInstalledPreviews("../etc", dir), [], "identifiant invalide");
});

/* ───────────── route de service ───────────── */

const fakeDeps = (over = {}) => ({
  catalogueTarget: async (id) => (id === "demo-mod" ? { kind: "repo", url: "https://github.com/o/r" } : null),
  repoPreview: async () => [{ index: 0, decl: decl("previews/a.png"), mime: "image/png", width: 800, height: 500, bytes: png(800, 500) }, { index: 2, decl: decl("previews/c.webp"), mime: "image/webp", width: 800, height: 500, bytes: webp(800, 500) }],
  installedImages: async (id) => (id === "demo-mod" ? [{ index: 1, decl: decl("previews/b.png"), mime: "image/png", width: 800, height: 500, bytes: png(800, 500) }] : []),
  ...over,
});
const get = (qs, deps = fakeDeps()) => S.servePreview(new URLSearchParams(qs), deps);

test("route : le type envoyé est celui des octets ; une seule source par demande ; rang entier de 0 à 5 ; sinon 400, et 404 quand il n'y a rien à montrer", async () => {
  const ok = await get("id=demo-mod&n=0");
  assert.equal(ok.status, 200); assert.equal(ok.mime, "image/png"); assert.ok(ok.bytes.length > 0);
  assert.equal((await get("id=demo-mod&n=2")).mime, "image/webp");
  assert.equal((await get("installed=demo-mod&n=1")).status, 200);
  assert.equal((await get("id=demo-mod&n=1")).status, 404, "rang non listé");
  assert.equal((await get("id=inconnu&n=0")).status, 404, "module absent du catalogue");
  assert.equal((await get("installed=inconnu&n=1")).status, 404);
  for (const qs of ["n=0", "id=demo-mod", "id=demo-mod&n=6", "id=demo-mod&n=-1", "id=demo-mod&n=01", "id=demo-mod&n=a", "id=demo-mod&n=", "id=demo-mod&installed=demo-mod&n=0", `id=${"x".repeat(301)}&n=0`, "id=&n=0"]) assert.equal((await get(qs)).status, 400, qs);
});

test("route : l'adresse du dépôt vient du catalogue (jamais de la demande) ; un dépôt personnel passe par les mêmes contrôles que l'installation ; un identifiant invalide ne touche à rien", async () => {
  let asked = 0;
  const deps = fakeDeps({ catalogueTarget: async () => { asked++; return null; }, repoPreview: async (t) => { asked++; throw new Error(t.url); } });
  assert.equal((await get("id=../../etc&n=0", deps)).status, 404);
  assert.equal((await get("installed=../etc&n=0", deps)).status, 404);
  assert.equal(asked, 0, "identifiant invalide : aucun accès");
  delete process.env.CURIOSA_ALLOW_LOCAL_MODULES;
  assert.equal((await get("repo=https://evil.example/o/r&n=0", deps)).status, 404, "hôte non autorisé");
  assert.equal((await get("repo=file:///etc&n=0", deps)).status, 404, "dépôt local refusé");
  assert.equal((await get("repo=ssh://git@github.com/o/r&n=0", deps)).status, 404);
  assert.equal(asked, 0);
  const seen = [];
  const ok = fakeDeps({ repoPreview: async (t) => { seen.push(t); return fakeDeps().repoPreview(); } });
  assert.equal((await get("repo=" + encodeURIComponent("https://github.com/o/r#v1:dossier") + "&n=0", ok)).status, 200);
  assert.deepEqual(seen, [{ kind: "repo", url: "https://github.com/o/r", ref: "v1", subdir: "dossier" }]);
});

test("route : adresses des images construites par le cœur (relatives, sur le site) ; la route est réservée à l'administration et ne sert que des octets vérifiés", () => {
  const u = S.previewUrl({ id: "demo-mod" }, 3, "1.2.0");
  assert.equal(u, "/api/admin/extension-previews?id=demo-mod&n=3&v=1.2.0");
  assert.ok(u.startsWith("/"), "jamais d'adresse absolue vers un site tiers");
  assert.match(S.previewUrl({ repo: "https://github.com/o/r#v1:d" }, 0), /repo=https%3A%2F%2Fgithub\.com%2Fo%2Fr%23v1%3Ad&n=0/);
  const route = fs.readFileSync("src/app/api/admin/extension-previews/route.ts", "utf8");
  assert.match(route, /hasRole\(user, "admin"\)[\s\S]*status: 404/, "réservée à l'administration");
  assert.match(route, /X-Content-Type-Options": "nosniff"/);
  assert.match(route, /Cache-Control": "private/, "jamais mise en cache partagée");
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /servePreview\(/);
});
