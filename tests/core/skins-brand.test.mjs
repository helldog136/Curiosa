// Le nom « Curiosa » du crédit ne change jamais d'allure, pour aucun skin (docs/SKINS.md §9.4, src/core/skins/brand.ts) :
// l'assainisseur refuse, le cœur a le dernier mot dans la feuille, le composant est unique (site public ET administration), le banc embarque la vraie police.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copySkin } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const { validateSkinFolder } = await import("@/core/skins/validate");
const { composeSkin } = await import("@/core/skins/compose");
const { renderSheet } = await import("@/core/skins/sheet");
const { BASIC } = await import("@/core/skins/basic");
const { NO_RETOUCHES } = await import("@/core/skins/types");
const { PARTS } = await import("@/core/skins/allowlist");
const { BRAND_MARK_CSS, BRAND_LOCKED_OWN, BRAND_LOCKED_INHERITED, BRAND_PART, BRAND_ATTRIBUTE } = await import("@/core/skins/brand");
const { makeIssue } = await import("@/core/skins/messages");

const ID = "brand-test";
const run = (css) => sanitizeSkinCss(css, { skinId: ID });
const refused = (css, prop) => {
  const r = run(css);
  assert.equal(r.ok, false, `refusé attendu : ${css}`);
  const hit = r.issues.filter((i) => i.code === "kit-brand-restyled");
  assert.ok(hit.length >= 1, `kit-brand-restyled attendu pour : ${css} ; obtenu ${r.issues.map((i) => i.code)}`);
  if (prop) assert.ok(hit.some((i) => i.message.en.includes(`(${prop})`)), `${prop} nommée dans le message`);
  assert.ok(!/text-transform|letter-spacing|font-family|font-weight|font-style|word-spacing|text-decoration|font-variant|font-feature|font-size/.test(r.css), `la déclaration est retirée de la feuille : ${r.css}`);
  return r;
};

test("la pièce `brand-mark` est dans l'allowlist (ajout additif, juste après `credit`) et dans la référence des pièces publiées", () => {
  assert.ok(PARTS.includes(BRAND_PART));
  assert.equal(PARTS[PARTS.indexOf("credit") + 1], "brand-mark");
  const baseline = JSON.parse(fs.readFileSync("docs/skins-parts-baseline.json", "utf8"));
  assert.ok(baseline.parts.includes("brand-mark"));
  // La référence est celle de la dernière version PUBLIÉE : une pièce ajoutée depuis (« nouvelle », signalée par `skin:official`) n'y figure pas encore ; aucune pièce publiée ne disparaît ni ne change d'ordre.
  assert.deepEqual([...PARTS].filter((p) => baseline.parts.includes(p)), baseline.parts, "la référence est une sous-suite ordonnée de l'allowlist");
  assert.equal(sanitizeSkinCss('[data-skin-part="brand-mark"]{color:red}', { skinId: ID }).ok, true);
});

test("refusé : sélecteur direct sur la pièce, avec chacune des propriétés verrouillées", () => {
  const values = {
    font: "italic 700 1rem Georgia", "font-family": "Georgia, serif", "font-weight": "400", "font-style": "normal", "font-variant": "small-caps", "font-variant-caps": "all-small-caps",
    "font-feature-settings": '"smcp"', "text-transform": "uppercase", "letter-spacing": "0.2em", "word-spacing": "0.5em", "font-size": "2rem",
    "text-decoration": "none", "text-decoration-line": "none", "text-decoration-style": "wavy", "text-decoration-thickness": "4px", "text-underline-offset": "6px",
  };
  for (const [prop, v] of Object.entries(values)) {
    assert.ok(BRAND_LOCKED_OWN.has(prop), prop);
    refused(`[data-skin-part="brand-mark"] { ${prop}: ${v}; }`, prop);
  }
  refused('[data-skin-part="brand-mark"]:hover { text-transform: uppercase; }', "text-transform");
  refused('[data-skin-part="brand-mark"]::first-letter { text-transform: uppercase; }', "text-transform");
  refused('@media (min-width: 40rem) { [data-skin-part="brand-mark"] { letter-spacing: 1px; } }', "letter-spacing");
  refused('[data-skin-part="credit"] [data-skin-part="brand-mark"], [data-skin-part="card"] { font-family: serif; }', "font-family");
  refused('[data-skin-part="card"], :is([data-skin-part="brand-mark"], [data-skin-part="badge"]) { font-style: normal; }', "font-style");
});

test("refusé : par le lien du crédit (`credit a`, `credit > a`, `a:hover`, attribut seul)", () => {
  for (const sel of [
    '[data-skin-part="credit"] a', '[data-skin-part="credit"] > a', '[data-skin-part="credit"] a:hover', '[data-skin-region="footer"] [data-skin-part="credit"] a',
    '[data-skin-part="credit"] [rel~="noopener"]', ':is([data-skin-part="credit"], [data-skin-part="footer-text"]) a', '[data-skin-part="credit"] a::before',
  ]) {
    refused(`${sel} { text-transform: uppercase; }`, "text-transform");
    refused(`${sel} { font-family: Georgia, serif; font-weight: 900; }`);
  }
});

