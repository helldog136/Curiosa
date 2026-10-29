import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { matchPalette, THEME_PRESETS, CUSTOM_PALETTE, PALETTE_ALIASES, resolvePaletteId } = await import("@/core/palettes");

const ORIGINAL = ["night", "ocean", "forest", "rose", "violet", "daylight", "paper"];
const byId = (id) => THEME_PRESETS.find((p) => p.id === id);
const full = (p, over = {}) => { const q = { ...p, ...over }; return matchPalette(q.background, q.accent, q.accent2, q.surface, q.text); };

test("14 palettes complètes, ids distincts, couleurs en minuscules, les 7 d'origine en tête", () => {
  assert.equal(THEME_PRESETS.length, 15);
  assert.deepEqual(THEME_PRESETS.slice(0, 7).map((p) => p.id), ORIGINAL);
  assert.deepEqual(THEME_PRESETS.slice(7).map((p) => p.id), ["ember", "arcade", "vinyl", "workshop", "stadium", "solidarity", "boutique", "lagoon"]);
  assert.equal(new Set(THEME_PRESETS.map((p) => p.id)).size, 15);
  assert.equal(new Set(THEME_PRESETS.map((p) => p.background + p.accent)).size, 15, "chaque couple fond/accent est unique");
  for (const p of THEME_PRESETS) {
    for (const k of ["background", "surface", "text", "accent", "accent2"]) assert.match(p[k], /^#[0-9a-f]{6}$/, `${p.id}.${k}`);
    assert.ok(p.mode === "dark" || p.mode === "light");
  }
});

test("valeurs exactes du rapport : fond, accent et accent 2 des palettes", () => {
  const expected = { night: ["#121214", "#e8a23b", "#7aa2ff"], ocean: ["#0b1220", "#38bdf8", "#fb7185"], forest: ["#0f1a14", "#4ade80", "#facc15"], rose: ["#1a0f14", "#f472b6", "#22d3ee"],
    violet: ["#14111f", "#a78bfa", "#f0abfc"], daylight: ["#fafafa", "#2563eb", "#7c3aed"], paper: ["#f5f0e6", "#c2410c", "#0f766e"], arcade: ["#0d0221", "#ff2a6d", "#05d9e8"],
    vinyl: ["#181414", "#f43f5e", "#fbbf24"], workshop: ["#1c1917", "#e07a5f", "#81b29a"], stadium: ["#f3f6fb", "#c2410c", "#1d4ed8"], solidarity: ["#fbf8f3", "#15803d", "#0369a1"],
    ember: ["#0b1716", "#e8782f", "#5fd3cc"], boutique: ["#fff7f5", "#be185d", "#6d28d9"], lagoon: ["#effcf8", "#0f766e", "#be185d"] };
  for (const [id, [background, accent, accent2]] of Object.entries(expected)) assert.deepEqual([byId(id).background, byId(id).accent, byId(id).accent2], [background, accent, accent2], id);
  assert.deepEqual([byId("night").surface, byId("night").text], ["#1d1d21", "#f4f4f5"]);
  assert.deepEqual([byId("lagoon").surface, byId("lagoon").text], ["#ffffff", "#12302a"]);
});

test("chaque palette complète est reconnue, en minuscules comme en majuscules ou avec des espaces", () => {
  for (const p of THEME_PRESETS) {
    assert.equal(full(p), p.id);
    assert.equal(matchPalette(p.background.toUpperCase(), p.accent.toUpperCase(), p.accent2.toUpperCase(), p.surface.toUpperCase(), p.text.toUpperCase()), p.id);
    assert.equal(matchPalette(` ${p.background} `, p.accent, ` ${p.accent2}`, p.surface, p.text), p.id);
  }
});

test("site existant : fond + accent d'une palette d'origine, sans rien d'autre, reste reconnu", () => {
  for (const id of ORIGINAL) {
    const p = byId(id);
    assert.equal(matchPalette(p.background, p.accent), id, id);
    assert.equal(matchPalette(p.background, p.accent, "", "", ""), id, `${id} (champs vides)`);
    assert.equal(matchPalette(p.background, p.accent, null, undefined, "  "), id, `${id} (absents)`);
    assert.equal(matchPalette(p.background.toUpperCase(), p.accent.toUpperCase()), id);
  }
});

test("les 7 nouvelles palettes ne sont PAS reconnues sans leurs autres couleurs", () => {
  for (const p of THEME_PRESETS.slice(7)) assert.equal(matchPalette(p.background, p.accent), CUSTOM_PALETTE, p.id);
});

test("une surcharge ou un accent 2 qui ne correspond pas => personnalisé", () => {
  const night = byId("night");
  assert.equal(matchPalette(night.background, night.accent, "#7aa2ff"), CUSTOM_PALETTE, "accent 2 seul : pas la palette complète");
  assert.equal(matchPalette(night.background, night.accent, "", "#1d1d21"), CUSTOM_PALETTE, "surface seule");
  assert.equal(matchPalette(night.background, night.accent, "", "", "#f4f4f5"), CUSTOM_PALETTE, "texte seul");
  assert.equal(full(night, { accent2: "#7aa2fe" }), CUSTOM_PALETTE, "accent 2 voisin");
  assert.equal(full(night, { surface: "#1d1d22" }), CUSTOM_PALETTE, "surface voisine");
  assert.equal(full(night, { text: "#ffffff" }), CUSTOM_PALETTE, "texte différent");
  assert.equal(full(night, { accent2: "" }), CUSTOM_PALETTE, "palette complète amputée de son accent 2");
  assert.equal(matchPalette(night.background, night.accent, night.accent), CUSTOM_PALETTE, "accent 2 = accent : réglage choisi, pas la palette");
});

test("un seul champ juste ou un croisement => personnalisé", () => {
  assert.equal(matchPalette("#121215", "#e8a23b"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#121214", "#e8a23c"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#121214", "#38bdf8"), CUSTOM_PALETTE, "fond de Nuit + accent d'Océan");
  assert.equal(matchPalette("#0b1220", "#e8a23b"), CUSTOM_PALETTE);
  assert.equal(matchPalette("#123", "#abc"), CUSTOM_PALETTE);
  const o = byId("ocean"), n = byId("night");
  assert.equal(matchPalette(n.background, n.accent, o.accent2, o.surface, o.text), CUSTOM_PALETTE, "couleurs d'une autre palette");
});

test("valeurs invalides => personnalisé, sans erreur", () => {
  for (const bad of [undefined, null, "", 5, {}, "nuit", "#12121"]) {
    assert.equal(matchPalette(bad, "#e8a23b"), CUSTOM_PALETTE);
    assert.equal(matchPalette("#121214", bad), CUSTOM_PALETTE);
  }
  for (const bad of [5, {}, []]) for (let i = 2; i <= 4; i++) {
    const args = ["#121214", "#e8a23b", "", "", ""]; args[i] = bad;
    assert.equal(matchPalette(...args), CUSTOM_PALETTE, `argument ${i} invalide`);
  }
  assert.equal(matchPalette(), CUSTOM_PALETTE);
});

test("composant : tuile Personnalisé, états accessibles, noms de champs, couleur secondaire, avertissement, i18n", () => {
  const src = fs.readFileSync("src/components/admin/ThemePicker.tsx", "utf8");
  assert.match(src, /data-testid="theme-custom"/);
  assert.match(src, /aria-pressed=\{custom\}/);
  assert.match(src, /aria-pressed=\{on\}/);
  assert.match(src, /matchPalette\(bg, ac, a2, sf, tx\)/);
  assert.match(src, /forced \? CUSTOM_PALETTE/);
  // les noms des champs portent un préfixe (vide : background, accent… comme toujours ; `light_` / `dark_` pour un skin à deux modes)
  assert.match(src, /name=\{`\$\{prefix\}background`\}/);
  assert.match(src, /name=\{`\$\{prefix\}accent`\}/);
  for (const n of ["accent2", "surface", "text"]) assert.match(src, new RegExp("<input type=\"hidden\" name=\\{`\\$\\{prefix\\}" + n + "`\\}"), n);
  assert.match(src, /showFields = advanced \|\| custom \|\| wantCustom/);
  assert.match(src, /\{advanced && \(/, "surface et texte : version avancée seulement");
  assert.match(src, /contrastIssues\(/);
  assert.match(src, /data-testid="theme-add-second"/);
  assert.match(src, /data-testid="theme-remove-second"/);
  const page = fs.readFileSync("src/app/admin/(panel)/appearance/page.tsx", "utf8");
  assert.match(page, /THEME_PRESETS\.map\(\(p\) => p\.id\)/);
  assert.match(page, /text: config\.textColor/);
  for (const l of ["fr", "en"]) {
    const dict = JSON.parse(fs.readFileSync(`src/locales/${l}.json`, "utf8"));
    for (const id of [...THEME_PRESETS.map((p) => p.id), "custom"]) assert.ok(dict[`theme.${id}`], `${l} theme.${id}`);
  }
});

test("ancien identifiant « rosaliax » : lu comme alias de « ember » (mêmes couleurs), jamais affiché, jamais écrit", () => {
  assert.deepEqual(PALETTE_ALIASES, { rosaliax: "ember" });
  for (const old of ["rosaliax", "Rosaliax", " ROSALIAX "]) assert.equal(resolvePaletteId(old), "ember", old);
  assert.equal(resolvePaletteId("ember"), "ember");
  assert.equal(resolvePaletteId("lagoon"), "lagoon");
  assert.equal(resolvePaletteId(CUSTOM_PALETTE), CUSTOM_PALETTE);
  for (const bad of ["", "inconnue", "__proto__", "constructor", null, undefined, 3, {}]) assert.equal(resolvePaletteId(bad), null, String(bad));
  assert.ok(!THEME_PRESETS.some((p) => p.id in PALETTE_ALIASES), "un alias n'est jamais un identifiant de palette");
  assert.ok(Object.values(PALETTE_ALIASES).every((id) => THEME_PRESETS.some((p) => p.id === id)), "chaque alias mène à une palette qui existe");
});

test("la palette renommée garde EXACTEMENT ses cinq couleurs (un site qui les a enregistrées s'affiche à l'identique)", () => {
  const p = byId("ember");
  assert.deepEqual([p.mode, p.background, p.surface, p.text, p.accent, p.accent2], ["dark", "#0b1716", "#122321", "#e9f3f1", "#e8782f", "#5fd3cc"]);
  assert.equal(matchPalette("#0b1716", "#e8782f", "#5fd3cc", "#122321", "#e9f3f1"), "ember");
});

test("noms de la palette dans les deux langues, sans nom propre ; l'ancienne clé de traduction n'existe plus", () => {
  const fr = JSON.parse(fs.readFileSync(new URL("../../src/locales/fr.json", import.meta.url), "utf8"));
  const en = JSON.parse(fs.readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8"));
  assert.equal(fr["theme.ember"], "Sarcelle et braise");
  assert.equal(en["theme.ember"], "Teal and ember");
  for (const d of [fr, en]) assert.ok(!("theme.rosaliax" in d));
  for (const p of THEME_PRESETS) for (const d of [fr, en]) assert.ok(d[`theme.${p.id}`], `theme.${p.id}`);
});
