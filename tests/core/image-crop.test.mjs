import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Dossier de données jetable : AVANT d'importer le cœur (UPLOADS_DIR et le cache en dépendent).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-crop-"));
const sharp = (await import("sharp")).default;

const K = await import("@/core/imageCrop");
const { deriveImage, cacheName, CROP_CACHE_DIR, MAX_INPUT_PIXELS } = await import("@/core/imageDerive");
const { UPLOADS_DIR } = await import("@/core/config");
const { GET } = await import("@/app/uploads/[name]/route");
const { isLogoUrl } = await import("@/core/logos");
const { isBlockImage } = await import("@/core/homeBlocks");
const { parseBackground } = await import("@/core/background");
const { checkFieldValue } = await import("@/core/modules/settingValues").catch(() => ({}));
const { socialMeta } = await import("@/core/seo");
const { renderRss } = await import("@/core/feeds");

const ID = "123e4567-e89b-12d3-a456-426614174000";
const crop = (o = {}) => ({ ratio: 1, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff", ...o });

async function put(buf, ext = "png") {
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return name;
}
/** 800 × 400 : moitié gauche rouge, moitié droite bleue. */
const twoHalves = async () => sharp({ create: { width: 800, height: 400, channels: 3, background: "#ff0000" } })
  .composite([{ input: { create: { width: 400, height: 400, channels: 3, background: "#0000ff" } }, left: 400, top: 0 }]).png().toBuffer();
const pixel = async (buf, x, y) => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * 4; return [...data.subarray(i, i + 4)]; };

// ── Format de la valeur : lisible, strict, stable ──

test("cadrage : écriture et lecture sont inverses, valeurs bornées et arrondies", () => {
  const c = crop({ ratio: 16 / 9, zoom: 1.2345, x: 0.12345, y: 0.9, fill: "00ff7f" });
  const text = K.formatCrop(c);
  assert.equal(text, "1.7778_1.23_0.123_0.9_00ff7f");
  assert.deepEqual(K.parseCrop(text), { ratio: 1.7778, zoom: 1.23, x: 0.123, y: 0.9, fill: "00ff7f" });
  assert.equal(K.formatCrop({ ...c, ratio: null, fill: "t" }), "o_1.23_0.123_0.9_t");
  assert.equal(K.parseCrop("o_1_0.5_0.5_t").ratio, null);
  // hors bornes → ramené dans les bornes à l'écriture
  assert.equal(K.formatCrop(crop({ zoom: 99, x: 5, y: -2, ratio: 100 })), "4_8_1_0_ffffff");
});

test("cadrage : une valeur illisible ou hors bornes n'est JAMAIS devinée", () => {
  for (const bad of ["", "1_1_0.5_0.5", "1_1_0.5_0.5_ffffff_1", "x_1_0.5_0.5_ffffff", "1_1_0.5_0.5_fff", "1_1_0.5_0.5_GGGGGG", "1_9_0.5_0.5_ffffff", "1_0.1_0.5_0.5_ffffff", "1_1_1.5_0.5_ffffff", "9_1_0.5_0.5_ffffff", "0.1_1_0.5_0.5_ffffff", "1_1_-1_0.5_ffffff", "1e3_1_0.5_0.5_ffffff", "1_1_0.5_0.5_ffffff;rm", "1_1_0.5_0.5_<script>"]) assert.equal(K.parseCrop(bad), null, bad);
});

test("valeurs d'avant : un simple chemin /uploads/xxx.png reste valable partout, sans migration", () => {
  const plain = `/uploads/${ID}.png`, cropped = `${plain}?c=1_1_0.5_0.5_ffffff`;
  assert.deepEqual(K.splitImageRef(plain), { path: plain, crop: null, share: false, hasQuery: false });
  assert.equal(K.splitImageRef(cropped).crop.ratio, 1);
  assert.equal(K.joinImageRef(plain, null), plain);
  assert.equal(K.joinImageRef(plain, crop()), cropped);
  assert.equal(K.refRatio(plain), null);
  assert.equal(K.refRatio(cropped), 1);
  assert.equal(K.refRatio(`${plain}?c=o_2_0.5_0.5_ffffff`), null, "ratio d'origine : l'image garde le sien");
  // validateurs existants du cœur
  assert.ok(isLogoUrl(plain) && isLogoUrl(cropped) && isLogoUrl(`/uploads/${ID}.svg`) && isLogoUrl("https://exemple.org/a.png"));
  assert.ok(!isLogoUrl(`/uploads/${ID}.svg?c=1_1_0.5_0.5_ffffff`), "un SVG ne se cadre pas");
  assert.ok(!isLogoUrl(`${plain}?c=<script>`) && !isLogoUrl(`${plain}?x=1`) && !isLogoUrl(`${plain}?c=${"a".repeat(80)}`));
  assert.ok(isBlockImage(plain) && isBlockImage(cropped) && !isBlockImage(`${plain}?c=bad bad`));
  const bg = (src) => parseBackground([{ type: "image", src, fit: "cover", position: "center" }]).ok;
  assert.ok(bg(cropped) && bg(plain) && !bg(`${plain}?c=" onerror="x`) && !bg(`${plain}?c=1_1_0.5_0.5_ffffff");x`));
  if (checkFieldValue) assert.equal(checkFieldValue({ type: "image" }, cropped).ok, true);
});

test("cadrage : GIF, SVG et images distantes ne se cadrent pas (la valeur reste l'image telle quelle)", () => {
  assert.equal(K.splitImageRef(`/uploads/${ID}.gif?c=1_1_0.5_0.5_ffffff`).crop, null);
  assert.equal(K.splitImageRef(`/uploads/${ID}.svg?c=1_1_0.5_0.5_ffffff`).crop, null);
  assert.equal(K.splitImageRef("https://exemple.org/a.png?c=1_1_0.5_0.5_ffffff").crop, null);
  assert.equal(K.shareImage("https://exemple.org/a.png?c=1_1_0.5_0.5_ffffff"), "https://exemple.org/a.png?c=1_1_0.5_0.5_ffffff");
});

// ── Géométrie ──

test("géométrie : sans cadrage particulier (ratio d'origine, zoom 1) l'image est entière", () => {
  const g = K.cropGeometry({ ratio: null, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff" }, 800, 400);
  assert.deepEqual([g.outW, g.outH, g.inside], [800, 400, true]);
  assert.deepEqual(g.extract, { left: 0, top: 0, width: 800, height: 400 });
});

test("géométrie : carré, 4:3, 9:16 sur une image 800 × 400 centrée (zoom 1 = l'image remplit le cadre)", () => {
  const sq = K.cropGeometry(crop({ ratio: 1 }), 800, 400);
  assert.deepEqual(sq.extract, { left: 200, top: 0, width: 400, height: 400 });
  assert.deepEqual([sq.outW, sq.outH], [400, 400], "même densité de pixels que l'original");
  const t = K.cropGeometry(crop({ ratio: 4 / 3 }), 800, 400);
  assert.equal(t.extract.height, 400); assert.equal(t.extract.width, 533);
  const p = K.cropGeometry(crop({ ratio: 9 / 16 }), 800, 400);
  assert.equal(p.extract.height, 400); assert.equal(p.extract.width, 225);
  assert.ok(Math.abs(p.outW / p.outH - 9 / 16) < 0.01);
});

test("géométrie : zoom avant lit une zone plus petite ; zoom arrière sort de l'image (remplissage) et reste centré", () => {
  const z2 = K.cropGeometry(crop({ ratio: 1, zoom: 2 }), 800, 400);
  assert.deepEqual(z2.extract, { left: 300, top: 100, width: 200, height: 200 });
  assert.equal(z2.inside, true);
  const out = K.cropGeometry(crop({ ratio: 1, zoom: 0.5 }), 800, 400);
  assert.equal(out.inside, false);
  assert.deepEqual(out.extract, { left: 0, top: 0, width: 800, height: 400 }, "toute l'image est lue");
  // 800 px posés dans un cadre de 800 / 0,5 = 1600 de large (zone visible 800 × 2 en x ?) : l'image est centrée horizontalement et verticalement
  assert.equal(out.place.left * 2 + out.resize.width, out.outW);
  assert.ok(Math.abs(out.place.top * 2 + out.resize.height - out.outH) <= 1);
  assert.ok(out.place.top > 0, "bandes en haut et en bas");
});

test("géométrie : décalage, bords et arrondis ne sortent jamais de l'image ; sortie bornée", () => {
  for (const [W, H] of [[800, 400], [400, 800], [5000, 3000], [3, 3], [1, 1], [4000, 40]]) {
    for (const ratio of [null, 16 / 9, 4 / 3, 3 / 2, 1, 3 / 4, 9 / 16, 0.3, 3.9]) {
      for (const zoom of [0.25, 0.5, 1, 1.7, 8]) {
        for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5], [0.13, 0.91]]) {
          const g = K.cropGeometry({ ratio, zoom, x, y, fill: "t" }, W, H);
          const at = JSON.stringify({ W, H, ratio, zoom, x, y });
          assert.ok(g.outW >= 1 && g.outH >= 1 && Math.max(g.outW, g.outH) <= K.MAX_SIDE, `taille ${at}`);
          assert.ok(g.extract.left >= 0 && g.extract.top >= 0 && g.extract.left + g.extract.width <= W && g.extract.top + g.extract.height <= H && g.extract.width >= 1 && g.extract.height >= 1, `extraction ${at}`);
          assert.ok(g.place.left >= 0 && g.place.top >= 0 && g.place.left + g.resize.width <= g.outW && g.place.top + g.resize.height <= g.outH, `placement ${at}`);
        }
      }
    }
  }
});

