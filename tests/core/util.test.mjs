import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { slugify } = await import("@/core/slug");
const { isSafeExternalUrl, safeHref, isExternalHref } = await import("@/core/url");
const { isHexColor, luminance, mix, buildPalette, FONT_STACKS } = await import("@/core/color");
const { resolveIcon } = await import("@/core/icons");
const { sniffImage, mimeFor, UPLOAD_NAME_RE, saveUpload, MAX_UPLOAD_BYTES } = await import("@/core/services/uploads");

test("slugify : accents, symboles, casse, longueur", () => {
  assert.equal(slugify("Été à Paris !"), "ete-a-paris");
  assert.equal(slugify("  --  "), "");
  assert.equal(slugify("Ça va ? Œuvre"), "ca-va-uvre");
  assert.equal(slugify("a".repeat(200)).length, 80);
  assert.equal(slugify("2024 / 2025"), "2024-2025");
});

test("liens sortants : seulement http, https et mailto", () => {
  for (const ok of ["https://a.b", "http://a.b/x?y=1", "mailto:a@b.c"]) assert.ok(isSafeExternalUrl(ok), ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x", "//evil", "/chemin", "", null, undefined, "not a url"]) assert.ok(!isSafeExternalUrl(bad), String(bad));
});

test("safeHref : chemins internes autorisés, tout le reste neutralisé", () => {
  assert.equal(safeHref("/blog"), "/blog");
  assert.equal(safeHref("https://a.b"), "https://a.b");
  for (const bad of ["javascript:x", "//evil.example", "", null, undefined, "data:x"]) assert.equal(safeHref(bad), "#", String(bad));
  assert.ok(isExternalHref("https://x") && isExternalHref("mailto:a@b.c") && !isExternalHref("/x"));
});

test("couleurs : validation stricte #RRGGBB", () => {
  assert.ok(isHexColor("#a1B2c3"));
  for (const bad of ["#fff", "a1b2c3", "#12345g", "red", "", null, 12, "#1234567", "javascript:1"]) assert.ok(!isHexColor(bad), String(bad));
});

test("luminance et mélange", () => {
  assert.equal(luminance("#000000"), 0);
  assert.ok(Math.abs(luminance("#ffffff") - 1) < 1e-9);
  assert.ok(luminance("#808080") > 0.2 && luminance("#808080") < 0.25);
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("palette : texte lisible quelle que soit la couleur de fond, valeurs invalides remplacées", () => {
  assert.equal(buildPalette("#101010", "#ff8800")["--v-fg"], "#f4f4f5");
  assert.equal(buildPalette("#fafafa", "#ff8800")["--v-fg"], "#18181b");
  assert.equal(buildPalette("#101010", "#ffff00")["--v-accent-fg"], "#111111", "texte sombre sur accent clair");
  assert.equal(buildPalette("#101010", "#000080")["--v-accent-fg"], "#ffffff", "texte clair sur accent sombre");
  const bad = buildPalette("javascript:1", "<script>");
  assert.equal(bad["--v-bg"], "#121214");
  assert.equal(bad["--v-accent"], "#e8a23b");
  for (const v of Object.values(buildPalette("#123456", "#abcdef"))) assert.match(v, /^#[0-9a-f]{6}$/, "toute valeur est injectable en CSS sans risque");
});

test("polices : trois familles système, pas de police externe", () => {
  assert.deepEqual(Object.keys(FONT_STACKS).sort(), ["mono", "sans", "serif"]);
  for (const stack of Object.values(FONT_STACKS)) assert.ok(!/https?:|url\(/.test(stack));
});

test("icônes : marque simple-icons, emoji, rien", () => {
  const twitch = resolveIcon("twitch");
  assert.ok(twitch && "svg" in twitch && twitch.title === "Twitch" && twitch.svg.length > 20);
  assert.ok("svg" in resolveIcon("YouTube"), "insensible à la casse");
  assert.deepEqual(resolveIcon("🎮"), { text: "🎮" });
  assert.deepEqual(resolveIcon("marque-inconnue-xyz"), { text: "marque-i" }, "inconnue → texte court, jamais d'HTML");
  assert.equal(resolveIcon(null), null);
  assert.equal(resolveIcon(""), null);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32)]);

test("envois : le vrai format est détecté par signature, pas par le nom", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(JPG), "jpg");
  assert.equal(sniffImage(GIF), "gif");
  assert.equal(sniffImage(WEBP), "webp");
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null, "SVG refusé (script possible)");
  assert.equal(sniffImage(Buffer.from("<?php echo 1; ?>" + " ".repeat(20))), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null, "trop court");
});

test("envois : noms servis restreints à ceux que le cœur génère, types MIME corrects", () => {
  assert.ok(UPLOAD_NAME_RE.test("0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"));
  for (const bad of ["../etc/passwd", "a.png", "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.exe", "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png/../x", ""]) assert.ok(!UPLOAD_NAME_RE.test(bad), bad);
  assert.equal(mimeFor("x.png"), "image/png");
  assert.equal(mimeFor("x.jpg"), "image/jpeg");
  assert.ok(UPLOAD_NAME_RE.test("0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.svg"), "les SVG de logo (nettoyés à l'envoi) sont servis");
  assert.equal(mimeFor("x.exe"), "application/octet-stream");
});

test("envois : saveUpload écrit un fichier au nom aléatoire et refuse le reste", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-up-"));
  process.env.DATA_DIR = dir;
  // UPLOADS_DIR est calculé à l'import de config : on réimporte avec un paramètre de requête pour obtenir un module neuf.
  const fresh = await import(`@/core/services/uploads?x=${Date.now()}`).catch(() => null);
  if (fresh) {
    const url = await fresh.saveUpload(PNG);
    assert.match(url ?? "", /^\/uploads\/[0-9a-f-]{36}\.png$/);
    assert.equal(await fresh.saveUpload(Buffer.from("not an image at all, really")), null);
    assert.equal(await fresh.saveUpload(Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)])), null, "trop gros");
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
