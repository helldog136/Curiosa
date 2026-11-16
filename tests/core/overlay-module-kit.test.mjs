// Module helper and checks for overlay elements (core 0.24.0): `ctx.overlay.tokens` / `tvFactor` / `tvTokens` (the function fifteen modules copied), and the
// advice rules "invisible at rest" and "readable" of the module:check kit, on faithful fake modules AND, when the modules repository is next to the core, on
// every module of it that offers elements (none must break: the rules are advice).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const K = await import("@/core/overlays/moduleKit");
const { tokenValues } = await import("@/core/overlays/tokens");
const { TV_TYPE_SCALE } = await import("@/core/overlays/textScale");
const { fakeCtx } = await import("../../testsupport/fakeCtx.mjs");
const R = await import("../../testsupport/requirements/overlay.mjs");
after(() => R.closeBrowser());

test("tokens(query): the same values as the core page for every common style; empty without the style parameters; a hostile selector is refused", () => {
  for (const text of ["light", "dark"]) for (const surface of ["transparent", "soft"]) for (const corners of ["round", "square"]) {
    const css = K.elementTokens(new URLSearchParams({ "ov-text": text, "ov-surface": surface, "ov-corners": corners }));
    const v = tokenValues({ text, background: surface, corners });
    assert.equal(css, `:root{--ov-fg:${v["--ov-fg"]};--ov-surface:${v["--ov-surface"]};--ov-radius:${v["--ov-radius"]};--ov-border:${v["--ov-border"]}}`);
  }
  assert.equal(K.elementTokens("ov-w=10"), "", "an address opened by hand: the module's own fallbacks apply");
  assert.equal(K.elementTokens("?ov-text=dark&ov-surface=weird"), K.elementTokens("ov-text=dark&ov-surface=transparent"), "an unknown surface is transparent");
  assert.match(K.elementTokens("ov-text=light", '[data-ov-region="element"]'), /^\[data-ov-region="element"\]\{--ov-fg:#ffffff/);
  assert.equal(K.elementTokens("ov-text=light", "x}body{color:red"), "");
  assert.equal(K.elementTokens({ "ov-text": "dark" }).includes("#111111"), true, "a plain object works too");
});

test("tvFactor and tvTokens: the factor in bounds (else 1) and the TV type scale of the core", () => {
  assert.equal(K.tvFactor("ov-tv=0.6667"), 0.6667); assert.equal(K.tvFactor("ov-tv=0"), 1); assert.equal(K.tvFactor("ov-tv=99"), 1); assert.equal(K.tvFactor(""), 1);
  const t = K.tvTokens("ov-tv=2");
  assert.match(t, /^--ov-tv:2;/);
  for (const [step, px] of Object.entries(TV_TYPE_SCALE)) assert.ok(t.includes(`--ov-text-${step}:calc(${px}px*var(--ov-tv))`), step);
});

test("ctx.overlay keeps the composition kit (0.19.0) and adds the element helpers; the test kit gives the real one; an older core has none", () => {
  for (const k of ["composeScript", "composeCss", "checkComposition", "resolveComposition", "copyPlacement", "tokens", "tvFactor", "tvTokens"]) assert.equal(typeof K.overlayKit[k], "function", k);
  assert.match(fs.readFileSync("src/core/modules/context.ts", "utf8"), /overlay: overlayKit,/);
  const ctx = fakeCtx({});
  assert.equal(ctx.overlay.tokens("ov-text=light"), K.elementTokens("ov-text=light"));
  assert.equal(typeof ctx.overlay.composeScript, "function");
  assert.equal(fakeCtx({ overlay: null }).overlay, undefined);
});

// ── The advice rules, on faithful fake modules ──────────────────────────────────────────────────────────────────────────────────────────────
const PAGE = {
  good: '<!doctype html><style>:root{--ov-fg:#fff}#p{background:var(--ov-surface,#222);color:var(--ov-fg,#fff);padding:12px}</style><div data-ov-region="element"><div id="p" data-ov-part="panel" hidden></div></div><script>/* shows the panel when data arrives */</script>',
  noData: '<!doctype html><style>#p{background:var(--ov-surface,#222);color:var(--ov-fg,#fff)}</style><div data-ov-region="element"><div id="p" data-ov-part="panel"><span data-ov-part="text">Aucune donnée</span></div></div>',
  emptyBox: '<!doctype html><style>#p{background:var(--ov-surface,#222);color:var(--ov-fg,#fff);height:80px;border:2px solid #fff}</style><div data-ov-region="element"><div id="p" data-ov-part="panel"></div></div>',
  hiddenByScript: '<!doctype html><style>#p{background:#222;height:80px}</style><div data-ov-region="element"><div id="p" data-ov-part="panel">x</div></div><script>document.getElementById("p").hidden = true</script>',
  inline016: '<!doctype html><style>[data-ov-part="card"]{background:var(--ov-surface,#223)}[data-ov-part="message"]{color:var(--ov-fg,#eee)}</style><div id="al-stage" style="--ov-fg:#ffffff;--ov-surface:transparent"><div data-ov-part="card" hidden><div data-ov-part="message"></div></div></div>',
  hardCoded: '<!doctype html><style>.box{background:#000;color:#fff}</style><div class="box" hidden></div>',
};
function fakeModule(pages) {
  const ids = Object.keys(pages);
  return {
    parsed: { ok: true, manifest: { id: "probe-mod", permissions: ["routes"], overlayElements: ids.map((id) => ({ id, label: id, fit: "fluid", followsStyle: id !== "hardCodedNoStyle", options: [] })) } },
    locales: { fr: {}, en: {} },
    definition: {
      overlayElements: Object.fromEntries(ids.map((id) => [id, (ctx) => ({ url: `/m/${ctx.instance.key}/element/${id}` })])),
      routes: { "element/:slug": (req, ctx) => new Response(pages[ctx.params.slug] ?? "", { headers: { "content-type": "text/html" } }) },
    },
  };
}
const rule = (id) => R.default.find((r) => r.id === id);

test("overlay.idle (advice): a page with a 'no data' text or an empty box is reported; a hidden panel (in the markup or by its script) passes", { timeout: 60000 }, async () => {
  assert.equal(rule("overlay.idle").level, "advice", "never refuses a module");
  const res = await rule("overlay.idle").run(fakeModule({ good: PAGE.good, noData: PAGE.noData, emptyBox: PAGE.emptyBox, hiddenByScript: PAGE.hiddenByScript }));
  const text = res.join("\n");
  assert.doesNotMatch(text, /"good"/);
  assert.match(text, /"noData"/);
  // A box drawn empty, or a panel the script hides, needs a real browser to be judged; without one (a CI runner without Chromium) the text check alone runs.
  if ((await R.paintedAtRest("<p>x</p>")) !== null) { assert.match(text, /"emptyBox"/); assert.doesNotMatch(text, /"hiddenByScript"/); }
  assert.deepEqual(await rule("overlay.idle").run({ parsed: { ok: true, manifest: { id: "x", overlayElements: [] } }, definition: {} }), { na: "the module offers no overlay page element" });
});

test("overlay.readable (advice): the 0.16.0 alerts bug (tokens written inline on an inner node) and a page that never reads the tokens are reported", () => {
  assert.equal(rule("overlay.readable").level, "advice");
  assert.deepEqual(R.readabilityProblems(PAGE.good), []);
  assert.match(R.readabilityProblems(PAGE.inline016).join(), /written inline on <div/);
  const hard = R.readabilityProblems(PAGE.hardCoded).join("\n");
  assert.match(hard, /never reads var\(--ov-fg\)/); assert.match(hard, /never read var\(--ov-surface\)/); assert.match(hard, /no part is marked/);
  assert.deepEqual(R.readabilityProblems('<html style="--ov-fg:#fff"><div data-ov-region="element" style="--ov-surface:#000" data-ov-part="panel">var(--ov-fg) var(--ov-surface)</div></html>'), [], "tokens on html or on the element node are right");
});

// ── The modules repository, when it is next to the core ─────────────────────────────────────────────────────────────────────────────────────
const extras = [process.env.CURIOSA_EXTRAS_DIR].filter(Boolean).find((d) => fs.existsSync(path.join(d, "modules")));
test("modules repository: every module that offers elements passes both advice rules, except the generative maze (it always plays)", { skip: extras ? false : "set CURIOSA_EXTRAS_DIR to the modules repository to run it", timeout: 300000 }, async () => {
  const { loadModuleDir } = await import("../../testsupport/loader.mjs");
  const found = [];
  for (const id of fs.readdirSync(path.join(extras, "modules")).sort()) {
    const file = path.join(extras, "modules", id, "module.json");
    if (!fs.existsSync(file) || !JSON.parse(fs.readFileSync(file, "utf8")).overlayElements?.length) continue;
    const m = await loadModuleDir(path.join(extras, "modules", id));
    for (const r of ["overlay.idle", "overlay.readable"]) { const res = await rule(r).run(m); if (Array.isArray(res) && res.length) found.push(`${id} ${r}: ${res.join("; ")}`); }
  }
  assert.ok(found.every((f) => f.startsWith("maze-overlay overlay.idle")), found.join("\n"));
});