test("géométrie : l'aperçu du navigateur et le serveur partent du même calcul (l'image occupe la même fraction du cadre)", () => {
  const c = crop({ ratio: 1, zoom: 0.5 });
  const g = K.cropGeometry(c, 800, 400);
  const l = K.previewLayout(c, 800, 400, 200);
  assert.ok(Math.abs(l.frameH - 200) < 1e-9);
  assert.ok(Math.abs(l.imgW / 200 - g.resize.width / g.outW) < 0.01);
  assert.ok(Math.abs(l.imgLeft / 200 - g.place.left / g.outW) < 0.01);
  assert.ok(Math.abs(l.imgTop / 200 - g.place.top / g.outH) < 0.01);
});

test("partage : cadrage raisonnable gardé, ratio extrême → version 1,91:1 fabriquée, image non cadrée inchangée", () => {
  const p = `/uploads/${ID}.png`;
  assert.equal(K.shareImage(p), p);
  const wide = `${p}?c=${K.formatCrop(crop({ ratio: 16 / 9 }))}`;
  assert.equal(K.shareImage(wide), wide);
  for (const r of [1, 3 / 4, 9 / 16, null, 4]) { const v = `${p}?c=${K.formatCrop(crop({ ratio: r }))}`; assert.equal(K.shareImage(v), `${v}&s=1`, String(r)); }
  assert.equal(K.shareImage(`${p}?c=1_1_0.5_0.5_ffffff&s=1`), `${p}?c=1_1_0.5_0.5_ffffff&s=1`, "pas deux fois");
  const meta = socialMeta({ siteName: "S", title: "T", image: `${p}?c=1_1_0.5_0.5_ffffff`, url: "https://x.org/" });
  assert.deepEqual(meta.openGraph.images, [`${p}?c=1_1_0.5_0.5_ffffff&s=1`]);
  assert.deepEqual(meta.twitter.images, meta.openGraph.images);
  assert.deepEqual(socialMeta({ siteName: "S", title: "T", image: p, url: "https://x.org/" }).openGraph.images, [p]);
  assert.equal(K.cropGeometry(crop({ ratio: 1 }), 800, 400, true).outW, 1200);
  assert.equal(K.cropGeometry(crop({ ratio: 1 }), 800, 400, true).outH, 630);
});

