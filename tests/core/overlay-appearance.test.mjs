// Appearance kit of overlay elements (core 0.17.0): contrast maths, presets, the readability fix of unreadable elements, stored data and validation,
// the public page (migration against the 0.16.0 output), a REAL Chromium render (no fake DOM), and the editor panel (texts, field budget, parity).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const K = await import("@/core/overlays/appearance");
const R = await import("@/core/overlays/render");
const { contrastRatio, composite } = await import("@/core/skins/readability");
const { parseElements } = await import("@/core/overlays/store");
const { validatePageInput } = await import("@/core/overlays/pageInput");
const { issueMessages } = await import("@/core/overlays/messages");
const { addElement, setLook } = await import("@/core/overlays/editorModel");
const { compileSkin } = await import("@/core/overlays/skinSheet");
const { ownerSurfaceCss } = await import("@/core/overlays/tokens");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { OverlayLookPanel } = await import("@/components/admin/OverlayLookPanel");
const { labelProblems, toneProblems, forbiddenWords, FORM_FIELDS_MAX, HELP_INLINE_MAX } = await import("../../testsupport/ergonomics.mjs");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));

const page = (background = "transparent", text = "light", skin = false) => ({ style: { text, background }, skin });

// ── Contrast maths ────────────────────────────────────────────────────────────────────────────────────────────────────
test("contrast: same results as the skin checker, and the thresholds of the design (white on black: 54 % for 4.5:1, 65 % for 7:1)", () => {
  assert.equal(Math.round(K.ratio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })), 21);
  for (const [a, b] of [["#ffffff", "#14171c"], ["#111111", "#f7f7f5"], ["#e8a23b", "#14171c"], ["#3366cc", "#ffeeaa"]]) {
    const x = K.hexRgb(a), y = K.hexRgb(b);
    assert.ok(Math.abs(K.ratio(x, y) - contrastRatio({ ...x, a: 1 }, { ...y, a: 1 })) < 1e-9, `${a}/${b}`);
  }
  // composite: same as the skin checker (rounded channels)
  assert.deepEqual(K.over(K.hexRgb("#14171c"), 0.85, { r: 255, g: 255, b: 255 }), (({ r, g, b }) => ({ r, g, b }))(composite({ ...K.hexRgb("#14171c"), a: 0.85 }, { r: 255, g: 255, b: 255, a: 1 })));
  assert.equal(K.minimalOpacity("#ffffff", "#000000", 4.5), 54);
  assert.equal(K.minimalOpacity("#ffffff", "#000000", 7), 65);
  assert.equal(K.minimalOpacity("#111111", "#ffffff", 4.5), 49);
  assert.equal(K.minimalOpacity("#111111", "#ffffff", 7), 62);
  assert.equal(K.OUTLINE_BELOW, 65);
  assert.ok(K.worstContrast("#ffffff", "#14171c", 0.85) >= 7, "Readable everywhere reaches 7:1 over a white video");
});

