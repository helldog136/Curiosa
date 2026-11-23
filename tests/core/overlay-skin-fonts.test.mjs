// Overlay skins that embark fonts (core 0.47.0, skin contract 6, docs/OVERLAY-SKINS.md "Fonts") and the `twinOf` link (overlay skin -> site skin).
// Pure and folder-level tests (no database, no server): the validator and each refusal, the `@font-face` the core writes, the page that carries it, the twin decisions.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { makeTempDir } from "../helpers/tmp.mjs";
import { CSS, FONT, FONT_ASSET, TOKENS, fontSkin } from "../helpers/overlay-font-skin.mjs";

const V = await import("@/core/skins/validate");
const F = await import("@/core/overlays/skinFonts");
const Sh = await import("@/core/overlays/skinSheet");
const T = await import("@/core/overlays/skinTokens");
const C = await import("@/core/overlays/skinCss");
const R = await import("@/core/overlays/render");
const W = await import("@/core/overlays/twin");
const O = await import("@/core/overlays/twinOffer");
const K = await import("@/core/skins/constants");
const Mf = await import("@/core/skins/manifest");
const Cat = await import("@/core/skins/catalogue");
const Msg = await import("@/core/skins/messages");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const check = (dir, extra = {}) => V.validateSkinFolder(dir, { coreVersion: "0.47.0", ...extra });
const codes = (r) => r.issues.map((i) => i.code);
const refused = (over, code, id = "emma-skin") => { const r = check(fontSkin(id, over)); assert.equal(r.ok, false, `${code}: should be refused`); assert.ok(codes(r).includes(code), `${code} in ${codes(r)}`); assert.deepEqual(r.installFiles, [], "a refused skin has nothing to install"); return r; };

// ── the validator ─────────────────────────────────────────────────────────────────────

