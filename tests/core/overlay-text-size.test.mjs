// Text size of overlay elements (core 0.11.0): pure helpers, window geometry, address parameter, stored data, editor control, skins, TV guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const S = await import("@/core/overlays/textScale");
const L = await import("@/core/overlays/layout");
const A = await import("@/core/overlays/address");
const R = await import("@/core/overlays/render");
const T = await import("@/core/overlays/tokens");
const { parseElements } = await import("@/core/overlays/store");
const { validatePageInput } = await import("@/core/overlays/pageInput");
const { issueMessages } = await import("@/core/overlays/messages");
const { parseManifest } = await import("@/core/modules/manifest");
const { sanitizeOverlayCss } = await import("@/core/overlays/skinCss");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const scale = { fit: "scale", size: { width: 600, height: 200 } };
const ratio = { fit: "ratio", referenceHeight: 1080, ratios: { min: 1.3, max: 2.4 } };
const fluid = { fit: "fluid", minSize: { width: 200, height: 100 } };
const rect = { w: 800, h: 300 };

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("text size: bounds, presets, effective value", () => {
  assert.equal(S.TEXT_SCALE_MIN, 50); assert.equal(S.TEXT_SCALE_MAX, 300); assert.equal(S.TEXT_SCALE_DEFAULT, 100);
  assert.deepEqual(S.TEXT_SCALE_PRESETS.map((p) => p.percent), [75, 100, 150, 200]);
  assert.equal(S.parseTextScale(150), 150); assert.equal(S.parseTextScale("150"), 150); assert.equal(S.parseTextScale(100), 100);
  for (const bad of [49, 301, 150.5, "abc", "", null, undefined, NaN, {}, -100]) assert.equal(S.parseTextScale(bad), null, String(bad));
  assert.deepEqual(S.checkTextScale(undefined), { ok: true, value: null }); assert.deepEqual(S.checkTextScale(""), { ok: true, value: null });
  assert.deepEqual(S.checkTextScale("175"), { ok: true, value: 175 });
  for (const bad of [49, 301, 1.5, "x", NaN]) assert.equal(S.checkTextScale(bad).ok, false, String(bad));
  assert.equal(S.effectiveTextScale(null, null), 100); assert.equal(S.effectiveTextScale(null, 200), 200); assert.equal(S.effectiveTextScale(100, 200), 100, "an element may opt out of a larger page size");
  assert.equal(S.presetOf(200), "tv"); assert.equal(S.presetOf(180), null);
});

test("TV type scale: nothing below the broadcast minimum, steps grow", () => {
  const px = Object.values(S.TV_TYPE_SCALE);
  assert.ok(Math.min(...px) >= S.TV_MIN_TEXT_PX); assert.deepEqual(px, [...px].sort((a, b) => a - b));
  assert.equal(S.TV_MIN_TEXT_PX, 24);
});

test("ov-tv: canvas px stay canvas px whatever the frame scale, and follow canvas height and text size", () => {
  assert.equal(S.tvFactor(1080, 100, 1), 1);
  assert.equal(S.tvFactor(720, 100, 1), 0.6667);
  const f = S.tvFactor(1080, 150, 0.5); // frame shown at half size, text 150 %
  assert.equal(f, 3);
  assert.equal(S.tvStepPx("md", f) * 0.5, 32 * 1.5, "32 px on a 1080 canvas at 150 % is 48 px on screen");
});

// ── Geometry: 100 % is exactly what it was ────────────────────────────────────────────────────────────────────────
test("window geometry: no value and 100 % give the same result (byte for byte), for the three behaviours", () => {
  for (const d of [scale, ratio, fluid]) {
    for (const r of [{ w: 800, h: 300 }, { w: 1920, h: 1080 }, { w: 150, h: 100 }, { w: 3440, h: 1440 }]) {
      assert.deepEqual(L.frameLayout(d, r, 100), L.frameLayout(d, r), JSON.stringify([d.fit, r]));
      assert.equal(JSON.stringify(L.frameLayout(d, r, 100)), JSON.stringify(L.frameLayout(d, r)));
    }
  }
  assert.deepEqual(L.frameLayout(scale, { w: 1200, h: 400 }), { iframeW: 600, iframeH: 200, scale: 2, offsetX: 0, offsetY: 0, boxW: 1200, boxH: 400 });
});