test("refusé : par héritage, une propriété héritée posée sur le crédit lui-même", () => {
  for (const prop of BRAND_LOCKED_INHERITED) {
    if (prop === "font-feature-settings" || prop === "font" || prop.startsWith("font-variant") || ["font-variation-settings", "font-kerning", "font-stretch", "font-synthesis", "font-optical-sizing"].includes(prop)) continue; // valeurs non listées ici : couvertes ci-dessous
    const v = { "font-family": "Georgia, serif", "font-weight": "300", "font-style": "italic", "text-transform": "uppercase", "letter-spacing": "0.2em", "word-spacing": "0.1em" }[prop];
    if (v) refused(`[data-skin-part="credit"] { ${prop}: ${v}; }`, prop);
  }
  refused('[data-skin-part="credit"] { font-variant: small-caps; }', "font-variant");
  refused('[data-skin-part="credit"] { font: italic 700 1rem Georgia; }', "font");
  refused('[data-skin-part="credit"] { font-feature-settings: "smcp"; }', "font-feature-settings");
  refused('[data-skin-part="credit"]:hover { text-transform: capitalize; }', "text-transform");
  // les autres déclarations de la même règle restent
  const r = run('[data-skin-part="credit"] { color: red; text-transform: uppercase; margin-block: 1rem; }');
  assert.match(r.css, /color:red;margin-block:1rem/);
  assert.doesNotMatch(r.css, /text-transform/);
});

test("un skin neutre passe : couleur, fond, alignement et marge du mot ; taille et couleur du crédit ; liens du pied ; soulignement des liens du pied", () => {
  const ok = [
    '[data-skin-part="brand-mark"] { color: var(--v-fg); }',
    '[data-skin-part="brand-mark"]:hover { color: var(--v-accent); background-color: transparent; }',
    '[data-skin-part="brand-mark"] { margin-inline: 0.25rem; vertical-align: baseline; text-align: center; }',
    '[data-skin-part="credit"] { color: var(--v-muted); font-size: 0.75rem; margin-block: 1rem; text-align: center; }',
    '[data-skin-part="credit"] a { color: var(--v-fg); }',
    '[data-skin-part="credit"] a:hover { color: var(--v-accent); }',
    '[data-skin-part="footer-link"] { text-transform: uppercase; letter-spacing: 0.1em; text-decoration: none; }',
    '[data-skin-part="footer-text"] { font-family: var(--v-font); }',
    '[data-skin-region="footer"] { font-style: normal; }',
  ].join("\n");
  const r = run(ok);
  assert.equal(r.ok, true, JSON.stringify(r.issues.map((i) => `${i.code} ${i.message.en}`)));
  assert.ok(!r.issues.some((i) => i.code === "kit-brand-restyled"));
});

test("le message est simple, en FR et EN, avec un exemple et la propriété nommée", () => {
  const i = makeIssue("kit-brand-restyled", { prop: "text-transform" });
  assert.equal(i.severity, "error");
  assert.match(i.message.fr, /nom Curiosa/);
  assert.match(i.message.en, /name Curiosa/);
  assert.match(i.message.fr, /\(text-transform\)/);
  assert.match(i.hint.fr, /\[data-skin-part="brand-mark"\] \{ color: var\(--v-fg\); \}/);
  assert.match(i.hint.en, /\[data-skin-part="brand-mark"\] \{ color: var\(--v-fg\); \}/);
});