test("contract 6: an overlay skin with a woff2 font is accepted; its font lists are rewritten to the scoped name; licence and credits are free text", () => {
  const v = check(fontSkin("emma-skin"));
  assert.equal(v.ok, true, JSON.stringify(codes(v)));
  assert.equal(v.manifest.skinContract, 6);
  assert.deepEqual(v.files.map((f) => [f.path, f.kind]).filter(([, k]) => k === "font"), [["fonts/fredoka.woff2", "font"]], "the font is part of the installed files, so of the fingerprint");
  assert.equal(v.tokens.common["--ov-font"], '"ov-emma-skin-fredoka", "Georgia", serif');
  assert.equal(v.tokens.common["--ov-font-heading"], '"ov-emma-skin-fredoka", "Georgia", serif');
  assert.match(v.css, /font-family:"ov-emma-skin-fredoka","Georgia",serif|font-family:"ov-emma-skin-fredoka", "Georgia", serif/);
  assert.doesNotMatch(v.css, /@font-face|url\(/, "the sheet of the skin never carries a font rule: the core writes them");
  // the licence is free text and is NEVER judged, whatever it says, and never reaches a sheet
  const odd = check(fontSkin("emma-skin", { manifest: { license: "All rights reserved, not for redistribution", assets: [{ ...FONT_ASSET, license: "} body{display:none} @import url(//evil.example/x.css) </style><script>x</script>", author: "A \"quoted\" {author}", source: "javascript:alert(1)" }] } }));
  assert.equal(odd.ok, true, JSON.stringify(codes(odd)));
  assert.doesNotMatch(odd.css + JSON.stringify(odd.tokens), /evil|display:none|script/);
  const withFonts = Sh.compileSkin({ id: "emma-skin", version: "1.0.0", tokens: odd.tokens.common, css: odd.css, fonts: F.overlayFonts("emma-skin", "1.0.0", odd.manifest.assets) });
  assert.doesNotMatch(withFonts.css, /evil|display:none|script|javascript|author/, "no text of the manifest reaches the generated rules");
  // a system font that is not declared is still fine (it is looked up on the viewer's machine, never loaded)
  assert.equal(check(fontSkin("emma-skin", { tokens: { ...TOKENS, "--ov-font": "Georgia, serif" } })).ok, true);
});

test("each refusal of a font is precise: wrong magic, too big, too many, too heavy together, wrong extension, header not sane", () => {
  const bad = Buffer.from(FONT); bad.write("XXXX", 0);
  refused({ fonts: { "fredoka.woff2": bad } }, "asset-signature");
  refused({ fonts: { "fredoka.woff2": Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(200)]) } }, "asset-signature");   // a TrueType file under a .woff2 name
  const truncated = FONT.subarray(0, FONT.length - 40);
  refused({ fonts: { "fredoka.woff2": truncated } }, "overlay-font-invalid");   // the length field no longer matches
  const shortHeader = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60)]);
  refused({ fonts: { "fredoka.woff2": shortHeader } }, "overlay-font-invalid");
  const big = refused({ fonts: { "fredoka.woff2": Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(151 * 1024)]) } }, "file-too-large");
  assert.match(big.issues.find((i) => i.code === "file-too-large").message.en, /152 KB; at most 150 KB/);
  // five fonts (4 at most) and 3 x 140 KB (400 KB together at most): the same ceilings as the fonts of a site skin
  const five = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`f${n}.woff2`, FONT]));
  refused({ fonts: five, manifest: { assets: [1, 2, 3, 4, 5].map((n) => ({ ...FONT_ASSET, file: `fonts/f${n}.woff2`, weight: `${n}00` })) } }, "fonts-too-many");
  const heavy = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(140 * 1024)]);
  refused({ fonts: { "a.woff2": heavy, "b.woff2": heavy, "c.woff2": heavy }, manifest: { assets: ["a", "b", "c"].map((n, i) => ({ ...FONT_ASSET, file: `fonts/${n}.woff2`, weight: `${i + 4}00` })) } }, "fonts-total-too-large");
  // wrong extension or place: ttf, otf, eot, woff (1), svg fonts, a font outside fonts/, a missing file
  for (const file of ["fonts/a.ttf", "fonts/a.otf", "fonts/a.eot", "fonts/a.woff", "fonts/a.svg", "images/a.woff2", "a.woff2", "fonts/A.woff2", "fonts/../a.woff2"]) {
    refused({ manifest: { assets: [{ ...FONT_ASSET, file }] }, fonts: {} }, "asset-bad-path");
  }
  refused({ manifest: { assets: [{ ...FONT_ASSET, file: "fonts/missing.woff2" }] }, fonts: {} }, "asset-missing");
  refused({ manifest: { assets: [FONT_ASSET, FONT_ASSET] } }, "asset-duplicate");
  // an undeclared file in fonts/ is as unlisted as anywhere else
  refused({ fonts: { "fredoka.woff2": FONT, "extra.woff2": FONT } }, "skin-file-unlisted");
});

test("contract, core and family rules: contract 6 and minCore 0.47.0 are asked for, a family is declared, images still need a scene", () => {
  refused({ manifest: { skinContract: 5, minCore: "0.40.0" } }, "overlay-contract-v6");
  refused({ manifest: { minCore: "0.46.1" } }, "overlay-font-mincore");
  refused({ manifest: { assets: [{ ...FONT_ASSET, family: undefined }] } }, "overlay-font-family-missing");
  assert.throws(() => assert.equal(check(fontSkin("emma-skin", { manifest: { assets: [{ ...FONT_ASSET, family: 'Evil"} body{x:y}' }] } })).ok, true), "a family with quotes or braces is not a family");
  refused({ manifest: { assets: [{ ...FONT_ASSET, family: 'Evil"} body{x:y}' }] } }, "manifest-field");
  refused({ manifest: { assets: [{ ...FONT_ASSET, weight: "400; src: url(//evil)" }] } }, "manifest-field");
  // a core older than 0.47.0 judging the skin says "core newer", the skin is never half-installed
  const old = check(fontSkin("emma-skin"), { coreVersion: "0.46.1" });
  assert.equal(old.ok, false); assert.ok(codes(old).includes("manifest-core-newer"));
  // images without a scene are still refused (contract 5 keeps them for scenes only), even in a contract 6 skin
  const img = refused({ manifest: { assets: [FONT_ASSET, { file: "images/a.png", kind: "image" }] } }, "overlay-no-assets");
  assert.match(img.issues.find((i) => i.code === "overlay-no-assets").message.en, /no image without a scene/);
});