test("window geometry: at 200 % the window is half as large and scaled twice as much, the frame does not move", () => {
  const f = L.frameLayout(fluid, rect, 200);
  assert.deepEqual([f.iframeW, f.iframeH, f.scale], [400, 150, 2]);
  assert.deepEqual([f.boxW, f.boxH, f.offsetX, f.offsetY], [800, 300, 0, 0]);
  const s = L.frameLayout(scale, { w: 1200, h: 400 }, 200);
  assert.deepEqual([s.iframeW, s.iframeH, s.scale, s.boxW, s.boxH], [300, 100, 4, 1200, 400]);
  const r = L.frameLayout(ratio, { w: 1920, h: 1080 }, 200);
  assert.deepEqual([r.iframeH, r.scale, r.boxH], [540, 2, 1080]);
  // the minimum size of a fluid element is kept: its window never gets smaller than that, everything is scaled down to fit instead
  const m = L.frameLayout(fluid, { w: 300, h: 150 }, 300);
  assert.ok(m.iframeW >= 200 && m.iframeH >= 100); assert.ok(m.boxW <= 300.01 && m.boxH <= 150.01);
  // 50 %: the window is twice as large
  assert.deepEqual([L.frameLayout(fluid, rect, 50).iframeW, L.frameLayout(fluid, rect, 50).scale], [1600, 0.5]);
});

test("window geometry: rendered text size on the canvas = css px x scale = css px x percent (fluid, no minimum reached)", () => {
  for (const pct of [75, 100, 150, 200, 300]) {
    const f = L.frameLayout({ fit: "fluid" }, { w: 1200, h: 600 }, pct);
    assert.ok(Math.abs(f.scale - pct / 100) < 1e-4, `${pct}`);
    assert.equal(f.boxW, 1200);
  }
});

// ── Address ───────────────────────────────────────────────────────────────────────────────────────────────────────
const decl = (extra = {}) => ({ id: "x", fit: "fluid", followsStyle: true, options: [], ...extra });
const layout = L.frameLayout(fluid, rect);
const style = { text: "light", background: "transparent", corners: "round" };
test("address: ov-tv only for an element that declares tvScale; other addresses are unchanged", () => {
  const base = { path: "/m/a/el", search: new URLSearchParams() };
  const plain = A.finalAddress(base, { decl: decl(), layout, style, options: {}, lang: "en", tv: 2 });
  assert.doesNotMatch(plain, /ov-tv/);
  assert.equal(plain, A.finalAddress(base, { decl: decl(), layout, style, options: {}, lang: "en" }), "no difference without tvScale");
  const tv = A.finalAddress(base, { decl: decl({ tvScale: true }), layout, style, options: {}, lang: "en", tv: 2 });
  assert.match(tv, /ov-tv=2(&|$)/);
  assert.equal(A.finalAddress({ path: "/m/a/el", search: new URLSearchParams("ov-tv=9") }, { decl: decl({ tvScale: true }), layout, style, options: {}, lang: "en", tv: 1.5 }).match(/ov-tv=/g).length, 1, "a module cannot choose its own ov-tv");
});