test("flux RSS : l'image cadrée est annoncée avec le type du fichier réellement servi", () => {
  const item = (image) => renderRss({ title: "T", link: "https://x.org", description: "", language: "fr", self: "https://x.org/feed", items: [{ id: "1", title: "a", link: "https://x.org/a", summary: "", publishedAt: null, topics: [], image }] });
  assert.match(item(`https://x.org/uploads/${ID}.png?c=1_1_0.5_0.5_ffffff`), /type="image\/webp"/);
  assert.match(item(`https://x.org/uploads/${ID}.png`), /type="image\/png"/);
});

// ── Traitement serveur ──

test("serveur : le cadrage fabrique la bonne zone, en WebP, sans toucher à l'original ni garder de métadonnées", async () => {
  const original = await twoHalves();
  const name = await put(original);
  const r = await deriveImage(name, crop({ ratio: 1, zoom: 1, x: 0.25 }));
  assert.equal(r.ok, true);
  assert.equal(r.mime, "image/webp");
  const out = fs.readFileSync(r.file);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, meta.height);
  assert.equal(meta.exif, undefined, "aucune métadonnée EXIF dans la version fabriquée");
  const [red] = await pixel(out, 10, 10), [, , blue] = await pixel(out, meta.width - 10, 10);
  assert.ok(red > 200, "centré sur la moitié gauche : rouge à gauche");
  assert.ok(blue < 60, "pas de bleu : la moitié droite est hors cadre à x = 0,25 ? (rouge partout)");
  assert.deepEqual(fs.readFileSync(path.join(UPLOADS_DIR, name)), original, "l'original est intact");
});

