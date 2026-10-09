import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { matchPalette, THEME_PRESETS, CUSTOM_PALETTE } = await import("@/core/palettes");

test("chaque palette pré-proposée est reconnue, en minuscules comme en majuscules", () => {
  assert.equal(THEME_PRESETS.length, 7);
  for (const p of THEME_PRESETS) {
    assert.equal(matchPalette(p.background, p.accent), p.id);
    assert.equal(matchPalette(p.background.toUpperCase(), p.accent.toUpperCase()), p.id);
    assert.equal(matchPalette(` ${p.background} `, p.accent), p.id);
  }
});

test("une couleur voisine, un seul champ juste ou un croisement => personnalisé", () => {
  assert.equal(matchPalette("#121215", "#e8a23b"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#121214", "#e8a23c"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#121214", "#38bdf8"), CUSTOM_PALETTE, "fond de Nuit + accent d'Océan");
  assert.equal(matchPalette("#0b1220", "#e8a23b"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#123", "#abc"), CUSTOM_PALETTE);
});

test("valeurs invalides => personnalisé, sans erreur", () => {
  for (const bad of [undefined, null, "", 5, {}, "nuit", "#12121"]) {
    assert.equal(matchPalette(bad, "#e8a23b"), CUSTOM_PALETTE);
    assert.equal(matchPalette("#121214", bad), CUSTOM_PALETTE);
  }
  assert.equal(matchPalette(), CUSTOM_PALETTE);
});

test("les palettes sont distinctes et en minuscules", () => {
  const ids = new Set(THEME_PRESETS.map((p) => p.id));
  assert.equal(ids.size, THEME_PRESETS.length);
  for (const p of THEME_PRESETS) assert.match(p.background + p.accent, /^#[0-9a-f]{6}#[0-9a-f]{6}$/);
});

test("composant : tuile Personnalisé, états accessibles, noms de champs inchangés, i18n", () => {
  const src = fs.readFileSync("src/components/admin/ThemePicker.tsx", "utf8");
  assert.match(src, /data-testid="theme-custom"/);
  assert.match(src, /aria-pressed=\{custom\}/);
  assert.match(src, /aria-pressed=\{on\}/);
  assert.match(src, /matchPalette\(bg, ac\)/);
  assert.match(src, /forced \? CUSTOM_PALETTE/);
  assert.match(src, /name="background"/);
  assert.match(src, /name="accent"/);
  assert.match(src, /showFields = advanced \|\| custom \|\| wantCustom/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8"), /custom: t\("theme\.custom"\)/);
  for (const l of ["fr", "en"]) assert.ok(JSON.parse(fs.readFileSync(`src/locales/${l}.json`, "utf8"))["theme.custom"]);
});
