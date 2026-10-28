// Pièces de skin des modules (docs/SKINS.md §8, lot S4) : clé `skin` du module.json, validation des jetons, couche 2 de la composition, cache sans minuteur,
// sélecteurs `[data-skin-part="module.pièce"]` des skins, lisibilité des paires, principe fondateur (apparence seulement).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertSafeOutput } from "../helpers/skins-invariants.mjs";

const { parseManifest } = await import("@/core/modules/manifest");
const D = await import("@/core/modules/skinDecl");
const M = await import("@/core/skins/moduleSkin");
const P = await import("@/core/skins/moduleParts");
const { composeSkin } = await import("@/core/skins/compose");
const { renderSheet } = await import("@/core/skins/sheet");
const { sanitizeSkinCss } = await import("@/core/skins/sanitize");
const { MODULE_TOKEN_TYPES, TOKEN_BY_NAME } = await import("@/core/skins/tokens");
const { BASIC } = await import("@/core/skins/basic");

const T = (en, fr = en) => ({ fr, en });
const part = (over = {}) => ({
  id: "demo.card", name: T("Card", "Carte"), description: T("The card around each entry.", "La carte autour de chaque entrée."),
  tokens: [
    { name: "--sk-m-demo-card-radius", type: "length", default: "var(--sk-radius-card)" },
    { name: "--sk-m-demo-card-bg", type: "color", default: "var(--v-surface)" },
    { name: "--sk-m-demo-card-fg", type: "color", default: "var(--v-fg)", on: "--sk-m-demo-card-bg" },
  ],
  ...over,
});
const skinDecl = (over = {}) => ({ since: 1, parts: [part()], ...over });
const manifest = (over = {}) => ({ apiVersion: 2, id: "demo", name: T("Demo"), version: "1.0.0", minCore: "0.4.0", skin: skinDecl(), ...over });
const parse = (m) => parseManifest(JSON.parse(JSON.stringify(m)));
const errorOf = (m) => { const r = parse(m); assert.equal(r.ok, false, "le manifeste aurait dû être refusé"); return r.error; };

// ── Le manifeste ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : une clé `skin` valide est lue ; sans la clé, rien ne change", () => {
  const ok = parse(manifest());
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.manifest.skin.parts[0].tokens.length, 3);
  const without = parse(manifest({ skin: undefined }));
  assert.equal(without.ok, true);
  assert.equal(without.manifest.skin, undefined);
});

test("manifeste : les types de jetons des modules sont ceux du vocabulaire du cœur", () => {
  assert.deepEqual([...D.MODULE_SKIN_TOKEN_TYPES], [...MODULE_TOKEN_TYPES]);
});

test("manifeste : le préfixe --sk-m-<module>- est obligatoire, une pièce porte l'id de son module", () => {
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-radius-card", type: "length", default: "1rem" }] })] }) })), /skin\.parts\.0\.tokens\.0\.name/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-other-card-radius", type: "length", default: "1rem" }] })] }) })), /name/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-elsewhere-card-radius", type: "length", default: "1rem" }] })] }) })), /must start with "--sk-m-demo-"/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ id: "other.card" })] }) })), /must start with the module id/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ id: "card" })] }) })), /skin\.parts\.0\.id/);
});

test("manifeste : doublons, plafonds, `on`", () => {
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part(), part()] }) })), /duplicate/);
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `--sk-m-demo-card-x${i}`, type: "length", default: "1rem" }));
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: many.slice(0, 24) }), part({ id: "demo.badge", tokens: [many[24]] })] }) })), /24 skin tokens at most/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: Array.from({ length: 13 }, (_, i) => part({ id: `demo.p${i}x`, tokens: [] })) }) })), /parts/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-fg", type: "color", default: "#fff", on: "--sk-m-demo-nowhere" }] })] }) })), /"on" must name another color token/);
  assert.match(errorOf(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-a", type: "length", default: "1px", on: "--sk-m-demo-card-a" }] })] }) })), /"on" is only for a color token/);
});