test("installation : un skin qui restyle le nom est refusé ; relecture d'un skin déjà installé : avertissement, déclaration retirée, skin gardé", () => {
  const tmp = makeTempDir("curiosa-brand-");
  try {
    const dir = path.join(tmp, "brand-old");
    copySkin("plain-light", dir, { id: "brand-old", patch: (m) => { m.minCore = "0.4.0"; }, files: { "skin.css": '[data-skin-part="credit"] a { color: var(--v-fg); text-transform: none; letter-spacing: normal; }\n' } });
    const install = validateSkinFolder(dir, { coreVersion: "0.6.0", expectId: "brand-old" });
    assert.equal(install.ok, false);
    assert.ok(install.issues.some((i) => i.code === "kit-brand-restyled" && i.severity === "error"));
    const reading = validateSkinFolder(dir, { coreVersion: "0.6.0", expectId: "brand-old", reading: true });
    assert.equal(reading.ok, true, JSON.stringify(reading.issues.map((i) => i.code)));
    assert.ok(reading.issues.some((i) => i.code === "kit-brand-restyled" && i.severity === "warning"));
    assert.match(reading.css, /color:var\(--v-fg\)/);
    assert.doesNotMatch(reading.css, /text-transform|letter-spacing/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("la feuille du site : la règle du cœur vient APRÈS la feuille du skin, en !important, pour basic comme pour un skin", () => {
  const skinCss = ':root[data-skin="test-duo"] [data-skin-region="footer"] a{text-transform:uppercase}';
  const skin = {
    id: "test-duo", version: "1.0.0", name: { fr: "T", en: "T" }, modes: ["light"], css: skinCss, defaults: {}, options: [], deriveFromBackground: false, colorScheme: true,
    tokens: { light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: {}, common: {} },
  };
  const withSkin = renderSheet(composeSkin({ skin, retouches: NO_RETOUCHES }));
  assert.ok(withSkin.indexOf(skinCss) >= 0 && withSkin.endsWith(BRAND_MARK_CSS), "le skin d'abord, la règle du cœur en dernier");
  assert.ok(withSkin.indexOf(BRAND_MARK_CSS) > withSkin.indexOf(skinCss));
  assert.ok(renderSheet(composeSkin({ skin: BASIC, retouches: NO_RETOUCHES })).endsWith(BRAND_MARK_CSS));
});

test("la règle du cœur fixe toutes les propriétés de la liste, en !important, et ne touche ni la couleur, ni l'alignement, ni la marge", () => {
  assert.ok(BRAND_MARK_CSS.startsWith(`[${BRAND_ATTRIBUTE}]{`));
  const body = BRAND_MARK_CSS.slice(BRAND_MARK_CSS.indexOf("{") + 1, -1);
  const decls = Object.fromEntries(body.split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
  for (const p of ["font-family", "font-weight", "font-style", "text-transform", "letter-spacing", "word-spacing", "font-variant", "font-feature-settings", "text-decoration-line", "text-underline-offset", "font-size"]) {
    assert.ok(decls[p]?.endsWith("!important"), `${p} doit être fixée en !important`);
  }
  assert.match(decls["font-family"], /^var\(--curiosa-wordmark-font,/);
  assert.equal(decls["font-size"], "1.15em!important", "la taille reste relative au texte du crédit");
  assert.equal(decls["text-underline-offset"], "2px!important", "le soulignement de lien du cœur (underline-offset-2)");
  for (const p of ["color", "background-color", "margin", "text-align", "vertical-align", "text-decoration-color"]) assert.equal(decls[p], undefined, `${p} reste habillable`);
  // la police du nom est celle de wordmark.ts, par la variable
  assert.match(fs.readFileSync("src/components/brand/wordmark.ts", "utf8"), /variable:\s*"--curiosa-wordmark-font"/);
  assert.match(fs.readFileSync("src/components/brand/wordmark.ts", "utf8"), /weight:\s*"600"[\s\S]*style:\s*"italic"/);
});

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test("un seul composant écrit le nom : pied public et pied d'administration passent par CuriosaMark ; aucun autre fichier n'utilise la police du nom", () => {
  const mark = fs.readFileSync("src/components/brand/CuriosaMark.tsx", "utf8");
  assert.match(mark, /data-skin-part="brand-mark"/);
  assert.match(mark, /data-curiosa-wordmark=""/);
  assert.match(mark, /wordmark\.className \+?\}?[^`]*wordmark\.variable|\$\{wordmark\.className\} \$\{wordmark\.variable\}/);
  assert.match(fs.readFileSync("src/components/site/Footer.tsx", "utf8"), /<CuriosaMark \/>/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8"), /<CuriosaMark newTab \/>/);
  const users = sources("src").filter((f) => /brand\/wordmark"/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("CuriosaMark.tsx"));
  assert.deepEqual(users, [], "la police du nom n'est importée que par CuriosaMark");
  const raw = sources("src").filter((f) => !f.endsWith("CuriosaMark.tsx") && />\s*Curiosa\s*<\/a>/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(raw, [], "aucun lien « Curiosa » écrit à la main");
});

test("banc d'essai : le pied est celui du vrai composant, et la vraie police du nom est servie au navigateur", async () => {
  for (const L of ["fr", "en"]) {
    const html = fs.readFileSync(`testsupport/skins/bench/fragments/${L}/footer.html`, "utf8");
    assert.match(html, /<a href="https:\/\/github\.com\/helldog136\/Curiosa" rel="noopener" data-skin-part="brand-mark" data-curiosa-wordmark="" class="bench-font bench-font-var /);
  }
  const { BRAND_FONT_URL } = await import("../../testsupport/skins/bench/site.mjs");
  assert.equal(BRAND_FONT_URL, "/__bench/curiosa-wordmark.woff2");
  assert.equal(fs.readFileSync("src/components/brand/curiosa-wordmark.woff2").subarray(0, 4).toString("latin1"), "wOF2");
  const site = fs.readFileSync("testsupport/skins/bench/site.mjs", "utf8");
  assert.match(site, /@font-face\{font-family:"\$\{BRAND_FONT_FAMILY\}"/);
  assert.match(site, /\.bench-font-var\{--curiosa-wordmark-font:/);
});
