// Chromium bench of the pattern branch (pieces x element size, one effects level): the measurement behind PATTERN.maxPieces in src/core/animate/spec.ts and the table in docs/OVERLAY-ANIMATIONS.md.
// Run from the repository root: node --import ./tests/helpers/register.mjs scripts/visual/pattern-bench.mjs   (COUNTS=60,120 QUALITY=full to narrow it). Prints JSON: first-frame ms, avg and p95 per size and count.
const lib = await import(process.cwd() + "/scripts/visual/lib/playwright.mjs");
const K = await import("@/core/animate/kit");
const G = await import("@/core/animate/patternGraph");
const chromium = lib.loadPlaywright().chromium;
const COUNTS = (process.env.COUNTS || "60,90,120,160").split(",").map(Number);
const SIZES = [[1764, 717], [3440, 1440]];
const QUALITY = process.env.QUALITY || "light";
// jittered grid of ~n quads tiling a [W,H] domain
function grid(n, W = 240, H = 100) {
  const ny = Math.max(2, Math.round(Math.sqrt((n * H) / W))), nx = Math.max(2, Math.round(n / ny));
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32, r2 = (v) => Math.round(v * 100) / 100;
  const V = []; for (let j = 0; j <= ny; j++) { V.push([]); for (let i = 0; i <= nx; i++) V[j].push([r2((i * W) / nx + (i === 0 || i === nx ? 0 : (rnd() - 0.5) * (W / nx) * 0.45)), r2((j * H) / ny + (j === 0 || j === ny ? 0 : (rnd() - 0.5) * (H / ny) * 0.45))]); }
  const cells = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push({ p: [V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]], tone: r2(rnd()) });
  return { domain: [W, H], cells };
}
const browser = await chromium.launch({ executablePath: lib.chromiumPath(), args: lib.CHROMIUM_ARGS });
const out = [];
for (const [w, h] of SIZES) for (const n of COUNTS) {
  const g = grid(n); const norm = G.normalisePattern(g.domain, g.cells);
  if (!norm.ok) { out.push({ w, h, n, error: "normalise" }); continue; }
  const recipe = { animateContract: 4, patterns: { p: [norm.graph] }, genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "p", seed: 3 } } } };
  // the cap check lives in the engine: raise it for the bench only so that 160 pieces can be measured
  let script = K.animateScript(); if (n > 120) script = script.replace(/maxPieces":120/, `maxPieces":${n + 5}`);
  const page = await (await browser.newContext({ viewport: { width: Math.min(w, 1920), height: Math.min(h, 1080) } })).newPage();
  await page.setContent(`<!doctype html><body style="margin:0"><canvas id="cv" width="${w}" height="${h}"></canvas><script>${script}</script>`);
  const r = await page.evaluate(({ recipe, w, h, quality }) => {
    const A = window.CuriosaAnimate, cv = document.getElementById("cv"), c = cv.getContext("2d");
    const times = []; let ops = 0, animating = 0, first = 0;
    const T0 = 1_800_000_000_000;
    // 150 frames: the value climbs from 0 to 100 over the first 100, then holds (the celebration frames are the heaviest)
    for (let i = 0; i < 150; i++) {
      const st = { genre: "gauge", value: Math.min(100, i), target: 100 };
      const t0 = performance.now();
      const f = A.frame(st, recipe, T0 + i * 33, { w, h }, { quality, calm: false });
      if (A.draw) A.draw(c, f, {}); // some builds draw through mount only
      const dt = performance.now() - t0; if (i === 0) first = dt; times.push(dt); ops = Math.max(ops, f.ops.length); if (f.animating) animating++;
    }
    times.sort((a, b) => a - b);
    return { first, ops, animating, avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], hasDraw: !!A.draw };
  }, { recipe, w, h, quality: QUALITY });
  out.push({ w, h, n, cells: g.cells.length, ...r });
  await page.context().close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