test("manifest: tvScale needs minCore 0.11.0 and is optional", () => {
  const m = (minCore, tvScale) => parseManifest({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", minCore, overlayElements: [{ id: "a", label: "A", fit: "fluid", ...(tvScale ? { tvScale } : {}) }] });
  assert.ok(m("0.5.0", false).ok); assert.ok(m("0.11.0", true).ok); assert.ok(m("0.12.1", true).ok);
  const r = m("0.10.0", true); assert.equal(r.ok, false); assert.match(r.error, /tvScale needs minCore 0\.11\.0/);
});

// ── Stored data and validation ────────────────────────────────────────────────────────────────────────────────────
test("stored data: data saved before 0.11.0 reads exactly as before (no key added)", () => {
  const old = JSON.stringify([{ uid: "abcdef1234", instance: "a", element: "b", x: 1, y: 2, w: 300, h: 100, visible: true, options: { n: 1 } }]);
  const [e] = parseElements(old);
  assert.equal("textScale" in e, false); assert.equal(JSON.stringify(parseElements(JSON.stringify([e]))), JSON.stringify([e]));
  assert.deepEqual(T.parseStyle({ text: "dark", background: "soft", corners: "square" }), { text: "dark", background: "soft", corners: "square" });
  assert.deepEqual(T.parseStyle(undefined), { text: "light", background: "transparent", corners: "round" });
});

test("stored data: text size is kept when valid, dropped when damaged, never throws", () => {
  const row = (extra) => ({ uid: "abcdef1234", instance: "a", element: "b", x: 0, y: 0, w: 10, h: 10, visible: true, options: {}, ...extra });
  const [a, b, c, d] = parseElements(JSON.stringify([row({ textScale: 150 }), row({ uid: "abcdef1235", textScale: 9000 }), row({ uid: "abcdef1236", textScale: "big" }), row({ uid: "abcdef1237", textScale: 100 })]));
  assert.equal(a.textScale, 150); assert.equal("textScale" in b, false); assert.equal("textScale" in c, false); assert.equal(d.textScale, 100, "an explicit 100 survives (it overrides the page)");
  assert.equal(T.parseStyle({ textScale: 200 }).textScale, 200);
  assert.equal("textScale" in T.parseStyle({ textScale: 100 }), false, "the page default 100 is stored as nothing");
  assert.equal("textScale" in T.parseStyle({ textScale: 12 }), false);
  assert.equal("textScale" in T.parseStyle({ textScale: "x" }), false);
});

const catalog = new Map([["a\u0000b", { instance: "a", moduleId: "m", moduleName: "M", instanceLabel: "A", decl: { id: "b", label: "B", fit: "fluid", followsStyle: true, options: [] } }]]);
const input = (elExtra = {}, styleExtra = {}) => ({ name: "Page", width: 1920, height: 1080, style: { ...style, ...styleExtra }, elements: [{ uid: "abcdef1234", instance: "a", element: "b", x: 0, y: 0, w: 400, h: 300, visible: true, options: {}, ...elExtra }] });
test("validation: the server never trusts the browser for text size", () => {
  const ok = validatePageInput(input({ textScale: 175 }, { textScale: 200 }), { catalog, previous: [] });
  assert.ok(ok.ok); assert.equal(ok.value.elements[0].textScale, 175); assert.equal(ok.value.style.textScale, 200);
  const none = validatePageInput(input(), { catalog, previous: [] });
  assert.ok(none.ok); assert.equal("textScale" in none.value.elements[0], false); assert.equal("textScale" in none.value.style, false);
  const hundred = validatePageInput(input({ textScale: 100 }, { textScale: 100 }), { catalog, previous: [] });
  assert.equal(hundred.value.elements[0].textScale, 100); assert.equal("textScale" in hundred.value.style, false);
  for (const bad of [49, 301, 99.5, "huge"]) {
    const r = validatePageInput(input({ textScale: bad }), { catalog, previous: [] });
    assert.equal(r.ok, false, String(bad)); assert.ok(r.issues.some((i) => i.code === "textScale" && i.path === "elements.abcdef1234.textScale"));
    const p = validatePageInput(input({}, { textScale: bad }), { catalog, previous: [] });
    assert.equal(p.ok, false, String(bad)); assert.ok(p.issues.some((i) => i.path === "style.textScale"));
  }
  const bad = validatePageInput(input({ textScale: 500 }), { catalog, previous: [] });
  const msg = issueMessages(bad.issues, input({ textScale: 500 }), catalog, makeTranslator("en"));
  assert.match(msg.errors["elements.abcdef1234.textScale"], /whole number between 50 and 300, for example 150/);
  assert.match(issueMessages(bad.issues, {}, catalog, makeTranslator("fr")).errors["elements.abcdef1234.textScale"], /entre 50 et 300, par exemple 150/);
});

// ── Render: byte-identical at the default ─────────────────────────────────────────────────────────────────────────
test("render: a page at the default text size is byte-identical to a page without the setting", () => {
  const mk = (pageExtra, elExtra, pct) => {
    const el = { uid: "abcdef1234", instance: "a", element: "b", x: 10, y: 20, w: 800, h: 300, visible: true, options: {}, ...elExtra };
    const page = { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { ...style, ...pageExtra }, look: { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } }, elements: [el], rev: 1, testUntil: null };
    const resolved = [{ el, title: "T", status: "ok", layout: L.frameLayout(fluid, el, pct), follows: true, src: "/m/a/el?ov-w=800", demoSrc: undefined }];
    return R.renderPage({ page, elements: resolved, t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "" });
  };
  const without = mk({}, {}, undefined);
  assert.equal(mk({}, {}, 100), without);
  assert.notEqual(mk({}, {}, 200), without);
  assert.match(mk({}, {}, 200), /width:400px;height:150px;transform:scale\(2\)/);
});

// ── Skins cannot override the owner's text size ───────────────────────────────────────────────────────────────────
test("skins: no way to zoom or resize the element window; text only follows the element's own size (relative, 60 to 160 %)", () => {
  for (const decls of ["zoom:3", "transform:scale(4)", "font-size:30px", "font-size:400%", "font-size:calc(2em + 10px)", "width:1px"]) {
    const r = sanitizeOverlayCss(`[data-ov-part="title"]{${decls}}`, "demo-skin");
    // transform may be a contract 3 property but is never applied to the root: the rule is scoped under html[data-ov-skin] INSIDE the element's page
    if (r.ok) assert.match(r.css, /^html\[data-ov-skin="demo-skin"\] /, decls);
    else assert.ok(r.issues.length > 0);
  }
  const big = sanitizeOverlayCss(`[data-ov-part="title"]{font-size:150%}`, "demo-skin");
  assert.ok(big.ok); assert.equal(big.shrinks, 0);
  const small = sanitizeOverlayCss(`[data-ov-part="title"]{font-size:80%}[data-ov-part="body"]{font-size:0.9em}`, "demo-skin");
  assert.ok(small.ok); assert.equal(small.shrinks, 2, "shrinking text is reported (a warning at install)");
  assert.equal(sanitizeOverlayCss(`[data-ov-part="title"]{font-size:100%}`, "demo-skin").shrinks, 0);
  // the injected sheet lives inside the element's document; the iframe's own size and scale are set by the core page, out of the skin's reach
  const render = fs.readFileSync("src/core/overlays/render.ts", "utf8");
  assert.match(render, /adoptedStyleSheets/); assert.doesNotMatch(render, /ns\.replaceSync\([^)]*zoom/);
});

// ── TV guard: the core's own overlay surfaces never use text below the broadcast minimum ────────────────────────
test("TV guard: text the core draws for viewers is at least 24 px; the test frame label (an editor aid) is the only exception", () => {
  const src = fs.readFileSync("src/core/overlays/render.ts", "utf8");
  const css = /const BASE_CSS = `([\s\S]*?)`;/.exec(src)[1];
  const rules = css.split("}").map((r) => r.trim()).filter(Boolean);
  const found = [];
  for (const r of rules) {
    const [selector, body] = r.split("{");
    for (const m of body.matchAll(/font:\s*[\w ]*?(\d+(?:\.\d+)?)px/g)) found.push([selector.trim(), Number(m[1])]);
    for (const m of body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) found.push([selector.trim(), Number(m[1])]);
  }
  assert.ok(found.length >= 2, "the guard reads the core's sizes");
  const EDITOR_AIDS = new Set([".tf .lb"]);   // visible only in test mode, drawn over the preview to name the element
  for (const [selector, px] of found) if (!EDITOR_AIDS.has(selector)) assert.ok(px >= S.TV_MIN_TEXT_PX, `${selector} uses ${px}px, below ${S.TV_MIN_TEXT_PX}px`);
  assert.ok(found.some(([sel]) => sel === ".off"), "the 'page off' message is covered");
});

// ── Editor control ────────────────────────────────────────────────────────────────────────────────────────────────
test("editor: the text size control is a labelled radio group with the ready-made sizes, stated bounds, 44 px targets", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TextSizeField } = await import("@/components/admin/TextSizeField");
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const s = (k, v = {}) => String(en[`ovp.${k}`] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n]));
  const html = (value, inherit) => renderToStaticMarkup(React.createElement(TextSizeField, { legend: "Text size", help: "h", value, inherit, errorPath: "x", onChange() {}, s, testId: "t" }));
  const el = html(null, true);
  assert.match(el, /<legend[^>]*>Text size<\/legend>/);
  assert.equal((el.match(/type="radio"/g) ?? []).length, 6, "same as the page, 4 sizes, other");
  for (const label of ["Same as the page", "Small", "Normal", "Large", "TV \\(recommended\\)", "Other"]) assert.match(el, new RegExp(`>${label}</label>`));
  assert.match(el, /id="[^"]*-inherit" type="radio"[^>]*checked=""/, "an element without its own setting follows the page");
  assert.equal((el.match(/min-h-11/g) ?? []).length, 6, "every choice is a 44 px target");
  assert.equal((el.match(/<label for=/g) ?? []).length, 6, "every radio has a label");
  const page = html(null, false);
  assert.equal((page.match(/type="radio"/g) ?? []).length, 5); assert.match(page, /id="[^"]*-normal" type="radio"[^>]*checked=""/);
  const tv = html(200, false); assert.match(tv, /id="[^"]*-tv" type="radio"[^>]*checked=""/);
  const other = html(175, true);
  assert.match(other, /id="[^"]*-other" type="radio"[^>]*checked=""/);
  assert.match(other, /value="175"/); assert.match(other, /Between 50 and 300\./); assert.match(other, /%<\/span>/, "the unit is stated");
  assert.doesNotMatch(el, /class="mt-1\.5 max-w/, "no visible help sentence under the control");
  const long = renderToStaticMarkup(React.createElement(TextSizeField, { legend: "Text size", help: "x".repeat(80), value: null, inherit: true, errorPath: "x", onChange() {}, s, testId: "t" }));
  assert.match(long, /data-helptip/, "the precision is in the \"?\" bubble next to the legend");
});

