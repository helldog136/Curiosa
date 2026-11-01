// Service HTTP des ressources d'un skin : /skins/<id>/<version>/<dossier>/<fichier> (docs/SKINS.md §5.6, §15).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeFont, fakePng, SVG_OK } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const root = makeTempDir("curiosa-skinserve-");
process.env.DATA_DIR = root;
const { resolveSkinAsset, assetHeaders } = await import("@/core/skins/serve");
const route = await import("../../src/app/skins/[id]/[version]/[dir]/[file]/route.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const dir = path.join(root, "skins", "demo", "1.0.0");
fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
fs.mkdirSync(path.join(dir, "images"), { recursive: true });
fs.mkdirSync(path.join(dir, "previews"), { recursive: true });
fs.writeFileSync(path.join(dir, "fonts", "corps.woff2"), fakeFont());
fs.writeFileSync(path.join(dir, "images", "grille.png"), fakePng());
fs.writeFileSync(path.join(dir, "images", "motif.svg"), SVG_OK);
fs.writeFileSync(path.join(dir, "skin.css"), '[data-skin-part="card"] { color: red; }');
fs.writeFileSync(path.join(dir, "tokens.json"), "{}");
fs.writeFileSync(path.join(dir, "skin.json"), "{}");
fs.writeFileSync(path.join(dir, "previews", "home.webp"), "RIFF");
fs.writeFileSync(path.join(root, "secret.txt"), "secret");
fs.symlinkSync(path.join(root, "secret.txt"), path.join(dir, "images", "lien.png"));
fs.symlinkSync(root, path.join(dir, "images", "dossier.png"));

const get = (id, version, d, file, method = "GET") => route[method](new Request(`http://localhost/skins/${id}/${version}/${d}/${file}`, { method }), { params: Promise.resolve({ id, version, dir: d, file }) });

test("police et image : type fixé par l'extension, cache éternel, nosniff, contenu exact", async () => {
  const font = await get("demo", "1.0.0", "fonts", "corps.woff2");
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.equal(font.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(font.headers.get("x-content-type-options"), "nosniff");
  assert.equal(font.headers.get("content-length"), String(fakeFont().length));
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), fakeFont());
  const png = await get("demo", "1.0.0", "images", "grille.png");
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal(png.headers.get("x-content-type-options"), "nosniff");
});

test("SVG : servi avec une politique qui interdit tout script et toute ressource (bac à sable)", async () => {
  const svg = await get("demo", "1.0.0", "images", "motif.svg");
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
});

test("HEAD : mêmes en-têtes, pas de corps", async () => {
  const r = await get("demo", "1.0.0", "fonts", "corps.woff2", "HEAD");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "font/woff2");
  assert.equal(await r.text(), "");
});

test("jamais la feuille brute, les jetons, le manifeste, les aperçus ni un dossier inconnu", async () => {
  for (const [d, f] of [["", "skin.css"], ["images", "skin.css"], ["fonts", "skin.css"], ["skin.css", ""], ["previews", "home.webp"], ["images", "home.webp"], ["fonts", "grille.png"], ["images", "corps.woff2"], ["root", "tokens.json"], ["images", "tokens.json"]]) {
    assert.equal((await get("demo", "1.0.0", d, f)).status, 404, `${d}/${f}`);
  }
});

test("traversée de chemin et segments douteux refusés ; liens symboliques jamais suivis", async () => {
  const cases = [["..", "1.0.0", "fonts", "corps.woff2"], ["demo", "..", "fonts", "corps.woff2"], ["demo", "1.0.0", "..", "secret.txt"], ["demo", "1.0.0", "images", "..%2Fsecret.txt"], ["demo", "1.0.0", "images", "../../../secret.txt"],
    ["demo", "1.0.0", "images", ".hidden.png"], ["demo", "1.0.0", "images", "a/b.png"], ["demo", "1.0.0", "images", "GRILLE.PNG"], ["demo", "1.0", "images", "grille.png"], ["demo", "1.0.0-rc", "images", "grille.png"],
    ["DEMO", "1.0.0", "images", "grille.png"], ["demo", "1.0.0", "images", "lien.png"], ["demo", "1.0.0", "images", "dossier.png"], ["demo", "1.0.0", "images", "x".repeat(300) + ".png"], ["demo", "1.0.0", "images", "grille.png\0"]];
  for (const [id, v, d, f] of cases) {
    const r = await get(id, v, d, f);
    assert.equal(r.status, 404, `${id}/${v}/${d}/${f}`);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal((await get("demo", "9.9.9", "images", "grille.png")).status, 404, "version non installée");
  assert.equal((await get("autre", "1.0.0", "images", "grille.png")).status, 404, "skin non installé");
});

test("résolution pure : extension → type ; extensions inconnues refusées", () => {
  assert.equal(resolveSkinAsset("demo", "1.0.0", "images", "grille.png", path.join(root, "skins"))?.type, "image/png");
  assert.equal(resolveSkinAsset("demo", "1.0.0", "images", "grille.gif", path.join(root, "skins")), null);
  assert.deepEqual(Object.keys(assetHeaders({ file: "x", type: "image/png", size: 1 })).sort(), ["cache-control", "content-length", "content-type", "x-content-type-options"]);
});

test("« skins » est un premier segment réservé : aucune collection de contenu ne peut le prendre", async () => {
  const { RESERVED_PATHS } = await import("@/core/config");
  assert.ok(RESERVED_PATHS.has("skins"));
});
