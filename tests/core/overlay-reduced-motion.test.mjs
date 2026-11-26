// Reduced motion on overlay pages: the browser's `prefers-reduced-motion: reduce` (an OBS browser reports it when Windows has animations off) removes the
// skin's DECORATIVE motion, but never the TIMING of a placed text: `in.at` / `out.at` of a composition keep working, the entrance and exit degrade to a plain
// fade. The real skin sheet and the real compose engine run in a real Chromium, with the text animations held and stepped the way the alerts overlay's video
// clock does (`getAnimations()` then `currentTime`).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const Sh = await import("@/core/overlays/skinSheet");
const R = await import("@/core/compose/render");
const M = await import("@/core/compose/model");

const SRC = "/uploads/00000001-0000-4000-8000-000000000000.png";
const TOKENS = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-accent": "#e8a23b", "--ov-anim": "rise" };
const sheet = Sh.compileSkin({ id: "epic", version: "1.0.0", tokens: TOKENS, css: "" }).css;

test("skin sheet: the reduced-motion rule leaves a composition (and its texts) alone, everything else stops", () => {
  const m = sheet.match(/@media \(prefers-reduced-motion:reduce\)\{([^}]*)\{animation:none!important;transition:none!important\}\}/);
  assert.ok(m, "the decorative motion is still cut under reduced motion");
  const sel = m[1];
  const comp = ':not([data-ov-region="composition"]):not([data-ov-region="composition"] *)';
  assert.deepEqual(sel.split(/,(?=html)/), [`html[data-ov-skin="epic"] *${comp}`, `html[data-ov-skin="epic"] *${comp}::before`, `html[data-ov-skin="epic"] *${comp}::after`]);
  assert.doesNotMatch(sheet, /prefers-reduced-motion:reduce\)\{html\[data-ov-skin="epic"\] \*,/, "no blanket selector any more");
  const none = Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" }).css;
  assert.doesNotMatch(none, /prefers-reduced-motion/, "a skin without motion has no rule");
});

test("compose engine: calm motion keeps the timing and turns every entrance and exit into a fade (unit, fake window)", () => {
  const mk = (matches, opts) => {
    const els = [];
    const doc = { createElement: (t) => { const e = { t, style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(c) { this.children.push(c); return c; }, addEventListener() {}, classList: { add() {} } }; els.push(e); return e; } };
    const win = { document: doc, matchMedia: matches === null ? undefined : () => ({ matches }) };
    R.composeEngine(win);
    const comp = M.checkComposition({ v: 1, format: "16:9", backdrop: { src: SRC }, boxes: [{ id: "a", x: 10, y: 60, w: 80, h: 20, content: { kind: "custom", text: "Merci" }, in: { anim: "pop", at: 1, dur: 0.5 }, out: { anim: "rise", at: 3, dur: 0.5 } }] }, { variables: [] }).value;
    const root = win.CuriosaCompose.build(M.resolveComposition(comp, { phrase: "x", values: {} }), { doc, ...opts });
    return { root, box: els.find((e) => e.className === "cmp-box") };
  };
  const calm = mk(true).box.style.animation, full = mk(false).box.style.animation, none = mk(null).box.style.animation;
  assert.equal(calm, "cmp-fade-in 0.5s cubic-bezier(.2,.8,.2,1) 1s both,cmp-fade-out 0.5s ease-in 3s forwards", "same durations and delays, fade only");
  assert.equal(full, "cmp-pop-in 0.5s cubic-bezier(.2,.8,.2,1) 1s both,cmp-rise-out 0.5s ease-in 3s forwards");
  assert.equal(none, full, "no matchMedia: full motion");
  assert.equal(mk(false, { calm: true }).box.style.animation, calm, "opts.calm forces calm");
  assert.equal(mk(true, { calm: false }).box.style.animation, full, "opts.calm false forces full motion");
  assert.equal(mk(true).root.attrs["data-calm"], "1"); assert.equal(mk(false).root.attrs["data-calm"], undefined);
});

/* ───────────── a real Chromium ───────────── */
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skip = pw ? false : "Chromium or playwright not found: real render not tried";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const page = `<!doctype html><meta charset="utf-8"><html data-ov-skin="epic"><style>html,body{margin:0;background:#333}#host{position:relative;width:640px;height:360px}${sheet}\n${R.COMPOSE_CSS}</style>
<body><div id="host"></div><script>${R.composeScript()}</script></body></html>`;