test("editor: the page and element controls are wired, saved and shown on the frames", () => {
  const editor = fs.readFileSync("src/components/admin/OverlayEditor.tsx", "utf8");
  assert.match(editor, /testId="text-size-page"/); assert.match(editor, /testId="text-size-element"/);
  assert.match(editor, /errorPath="style\.textScale"/); assert.match(editor, /errorPath=\{`elements\.\$\{sel\.uid\}\.textScale`\}/);
  assert.match(editor, /sizeNote\(el\)/, "the frame label states a text size that is not 100 %");
  const page = fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8");
  for (const k of ["textSize.page", "textSize.element", "textSize.inherit", "textSize.tv", "textSize.err"]) assert.ok(page.includes(`"${k}"`), k);
});

test("text size strings exist in English and French with the same variables, short helps, no colon, no forbidden words", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => k.startsWith("ovp.ed.textSize.") || k === "ovp.err.textScale");
  assert.ok(keys.length >= 15);
  const vars = (v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    assert.ok(typeof fr[k] === "string" && fr[k].length > 0, k); assert.equal(vars(en[k]), vars(fr[k]), k);
    for (const v of [en[k], fr[k]]) { assert.ok(!/!/.test(v), k); assert.ok(!/\b(token|API|JSON|slug|webhook)\b/i.test(v), k); }
    if (!/Help$/.test(k) && !/err/i.test(k)) for (const v of [en[k], fr[k]]) { assert.ok(v.length <= 60, k); assert.ok(!/:\s*$/.test(v), k); }
    if (/Help$/.test(k)) for (const v of [en[k], fr[k]]) assert.ok(v.length > 60 && v.length <= 300, `${k} is precision for the "?" bubble, not a visible line`);
  }
});