test("serveur : zoom arrière → remplissage en couleur choisie ou transparent", async () => {
  const name = await put(await twoHalves());
  const solid = await deriveImage(name, crop({ ratio: 1, zoom: 0.5, fill: "00ff00" }));
  const s = fs.readFileSync(solid.file), m = await sharp(s).metadata();
  assert.deepEqual((await pixel(s, 5, 5)).slice(0, 3).map((v) => Math.round(v / 40)), [0, 6, 0].map((v) => Math.round(v * 255 / 6 / 40)), "bande du haut = vert");
  assert.equal(m.width, m.height);
  const clear = await deriveImage(name, crop({ ratio: 1, zoom: 0.5, fill: "t" }));
  assert.equal((await pixel(fs.readFileSync(clear.file), 5, 5))[3], 0, "transparent");
  assert.notEqual(solid.file, clear.file);
});

test("serveur : même cadrage → même fichier en cache (rien n'est refait) ; autre cadrage → autre fichier", async () => {
  const name = await put(await twoHalves());
  const a = await deriveImage(name, crop({ zoom: 1.5 }));
  const t = fs.statSync(a.file).mtimeMs;
  const b = await deriveImage(name, crop({ zoom: 1.5 }));
  assert.equal(b.file, a.file);
  assert.equal(fs.statSync(b.file).mtimeMs, t);
  const c = await deriveImage(name, crop({ zoom: 1.6 }));
  assert.notEqual(c.file, a.file);
  assert.ok(a.file.startsWith(CROP_CACHE_DIR) && cacheName(name, crop(), false).endsWith(".webp") && cacheName(name, crop(), true).endsWith(".jpg"));
  assert.notEqual(cacheName(name, crop(), true).slice(0, -4), cacheName(name, crop(), false).slice(0, -5));
});

test("serveur : l'orientation EXIF est respectée et le GPS n'est pas recopié", async () => {
  // 200 × 100, marquée « à tourner de 90° » : à l'écran elle fait 100 × 200.
  const src = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#336699" } }).jpeg().withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1" } } }).toBuffer();
  assert.ok((await sharp(src).metadata()).exif, "le fichier de départ porte bien des métadonnées");
  const name = await put(src, "jpg");
  const r = await deriveImage(name, { ratio: null, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff" });
  assert.equal(r.ok, true);
  const meta = await sharp(fs.readFileSync(r.file)).metadata();
  assert.ok(meta.height > meta.width, `portrait après redressement (${meta.width}×${meta.height})`);
  assert.equal(meta.exif, undefined);
  const share = await deriveImage(name, crop({ ratio: 1 }), true);
  const sm = await sharp(fs.readFileSync(share.file)).metadata();
  assert.deepEqual([sm.format, sm.width, sm.height, sm.exif], ["jpeg", 1200, 630, undefined]);
});

test("serveur : refus propres — image trop grande en pixels, GIF, fichier absent, contenu qui n'est pas une image, SVG", async () => {
  const huge = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(7000 * 7000 > MAX_INPUT_PIXELS && huge.length < 5 * 1024 * 1024, "l'image de test est une bombe de décompression sous la limite d'envoi");
  assert.deepEqual(await deriveImage(await put(huge), crop()), { ok: false, reason: "toolarge" });
  const gif = await put(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]), "gif");
  assert.equal((await deriveImage(gif, crop())).reason, "format");
  assert.equal((await deriveImage(`${crypto.randomUUID()}.png`, crop())).reason, "missing");
  const junk = await put(Buffer.from("ceci n'est pas une image du tout, vraiment pas"), "png");
  assert.equal((await deriveImage(junk, crop())).reason, "format");
  const svg = await put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "svg");
  assert.equal((await deriveImage(svg, crop())).reason, "format");
  const truncated = await put((await twoHalves()).subarray(0, 300), "png");
  assert.equal((await deriveImage(truncated, crop())).ok, false, "image tronquée : refusée sans planter");
});

