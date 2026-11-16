// Overlay appearance depth (core 0.21.0): readability default of a page, skin per element, site retouches of a skin, the optional kit tokens of skin
// contract 3. Migration: every fixture page renders byte for byte as with 0.20.0; real Chromium checks of the layers' priority.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const K = await import("@/core/overlays/appearance");
const R = await import("@/core/overlays/render");
const SS = await import("@/core/overlays/skinSheet");
const T = await import("@/core/overlays/skinTokens");
const L = await import("@/core/overlays/look");
const { parseStyle } = await import("@/core/overlays/tokens");
const { parseElements } = await import("@/core/overlays/store");
const { validatePageInput } = await import("@/core/overlays/pageInput");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { CASES, renderCase, sha } = await import("../fixtures/overlays/render-cases.mjs");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));

// ── Migration ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("migration: the 96 fixture pages (styles, skins, element looks, test mode) render byte for byte as with 0.20.0", () => {
  const golden = JSON.parse(fs.readFileSync("tests/fixtures/overlays/render-0.20.0.json", "utf8"));
  assert.equal(golden.core, "0.20.0");
  assert.equal(Object.keys(golden.hashes).length, CASES.length);
  for (const c of CASES) assert.equal(sha(renderCase(R, makeTranslator, c)), golden.hashes[c.id], c.id);
});

test("migration: stored data of 0.20.0 reads the same (no readability default, no element skin, no retouch); unknown values are dropped", () => {
  assert.deepEqual(parseStyle({ text: "light", background: "soft", corners: "round" }), { text: "light", background: "soft", corners: "round" });
  assert.deepEqual(parseStyle({ text: "light", background: "soft", corners: "round", readability: { preset: "nope" } }), { text: "light", background: "soft", corners: "round" });
  const el = { uid: "aaaaaa1111", instance: "i", element: "e", x: 0, y: 0, w: 10, h: 10, visible: true, options: {} };
  assert.equal("skin" in parseElements(JSON.stringify([el]))[0], false);
  assert.equal(parseElements(JSON.stringify([{ ...el, skin: null }]))[0].skin, null);
  assert.equal(parseElements(JSON.stringify([{ ...el, skin: "night-neon" }]))[0].skin, "night-neon");
  assert.equal("skin" in parseElements(JSON.stringify([{ ...el, skin: "Bad Id" }]))[0], false);
  assert.equal("tweaks" in L.parseLook({ skin: "night" }), false);
  assert.deepEqual(L.parseLook({ skin: "night", tweaks: { accent: "#AABBCC", surface: "red", font: "comic", corners: "square", extra: 1 } }).tweaks, { accent: "#aabbcc", corners: "square" });
});

