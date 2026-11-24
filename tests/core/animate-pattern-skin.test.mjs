// The example skin of the repository (tests/fixtures/pattern-skins/slate-panes) drawn by the engine: the variant that fits the element is the one drawn, a cold frame and a warm
// frame agree, and a real Chromium draws it at the sizes of a wide bar, an ultra-wide bar and a square element. The cost (60 to 160 pieces, light and full effects) is measured by
// the bench noted in docs/OVERLAY-ANIMATIONS.md "Patterns"; the cap of 120 pieces comes from it.
import test from "node:test";
import assert from "node:assert/strict";

const V = await import("@/core/skins/validate");
const K = await import("@/core/animate/kit");
const S = await import("@/core/animate/spec");
const FIXTURE = "tests/fixtures/pattern-skins/slate-panes";
const engine = () => { const win = {}; new Function("window", K.animateScript())(win); return win.CuriosaAnimate; };
const T0 = 1_800_000_000_000;
const skin = V.validateSkinFolder(FIXTURE, { coreVersion: "0.48.0" });
const state = (value = 100) => ({ genre: "gauge", value, target: 100 });
const polys = (f, L) => f.ops.filter((o) => o.k === "poly" && o.L === L);

test("the variant nearest in proportions is drawn: the wide file for a bar, the square one for a square element, never a mix", () => {
  assert.equal(skin.ok, true, JSON.stringify(skin.issues.map((i) => i.code)));
  const [wide, square] = skin.animation.patterns.panes;
  const A = engine();
  for (const [w, h, want] of [[1764, 717, wide.cells.length], [3440, 1440, wide.cells.length], [900, 300, wide.cells.length], [400, 400, square.cells.length], [360, 420, square.cells.length]]) {
    const f = A.frame(state(), skin.animation, T0, { w, h }, { quality: "light" });
    assert.equal(polys(f, 0).length, want, `${w}x${h}: ${want} unlit panes`);
  }
  assert.notEqual(wide.cells.length, square.cells.length, "the two files do not have the same number of pieces, so the check above tells them apart");
});

test("a cold frame and a warm frame are the same drawing, and the pieces stay inside the element", () => {
  const A = engine(), B = engine();
  const a = JSON.stringify(A.frame(state(), skin.animation, T0, { w: 1764, h: 717 }, { quality: "light" }));
  A.frame(state(40), skin.animation, T0 + 500, { w: 1764, h: 717 }, { quality: "light" });
  assert.equal(JSON.stringify(A.frame(state(), skin.animation, T0, { w: 1764, h: 717 }, { quality: "light" })), a, "warm = cold");
  assert.equal(JSON.stringify(B.frame(state(), skin.animation, T0, { w: 1764, h: 717 }, { quality: "light" })), a, "another engine, same frame");
  const f = A.frame(state(), skin.animation, T0, { w: 1764, h: 717 }, { quality: "light" });
  for (const o of polys(f, 0)) for (let i = 0; i < o.p.length; i += 2) { assert.ok(o.p[i] >= -2 && o.p[i] <= 1766 && o.p[i + 1] >= -2 && o.p[i + 1] <= 719, `a point is inside: ${o.p[i]}, ${o.p[i + 1]}`); }
});

test("the cap of the engine is the cap of the checker (120 pieces), and a file may hold up to 160", () => {
  assert.equal(S.PATTERN.maxPieces, 120);
  assert.equal(S.PATTERN.maxCellsFile, 160);
});

// ── real Chromium ──────────────────────────────────────────────────────────────────────�
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

test("real browser: the example skin draws its own pieces at 1764 x 717, 3440 x 1440 and 400 x 400, with no error, and differs from the simple mosaic", { skip: skipBrowser, timeout: 120000 }, async () => {
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  const errors = [];
  try {
    const p = await (await browser.newContext({ viewport: { width: 1000, height: 500 } })).newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    const simple = { ...skin.animation, genres: { gauge: { body: { draw: "mosaic", pattern: "voronoi", seed: 3 } } } };
    for (const [w, h] of [[1764, 717], [3440, 1440], [400, 400]]) {
      const shot = async (recipe) => {
        await p.setContent(K.animateKitPage({ state: state(), recipe, width: w, height: h, at: T0 + 400, background: "transparent", quality: "light" }));
        await p.waitForSelector("html[data-ready='1']");
        return p.evaluate(() => { const cv = document.getElementById("cv"), c = cv.getContext("2d"), d = c.getImageData(0, 0, cv.width, cv.height).data; let drawn = 0, sum = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20) { drawn++; sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + (i >> 8)) % 1000003; } return { drawn: drawn / (cv.width * cv.height), sig: sum }; });
      };
      const mine = await shot(skin.animation), plain = await shot(simple);
      assert.ok(mine.drawn > 0.2, `${w}x${h}: the panes are drawn (${mine.drawn})`);
      assert.notEqual(mine.sig, plain.sig, `${w}x${h}: not the same picture as the simple mosaic`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