test("route /uploads : image cadrée en WebP, cache immuable ; valeur illisible → original ; nom piégé → 404 ; échec → original, cache court", async () => {
  const name = await put(await twoHalves());
  const get = (u) => GET(new Request(`http://localhost${u}`), { params: Promise.resolve({ name: decodeURIComponent(u.slice(9).split("?")[0]) }) });
  const ok = await get(`/uploads/${name}?c=1_1_0.5_0.5_ffffff`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/webp");
  assert.match(ok.headers.get("cache-control"), /immutable/);
  const m = await sharp(Buffer.from(await ok.arrayBuffer())).metadata();
  assert.deepEqual([m.format, m.width === m.height], ["webp", true]);
  const share = await get(`/uploads/${name}?c=1_1_0.5_0.5_ffffff&s=1`);
  assert.equal(share.headers.get("content-type"), "image/jpeg");
  const bad = await get(`/uploads/${name}?c=nimporte_quoi`);
  assert.equal(bad.headers.get("content-type"), "image/png", "valeur illisible : l'original");
  assert.equal((await get(`/uploads/${name}`)).headers.get("content-type"), "image/png");
  assert.equal((await get(`/uploads/..%2F..%2Fetc%2Fpasswd?c=1_1_0.5_0.5_ffffff`)).status, 404);
  assert.equal((await get(`/uploads/${crypto.randomUUID()}.png?c=1_1_0.5_0.5_ffffff`)).status, 404);
  const gif = await put(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]), "gif");
  const g = await get(`/uploads/${gif}?c=1_1_0.5_0.5_ffffff`);
  assert.equal(g.headers.get("content-type"), "image/gif");
});

// ── Éditeur, textes, architecture ──

test("textes de l'éditeur : chaque clé existe en français ET en anglais", async () => {
  const { CROP_LABEL_KEYS } = await import("../../src/components/admin/cropLabelKeys.ts");
  for (const f of ["fr", "en"]) {
    const d = JSON.parse(fs.readFileSync(`src/locales/${f}.json`, "utf8"));
    for (const k of CROP_LABEL_KEYS) assert.ok(String(d[`crop.${k}`] ?? "").trim(), `crop.${k} manque en ${f}`);
  }
});

test("architecture : le calcul du cadrage est pur et partagé ; tous les champs image passent par UN composant ; les pages publiques ne figent plus 16:9", () => {
  const pure = fs.readFileSync("src/core/imageCrop.ts", "utf8");
  assert.ok(!/^import /m.test(pure), "imageCrop.ts n'importe rien (navigateur et serveur s'en servent)");
  assert.match(fs.readFileSync("src/components/admin/ImageCropper.tsx", "utf8"), /from "@\/core\/imageCrop"/);
  assert.match(fs.readFileSync("src/core/imageDerive.ts", "utf8"), /from "@\/core\/imageCrop"/);
  for (const f of ["src/components/site/EntryList.tsx", "src/app/(site)/[...path]/page.tsx"]) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(s.includes("<CoverImage") && !/aspect-video/.test(s), `${f} : couverture au ratio choisi`);
  }
  // un seul composant de champ image pour les entrées, les réglages, les blocs et les réglages de modules
  for (const f of ["src/app/admin/(panel)/entries/EntryForm.tsx", "src/app/admin/(panel)/settings/page.tsx", "src/components/admin/BlockEditor.tsx", "src/components/admin/AdminBlocks.tsx", "src/components/admin/ModuleSettings.tsx"]) {
    assert.match(fs.readFileSync(f, "utf8"), /<ImageField/, f);
    assert.ok(!/type="file"/.test(fs.readFileSync(f, "utf8")), `${f} : aucun téléversement hors du composant commun`);
  }
  // le moteur d'image n'est chargé qu'à la demande et nulle part ailleurs
  const where = fs.readdirSync("src/core").filter((f) => f.endsWith(".ts") && /sharp/.test(fs.readFileSync(`src/core/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")));
  assert.deepEqual(where, ["imageDerive.ts"]);
});
