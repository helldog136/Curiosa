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

test("skin sheet: the core cuts only what it generates (entrance preset, idle presets); module animations and transitions are left alone", () => {
  const entrance = sheet.match(/@media \(prefers-reduced-motion:no-preference\)\{[^{]*\[data-ov-part="panel"\][^{]*\{animation:ov-rise [^}]*\}\}/);
  assert.ok(entrance, "the entrance preset is written inside no-preference, so there is nothing to cut afterwards");
  assert.doesNotMatch(sheet.replace(entrance[0], ""), /animation:ov-rise/, "and nowhere else");
  const reduce = [...sheet.matchAll(/@media \(prefers-reduced-motion:reduce\)\{([^}]*)\{animation:none!important;transition:none!important\}\}/g)];
  assert.equal(reduce.length, 1, "one reduced-motion rule");
  const r = 'html[data-ov-skin="epic"] [data-ov-calm]';
  assert.deepEqual(reduce[0][1].split(","), [r, `${r} *`, `${r}::before`, `${r}::after`, `${r} *::before`, `${r} *::after`], "only the opt-in hook `data-ov-calm`");
  assert.doesNotMatch(sheet, /html\[data-ov-skin="epic"\] \*/, "no blanket selector, with or without the composition exclusion");
  const none = Sh.compileSkin({ id: "plain", version: "1.0.0", tokens: { "--ov-fg": "#fff", "--ov-surface": "#000" }, css: "" }).css;
  assert.doesNotMatch(none, /@keyframes|animation:ov-/, "a skin without motion has no animation");
  assert.match(none, /\[data-ov-calm\]/, "the hook exists for every skin");
  const idle = Sh.compileSkin({ id: "epic", version: "1.0.0", tokens: TOKENS, css: '@media (prefers-reduced-motion:no-preference){html[data-ov-skin="epic"] [data-ov-part="badge"]{animation:ov-flicker 3s infinite}}' }).css;
  assert.match(idle, /@keyframes ov-flicker/);
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

/* ───────────── module content vs core decoration, in a real Chromium ───────────── */
const modSheet = Sh.compileSkin({ id: "epic", version: "1.0.0", tokens: TOKENS, css: '@media (prefers-reduced-motion:no-preference){html[data-ov-skin="epic"] [data-ov-part="badge"]{animation:ov-flicker 3s ease-in-out infinite}}' }).css;
const modPage = `<!doctype html><meta charset="utf-8"><html data-ov-skin="epic"><style>${modSheet}
.slide{transform:translateX(135%);opacity:0;transition:transform .5s,opacity .4s}.slide.on{transform:none;opacity:1}
.own{animation:own-in .4s ease-out both}@keyframes own-in{from{opacity:0}to{opacity:1}}</style>
<body><div id="a" class="slide" data-ov-part="item">module slider</div><div id="c" class="slide" data-ov-calm>calm slider</div><div id="p" data-ov-part="card">preset</div><div id="b" data-ov-part="badge">idle</div><div id="o" class="own" data-ov-part="panel">own</div><div id="k" data-ov-calm class="own">calm own</div></body>`;

async function probe(reducedMotion) {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(modPage); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 800, height: 500 }, reducedMotion })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    return await p.evaluate(async () => {
      const $ = (id) => document.getElementById(id), cs = (id) => getComputedStyle($(id));
      const out = {};
      for (const id of ["a", "c"]) {
        $(id).offsetWidth; $(id).classList.add("on"); cs(id).opacity;
        const tr = $(id).getAnimations().filter((x) => x.transitionProperty).map((x) => x.transitionProperty).sort();
        const mid = (() => { $(id).getAnimations().forEach((x) => { x.pause(); x.currentTime = 100; }); return cs(id).opacity; })();
        out[id] = { duration: cs(id).transitionDuration, running: tr, midOpacity: Number(mid) };
      }
      out.preset = cs("p").animationName; out.idle = cs("b").animationName; out.own = cs("o").animationName; out.calmOwn = cs("k").animationName;
      return out;
    });
  } finally { await browser.close(); server.close(); }
}

for (const mode of ["no-preference", "reduce"]) {
  test(`real browser, ${mode}: module transitions and animations keep their timing, the core's decorative presets follow the preference`, { skip, timeout: 90000 }, async () => {
    const r = await probe(mode);
    const reduce = mode === "reduce";
    // (a) a module element with a CSS transition on transform / opacity still transitions, in both modes
    assert.equal(r.a.duration, "0.5s, 0.4s", "the module's transition is still there");
    assert.deepEqual(r.a.running, ["opacity", "transform"], "and it runs");
    assert.ok(r.a.midOpacity > 0 && r.a.midOpacity < 1, `half-way through the transition the element is neither hidden nor shown (${r.a.midOpacity})`);
    // (b) the decorative presets of the core: on without a preference, off under reduced motion
    assert.equal(r.preset, reduce ? "none" : "ov-rise", "the entrance preset");
    assert.equal(r.idle, reduce ? "none" : "ov-flicker", "the idle preset of the skin");
    // a module's own keyframes on a skinned part are no longer overridden or cancelled by the core
    assert.equal(r.own, reduce ? "own-in" : "ov-rise", "a module's own animation on a skinned container: the preset still replaces it without a preference (unchanged), but is no longer cancelled under reduced motion");
    // the opt-in hook
    assert.equal(r.c.duration, reduce ? "0s" : "0.5s, 0.4s", "data-ov-calm: calm under reduced motion only");
    assert.deepEqual(r.c.running, reduce ? [] : ["opacity", "transform"]);
    assert.equal(r.calmOwn, reduce ? "none" : "own-in");
  });
}
