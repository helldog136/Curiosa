import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { hasAccent2, hasChosenSurface, gradientTextOn, contrast, mix } = await import("@/core/color");
const { THEME_PRESETS } = await import("@/core/palettes");
const read = (p) => fs.readFileSync(p, "utf8");
const css = read("src/app/globals.css");
const layout = read("src/app/(site)/layout.tsx");
const site = fs.readdirSync("src/components/site").filter((f) => f.endsWith(".tsx")).map((f) => [f, read(`src/components/site/${f}`)]);

test("hasAccent2 : seulement si accent2 est défini et différent de l'accent", () => {
  assert.equal(hasAccent2({ accent: "#e8a23b", accent2: "#5fd3cc" }), true);
  assert.equal(hasAccent2({ accent: "#e8a23b", accent2: "" }), false);
  assert.equal(hasAccent2({ accent: "#e8a23b", accent2: null }), false);
  assert.equal(hasAccent2({ accent: "#e8a23b", accent2: "#E8A23B" }), false);
  assert.equal(hasAccent2({ accent: "#e8a23b", accent2: "rouge" }), false);
  assert.equal(hasChosenSurface({ surface: "#122321" }), true);
  assert.equal(hasChosenSurface({ surface: "" }), false);
});

test("l'attribut data-accent2 n'est posé que si hasAccent2, jamais en dur", () => {
  assert.match(layout, /data-accent2=\{two \? "1" : undefined\}/);
  assert.match(layout, /const two = hasAccent2\(localized\)/);
  assert.match(layout, /data-surface=\{hasChosenSurface\(localized\)/);
});

test("règles CSS visuelles toutes scopées sur data-accent2 / data-surface", () => {
  const rest = css.slice(css.indexOf("/* Accent secondaire choisi"));
  const body = rest.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@supports[^{]*\{/g, "");
  const selectors = [...body.matchAll(/(?:^|[}\n])\s*([^{}\n][^{}]*?)\s*\{/g)].flatMap((m) => m[1].split(",")).map((x) => x.trim()).filter(Boolean);
  assert.ok(selectors.length >= 15);
  for (const s of selectors) assert.match(s, /^\[data-(accent2|surface)\]/, s);
  assert.ok(!/(^|\n)\s*\[data-btn/.test(css), "aucune règle de bouton hors data-accent2");
});

test("bouton plein scopé, repère data-btn sur le bouton d'en-tête et les boutons de panneau", () => {
  assert.match(css, /\[data-accent2\] \[data-btn="primary"\] \{ background-color: var\(--v-accent\);[^}]*color: var\(--v-accent-fg\)/);
  assert.match(site.find(([f]) => f === "Header.tsx")[1], /data-testid="header-button" data-btn="primary"/);
  assert.match(site.find(([f]) => f === "Panel.tsx")[1], /data-btn=\{on \? undefined : "primary"\}/);
});

test("dégradé : repli couleur unie avant le background-clip, panneau et liseré", () => {
  const i = css.indexOf("[data-accent2] [data-stat] { color: var(--v-accent)");
  const j = css.indexOf("background-clip: text; color: transparent");
  assert.ok(i > 0 && j > i, "couleur unie d'abord");
  assert.match(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)/);
  assert.match(css, /\[data-on="accent"\] \{ background: var\(--v-accent\); background-image: var\(--v-gradient\)/);
  assert.match(css, /header\[data-header-layout\] \{ border-image: var\(--v-gradient\) 1/);
});

test("pas de texte blanc ou noir en dur dans les nouvelles règles", () => {
  const rest = css.slice(css.indexOf("/* Accent secondaire choisi"));
  assert.ok(!/#fff|#000|white|black/i.test(rest));
});

test("texte sur le dégradé : lisible (>= 4,5) sur les deux extrémités pour les 15 palettes", () => {
  for (const p of THEME_PRESETS) {
    const fg = gradientTextOn(p.accent, p.accent2);
    for (const [name, end] of [["accent", p.accent], ["accent2", p.accent2], ["milieu", mix(p.accent, p.accent2, 0.5)]]) {
      assert.ok(contrast(fg, end) >= 4.5, `${p.id} ${name} ${contrast(fg, end).toFixed(2)}`);
    }
  }
});