test("MCP: the overlay page list states the text size of each page", () => {
  assert.match(fs.readFileSync("src/core/overlaySkinsMcp.ts", "utf8"), /textScale: p\.style\.textScale \?\? 100/);
});

// ══ Opaque background (0.11.0) ═════════════════════════════════════════════════════════════════════════════════════
const { contrastRatio, composite } = await import("@/core/skins/readability");
const { parseColor } = await import("@/core/skins/colorParse");
const { compileSkin, solidSurface } = await import("@/core/overlays/skinSheet");

test("opaque background: the third choice, stored and read back, unknown values fall back to today's default", () => {
  assert.deepEqual([...T.STYLE_CHOICES.background], ["transparent", "soft", "opaque"]);
  assert.equal(T.parseStyle({ background: "opaque" }).background, "opaque");
  for (const bad of ["solid", "OPAQUE", 3, null, {}, ""]) assert.equal(T.parseStyle({ background: bad }).background, "transparent", String(bad));
  assert.deepEqual(T.parseStyle(JSON.parse(JSON.stringify(T.parseStyle({ text: "dark", background: "opaque", corners: "square", textScale: 150 })))), { text: "dark", background: "opaque", corners: "square", textScale: 150 });
  const ok = validatePageInput(input({}, { background: "opaque" }), { catalog, previous: [] });
  assert.ok(ok.ok); assert.equal(ok.value.style.background, "opaque");
});