test("principe fondateur : la déclaration ne peut décrire que de l'apparence (aucune clé de contenu, aucun type hors liste, aucune valeur qui ouvre une règle)", () => {
  // aucune clé inconnue : pas de gabarit, de texte, de masquage, de contenu
  for (const key of ["template", "html", "content", "hidden", "hide", "show", "text", "label", "css", "style", "script"]) {
    assert.equal(parse(manifest({ skin: skinDecl({ [key]: "x" }) })).ok, false, `clé de skin « ${key} » acceptée`);
    assert.equal(parse(manifest({ skin: skinDecl({ parts: [part({ [key]: "x" })] }) })).ok, false, `clé de pièce « ${key} » acceptée`);
    assert.equal(parse(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-a", type: "length", default: "1px", [key]: "x" }] })] }) })).ok, false, `clé de jeton « ${key} » acceptée`);
  }
  // types : une liste fermée de valeurs de style
  for (const type of ["string", "text", "content", "html", "url", "display", "visibility", "boolean", "image"]) {
    assert.equal(parse(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-a", type, default: "1px" }] })] }) })).ok, false, `type « ${type} » accepté`);
  }
  // valeurs par défaut : rien qui sorte d'une valeur de style
  for (const bad of ["url(https://x.test/a.png)", "url(skin:images/a.png)", "attr(title)", "1px; display:none", "red}body{display:none", "\\75rl(x)", "expression(1)", "1px !important", "<b>", "1px /* x */", "@import"]) {
    assert.equal(parse(manifest({ skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-a", type: "length", default: bad }] })] }) })).ok, false, `valeur « ${bad} » acceptée`);
  }
  // l'aperçu est un fichier .html à la racine du module
  for (const bad of ["../x.html", "/etc/x.html", "a/b.html", "x.js", "x.html.js"]) assert.equal(parse(manifest({ skin: skinDecl({ demo: bad }) })).ok, false, `demo « ${bad} » accepté`);
  assert.equal(parse(manifest({ skin: skinDecl({ demo: "skin-demo.html" }) })).ok, true);
  // les noms FR et EN sont obligatoires
  assert.equal(parse(manifest({ skin: skinDecl({ parts: [part({ name: { en: "Card" } })] }) })).ok, false);
});

// ── L'analyse d'une déclaration ──────────────────────────────────────────────────────────────────────────────────────
test("analyse : jetons valides gardés, paires de lisibilité tirées de `on`", () => {
  const a = M.analyzeModuleSkin("demo", skinDecl());
  assert.equal(a.ok, true, JSON.stringify(a.issues));
  assert.deepEqual(a.tokens.map((t) => t.name), ["--sk-m-demo-card-radius", "--sk-m-demo-card-bg", "--sk-m-demo-card-fg"]);
  assert.deepEqual(a.pairs, [{ fg: "--sk-m-demo-card-fg", bg: "--sk-m-demo-card-bg" }]);
  assert.deepEqual(a.parts.map((p) => [p.id, p.piece, p.tokens.length]), [["demo.card", "card", 3]]);
});

test("analyse : une valeur refusée par les règles des jetons est RETIRÉE (le module garde sa valeur d'origine), jamais corrigée", () => {
  const decl = skinDecl({ parts: [part({ tokens: [
    { name: "--sk-m-demo-card-radius", type: "length", default: "red" },
    { name: "--sk-m-demo-card-bg", type: "color", default: "1rem" },
    { name: "--sk-m-demo-card-shadow", type: "shadow", default: "0 1px 2px rgb(0 0 0 / .2)" },
    { name: "--sk-m-demo-card-gap", type: "duration", default: "9s" },
  ] })] });
  const a = M.analyzeModuleSkin("demo", decl);
  assert.equal(a.ok, false);
  assert.deepEqual(a.tokens.map((t) => t.name), ["--sk-m-demo-card-shadow"]);
  assert.deepEqual(a.issues.map((i) => i.code), ["module-token-invalid", "module-token-invalid", "module-token-invalid"]);
  for (const i of a.issues) assert.ok(i.message.fr && i.message.en && i.hint.fr && i.hint.en);
});

test("analyse : un jeton ne lit que les jetons communs ou ceux de son module", () => {
  const mk = (value) => skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-radius", type: "length", default: value }, { name: "--sk-m-demo-card-bg", type: "color", default: "var(--sk-m-other-card-bg)" }, { name: "--sk-m-demo-card-own", type: "length", default: "var(--sk-m-demo-card-radius)" }, { name: "--sk-m-demo-card-surf", type: "color", default: "var(--v-surface)" }] })] });
  const a = M.analyzeModuleSkin("demo", mk("var(--sk-radius-card)"));
  assert.deepEqual(a.tokens.map((t) => t.name), ["--sk-m-demo-card-radius", "--sk-m-demo-card-own", "--sk-m-demo-card-surf"]);
  assert.deepEqual(a.issues.map((i) => [i.code, i.severity]), [["module-token-reference", "error"]]);
  // un nom de variable inconnu du vocabulaire commun est refusé aussi
  assert.equal(M.analyzeModuleSkin("demo", mk("var(--nope)")).tokens.some((t) => t.name === "--sk-m-demo-card-radius"), false);
});

test("analyse : une déclaration mal formée est ignorée en entier, sans lever", () => {
  for (const raw of [null, 3, "x", {}, { since: 2, parts: [] }, { since: 1, parts: [] }, { since: 1, parts: [{ id: "demo.card" }] }]) {
    const a = M.analyzeModuleSkin("demo", raw);
    assert.equal(a.ok, false);
    assert.deepEqual(a.tokens, []);
  }
});

// ── La couche 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("couche : aucun module avec `skin` = couche vide (la composition ne change en rien)", () => {
  assert.equal(M.buildModuleSkinLayer([]).layer, M.EMPTY_MODULE_LAYER);
  assert.equal(M.buildModuleSkinLayer([{ id: "plain", skin: undefined }]).layer, M.EMPTY_MODULE_LAYER);
  assert.equal(M.EMPTY_MODULE_LAYER.version, "0");
  const a = composeSkin();
  const b = composeSkin({ moduleTokens: M.EMPTY_MODULE_LAYER.tokens, modulePairs: M.EMPTY_MODULE_LAYER.pairs });
  assert.deepEqual(b, a);
  assert.equal(renderSheet(b), renderSheet(a));
});

test("couche : ne dépend pas de l'ordre d'installation, change quand les pièces changent", () => {
  const a = { id: "alpha", skin: skinDecl({ parts: [part({ id: "alpha.card", tokens: [{ name: "--sk-m-alpha-card-radius", type: "length", default: "1rem" }] })] }) };
  const b = { id: "beta", skin: skinDecl({ parts: [part({ id: "beta.card", tokens: [{ name: "--sk-m-beta-card-radius", type: "length", default: "2rem" }] })] }) };
  const ab = M.buildModuleSkinLayer([a, b]).layer;
  const ba = M.buildModuleSkinLayer([b, a]).layer;
  assert.deepEqual(ab, ba);
  assert.notEqual(ab.version, "0");
  assert.notEqual(M.buildModuleSkinLayer([a]).layer.version, ab.version);
  assert.deepEqual(ab.byModule, { alpha: ["card"], beta: ["card"] });
  assert.deepEqual(ab.parts.map((p) => p.id), ["alpha.card", "beta.card"]);
});

test("couche : un module ne peut pas empiéter sur le préfixe d'un autre (thanks / thanks-wall)", () => {
  const short = { id: "thanks", skin: skinDecl({ parts: [part({ id: "thanks.card", tokens: [{ name: "--sk-m-thanks-card-radius", type: "length", default: "1rem" }, { name: "--sk-m-thanks-wall-card-radius", type: "length", default: "9rem" }] })] }) };
  const long = { id: "thanks-wall", skin: skinDecl({ parts: [part({ id: "thanks-wall.card", tokens: [{ name: "--sk-m-thanks-wall-card-radius", type: "length", default: "2rem" }] })] }) };
  const { layer, issues } = M.buildModuleSkinLayer([short, long]);
  assert.deepEqual(layer.tokens.map((t) => [t.name, t.default]), [["--sk-m-thanks-card-radius", "1rem"], ["--sk-m-thanks-wall-card-radius", "2rem"]]);
  assert.deepEqual(issues.map((i) => [i.moduleId, i.issue.code]), [["thanks", "module-token-clash"]]);
});

test("couche : les paires de lisibilité ne gardent que des jetons acceptés", () => {
  const bad = { id: "demo", skin: skinDecl({ parts: [part({ tokens: [{ name: "--sk-m-demo-card-bg", type: "color", default: "1rem" }, { name: "--sk-m-demo-card-fg", type: "color", default: "var(--v-fg)", on: "--sk-m-demo-card-bg" }] })] }) };
  const { layer, issues } = M.buildModuleSkinLayer([bad]);
  assert.deepEqual(layer.pairs, []);
  assert.ok(issues.some((i) => i.issue.code === "module-pair-ignored"));
});

// ── La composition ───────────────────────────────────────────────────────────────────────────────────────────────────
const LAYER = M.buildModuleSkinLayer([{ id: "demo", skin: skinDecl({ parts: [part()] }) }]).layer;
const skin = (over = {}) => ({
  id: "test-skin", version: "1.0.0", name: T("Test"), modes: ["light"], css: "", defaults: {}, options: [], deriveFromBackground: false, colorScheme: true,
  tokens: { light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, common: {}, modules: {} },
  ...over,
});

test("composition : basic reçoit les valeurs par défaut des jetons de module, rattachées aux jetons communs", () => {
  const c = composeSkin({ moduleTokens: LAYER.tokens, modulePairs: LAYER.pairs });
  const t = c.modes[0].tokens;
  assert.equal(t["--sk-m-demo-card-radius"], "var(--sk-radius-card)");
  assert.equal(t["--sk-m-demo-card-bg"], "var(--v-surface)");
  assert.equal(t["--sk-m-demo-card-fg"], "var(--v-fg)");
  // tout le reste est identique à basic sans module
  const base = composeSkin().modes[0].tokens;
  assert.deepEqual(Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith("--sk-m-"))), base);
  const sheet = renderSheet(c);
  assert.ok(sheet.includes("--sk-m-demo-card-radius:var(--sk-radius-card)"), sheet.slice(0, 400));
});

test("composition : le skin redéfinit un jeton de module (tokens.json `modules.<id>`), seulement pour un module installé", () => {
  const s = skin({ tokens: { light: skin().tokens.light, common: {}, modules: { demo: { "--sk-m-demo-card-radius": "0", "--sk-m-demo-card-bg": "#f1efe6" }, ghost: { "--sk-m-ghost-card-radius": "3rem" } } } });
  const c = composeSkin({ skin: s, moduleTokens: LAYER.tokens, modulePairs: LAYER.pairs });
  const t = c.modes[0].tokens;
  assert.equal(t["--sk-m-demo-card-radius"], "0");
  assert.equal(t["--sk-m-demo-card-bg"], "#f1efe6");
  assert.equal(t["--sk-m-demo-card-fg"], "var(--v-fg)", "ce que le skin ne définit pas vient du module, qui retombe sur basic");
  assert.equal("--sk-m-ghost-card-radius" in t, false);
  // une valeur refusée retombe sur le défaut du module
  const bad = skin({ tokens: { light: skin().tokens.light, common: {}, modules: { demo: { "--sk-m-demo-card-radius": "url(https://x.test/a)" } } } });
  assert.equal(composeSkin({ skin: bad, moduleTokens: LAYER.tokens }).modes[0].tokens["--sk-m-demo-card-radius"], "var(--sk-radius-card)");
  // un jeton de module n'est pas pris pour un jeton commun : sans la couche, le skin ne peut rien en faire
  assert.equal("--sk-m-demo-card-radius" in composeSkin({ skin: s }).modes[0].tokens, false);
});

test("composition : la lisibilité contrôle les paires de module (texte illisible sur son fond = corrigé)", () => {
  const s = skin({ tokens: { light: skin().tokens.light, common: {}, modules: { demo: { "--sk-m-demo-card-bg": "#ffffff", "--sk-m-demo-card-fg": "#f4f4f0" } } } });
  const c = composeSkin({ skin: s, moduleTokens: LAYER.tokens, modulePairs: LAYER.pairs });
  const fg = c.modes[0].tokens["--sk-m-demo-card-fg"];
  assert.notEqual(fg, "#f4f4f0");
  assert.ok(c.modes[0].changes.some((ch) => /sk-m-demo-card/.test(JSON.stringify(ch))), JSON.stringify(c.modes[0].changes));
  // la même feuille avec un texte lisible n'est pas touchée
  const ok = skin({ tokens: { light: skin().tokens.light, common: {}, modules: { demo: { "--sk-m-demo-card-bg": "#ffffff", "--sk-m-demo-card-fg": "#111111" } } } });
  const c2 = composeSkin({ skin: ok, moduleTokens: LAYER.tokens, modulePairs: LAYER.pairs });
  assert.equal(c2.modes[0].tokens["--sk-m-demo-card-fg"], "#111111");
});

// ── La feuille du skin vise les pièces des modules ──────────────────────────────────────────────────────────────────
test("feuille : [data-skin-part=\"module.pièce\"] accepté pour une pièce déclarée, refusé sinon ; le jeton du module se redéfinit dans la pièce", () => {
  const css = '[data-skin-part="demo.card"]{--sk-m-demo-card-radius:0;border:2px solid var(--v-fg);box-shadow:4px 4px 0 var(--v-fg)} [data-skin-part="demo.ghost"]{color:red} [data-skin-part="other.card"]{color:red}';
  const r = sanitizeSkinCss(css, { skinId: "test-skin", moduleParts: LAYER.byModule });
  assert.equal(r.ok, false);
  assertSafeOutput(assert, r.css, "test-skin");
  assert.ok(r.css.includes('[data-skin-part="demo.card"]{--sk-m-demo-card-radius:0;'), r.css);
  assert.ok(!r.css.includes("demo.ghost") && !r.css.includes("other.card"));
  // sans liste, toute pièce bien formée est acceptée (installation d'un skin : les modules du site ne sont pas connus)
  assert.equal(sanitizeSkinCss(css, { skinId: "test-skin" }).ok, true);
  // le principe fondateur tient aussi pour une pièce de module
  assert.equal(sanitizeSkinCss('[data-skin-part="demo.card"]{display:none}', { skinId: "test-skin", moduleParts: LAYER.byModule }).ok, false);
  assert.equal(sanitizeSkinCss('[data-skin-part="demo.card"]::before{content:attr(title)}', { skinId: "test-skin", moduleParts: LAYER.byModule }).ok, false);
});

// ── Le cache : invalidation, aucun minuteur ──────────────────────────────────────────────────────────────────────────
const fakeSource = (state) => ({
  list: async () => { state.lists++; if (state.fail) throw new Error("db down"); return state.rows.map((id) => ({ id, version: state.versions[id] ?? "1.0.0" })); },
  read: (id) => { state.reads++; if (state.broken?.has(id)) throw new Error("unreadable"); return state.files[id] ?? null; },
});

test("cache : relit quand l'empreinte ou l'invalidation le demande, jamais autrement", async () => {
  const state = { rows: ["demo", "plain"], versions: {}, files: { demo: manifest(), plain: { apiVersion: 2, id: "plain", name: T("Plain"), version: "1.0.0" } }, lists: 0, reads: 0 };
  const cache = P.createLayerCache(fakeSource(state));
  const l1 = await cache.get();
  assert.deepEqual(l1.byModule, { demo: ["card"] });
  const reads = state.reads;
  assert.equal(await cache.get(), l1, "même objet : rien n'est recalculé");
  assert.equal(state.reads, reads, "aucun fichier relu");
  // mise à jour : la version change
  state.versions.demo = "1.1.0";
  state.files.demo = manifest({ version: "1.1.0", skin: skinDecl({ parts: [part(), part({ id: "demo.badge", tokens: [] })] }) });
  const l2 = await cache.get();
  assert.deepEqual(l2.byModule, { demo: ["card", "badge"] });
  assert.notEqual(l2.version, l1.version);
  // retrait
  state.rows = ["plain"];
  assert.equal((await cache.get()).version, "0");
  // réinstallation du même numéro de version avec un autre contenu : invalidation explicite
  state.rows = ["demo", "plain"];
  assert.deepEqual((await cache.get()).byModule, { demo: ["card", "badge"] });
  state.files.demo = manifest({ version: "1.1.0", skin: skinDecl({ parts: [part({ id: "demo.badge", tokens: [] })] }) });
  assert.deepEqual((await cache.get()).byModule, { demo: ["card", "badge"] }, "sans signal, même empreinte : la copie en mémoire sert");
  cache.invalidate();
  assert.deepEqual((await cache.get()).byModule, { demo: ["badge"] });
});

test("cache : une panne ou un fichier illisible ne casse jamais le site et n'est pas gardée", async () => {
  const state = { rows: ["demo"], versions: {}, files: { demo: manifest() }, lists: 0, reads: 0, fail: true };
  const cache = P.createLayerCache(fakeSource(state));
  assert.equal(await cache.get(), M.EMPTY_MODULE_LAYER, "base illisible : couche vide");
  state.fail = false;
  assert.deepEqual((await cache.get()).byModule, { demo: ["card"] }, "la base revient : la couche revient");
  state.fail = true;
  assert.deepEqual((await cache.get()).byModule, { demo: ["card"] }, "base illisible plus tard : la dernière couche reste en service");
  // fichier illisible : réessayé à chaque fois jusqu'à ce qu'il se lise
  const s2 = { rows: ["demo"], versions: {}, files: { demo: manifest() }, lists: 0, reads: 0, broken: new Set(["demo"]) };
  const c2 = P.createLayerCache(fakeSource(s2));
  assert.equal((await c2.get()).version, "0");
  s2.broken.clear();
  assert.deepEqual((await c2.get()).byModule, { demo: ["card"] });
  // manifeste invalide ou clé `skin` mal formée : le module est ignoré
  const s3 = { rows: ["demo", "bad"], versions: {}, files: { demo: manifest(), bad: { apiVersion: 2, id: "bad", name: T("Bad"), version: "1.0.0", skin: { since: 1, parts: [{ id: "bad.card" }] } } }, lists: 0, reads: 0 };
  assert.deepEqual((await P.createLayerCache(fakeSource(s3)).get()).byModule, { demo: ["card"] });
});

test("cache : le registre des modules invalide la couche (installation, mise à jour, retrait) ; aucun minuteur dans le chemin", async () => {
  const state = { rows: ["demo"], versions: {}, files: { demo: manifest() }, lists: 0, reads: 0 };
  const saved = globalThis.curiosaModuleSkinLayer;
  globalThis.curiosaModuleSkinLayer = P.createLayerCache(fakeSource(state));
  try {
    const R = await import("@/core/modules/registry");
    assert.deepEqual((await P.getModuleSkinLayer()).byModule, { demo: ["card"] });
    state.files.demo = manifest({ skin: skinDecl({ parts: [part({ id: "demo.badge", tokens: [] })] }) });
    assert.deepEqual((await P.getModuleSkinLayer()).byModule, { demo: ["card"] });
    R.forgetModule("demo");
    assert.deepEqual((await P.getModuleSkinLayer()).byModule, { demo: ["badge"] });
    state.files.demo = manifest();
    R.resetModuleRegistry();
    assert.deepEqual((await P.getModuleSkinLayer()).byModule, { demo: ["card"] });
  } finally { globalThis.curiosaModuleSkinLayer = saved; }
  for (const file of ["moduleParts.ts", "moduleSkin.ts"]) {
    const code = fs.readFileSync(path.join(import.meta.dirname, "../../src/core/skins", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/setInterval|setTimeout|setImmediate|unref\s*\(/.test(code), `${file} : aucun minuteur`);
  }
});

test("vocabulaire : un jeton de module ne peut pas se faire passer pour un jeton commun", () => {
  for (const t of LAYER.tokens) assert.equal(TOKEN_BY_NAME.has(t.name), false);
  assert.equal(BASIC.tokens.common["--sk-m-demo-card-radius"], undefined);
});