test("the skin never writes @font-face or url(); a family it does not declare, a list without a generic fallback, are refused with their own message", () => {
  const css = (body) => `[data-ov-part="title"]{${body}}`;
  // @font-face and url() stay forbidden whatever the contract
  for (const c of ['@font-face{font-family:"Fredoka";src:url(fonts/fredoka.woff2)}', css('background:url(fonts/fredoka.woff2)'), css('font-family:"Fredoka",serif;src:url(x)'), '@import url("x.css");']) refused({ css: c }, "overlay-css");
  refused({ tokens: { ...TOKENS, "--ov-font": 'url(fonts/fredoka.woff2), serif' } }, "overlay-token-value");
  refused({ tokens: { ...TOKENS, "--ov-font": '"Fredoka", serif; src: url(x)' } }, "overlay-token-value");
  // a family that is neither declared nor a known system font (token, then sheet)
  const t = refused({ tokens: { ...TOKENS, "--ov-font": '"Cinzel Decorative", serif' } }, "overlay-font-undeclared");
  assert.match(t.issues.find((i) => i.code === "overlay-font-undeclared").message.en, /"Cinzel Decorative" without shipping it/);
  assert.match(t.issues.find((i) => i.code === "overlay-font-undeclared").hint.fr, /Déclarez-la dans `assets`/);
  refused({ css: css('font-family:"Cinzel Decorative",serif') }, "overlay-font-undeclared");
  // no generic family last: the declared family alone, or followed by a system name only (token, then sheet)
  refused({ tokens: { ...TOKENS, "--ov-font": '"Fredoka"' } }, "overlay-font-fallback");
  refused({ tokens: { ...TOKENS, "--ov-font": '"Fredoka", Georgia' } }, "overlay-font-fallback");
  refused({ css: css('font-family:"Fredoka"') }, "overlay-font-fallback");
  refused({ css: css('font-family:"Fredoka",Georgia') }, "overlay-font-fallback");
  // the generic words are never families: a quoted "serif" is a name, not the keyword, and is refused as a malformed list
  refused({ tokens: { ...TOKENS, "--ov-font": '"Fredoka", "serif"' } }, "overlay-token-value");
  // the messages exist in both languages
  for (const c of ["overlay-contract-v6", "overlay-font-mincore", "overlay-font-family-missing", "overlay-font-invalid", "overlay-font-undeclared", "overlay-font-fallback", "twin-overlay-only", "twin-self"]) {
    const e = Msg.catalogEntry(c); assert.ok(e && e.fr && e.en && e.hintFr && e.hintEn, c);
    assert.deepEqual([...e.fr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...e.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${c}: same {variables}`);
  }
});

test("font lists: mapping to scoped names, the generic fallback, known system fonts, and contracts 2 to 5 keep their rules", () => {
  const ctx = F.fontCtx("emma-skin", [FONT_ASSET, { ...FONT_ASSET, family: "Fredoka One", file: "fonts/b.woff2" }], 6);
  assert.deepEqual(F.mapFontStack('"Fredoka One", Fredoka, "Segoe UI", system-ui', ctx), { ok: true, value: '"ov-emma-skin-fredoka-one", "ov-emma-skin-fredoka", "Segoe UI", system-ui' });
  assert.deepEqual(F.mapFontStack("Fredoka, sans-serif", ctx), { ok: true, value: '"ov-emma-skin-fredoka", sans-serif' });
  assert.equal(F.mapFontStack("sans-serif", ctx).reason, "fallback");
  assert.deepEqual(F.mapFontStack("Nope, serif", ctx), { ok: false, reason: "undeclared", family: "Nope" });
  assert.equal(F.mapFontStack('"Fredoka", serif, "Segoe UI"', ctx).reason, "fallback", "the generic family must be LAST");
  for (const bad of ["", ",serif", '"Fredoka",, serif', '"Fredoka, serif', "Fredoka;x, serif", "a, b, c, d, e, f, g, h, serif"]) assert.equal(F.mapFontStack(bad, ctx).ok, false, bad);
  // below contract 6 there is no context: today's rules (any well-formed name, a generic family last) are exactly kept
  assert.equal(F.fontCtx("emma-skin", [FONT_ASSET], 5), undefined);
  assert.deepEqual(T.checkToken("--ov-font", "Cinzel, serif"), { ok: true, value: '"Cinzel", serif' });
  assert.equal(T.checkToken("--ov-font", "Cinzel").ok, false);
  assert.equal(C.sanitizeOverlayCss('[data-ov-part="title"]{font-family:"Cinzel",serif}', "epic").ok, true);
  assert.equal(C.sanitizeOverlayCss('[data-ov-part="title"]{font-family:"Cinzel",serif}', "epic", ctx).ok, false);
  // `var(--ov-font)` keeps working in a sheet of contract 6
  assert.equal(C.sanitizeOverlayCss('[data-ov-part="title"]{font-family:var(--ov-font-heading)}', "epic", ctx).ok, true);
});

// ── the `@font-face` the core writes ─────────────────────────────────────────────────

test("generated @font-face: exact output, scoping, escaping, nothing of the manifest's text goes through", () => {
  const fonts = F.overlayFonts("emma-skin", "1.2.3", [{ ...FONT_ASSET, weight: "700", style: "italic" }, { ...FONT_ASSET, file: "fonts/b.woff2", family: "Fredoka  One", weight: "300 500" }]);
  assert.deepEqual(fonts, [
    { family: "ov-emma-skin-fredoka", weight: "700", style: "italic", url: "/skins/emma-skin/1.2.3/fonts/fredoka.woff2" },
    { family: "ov-emma-skin-fredoka-one", weight: "300 500", style: "normal", url: "/skins/emma-skin/1.2.3/fonts/b.woff2" },
  ]);
  assert.equal(F.fontFaceCss(fonts[0]), '@font-face{font-family:"ov-emma-skin-fredoka";src:url("\\2f skins\\2f emma-skin\\2f 1.2.3\\2f fonts\\2f fredoka.woff2") format("woff2");font-weight:700;font-style:italic;font-display:fallback}');
  // scoped per skin: the same family name in two skins never collides, and never collides with a page's own family
  assert.notEqual(F.scopedFamily("emma-skin", "Fredoka"), F.scopedFamily("lune-skin", "Fredoka"));
  assert.match(F.scopedFamily("lune-skin", "Fredoka"), /^ov-lune-skin-fredoka$/);
  // defence in depth: whatever a manifest holds, an entry that is not well formed is skipped, never written
  const hostile = F.overlayFonts("emma-skin", "1.0.0", [
    { file: "fonts/a.woff2", kind: "font", family: 'x"}body{display:none}' }, { file: "fonts/a.woff2", kind: "font", family: "Ok", weight: "400;src:url(//evil)" }, { file: "fonts/../../etc/passwd", kind: "font", family: "Ok" },
    { file: "fonts/a.woff2", kind: "font" }, { file: "images/a.png", kind: "image", family: "Ok" }, { file: "fonts/a.woff2", kind: "font", family: "Ok", style: "oblique 10deg" },
  ]);
  assert.deepEqual(hostile.map((f) => [f.family, f.style]), [["ov-emma-skin-ok", "normal"]], "only the entry that is well formed is kept (an unknown style falls back to normal)");
  assert.deepEqual(F.overlayFonts("Bad_ID", "1.0.0", [FONT_ASSET]), []);
  assert.deepEqual(F.overlayFonts("emma-skin", "1.0", [FONT_ASSET]), []);
  // the compiled sheet: the rules come first, once per font, and `url(` appears nowhere else
  const v = check(fontSkin("emma-skin"));
  const p = Sh.compileSkin({ id: "emma-skin", version: "1.0.0", tokens: v.tokens.common, css: v.css, fonts: F.overlayFonts("emma-skin", "1.0.0", v.manifest.assets) });
  assert.ok(p.css.startsWith("@font-face{font-family:\"ov-emma-skin-fredoka\""), p.css.slice(0, 80));
  assert.equal([...p.css.matchAll(/url\(/g)].length, 1); assert.equal([...p.css.matchAll(/@font-face/g)].length, 1);
  assert.deepEqual(p.fonts, [{ family: "ov-emma-skin-fredoka", weight: "400", style: "normal", url: "/skins/emma-skin/1.0.0/fonts/fredoka.woff2" }]);
  assert.match(p.css, /--ov-font:"ov-emma-skin-fredoka", "Georgia", serif!important/);
  // no font: no key, no rule (byte for byte the sheet of before: see overlay-skins-regression.test.mjs)
  assert.equal("fonts" in Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" }), false);
});

// ── the page that wears it ─────────────────────────────────────────────────────────────

const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
function page(skin, { contextual = false, elementSkins } = {}) {
  const pg = { id: "p", name: "Page", width: 1920, height: 1080, active: true, style: { text: "light", background: "transparent", corners: "round" }, look: { skin: skin?.id ?? null, byContext: { enabled: false, instance: null, context: null, rules: [] } }, rev: 1,
    elements: [{ uid: "aaaaaa1111", instance: "al", element: "alerts", x: 10, y: 20, w: 640, h: 260, visible: true, options: {}, ...(elementSkins ? { skin: "lune-skin" } : {}) }] };
  const html = R.renderPage({ page: pg, elements: [{ el: pg.elements[0], title: "Alerts", status: "ok", layout, follows: true, src: "/overlays/al?ov-w=640" }], t: makeTranslator("en"), lang: "en", test: false, now: 1_000_000, nonce: "N0nce", stateUrl: "/overlays/page/x/state", skin, contextual, ...(elementSkins ? { elementSkins } : {}) });
  return html;
}
const withFonts = () => { const v = check(fontSkin("emma-skin")); return { ...Sh.compileSkin({ id: "emma-skin", version: "1.0.0", tokens: v.tokens.common, css: v.css, fonts: F.overlayFonts("emma-skin", "1.0.0", v.manifest.assets) }), key: "emma-skin@1.0.0:abc" }; };
const scriptOf = (html) => /<script nonce="N0nce">([\s\S]*?)<\/script>/.exec(html)[1];

test("overlay page: fonts travel with the skin, the loader is emitted only when needed, the policy is unchanged, the script is valid", () => {
  const html = page(withFonts());
  const s = scriptOf(html);
  assert.doesNotThrow(() => new vm.Script(s), "the page script is valid JavaScript");
  assert.match(s, /"fonts":\[\{"family":"ov-emma-skin-fredoka","weight":"400","style":"normal","url":"\/skins\/emma-skin\/1\.0\.0\/fonts\/fredoka\.woff2"\}\]/);
  assert.match(s, /new w\.FontFace\(ft\.family,new w\.Uint8Array\(b\.slice\(0\)\)/, "the bytes are handed to the frame: no address for a strict element policy to refuse");
  assert.match(s, /Promise\.race\(\[fload\(f,Q\),new Promise\(function\(r\)\{setTimeout\(r,2500\)\}\)\]\)\.then\(show,show\)/, "the frame is shown after 2.5 s at most, font or not");
  assert.match(s, /fonts:s\.skin\.fonts\|\|null/, "a skin that comes with the next state brings its fonts");
  assert.match(html, /@font-face\{font-family:\\"ov-emma-skin-fredoka\\"/, "the core's @font-face rules are in the sheet handed to the frames");
  assert.match(html, /data-follows="1"[^>]*style="opacity:0;transition:opacity \.2s;/, "the frame waits hidden for its sheet and its fonts");
  // the policy of the page: no new origin and no `font-src` (the page itself draws no skin text; fonts are fetched under `connect-src 'self'`)
  const csp = R.contentSecurityPolicy("N0nce", "'none'");
  assert.match(csp, /font-src 'none'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /default-src 'none'/);
  // a page whose skin has no font has no loader at all
  const plain = page({ ...Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" }), key: "plain@1.0.0:abc" });
  assert.doesNotMatch(plain, /FontFace|fbuf|fonts/);
  // ...except a page whose skin changes by context (a rule may bring a skin with fonts)
  const ctx = scriptOf(page({ ...Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" }), key: "plain@1.0.0:abc" }, { contextual: true }));
  assert.match(ctx, /FontFace/); assert.doesNotThrow(() => new vm.Script(ctx));
  // an element that wears its own skin with fonts
  const own = page(null, { elementSkins: new Map([["lune-skin", withFonts()]]) });
  assert.match(scriptOf(own), /"es":\[\{"id":"emma-skin","css":.*"fonts":\[\{/); assert.doesNotThrow(() => new vm.Script(scriptOf(own)));
  // the animation hand-off and the fonts compose
  const both = scriptOf(page({ ...withFonts(), anim: { animateContract: 1 } }));
  assert.doesNotThrow(() => new vm.Script(both)); assert.match(both, /window\.__ovAnim/); assert.match(both, /FontFace/);
});

// ── twinOf ─────────────────────────────────────────────────────────────────────────────

test("twinOf: optional, a skin id, ignored when unknown to an older core, overlay skins only", () => {
  const base = { skinContract: 6, kind: "overlay", id: "emma-skin", name: { fr: "E", en: "E" }, description: { fr: "d", en: "d" }, version: "1.0.0", minCore: "0.47.0", tokens: "tokens.json" };
  const parsed = Mf.parseSkinManifest({ ...base, twinOf: "lune-douce" });
  assert.equal(parsed.ok, true); assert.equal(parsed.manifest.twinOf, "lune-douce");
  assert.equal(Mf.parseSkinManifest(base).manifest.twinOf, undefined);
  for (const bad of ["Not An Id", "", 12, "x", "a".repeat(60), "../x"]) assert.equal(Mf.parseSkinManifest({ ...base, twinOf: bad }).ok, false, String(bad));
  // an older core reads the same manifest with a schema that does not know the key: the strict-looking zod object STRIPS unknown keys, and the reader only warns
  assert.ok(Mf.parseSkinManifest({ ...base, twinOf: "lune-douce", futureKey: 1 }).warnings.some((w) => w.code === "manifest-unknown-key"), "unknown keys are a warning here, as they are in the older cores");
  // folder level: overlay only, never itself or the built-in skin
  const ok = check(fontSkin("emma-skin", { manifest: { twinOf: "lune-douce" } }));
  assert.equal(ok.ok, true); assert.equal(ok.manifest.twinOf, "lune-douce");
  refused({ manifest: { twinOf: "emma-skin" } }, "twin-self"); refused({ manifest: { twinOf: "basic" } }, "twin-self");
  refused({ manifest: { kind: undefined, skinContract: 4, modes: ["dark"], twinOf: "lune-douce", assets: [], scene: undefined }, fonts: {} }, "twin-overlay-only");
  // a contract-5 overlay skin (no font) may carry it too: it is metadata, no contract change
  assert.equal(check(fontSkin("emma-skin", { manifest: { skinContract: 5, minCore: "0.40.0", assets: [], twinOf: "lune-douce" }, fonts: {}, tokens: { ...TOKENS, "--ov-font": "Georgia, serif" }, css: '[data-ov-part="panel"]{border-radius:var(--ov-radius,6px)}' })).ok, true);
});

test("twinOf in the catalogue: a fixed field list, validated as a skin id, only for overlay entries", () => {
  const entry = (extra) => ({ id: "emma-skin", name: "E", description: "d", repo: "https://github.com/test/curiosa-skins", skinContract: 6, ...extra });
  const read = (list, kind) => Cat.sanitizeSkinEntries({ skins: list }, "0.47.0", "official", kind);
  assert.equal(read([entry({ twinOf: "lune-douce" })], "overlay")[0].twinOf, "lune-douce");
  assert.equal("twinOf" in read([entry({})], "overlay")[0], false);
  for (const bad of ["Lune Douce", "basic", "emma-skin", 5, "../x", "", null]) assert.equal(read([entry({ twinOf: bad })], "overlay")[0].twinOf, undefined, String(bad));
  assert.equal(read([entry({ twinOf: "lune-douce" })], "site")[0].twinOf, undefined, "a site entry has no twin");
  assert.equal(read([entry({ twinOf: "lune-douce", surprise: 1 })], "overlay")[0].surprise, undefined, "unknown fields are ignored");
  // contract 6 is listed as compatible for this core, and an older core (ceiling 5) lists it as incompatible, never installable
  assert.equal(read([entry({})], "overlay")[0].compatible, true);
  assert.equal(read([entry({ skinContract: 7 })], "overlay")[0].compatible, false);
});

test("an older core refuses a contract 6 overlay skin cleanly as \"contract newer\" (its ceiling was 5)", () => {
  assert.equal(K.OVERLAY_SKIN_CONTRACT_V6, 6); assert.equal(K.maxSkinContract("overlay"), 6); assert.equal(K.maxSkinContract("site"), 4);
  // the refusal rule of every core, written as the previous core had it: the contract of the manifest above the ceiling of the skin's kind
  const PREVIOUS_CEILING = 5;
  const previousCore = (raw) => (Number.isInteger(raw.skinContract) && raw.skinContract > (raw.kind === "overlay" ? PREVIOUS_CEILING : 4) ? "manifest-contract-newer" : "parsed");
  const dir = fontSkin("emma-skin");
  assert.equal(previousCore(JSON.parse(fs.readFileSync(path.join(dir, "skin.json"), "utf8"))), "manifest-contract-newer");
  assert.equal(previousCore({ skinContract: 5, kind: "overlay" }), "parsed");
  // and the refusal this core gives for a contract one more than its own ceiling is the same message, so the wording is the one an older core shows
  const r = Mf.parseSkinManifest({ skinContract: 7, kind: "overlay", id: "emma-skin" });
  assert.deepEqual(r.issues.map((i) => i.code), ["manifest-contract-newer"]);
  assert.match(r.issues[0].message.en, /newer|more recent/i);
  assert.equal(Cat.sanitizeSkinEntries({ skins: [{ id: "emma-skin", name: "E", description: "d", repo: "https://github.com/test/curiosa-skins", skinContract: 6 }] }, "0.46.1", "official", "overlay")[0].compatible, true, "(the current core)");
});

test("badge: \"Matches your site skin\" only when the active site skin is the twin, a quiet \"Twin of\" when it is installed, nothing otherwise", () => {
  const names = new Map([["lune-douce", "Lune douce"], ["etoile-nord", "Étoile nord"]]);
  assert.deepEqual(W.twinBadge("lune-douce", "lune-douce", names), { kind: "match" });
  assert.deepEqual(W.twinBadge("lune-douce", "etoile-nord", names), { kind: "twin", name: "Lune douce" });
  assert.deepEqual(W.twinBadge("lune-douce", "basic", names), { kind: "twin", name: "Lune douce" });
  assert.equal(W.twinBadge("lune-douce", "etoile-nord", new Map([["etoile-nord", "Étoile nord"]])), null, "the site skin is not installed: nothing");
  assert.equal(W.twinBadge(undefined, "lune-douce", names), null);
  assert.deepEqual(W.twinBadge("lune-douce", "lune-douce", new Map()), { kind: "match" }, "the active skin matches even when the list of names is empty");
});

test("offer: one matching overlay skin, installed and working, not worn by every page; never when nothing is left to change", () => {
  const skins = [{ id: "z-twin", twinOf: "lune-douce", status: "ok", name: "Z" }, { id: "a-twin", twinOf: "lune-douce", status: "ok", name: "A" }, { id: "broken", twinOf: "lune-douce", status: "modified" }, { id: "other", twinOf: "etoile-nord", status: "ok" }, { id: "free", status: "ok" }];
  assert.deepEqual(W.twinToOffer(skins, "lune-douce", [null, "free"]), { skin: "a-twin", name: "A", pages: 2 }, "first twin by id; both pages would change");
  assert.deepEqual(W.twinToOffer(skins, "lune-douce", ["a-twin", "other"]), { skin: "a-twin", name: "A", pages: 1 }, "only the pages that do not wear it count");
  assert.deepEqual(W.twinToOffer(skins, "lune-douce", ["a-twin", "a-twin"]), { skin: "z-twin", name: "Z", pages: 2 }, "the first twin is already everywhere: the next one is offered");
  assert.equal(W.twinToOffer(skins.filter((s) => s.id !== "z-twin"), "lune-douce", ["a-twin"]), null, "worn by every page: nothing to offer");
  assert.equal(W.twinToOffer(skins, "lune-douce", []), null, "no overlay page: nothing to apply it to");
  assert.equal(W.twinToOffer(skins, "nobody", [null]), null); assert.equal(W.twinToOffer(skins, "", [null]), null);
  assert.equal(W.twinToOffer([{ id: "broken", twinOf: "lune-douce", status: "modified" }], "lune-douce", [null]), null, "a skin that does not work is never offered");
  // armed once, spent after a few hours, read without throwing
  const t0 = 1_800_000_000_000;
  assert.equal(O.readArmed({ site: "lune-douce", at: t0 }, t0 + 1000), "lune-douce");
  assert.equal(O.readArmed({ site: "lune-douce", at: t0 }, t0 + O.TWIN_OFFER_TTL_MS + 1), null);
  assert.equal(O.readArmed({ site: "lune-douce", at: t0 }, t0 - 1), null);
  for (const junk of [null, undefined, 5, "x", [], {}, { site: 1, at: t0 }, { site: "a" }]) assert.equal(O.readArmed(junk, t0), null);
});

test("the sample page of the gallery gets the fonts as data addresses and a matching policy; the CSS of a skin without fonts is untouched", async () => {
  const { inlineSkinFonts } = await import("@/core/overlays/skinFontData");
  const { sampleHeaders } = await import("@/core/overlays/sample");
  const root = makeTempDir("ovfont-root-");
  fs.mkdirSync(path.join(root, "emma-skin/1.0.0/fonts"), { recursive: true }); fs.writeFileSync(path.join(root, "emma-skin/1.0.0/fonts/fredoka.woff2"), FONT);
  const fonts = F.overlayFonts("emma-skin", "1.0.0", [FONT_ASSET]);
  const css = fonts.map(F.fontFaceCss).join("\n");
  const r = inlineSkinFonts(css, fonts, root);
  assert.equal(r.inlined, 1); assert.match(r.css, /^@font-face\{font-family:"ov-emma-skin-fredoka";src:url\("data:font\/woff2;base64,/);
  assert.equal(crypto.createHash("sha256").update(Buffer.from(/base64,([^"]+)"/.exec(r.css)[1], "base64")).digest("hex"), crypto.createHash("sha256").update(FONT).digest("hex"));
  assert.equal(inlineSkinFonts(css, fonts, path.join(root, "nowhere")).inlined, 0, "an unreadable font keeps its address: the sample shows the fallback");
  assert.equal(inlineSkinFonts("a{}", [], root).css, "a{}");
  assert.match(sampleHeaders("N", true)["Content-Security-Policy"], /font-src data:/); assert.doesNotMatch(sampleHeaders("N")["Content-Security-Policy"], /font-src/);
});