test("accent: kept when it already reaches 3:1, moved toward white or black otherwise, never below 3:1", () => {
  assert.equal(K.accentFor("#e8a23b", "#14171c", 0.85), "#e8a23b");
  for (const [accent, surface, alpha] of [["#3a3f8f", "#14171c", 0.85], ["#e8a23b", "#f7f7f5", 0.85], ["#777777", "#000000", 0.6], ["#ffff00", "#ffffff", 1]]) {
    const out = K.accentFor(accent, surface, alpha);
    assert.match(out, /^#[0-9a-f]{6}$/);
    assert.ok(K.worstContrast(out, surface, alpha) >= K.ACCENT_MIN_RATIO, `${accent} on ${surface}: ${out}`);
  }
});

// ── Presets and what applies ──────────────────────────────────────────────────────────────────────────────────────────
test("presets: Readable everywhere, Discreet, No background with outlined text", () => {
  const r = K.appliedLook({ preset: "readable" }, page("soft"), true);
  assert.deepEqual({ ...r }, { source: "element", text: "light", background: "solid", opacity: 85, color: "#14171c", outline: "thin", outlineForced: false });
  const d = K.appliedLook({ preset: "discreet" }, page("soft"), true);
  assert.equal(d.background, "soft"); assert.equal(d.opacity, 55); assert.equal(d.outline, "thin");
  const b = K.appliedLook({ preset: "bare" }, page("soft"), true);
  assert.equal(b.background, "none"); assert.equal(b.opacity, 0); assert.equal(b.text, "light"); assert.equal(b.outline, "thick");
  for (const p of K.LOOK_PRESETS) assert.equal(K.readabilityOf(K.appliedLook({ preset: p }, page(), true)).ok, true, p);
  assert.deepEqual(K.NEW_ELEMENT_STYLE, { preset: "readable" }, "new elements start readable (owner decision 2)");
});

test("text Auto picks the best contrast; a light background gets dark text", () => {
  assert.equal(K.appliedLook({ preset: "readable", color: "#f2f2f2" }, page(), true).text, "dark");
  assert.equal(K.appliedLook({ preset: "readable", color: "#202040" }, page(), true).text, "light");
  assert.equal(K.appliedLook({ preset: "readable", text: "dark" }, page(), true).color, "#f7f7f5", "dark text on the default light panel");
  assert.equal(K.appliedLook({ preset: "bare", text: "auto" }, page(), true).text, "light", "no background: light text, dark outline");
});

test("below 65 % a text outline is always drawn; a fine setting overrides the preset; kind change takes its own opacity", () => {
  const a = K.appliedLook({ preset: "readable", opacity: 40, outline: "none" }, page(), true);
  assert.equal(a.outline, "thin"); assert.equal(a.outlineForced, true);
  const b = K.appliedLook({ preset: "readable", opacity: 90, outline: "none" }, page(), true);
  assert.equal(b.outline, "none"); assert.equal(b.outlineForced, false); assert.equal(K.readabilityOf(b).ok, true);
  assert.equal(K.appliedLook({ preset: "readable", background: "glass" }, page(), true).opacity, 60);
  assert.equal(K.appliedLook({ preset: "bare", background: "solid" }, page(), true).opacity, 85);
  assert.equal(K.appliedLook({ preset: "readable", corners: "square" }, page(), true).corners, "square");
});

test("the editor warning: dark text on a dark background without outline is hard to read; Fix gives a readable look", () => {
  const bad = K.appliedLook({ preset: "readable", text: "dark", color: "#202020", opacity: 90, outline: "none" }, page(), true);
  const r = K.readabilityOf(bad);
  assert.equal(r.ok, false); assert.ok(r.ratio < 4.5);
  assert.equal(K.readabilityOf(K.appliedLook({ preset: "readable" }, page(), true)).ok, true);
  assert.deepEqual(K.readabilityOf(null), { ok: true, ratio: null }, "page style or skin: guaranteed by the skin checker");
});

test("readability fix (owner decision 1): ONLY an element that follows the style, on a transparent page without skin, without its own setting", () => {
  assert.equal(K.appliedLook(undefined, page("transparent"), true).source, "auto");
  assert.equal(K.appliedLook(undefined, page("transparent"), true).background, "solid");
  assert.equal(K.appliedLook(undefined, page("transparent", "dark"), true).text, "dark", "the page text colour is kept");
  assert.equal(K.appliedLook(undefined, page("soft"), true), null);
  assert.equal(K.appliedLook(undefined, page("opaque"), true), null);
  assert.equal(K.appliedLook(undefined, page("transparent", "light", true), true), null, "a skin brings its own checked surface");
  assert.equal(K.appliedLook(undefined, page("transparent"), false), null, "an element with its own look (followsStyle false) is never touched");
  assert.equal(K.appliedLook({ preset: "bare" }, page("transparent"), true).source, "element", "the person can go back to no background");
  assert.equal(K.presetShown(null), "page"); assert.equal(K.presetShown({ preset: "bare" }), "bare"); assert.equal(K.presetShown({ preset: "bare", opacity: 30 }), "custom");
});

test("sheet: tokens forced on the whole document (beats an inline token), containers and text parts mapped, outline on all text under 65 %, never html/body backgrounds", () => {
  const css = K.lookCss(K.appliedLook({ preset: "readable" }, page(), true));
  assert.match(css, /html\[data-ov-look\]:not\(#ov-look\),html\[data-ov-look\]:not\(#ov-look\) \*\{--ov-fg:#ffffff!important;/);
  assert.match(css, /--ov-surface:rgba\(20,23,28,0\.85\)!important/);
  assert.match(css, /\[data-ov-part="card"\]/); assert.match(css, /\[data-ov-part="message"\]/);
  assert.doesNotMatch(css, /backdrop-filter/); assert.doesNotMatch(css, /\*\{text-shadow/);
  assert.doesNotMatch(css, /(^|[,}])(html|body)\s*\{[^}]*background/);
  assert.match(K.lookCss(K.appliedLook({ preset: "readable", background: "glass" }, page(), true)), /backdrop-filter:blur\(10px\)/);
  assert.match(K.lookCss(K.appliedLook({ preset: "bare" }, page(), true)), /:not\(#ov-look\) \*:not\(\[data-ov-region="composition"\],\[data-ov-region="composition"\] \*\)\{text-shadow:var\(--ov-text-shadow\)!important\}/);
  assert.equal(K.outlineShadow("none", "light"), "none");
  assert.equal(K.outlineShadow("thin", "light").split("),").length, 5, "4 directions and a soft blur");
});

// ── Stored data, validation, editor model ─────────────────────────────────────────────────────────────────────────────
test("stored data: a style is read without ever throwing; unknown values are dropped; nothing stored means follows the page", () => {
  const raw = JSON.stringify([
    { uid: "aaaaaa1111", instance: "i", element: "e", x: 0, y: 0, w: 10, h: 10, visible: true, options: {}, style: { preset: "discreet", opacity: 40, color: "#ABCDEF", outline: "thick", junk: 1 } },
    { uid: "bbbbbb2222", instance: "i", element: "e", x: 0, y: 0, w: 10, h: 10, visible: true, options: {}, style: { preset: "nope", opacity: 400, color: "red" } },
    { uid: "cccccc3333", instance: "i", element: "e", x: 0, y: 0, w: 10, h: 10, visible: true, options: {} },
  ]);
  const [a, b, c] = parseElements(raw);
  assert.deepEqual(a.style, { preset: "discreet", opacity: 40, color: "#abcdef", outline: "thick" });
  assert.equal("style" in b, false); assert.equal("style" in c, false);
});

test("validation: what the editor sends is checked field by field, with a message under the field and an example", () => {
  const catalog = new Map([["i\u0000e", { instance: "i", moduleId: "m", moduleName: "M", instanceLabel: "I", decl: { id: "e", fit: "fluid", minSize: { width: 50, height: 50 }, followsStyle: true, options: [] } }]]);
  const item = (style) => ({ name: "P", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round" }, elements: [{ uid: "aaaaaa1111", instance: "i", element: "e", x: 0, y: 0, w: 400, h: 200, visible: true, options: {}, style }] });
  const ok = validatePageInput(item({ preset: "bare", corners: "square" }), { catalog, previous: [] });
  assert.ok(ok.ok); assert.deepEqual(ok.value.elements[0].style, { preset: "bare", corners: "square" });
  const none = validatePageInput(item(undefined), { catalog, previous: [] });
  assert.ok(none.ok); assert.equal("style" in none.value.elements[0], false, "nothing stored at the default");
  for (const [style, field, key] of [[{ opacity: 101 }, "opacity", "ovp.err.lookOpacity"], [{ opacity: 12.5 }, "opacity", "ovp.err.lookOpacity"], [{ color: "blue" }, "color", "ovp.err.lookColor"], [{ preset: "x" }, "preset", "ovp.err.lookChoice"], [{ outline: "huge" }, "outline", "ovp.err.lookChoice"]]) {
    const r = validatePageInput(item(style), { catalog, previous: [] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.issues, [{ path: `elements.aaaaaa1111.style.${field}`, code: "appearance" }]);
    for (const [lang, dict] of [["fr", fr], ["en", en]]) {
      const msg = issueMessages(r.issues, item(style), catalog, makeTranslator(lang)).errors[`elements.aaaaaa1111.style.${field}`];
      assert.equal(msg, dict[key]); assert.match(msg, /(par exemple|for example)/);
    }
  }
});

test("editor model: a new element that follows the style starts readable; setLook stores or clears", () => {
  const decl = { fit: "fluid", minSize: { width: 50, height: 50 } };
  const list = addElement([], { width: 1920, height: 1080 }, { instance: "i", element: "e", decl, defaults: {}, style: K.NEW_ELEMENT_STYLE }, "aaaaaa1111");
  assert.deepEqual(list[0].style, { preset: "readable" });
  assert.notEqual(list[0].style, K.NEW_ELEMENT_STYLE, "a copy, never the shared object");
  const plain = addElement([], { width: 1920, height: 1080 }, { instance: "i", element: "e", decl, defaults: {} }, "bbbbbb2222");
  assert.equal("style" in plain[0], false);
  assert.deepEqual(setLook(list, "aaaaaa1111", { preset: "bare" })[0].style, { preset: "bare" });
  assert.equal("style" in setLook(list, "aaaaaa1111", null)[0], false);
});

// ── Public page: migration against the 0.16.0 output ──────────────────────────────────────────────────────────────────
const golden = JSON.parse(fs.readFileSync("tests/fixtures/overlays/render-0.16.0.json", "utf8")).hashes;
const look0 = { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } };
const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
const fx = (uid, extra = {}) => ({ uid, instance: "al", element: "alerts", x: 10, y: 20, w: 640, h: 260, visible: true, options: {}, ...extra });
/** The same fixture pages as the ones the golden file was made from (core 0.16.0). `style` adds an element setting (not known to 0.16.0). */
function buildFixture(c, style) {
  const pg = { id: "p", name: "Page <1>", width: 1920, height: 1080, active: true, style: { text: c.text, background: c.background, corners: "round" }, look: c.skin ? { ...look0, skin: "night" } : look0, elements: [], rev: 3, testUntil: c.test ? 2_000_000 : null };
  const elements = [
    { el: fx("aaaaaa1111", style ? { style } : {}), title: "Alerts", status: "ok", layout, follows: true, src: "/overlays/al?ov-w=640", demoSrc: "/overlays/al?ov-w=640&ov-demo=1" },
    { el: fx("bbbbbb2222", { element: "maze" }), title: "Maze", status: "ok", layout, follows: false, src: "/overlays/mz?ov-w=640" },
    { el: fx("cccccc3333"), title: "Gone", status: "missing", reason: "gone" },
    { el: fx("dddddd4444"), title: "Failed", status: "failed", reason: "stalled", layout },
  ];
  const skin = c.skin ? { id: "night", version: "1.0.0", css: "html[data-ov-skin=\"night\"]{--ov-fg:#fff!important}", key: "night@1.0.0:abc" } : null;
  return R.renderPage({ page: pg, elements, t: makeTranslator("en"), lang: "en", test: c.test, now: 1_000_000, nonce: "N0nce", stateUrl: "/overlays/page/x/state", skin, contextual: false });
}
const cases = [];
for (const background of ["transparent", "soft", "opaque"]) for (const text of ["light", "dark"]) for (const skin of [false, true]) for (const t of [false, true]) cases.push({ id: `${background}-${text}-${skin ? "skin" : "plain"}-${t ? "test" : "live"}`, background, text, skin, test: t });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
/** Removes what 0.17.0 adds for an element with a look: the frame mark, the hidden start (when no skin already did it) and the look script. */
const withoutLook = (html, skin) => html.replace(/<iframe [^>]*>/g, (tag) => (tag.includes(" data-look=") ? tag.replace(/ data-look="\d+"/, "").replace(skin ? /$^/ : 'style="opacity:0;transition:opacity .2s;', skin ? "" : 'style="') : tag)).replace(/<script nonce="N0nce">\(function\(\)\{var L=[\s\S]*?<\/script>/, "");

test("migration: every existing page renders exactly as with 0.16.0, except the alerts-like element of a transparent page without skin (the intended readability fix)", () => {
  assert.equal(Object.keys(golden).length, cases.length);
  for (const c of cases) {
    const html = buildFixture(c);
    const changed = c.background === "transparent" && !c.skin;
    if (!changed) { assert.equal(sha(html), golden[c.id], `${c.id}: byte for byte as 0.16.0`); assert.doesNotMatch(html, /data-look|data-ov-look|var L=/, c.id); continue; }
    assert.match(html, /<iframe [^>]*data-follows="1" data-look="0"/, `${c.id}: the element that follows the style gets the fix`);
    assert.equal((html.match(/data-look=/g) ?? []).length, 1, `${c.id}: the element with its own look (followsStyle false) and the empty frames are untouched`);
    assert.equal(sha(withoutLook(html, c.skin)), golden[c.id], `${c.id}: nothing else changes`);
  }
});

test("an element setting applies on every page (also over a skin and an opaque page), and only to that element", () => {
  for (const c of cases) {
    const html = buildFixture(c, { preset: "bare" });
    assert.match(html, /data-look="0"/, c.id);
    assert.equal(sha(withoutLook(html, c.skin)), golden[c.id], `${c.id}: only the look is added`);
  }
});

test("safety: the look sheet is data inside the page script (no `</script>` escape), and frames are shown after 3 s even if they cannot be reached", () => {
  const html = buildFixture(cases[0]);
  const script = /<script nonce="N0nce">(\(function\(\)\{var L=[\s\S]*?)<\/script>/.exec(html)[1];
  assert.doesNotMatch(script, /<\//); assert.match(script, /setTimeout\(function\(\)\{fr\.style\.opacity="1"\},3000\)/);
  assert.doesNotMatch(html, /\bstyle="[^"]*background:[^"]*"[^>]*class="el"/, "the core never paints the element frame");
});

// ── Real Chromium render ──────────────────────────────────────────────────────────────────────────────────────────────
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

/** Element pages written like real modules: an alerts-like stage that writes its tokens INLINE (the 0.16.0 bug), and a panel hidden when idle. */
const ELEMENT = {
  stage: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#st{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}[data-ov-part="card"]{padding:20px;border-radius:var(--ov-radius,1.5rem);background:var(--ov-surface,#223);border:1px solid var(--ov-border,#444)}[data-ov-part="kind"]{color:#e8a23b;text-shadow:0 0 12px #e8a23b}[data-ov-part="message"]{color:var(--ov-fg,#eee)}</style><div id="st" style="--ov-fg:#ffffff;--ov-surface:transparent;--ov-radius:12px;--ov-border:transparent"><div data-ov-part="card"><div data-ov-part="kind">Follow</div><div data-ov-part="message">lune_douce follows</div></div></div>',
  idle: '<!doctype html><meta charset="utf-8"><style>:root{--ov-surface:rgba(0,0,0,.55);--ov-fg:#fff}html,body{margin:0;background:transparent}#p{padding:12px;background:var(--ov-surface);border:1px solid var(--ov-border,#888);border-radius:12px;box-shadow:0 2px 8px #0008}</style><div id="p" data-ov-region="element" data-ov-part="panel" hidden></div><div id="empty"></div>',
};
async function rendered(variant) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (u.pathname.startsWith("/el/")) return res.end(ELEMENT[u.pathname.slice(4)] ?? "");
    res.end(variant.html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/page`);
    await p.waitForFunction(() => [...document.querySelectorAll("iframe")].every((f) => f.contentDocument?.readyState === "complete" && f.style.opacity !== "0"), null, { timeout: 10000 });
    return await p.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => {
      const d = f.contentDocument, cs = (n) => (n ? getComputedStyle(n) : null);
      const card = d.querySelector('[data-ov-part="card"]'), msg = d.querySelector('[data-ov-part="message"]'), kind = d.querySelector('[data-ov-part="kind"]'), panel = d.getElementById("p");
      // Anything painted? Every node that takes room: background, border, shadow or text.
      const painted = [...d.querySelectorAll("body, body *")].filter((n) => { const s = getComputedStyle(n), r = n.getBoundingClientRect(); if (s.display === "none" || r.width === 0 || r.height === 0) return false; for (let x = n; x && x.nodeType === 1; x = x.parentElement) if (getComputedStyle(x).opacity === "0") return false; const bg = s.backgroundColor, bc = s.borderTopColor; return (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || (parseFloat(s.borderTopWidth) > 0 && bc !== "rgba(0, 0, 0, 0)") || s.boxShadow !== "none" || [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()); }).map((n) => n.id || n.getAttribute("data-ov-part") || n.tagName);
      return { look: d.documentElement.getAttribute("data-ov-look"), card: cs(card)?.backgroundColor, msg: cs(msg)?.color, msgShadow: cs(msg)?.textShadow, kindShadow: cs(kind)?.textShadow, panelDisplay: cs(panel)?.display, painted };
    }));
  } finally { await browser.close(); server.close(); }
}
const pageWith = (background, elStyle, skinTokens) => {
  const pg = { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { text: "light", background, corners: "round" }, look: skinTokens ? { ...look0, skin: "night" } : look0, elements: [], rev: 1, testUntil: null };
  const elements = ["stage", "idle"].map((k, i) => ({ el: fx(`${k}abcdef${i}`, elStyle ? { style: elStyle } : {}), title: k, status: "ok", layout, follows: true, src: `/el/${k}` }));
  const skin = skinTokens ? { ...compileSkin({ id: "night", version: "1.0.0", tokens: skinTokens, css: "" }), key: "k" } : null;
  return { html: R.renderPage({ page: pg, elements, t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "", skin }) };
};

test("real browser, 0.16.0 bug: on a transparent page the card now has a solid background and outlined text, even though the module writes its tokens inline", { skip: skipBrowser, timeout: 60000 }, async () => {
  const [stage, idle] = await rendered(pageWith("transparent"));
  assert.equal(stage.look, "1");
  assert.equal(stage.card, "rgba(20, 23, 28, 0.85)");
  assert.equal(stage.msg, "rgb(255, 255, 255)");
  assert.match(stage.msgShadow, /rgba\(0, 0, 0, 0\.9\) -1px -1px 0px/);
  assert.equal(stage.kindShadow, "rgb(232, 162, 59) 0px 0px 12px", "above 65 %: the module keeps its own glow on its coloured title");
  assert.equal(idle.panelDisplay, "none", "an element hidden when idle stays hidden");
  assert.deepEqual(idle.painted, [], "idle: nothing painted, no empty box");
});

test("real browser: element setting beats the skin and the Opaque background; bare look outlines every text; Like the page on a soft page changes nothing", { skip: skipBrowser, timeout: 90000 }, async () => {
  const [overSkin] = await rendered(pageWith("transparent", { preset: "readable", color: "#203040" }, { "--ov-fg": "#ffffff", "--ov-surface": "rgba(90,10,10,0.95)" }));
  assert.equal(overSkin.card, "rgba(32, 48, 64, 0.85)", "the element setting wins over the skin");
  const opaqueSheet = ownerSurfaceCss({ text: "light", background: "opaque", corners: "round" });
  assert.match(opaqueSheet, /!important/);
  const [overOpaque, idleOpaque] = await rendered(pageWith("opaque", { preset: "discreet" }));
  assert.equal(overOpaque.card, "rgba(20, 23, 28, 0.55)");
  assert.deepEqual(idleOpaque.painted, []);
  const [bare, idleBare] = await rendered(pageWith("transparent", { preset: "bare" }));
  assert.equal(bare.card, "rgba(0, 0, 0, 0)");
  assert.match(bare.kindShadow, /-2px -2px 0px/, "under 65 %: the coloured title gets the outline too");
  assert.deepEqual(idleBare.painted, []);
  const [soft] = await rendered(pageWith("soft"));
  assert.equal(soft.look, null, "nothing injected");
});

// ── Editor panel ──────────────────────────────────────────────────────────────────────────────────────────────────────
const lookKeys = (dict) => Object.keys(dict).filter((k) => k.startsWith("ovp.ed.look.") || k.startsWith("ovp.ed.tab.") || k.startsWith("ovp.err.look"));
test("texts: FR/EN parity (same keys, same variables), labels at most 60 characters without colon, no forbidden word, neutral tone", () => {
  assert.deepEqual(lookKeys(fr).sort(), lookKeys(en).sort());
  assert.ok(lookKeys(fr).length >= 40);
  const vars = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of lookKeys(fr)) {
    assert.deepEqual(vars(fr[k]), vars(en[k]), k);
    for (const [lang, d] of [["fr", fr], ["en", en]]) {
      assert.deepEqual(forbiddenWords(d[k]), [], `${k} ${lang}`);
      assert.deepEqual(toneProblems(d[k], lang), [], `${k} ${lang}`);
      if (!/Help$|Err$|Notice(\.one)?$|^ovp\.err\./.test(k)) assert.deepEqual(labelProblems(d[k]), [], `${k} ${lang}`);
    }
  }
  assert.equal(fr["ovp.ed.look.preset.readable"], "Lisible partout"); assert.equal(fr["ovp.ed.look.preset.bare"], "Sans fond, texte détouré"); assert.equal(fr["ovp.ed.look.warn"], "Peu lisible sur une vidéo claire");
  // the visible notes stay short (R11, R32); longer precisions live in the "?" bubble
  for (const k of ["ovp.ed.look.auto", "ovp.ed.look.custom", "ovp.ed.look.autoNotice", "ovp.ed.look.warn"]) for (const d of [fr, en]) assert.ok(d[k].length <= HELP_INLINE_MAX, k);
});

const S = (k, v = {}) => String(fr[`ovp.${k}`] ?? `?${k}`).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? `{${n}}`));
const panel = (style, pg = page()) => renderToStaticMarkup(React.createElement(OverlayLookPanel, { uid: "aaaaaa1111", style, applied: K.appliedLook(style, pg, true), readable: K.readabilityOf(K.appliedLook(style, pg, true)), onChange() {}, s: S }));
const fields = (html) => html.replace(/<details[\s\S]*<\/details>/, "").match(/<fieldset|<input[^>]*type="(number|color)"/g)?.length ?? 0;

test("panel: short path = 2 visible fields (Readability, Text), the rest folded under More options with a summary; budget R4 respected", () => {
  const html = panel({ preset: "readable" });
  assert.equal(fields(html), 2);
  assert.ok(fields(html) <= FORM_FIELDS_MAX);
  assert.match(html, /<details[^>]*data-more-options/);
  assert.match(html, /Plus d&#x27;options/); assert.match(html, /Plein 85 %/); assert.match(html, /Fin/);
  assert.equal((html.match(/<details[\s\S]*<\/details>/)[0].match(/<fieldset|type="number"|type="color"/g) ?? []).length, 5, "folded: background, opacity, colour, outline, corners");
  for (const k of ["readable", "discreet", "bare", "page"]) assert.ok(html.includes(fr[`ovp.ed.look.preset.${k}`].replace(/'/g, "&#x27;")), k);
  assert.doesNotMatch(html, /\?ed\./, "every text exists in the dictionary");
  assert.doesNotMatch(html, /data-testid="look-warning"/);
});

test("panel: warning pill with Fix when hard to read; Custom note; the automatic fix says so in one short line; Like the page on a soft page shows only the preset", () => {
  const bad = panel({ preset: "readable", text: "dark", color: "#202020", opacity: 90, outline: "none" });
  assert.match(bad, /data-testid="look-warning"/); assert.match(bad, />Peu lisible sur une vidéo claire</); assert.match(bad, />Corriger<\/button>/);
  assert.match(bad, /data-testid="look-note"[^>]*>Personnalisé</);
  assert.match(bad, /<details open=""/, "custom: More options open");
  const auto = panel(null);
  assert.match(auto, /data-testid="look-note"[^>]*>Fond ajouté pour la lisibilité</);
  const soft = panel(null, page("soft"));
  assert.equal(fields(soft), 1); assert.doesNotMatch(soft, /<details/);
  assert.match(panel({ preset: "bare" }), /id="look-outline-aaaaaa1111-none"[^>]*disabled=""/, "under 65 % the outline cannot be removed");
});

test("editor wiring: tabs Place / Appearance / Options, strings sent by the server, page skin passed, new elements readable", () => {
  const editor = fs.readFileSync("src/components/admin/OverlayEditor.tsx", "utf8"), pageTsx = fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8");
  assert.match(editor, /role="tablist"/); assert.match(editor, /role="tab"/); assert.match(editor, /aria-selected=/);
  assert.match(editor, /\.\.\.\(a\.followsStyle \? \{ style: NEW_ELEMENT_STYLE \} : \{\}\)/);
  assert.match(pageTsx, /pageSkin=\{!!\(page\.look\.skin \|\| page\.look\.byContext\.enabled\)\}/);
  const strings = pageTsx.match(/const STRINGS = \[([\s\S]*?)\] as const/)[1].match(/"[\w.]+"/g).map((x) => x.slice(1, -1));
  for (const k of lookKeys(fr).filter((k) => k.startsWith("ovp.ed."))) assert.ok(strings.includes(k.slice("ovp.ed.".length)), k);
  for (const m of fs.readFileSync("src/components/admin/OverlayLookPanel.tsx", "utf8").matchAll(/s\(`?"?(ed\.look\.[\w.]+)/g)) assert.ok(m[1].endsWith(".") ? lookKeys(fr).some((k) => k.startsWith(`ovp.${m[1]}`)) : `ovp.${m[1]}` in fr, m[1]);
});