/** The state the page reads from a text box at a given moment of the held clock: what the video clock of the alerts overlay does (`currentTime` of every animation). */
async function run(reducedMotion) {
  const server = http.createServer((req, res) => {
    if (req.url === SRC) { res.setHeader("content-type", "image/png"); return res.end(png); }
    res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 800, height: 500 }, reducedMotion })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    const comp = M.resolveComposition(M.checkComposition({ v: 1, format: "16:9", backdrop: { src: SRC }, boxes: [{ id: "a", x: 10, y: 60, w: 80, h: 20, content: { kind: "custom", text: "Merci etoile_nord" }, in: { anim: "pop", at: 1, dur: 0.5 }, out: { anim: "pop", at: 3, dur: 0.5 } }] }, { variables: [] }).value, { phrase: "x", values: {} });
    return await p.evaluate((c) => {
      const root = window.CuriosaCompose.mount(document.getElementById("host"), c, { still: true, seconds: 6 });
      const box = root.querySelector(".cmp-box");
      const anims = box.getAnimations();
      anims.forEach((a) => a.pause());
      const at = (t) => { anims.forEach((a) => { a.currentTime = t * 1000; }); const cs = getComputedStyle(box); return { opacity: Number(cs.opacity), transform: cs.transform }; };
      return { name: getComputedStyle(box).animationName, count: anims.length, calm: root.getAttribute("data-calm"), t: [0, 0.5, 0.9, 1.6, 2, 2.9, 3.6, 4, 5.5].map((t) => [t, at(t)]) };
    }, comp);
  } finally { await browser.close(); server.close(); }
}

for (const mode of ["no-preference", "reduce"]) {
  test(`real browser, ${mode}: a placed text with in.at=1 s and out.at=3 s is hidden before, shown between, hidden after`, { skip, timeout: 90000 }, async () => {
    const r = await run(mode);
    assert.equal(r.count, 2, "the entrance and the exit animations exist (the held clock can drive them)");
    assert.notEqual(r.name, "none", "the animation is not cancelled by the skin sheet");
    assert.equal(r.calm, mode === "reduce" ? "1" : null);
    const o = Object.fromEntries(r.t.map(([t, s]) => [t, s.opacity]));
    for (const t of [0, 0.5, 0.9]) assert.equal(o[t], 0, `hidden at ${t} s`);
    for (const t of [1.6, 2, 2.9]) assert.equal(o[t], 1, `shown at ${t} s`);
    for (const t of [3.6, 4, 5.5]) assert.equal(o[t], 0, `hidden at ${t} s`);
    const mid = Object.fromEntries(r.t.map(([t, s]) => [t, s.transform]));
    assert.ok(mid[2] === "none" || mid[2] === "matrix(1, 0, 0, 1, 0, 0)", "settled between the two");
    if (mode === "reduce") for (const [t, s] of r.t) assert.equal(s.transform, "none", `no scale or travel under reduced motion (${t} s)`);
  });
}

test("real browser: without the exclusion the skin sheet would cancel the animation (the former bug, kept as a witness)", { skip, timeout: 90000 }, async () => {
  const old = sheet.replace(/\*:not\(\[data-ov-region="composition"\]\):not\(\[data-ov-region="composition"\] \*\)/g, "*");
  assert.notEqual(old, sheet);
  const server = http.createServer((req, res) => { if (req.url === SRC) { res.setHeader("content-type", "image/png"); return res.end(png); } res.setHeader("content-type", "text/html"); res.end(page.replace(sheet, old)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 800, height: 500 }, reducedMotion: "reduce" })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    const comp = M.resolveComposition(M.checkComposition({ v: 1, format: "16:9", backdrop: { src: SRC }, boxes: [{ id: "a", content: { kind: "custom", text: "x" }, in: { anim: "pop", at: 1, dur: 0.5 } }] }, { variables: [] }).value, { phrase: "x", values: {} });
    const n = await p.evaluate((c) => { const r = window.CuriosaCompose.mount(document.getElementById("host"), c, { still: true, calm: false }); return r.querySelector(".cmp-box").getAnimations().length; }, comp);
    assert.equal(n, 0, "the old blanket rule cancels the placed text's animations");
  } finally { await browser.close(); server.close(); }
});