// ── Readability default of the page ────────────────────────────────────────────────────────────────────────────────────────────────────────
const side = (style, skin = false) => ({ style: { text: "light", background: "transparent", corners: "round", ...style }, skin });
test("page readability default: elements set to Like the page wear it; an element's own setting wins; absent = the 0.17.0 behaviour", () => {
  const a = K.appliedLook(null, side({ readability: { preset: "discreet" } }), true);
  assert.equal(a.source, "page"); assert.equal(a.background, "soft"); assert.equal(a.opacity, 55);
  assert.equal(K.appliedLook({ preset: "bare" }, side({ readability: { preset: "discreet" } }), true).source, "element");
  assert.equal(K.appliedLook(null, side({}), true).source, "auto", "no default on a transparent page: the readability fix as before");
  assert.equal(K.appliedLook(null, side({ background: "soft" }), true), null, "no default on a soft page: nothing injected, as before");
  assert.equal(K.appliedLook(null, side({ background: "soft", readability: { preset: "readable" } }, true), true).source, "page", "the default applies over a skin too");
  assert.equal(K.appliedLook(null, side({ readability: { preset: "readable" } }), false), null, "an element that does not follow the style is never touched");
  assert.deepEqual(K.NEW_PAGE_READABILITY, { preset: "readable" });
  const src = fs.readFileSync("src/app/admin/(panel)/overlay-pages/actions.ts", "utf8");
  assert.match(src, /createPage\(\{[^}]*style: \{ \.\.\.DEFAULT_STYLE, readability: NEW_PAGE_READABILITY \}/, "a NEW page starts readable");
  assert.doesNotMatch(fs.readFileSync("src/core/overlays/store.ts", "utf8"), /NEW_PAGE_READABILITY/, "existing pages are never rewritten");
});

test("page validation: a readability default with an unknown value is refused under its field; an element skin must be installed (or already chosen)", () => {
  const catalog = new Map();
  const bad = validatePageInput({ name: "x", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round", readability: { preset: "loud" } }, elements: [] }, { catalog, previous: [] });
  assert.equal(bad.ok, false); assert.equal(bad.issues[0].path, "style.readability.preset");
  const ok = validatePageInput({ name: "x", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round", readability: { preset: "bare" } }, elements: [] }, { catalog, previous: [] });
  assert.deepEqual(ok.value.style.readability, { preset: "bare" });
  const el = { uid: "aaaaaa1111", instance: "gone", element: "e", x: 0, y: 0, w: 100, h: 100, visible: true, options: {} };
  const skins = new Set(["night-neon"]);
  assert.equal(validatePageInput({ name: "x", width: 1920, height: 1080, elements: [{ ...el, skin: "soft-glass" }] }, { catalog, previous: [el], skins }).issues[0].path, "elements.aaaaaa1111.skin");
  assert.equal(validatePageInput({ name: "x", width: 1920, height: 1080, elements: [{ ...el, skin: "soft-glass" }] }, { catalog, previous: [{ ...el, skin: "soft-glass" }], skins }).ok, true, "a skin removed since never blocks a save");
  assert.equal(validatePageInput({ name: "x", width: 1920, height: 1080, elements: [{ ...el, skin: null }] }, { catalog, previous: [el], skins }).value.elements[0].skin, null);
  assert.equal(validatePageInput({ name: "x", width: 1920, height: 1080, elements: [{ ...el, skin: "night-neon" }] }, { catalog, previous: [el], skins }).value.elements[0].skin, "night-neon");
});

// ── Skin contract 3, additive kit tokens ───────────────────────────────────────────────────────────────────────────────────────────────────
test("contract 3, additive: the five kit tokens are accepted and checked; absent, the core derives them; existing skins compile to the same sheet", () => {
  for (const n of ["--ov-surface-soft", "--ov-surface-solid", "--ov-fg-on-light", "--ov-fg-on-dark", "--ov-outline"]) {
    assert.equal(T.checkToken(n, "#123456").ok, true, n);
    assert.equal(T.checkToken(n, "url(x)").ok, false, n);
  }
  const base = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(20,10,40,0.8)" };
  const derived = SS.skinColors(base);
  assert.equal(derived.solid, "#140a28"); assert.equal(derived.onLight, "#111111"); assert.equal(derived.onDark, "#ffffff"); assert.equal(derived.outline, null);
  const own = SS.skinColors({ ...base, "--ov-surface-solid": "#202020", "--ov-surface-soft": "#303030", "--ov-fg-on-light": "#1a1a1a", "--ov-fg-on-dark": "#fafafa", "--ov-outline": "#000010" });
  assert.deepEqual(own, { solid: "#202020", soft: "#303030", onLight: "#1a1a1a", onDark: "#fafafa", outline: "#000010" });
  assert.deepEqual(SS.checkSkinTokens({ ...base, "--ov-surface-solid": "#eeeeee" }).map((i) => i.pair), ["--ov-fg / --ov-surface-solid"], "white text on a near-white solid panel is refused");
  assert.deepEqual(SS.checkSkinTokens({ ...base, "--ov-fg-on-dark": "#333333" }).map((i) => i.pair), ["--ov-fg-on-dark / #000000"]);
  assert.deepEqual(SS.checkSkinTokens(base), []);
  // A skin without the new tokens: the same css as before (only `colors` is added to the payload, never to the sheet).
  const sheet = SS.compileSkin({ id: "night", version: "1", tokens: base, css: "" });
  assert.doesNotMatch(sheet.css, /surface-soft|surface-solid|fg-on-|--ov-outline/);
});

test("contract 3 stays readable by older cores: skin installation reads minCore BEFORE the tokens (an older core says 'needs a newer core', never 'unknown token')", () => {
  const src = fs.readFileSync("src/core/skins/validate.ts", "utf8");
  const core = src.indexOf('add("manifest-core-newer"'), bail = src.indexOf("if (hasErrors(issues)) return fail();   // le reste dépend d'un manifeste sain"), overlay = src.indexOf("return runOverlay(");
  assert.ok(core > 0 && bail > core && overlay > bail, "minCore check, then stop on error, then the overlay tokens");
});

test("element kit with the skin's colours: background and text pair from the skin, outline colour from the skin; without a skin, the usual colours", () => {
  const colors = { solid: "#2a1040", soft: "#40205a", onLight: "#1a1a1a", onDark: "#fff6e0", outline: "#100018" };
  const a = K.appliedLook({ preset: "readable", colorFrom: "skin" }, side({}, true), true, colors);
  assert.equal(a.color, "#2a1040"); assert.equal(a.text, "light"); assert.equal(a.fg, "#fff6e0"); assert.equal(a.outlineColor, "#100018");
  assert.match(K.lookCss(a), /--ov-fg:#fff6e0!important/); assert.match(K.lookCss(a), /rgba\(16,0,24,0\.92\)/);
  assert.equal(K.appliedLook({ preset: "discreet", colorFrom: "skin" }, side({}, true), true, colors).color, "#40205a");
  assert.equal(K.appliedLook({ preset: "readable", colorFrom: "skin", color: "#000000" }, side({}, true), true, colors).color, "#000000", "an own colour wins");
  const plain = K.appliedLook({ preset: "readable", colorFrom: "skin" }, side({}), true, null);
  assert.equal(plain.color, "#14171c"); assert.equal(plain.fg, undefined);
  assert.equal(K.readabilityOf(a).ok, true);
  assert.equal(K.checkElementStyle({ colorFrom: "page" }).ok, false);
  assert.equal(K.presetShown({ preset: "readable", colorFrom: "skin" }), "custom");
});

// ── Retouches ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("retouches: written after the skin's tokens, before its rules; the panel keeps the skin's opacity; the text colour is corrected to keep 4.5:1", () => {
  const tokens = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.8)", "--ov-accent": "#ff0055", "--ov-font": "Georgia, serif" };
  const tw = SS.tweakTokens(tokens, { surface: "#f0f0e8", accent: "#ffd400", font: "mono", corners: "square" });
  assert.equal(tw["--ov-surface"], "rgba(240,240,232,0.8)");
  assert.equal(tw["--ov-fg"], "#111111", "white on a light panel would be unreadable: dark text");
  assert.equal(tw["--ov-accent-fg"], "#111111");
  assert.match(tw["--ov-font"], /monospace/); assert.equal(tw["--ov-radius"], "0px");
  assert.equal(SS.tweakTokens(tokens, { surface: "#101010" })["--ov-fg"], undefined, "a dark panel keeps the skin's white text");
  const sheet = SS.compileSkin({ id: "night", version: "1", tokens, css: "html[data-ov-skin=\"night\"] [data-ov-part=\"panel\"]{color:red}", tweaks: { surface: "#f0f0e8" } }).css;
  assert.match(sheet.split("\n")[0], /--ov-surface:rgba\(240,240,232,0\.8\)!important/);
  assert.ok(sheet.indexOf("rgba(240,240,232") < sheet.indexOf("color:red"), "the skin's own rules come after (they keep their place)");
  assert.equal(SS.compileSkin({ id: "night", version: "1", tokens, css: "", tweaks: {} }).css, SS.compileSkin({ id: "night", version: "1", tokens, css: "" }).css, "no retouch, same sheet");
});

// ── Skin per element: the public page ──────────────────────────────────────────────────────────────────────────────────────────────────────
const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
const look0 = { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } };
const payload = (id, tokens) => ({ ...SS.compileSkin({ id, version: "1.0.0", tokens, css: "" }), key: `${id}@1` });
function skinPage({ pageSkin = true, own = [], elementSkins = new Map(), src = (k) => `/el/${k}` } = {}) {
  const pg = { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { text: "light", background: "transparent", corners: "round" }, look: pageSkin ? { ...look0, skin: "night" } : look0, elements: [], rev: 1, testUntil: null };
  const elements = own.map((skin, i) => ({ el: { uid: `u${i}abcdefgh`, instance: "i", element: "e", x: 0, y: i * 300, w: 640, h: 260, visible: true, options: {}, ...(skin !== undefined ? { skin } : {}) }, title: `E${i}`, status: "ok", layout, follows: true, src: src(i) }));
  const skin = pageSkin ? payload("night", { "--ov-fg": "#ffffff", "--ov-surface": "rgba(80,10,10,0.95)" }) : null;
  return R.renderPage({ page: pg, elements, t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "", skin, elementSkins });
}
const sky = payload("sky", { "--ov-fg": "#111111", "--ov-surface": "rgba(220,240,255,0.95)" });

test("skin per element: frames carry data-eskin, the page script picks their own sheet; a page without one keeps the 0.20.0 script byte for byte", () => {
  const html = skinPage({ own: [undefined, "sky", null], elementSkins: new Map([["sky", sky]]) });
  const tags = html.match(/<iframe [^>]*>/g);
  assert.doesNotMatch(tags[0], /data-eskin/);
  assert.match(tags[1], /data-eskin="0"/); assert.match(tags[2], /data-eskin="1"/);
  assert.match(html, /"es":\[\{"id":"sky","css":"html\[data-ov-skin=\\"sky\\"\]/);
  assert.match(html, /"id":"","css":""\}\]/);
  assert.match(html, /var X=f\.getAttribute\("data-eskin"\),Q=X===null\?S:/); assert.match(html, /ns\.replaceSync\(Q\.css\)/); assert.match(html, /el\.setAttribute\("data-ov-skin",Q\.id\)/);
  assert.equal(R.pollScript(false).includes("data-eskin"), false);
  for (const [a, b] of [['if(S.css&&w.CSSStyleSheet', 1], ["ns.replaceSync(S.css)", 1], ['el.setAttribute("data-ov-skin",S.id)', 1]]) assert.equal(R.pollScript(false).split(a).length - 1, b, `the 0.20.0 script has exactly one ${a}`);
  const plain = skinPage({ own: [undefined, undefined] });
  assert.doesNotMatch(plain, /data-eskin|"es":|var X=/);
  // A skin that was not loaded (more than 6 on the page): the element wears the page's skin.
  assert.doesNotMatch(skinPage({ own: ["far-away"], elementSkins: new Map() }), /data-eskin/);
});

test("skin per element: the kit's 'auto' fix and colours follow the skin the element wears, not the page's", () => {
  const html = skinPage({ pageSkin: false, own: [undefined, "sky"], elementSkins: new Map([["sky", sky]]) });
  const tags = html.match(/<iframe [^>]*>/g);
  assert.match(tags[0], /data-look="0"/, "no skin on a transparent page: the readability fix");
  assert.doesNotMatch(tags[1], /data-look=/, "its own skin brings its panel: no fix");
});

// ── Real Chromium ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";
const PANEL = '<!doctype html><meta charset="utf-8"><style>:root{--ov-surface:transparent;--ov-fg:#eee}html,body{margin:0;background:transparent}[data-ov-part="panel"]{padding:12px;background:var(--ov-surface);color:var(--ov-fg)}</style><div data-ov-region="element"><div data-ov-part="panel"><span data-ov-part="text">lune_douce</span></div></div>';
async function inBrowser(html) {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(req.url.startsWith("/el/") ? PANEL : html); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/page`);
    await p.waitForFunction(() => [...document.querySelectorAll("iframe")].every((f) => f.contentDocument?.readyState === "complete" && f.style.opacity !== "0"), null, { timeout: 10000 });
    return await p.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => { const d = f.contentDocument, panel = d.querySelector('[data-ov-part="panel"]'); return { skin: d.documentElement.getAttribute("data-ov-skin"), bg: getComputedStyle(panel).backgroundColor, fg: getComputedStyle(d.querySelector('[data-ov-part="text"]')).color }; }));
  } finally { await browser.close(); server.close(); }
}

test("real browser: page skin, own skin and no skin side by side; a retouched page skin changes its panel and keeps the text readable", { skip: skipBrowser, timeout: 60000 }, async () => {
  const [follows, own, none] = await inBrowser(skinPage({ own: [undefined, "sky", null], elementSkins: new Map([["sky", sky]]) }));
  assert.deepEqual([follows.skin, follows.bg], ["night", "rgba(80, 10, 10, 0.95)"]);
  assert.deepEqual([own.skin, own.bg, own.fg], ["sky", "rgba(220, 240, 255, 0.95)", "rgb(17, 17, 17)"]);
  assert.equal(none.skin, null, "no skin: the element keeps its own tokens");
  const tweaked = { ...SS.compileSkin({ id: "night", version: "1.0.0", tokens: { "--ov-fg": "#ffffff", "--ov-surface": "rgba(80,10,10,0.95)" }, css: "", tweaks: { surface: "#f4f1e8" } }), key: "night@1:t" };
  const pg = { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { text: "light", background: "soft", corners: "round" }, look: { ...look0, skin: "night" }, elements: [], rev: 1, testUntil: null };
  const html = R.renderPage({ page: pg, elements: [{ el: { uid: "uabcdefgh0", instance: "i", element: "e", x: 0, y: 0, w: 640, h: 260, visible: true, options: {} }, title: "E", status: "ok", layout, follows: true, src: "/el/0" }], t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "", skin: tweaked });
  const [t] = await inBrowser(html);
  assert.equal(t.bg, "rgba(244, 241, 232, 0.95)"); assert.equal(t.fg, "rgb(17, 17, 17)");
});

// ── Editor texts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = ["ovp.ed.pageLook", "ovp.ed.pageLookHelp", "ovp.ed.pageLook.none", "ovp.ed.pageMore", "ovp.ed.look.fromPage", "ovp.ed.look.colorFromSkin", "ovp.ed.look.skin", "ovp.ed.look.skinHelp", "ovp.ed.look.skin.page", "ovp.ed.look.skin.none", "ovp.err.lookSkin",
  ...Object.keys(fr).filter((k) => k.startsWith("ovp.tweak."))];
test("texts: FR/EN for every new word, same variables, short labels without a final colon, glossary entries", () => {
  assert.ok(KEYS.length >= 36);
  const vars = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of KEYS) {
    assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k);
    for (const t of [fr[k], en[k]]) { if (!/[Hh]elp$|Confirm$|^ovp\.err\./.test(k)) assert.ok(t.length <= 60, `${k}: ${t}`); assert.doesNotMatch(t, /:\s*$|!/, k); }
  }
  const page = fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8");
  for (const k of KEYS.filter((x) => x.startsWith("ovp.ed."))) assert.ok(page.includes(`"${k.slice(7)}"`), `${k} sent to the editor`);
  const tr = fs.readFileSync("docs/TRANSLATING.md", "utf8");
  for (const w of ["default readability", "skin retouches", "skin of this element"]) assert.ok(tr.includes(`| ${w} |`), w);
});

test("editor: the page card shows Default readability and the text size; the common style is folded with a summary", async () => {
  const { OverlayEditor } = await import("@/components/admin/OverlayEditor");
  const strings = Object.fromEntries(Object.entries(fr).filter(([k]) => k.startsWith("ovp.ed.")).map(([k, v]) => [k.slice(4), v]));
  const html = renderToStaticMarkup(React.createElement(OverlayEditor, {
    initial: { name: "Jeu", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round", readability: { preset: "readable" } }, elements: [] },
    available: [], resolutions: [[1920, 1080]], limits: { elements: 30, fold: 3, minSide: 320, maxSide: 7680 }, previewSrc: "/x", strings, pageId: "p1",
  }));
  assert.match(html, /Lisibilité par défaut/);
  const card = html.slice(0, html.indexOf("Aperçu à"));
  const top = card.replace(/<details[\s\S]*?<\/details>/g, "");
  assert.ok((top.match(/<fieldset|<select|<input(?![^>]*type="(hidden|radio)")/g) ?? []).length <= 5, "R4: five visible fields at most in the page card");
  assert.match(card, /<details[^>]*data-more-options[\s\S]*Style commun[\s\S]*Clair · Transparent · Arrondis/);
});