test("opaque background: solid panel in both text modes, contrast at least 4.5:1, the two other values unchanged", () => {
  for (const text of ["light", "dark"]) {
    const v = T.tokenValues({ text, background: "opaque", corners: "round" });
    const surface = parseColor(v["--ov-surface"]), fg = parseColor(v["--ov-fg"]);
    assert.equal(surface.a, 1, `${text}: alpha 1`);
    assert.ok(contrastRatio(fg, surface) >= 4.5, `${text}: ${contrastRatio(fg, surface)}`);
    assert.ok(contrastRatio(fg, surface) >= 7, "in practice far above AA");
  }
  assert.equal(T.tokenValues({ text: "light", background: "soft", corners: "round" })["--ov-surface"], "rgba(0,0,0,0.55)");
  assert.equal(T.tokenValues({ text: "dark", background: "soft", corners: "round" })["--ov-surface"], "rgba(255,255,255,0.7)");
  assert.equal(T.tokenValues({ text: "light", background: "transparent", corners: "round" })["--ov-surface"], "transparent");
});

test("opaque background: elements are told 'soft' (they all know it), the core sets the solid colour on top; no skin, no stale rule", () => {
  assert.equal(T.moduleSurface("opaque"), "soft"); assert.equal(T.moduleSurface("soft"), "soft"); assert.equal(T.moduleSurface("transparent"), "transparent");
  const base = { path: "/m/a/el", search: new URLSearchParams() };
  const addr = (background) => A.finalAddress(base, { decl: decl(), layout, style: { ...style, background }, options: {}, lang: "en" });
  assert.match(addr("opaque"), /ov-surface=soft/); assert.equal(addr("opaque"), addr("soft"));
  const css = T.ownerSurfaceCss({ ...style, background: "opaque" });
  assert.match(css, /--ov-surface:#14171c!important/); assert.match(css, /:not\(\[data-ov-skin\]\)/, "a skin carries its own solid colour");
  assert.match(T.ownerSurfaceCss({ text: "dark", background: "opaque", corners: "round" }), /--ov-surface:#f7f7f5!important/);
});

test("opaque background: render at each value; only an opaque page carries the solid-colour script, others are byte-identical", () => {
  const mk = (background) => {
    const el = { uid: "abcdef1234", instance: "a", element: "b", x: 10, y: 20, w: 800, h: 300, visible: true, options: {} };
    const page = { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { ...style, background }, look: { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } }, elements: [el], rev: 1, testUntil: null };
    return R.renderPage({ page, elements: [{ el, title: "T", status: "ok", layout: L.frameLayout(fluid, el), follows: true, src: "/m/a/el?ov-w=800" }], t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "" });
  };
  const t = mk("transparent"), s = mk("soft"), o = mk("opaque");
  assert.doesNotMatch(t, /data-ov-owner/); assert.doesNotMatch(s, /data-ov-owner/);
  assert.match(o, /data-ov-owner/); assert.match(o, /--ov-surface:#14171c!important/); assert.match(o, /nonce="n">\(function\(\)\{var css=/);
  assert.match(t, /--ov-surface:transparent/); assert.match(s, /--ov-surface:rgba\(0,0,0,0\.55\)/); assert.match(o, /:root\{--ov-fg:#ffffff;--ov-surface:#14171c/);
  // the page without any element that follows the style gets no script
  const el = { uid: "abcdef1234", instance: "a", element: "b", x: 0, y: 0, w: 800, h: 300, visible: true, options: {} };
  const bare = R.renderPage({ page: { id: "p", name: "P", width: 1920, height: 1080, active: true, style: { ...style, background: "opaque" }, look: { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } }, elements: [el], rev: 1, testUntil: null }, elements: [{ el, title: "T", status: "ok", layout: L.frameLayout(fluid, el), follows: false, src: "/x" }], t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "" });
  assert.doesNotMatch(bare, /data-ov-owner/);
});

test("opaque background: a skin keeps its colours, its panel becomes solid and stays readable; the owner's choice wins over the skin", () => {
  const tokens = { "--ov-fg": "#f4ecdc", "--ov-surface": "rgba(24,14,10,0.88)" };
  const solid = solidSurface(tokens["--ov-surface"], tokens["--ov-fg"]);
  assert.equal(solid, "#180e0a");
  assert.equal(parseColor(solid).a, 1); assert.ok(contrastRatio(parseColor(tokens["--ov-fg"]), parseColor(solid)) >= 4.5);
  // a light, translucent panel under dark text: made solid over white (the case it was checked over), not turned into something unreadable
  const lightish = solidSurface("rgba(30,30,30,0.3)", "#111111");
  assert.ok(contrastRatio(parseColor("#111111"), parseColor(lightish)) >= 4.5, lightish);
  assert.equal(solidSurface("#222222", "#ffffff"), "#222222", "already solid: untouched");
  const normal = compileSkin({ id: "demo-skin", version: "1.0.0", tokens, css: "" });
  const opaque = compileSkin({ id: "demo-skin", version: "1.0.0", tokens, css: "", opaque: true });
  assert.match(normal.css, /--ov-surface:rgba\(24,14,10,0\.88\)!important/); assert.match(opaque.css, /--ov-surface:#180e0a!important/);
  assert.equal(compileSkin({ id: "demo-skin", version: "1.0.0", tokens, css: "", opaque: false }).css, normal.css, "off = byte-identical");
  // the owner sheet never fights a skin: it steps aside when a skin is worn
  assert.match(T.ownerSurfaceCss({ ...style, background: "opaque" }), /html\[data-ov-owner="1"\]:not\(\[data-ov-skin\]\)/);
});

test("opaque background: the list keeps every label whole (a real select, no truncation) and FR/EN labels exist", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  assert.equal(en["ovp.ed.style.background.opaque"], "Opaque"); assert.equal(fr["ovp.ed.style.background.opaque"], "Opaque");
  const editor = fs.readFileSync("src/components/admin/OverlayEditor.tsx", "utf8");
  assert.match(editor, /\["opaque", s\("ed\.style\.background\.opaque"\)\]/); assert.doesNotMatch(editor, /truncate[^"]*"[^>]*<select/);
  assert.match(fs.readFileSync("src/core/overlaySkinsMcp.ts", "utf8"), /background: p\.style\.background/);
});
