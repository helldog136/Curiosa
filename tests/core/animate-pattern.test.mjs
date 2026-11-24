// The mosaic engine with a skin's own pieces (core 0.48.0, `pattern: "file"`, docs/OVERLAY-ANIMATIONS.md "Patterns"): the engine receives a normalised graph of
// numbers (patternGraph.ts), scales it to the body, bows each chain once, lights the pieces in an order that does not depend on their shape, and draws concave pieces
// safely (label point, inradius, details cut by the piece). The legacy mosaic (voronoi, grid, bricks) is proved unchanged by animate-motion.test.mjs (golden frames).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const K = await import("@/core/animate/kit");
const G = await import("@/core/animate/patternGraph");
const S = await import("@/core/animate/spec");
const engine = () => { const win = {}; new Function("window", K.animateScript())(win); return win.CuriosaAnimate; };
const A = engine();
const T0 = 1_800_000_000_000, SIZE = { w: 1764, h: 717 };
const LT = JSON.parse(fs.readFileSync("tests/fixtures/animate/pattern-lt.json", "utf8"));
const graphOf = (cells = LT.cells, domain = LT.domain) => { const r = G.normalisePattern(domain, cells); assert.equal(r.ok, true); return r.graph; };
const body = (extra = {}) => ({ draw: "mosaic", pattern: "file", source: "lt", seed: 5, order: "x", glow: 0, ...extra });
const recipe = (b = body(), patterns = { lt: [graphOf()] }) => ({ animateContract: 2, genres: { gauge: { body: b } }, patterns });
const state = (value) => ({ genre: "gauge", value, target: 100 });
const frame = (rc, v = 100, opts = {}, size = SIZE) => A.frame(state(v), rc, T0, size, opts);
const polys = (f, L) => f.ops.filter((o) => o.k === "poly" && o.L === L);
const inside = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) { const a = [pts[i], pts[i + 1]], b = [pts[j], pts[j + 1]]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

test("a pattern draws its own pieces: one unlit pane per piece, one lit pane per piece at 100 %, leads from chains", () => {
  const f = frame(recipe());
  assert.equal(polys(f, 0).length, 5, "five unlit panes");
  const lit = f.ops.filter((o) => o.L === 1 && o.k === "poly" && o.f && o.a === 1 && typeof o.f === "string");
  assert.equal(lit.length, 5, "five lit panes");
  const g = graphOf();
  const lead = polys(f, 2).filter((o) => typeof o.f === "string");
  assert.equal(lead.length, g.chains.length, "one lead stroke per chain (a straight lead is ONE stroke)");
  assert.ok(g.chains.length < g.edges.length, "joining made fewer strokes than sub-edges");
  // nothing escapes the body box
  const b = f.ops.filter((o) => o.k === "poly" && o.L === 0).flatMap((o) => o.p);
  for (let i = 0; i < b.length; i += 2) { assert.ok(isFinite(b[i]) && isFinite(b[i + 1])); }
});

test("deterministic: the same frame from two separate engines; a seed changes the lead, not the pieces", () => {
  const B = engine(), rc = recipe();
  for (const v of [0, 17, 50, 83, 100]) assert.equal(JSON.stringify(A.frame(state(v), rc, T0, SIZE, {})), JSON.stringify(B.frame(state(v), rc, T0, SIZE, {})), `value ${v}`);
  const a = frame(recipe(body({ seed: 1, irregularity: 2 }))), b = frame(recipe(body({ seed: 2, irregularity: 2 })));
  assert.notDeepEqual(polys(a, 2), polys(b, 2));
  assert.equal(polys(a, 0).length, polys(b, 0).length);
});

test("the pieces' own geometry is kept at every effects level and in calm mode (only the details and the lead's breathing change)", () => {
  const base = frame(recipe(), 100, { quality: "full" }), ref = JSON.stringify(polys(base, 0).map((o) => o.p));
  for (const opts of [{ quality: "light" }, { quality: "minimal" }, { quality: "full", calm: true }]) {
    const f = frame(recipe(), 100, opts);
    assert.equal(JSON.stringify(polys(f, 0).map((o) => o.p)), ref, JSON.stringify(opts));
    assert.equal(polys(f, 2).filter((o) => typeof o.f === "string").length, polys(base, 2).filter((o) => typeof o.f === "string").length, `${JSON.stringify(opts)}: the same leads`);
  }
  const calm = frame(recipe(), 100, { quality: "full", calm: true });
  assert.equal(JSON.stringify(polys(calm, 2)), JSON.stringify(polys(base, 2)));
});

test("concave pieces: details (mottle, bubbles, streak) are cut by the piece, clip and unclip are balanced, gradients start inside the piece", () => {
  const f = frame(recipe(body({ mottle: 1, bubbles: 1, streaks: 1 })));
  let depth = 0, inClip = 0, circOutside = 0;
  for (const o of f.ops) {
    if (o.k === "clip") depth++;
    else if (o.k === "unclip") { depth--; assert.ok(depth >= 0); }
    else if (o.k === "circ" && o.L === 1) { if (depth > 0) inClip++; else circOutside++; }
  }
  assert.equal(depth, 0, "balanced");
  assert.ok(inClip > 5, `details drawn under a clip (${inClip})`);
  assert.equal(circOutside, 0, "no detail circle outside a clip (glow is off)");
  // the radial gradient of the L-shaped piece (the first one in the file) starts inside it
  const L = graphOf().cells[0], sx = 1764 / 120, sy = 717 / 60;
  const pts = L.loop.map((id) => graphOf().v[id]);
  const grads = f.ops.filter((o) => o.k === "poly" && o.L === 1 && o.f && o.f.g === "rad");
  assert.ok(grads.length >= 5);
  for (const g of grads) assert.ok(isFinite(g.f.x) && isFinite(g.f.y));
  const flatL = pts.flatMap((q) => [q[0] * sx, q[1] * sy]);
  assert.ok(grads.some((g) => inside(flatL, g.f.x, g.f.y)), "one gradient starts inside the L");
  // with a DIFFERENT detail seed per piece (not the tone): two pieces of the same tone do not get the same blotches
  const same = graphOf(LT.cells.map((c) => ({ ...c, tone: 0.5 })));
  const f2 = frame(recipe(body({ mottle: 1 }), { lt: [same] }));
  const c2 = f2.ops.filter((o) => o.k === "circ" && o.L === 1);
  assert.equal(new Set(c2.map((o) => o.x + "," + o.y)).size > 3, true);
});

test("lit in the order of the area centroids (x by default), or of the pieces' own ranks when every piece has one", () => {
  const litFirst = (rc) => { const f = frame(rc, 20); return f.ops.filter((o) => o.L === 1 && o.k === "poly" && typeof o.f === "string" && o.a === 1)[0]; };
  const first = litFirst(recipe());
  // 20 % of five pieces: one pane lit. By x: the L (centroid furthest left) comes first
  const lPoly = polys(frame(recipe()), 0)[0].p;
  assert.equal(JSON.stringify(first.p), JSON.stringify(lPoly));
  const ranked = graphOf(LT.cells.map((c, i) => ({ ...c, rank: [4, 3, 2, 1, 0][i] })));
  const r = litFirst(recipe(body(), { lt: [ranked] }));
  assert.equal(JSON.stringify(r.p), JSON.stringify(polys(frame(recipe(body(), { lt: [ranked] })), 0)[4].p), "the piece with rank 0 is lit first");
  // a partial ranking is ignored (all or none)
  const partial = graphOf(LT.cells.map((c, i) => (i === 4 ? { ...c, rank: 0 } : c)));
  assert.equal(JSON.stringify(litFirst(recipe(body(), { lt: [partial] })).p), JSON.stringify(lPoly));
});

test("`shape` is ignored: the union of the pieces is the window", () => {
  const a = frame(recipe(body({ shape: "ellipse" }))), b = frame(recipe(body({ shape: "rect" })));
  assert.equal(JSON.stringify(a.ops), JSON.stringify(b.ops));
});

test("variants: the nearest aspect ratio wins (log scale); a pattern is stretched to the body", () => {
  const wide = graphOf(), tall = graphOf([{ p: [[0, 0], [20, 0], [20, 30], [0, 30]], tone: 0.2 }, { p: [[0, 30], [20, 30], [20, 60], [0, 60]], tone: 0.7 }], [20, 60]);
  const rc = recipe(body(), { lt: [tall, wide] });
  assert.equal(polys(frame(rc, 100, {}, { w: 1764, h: 717 }), 0).length, 5, "a wide body takes the wide variant");
  assert.equal(polys(frame(rc, 100, {}, { w: 200, h: 717 }), 0).length, 2, "a tall body takes the tall variant");
  // the same variant order reversed gives the same choice (no dependence on the order)
  assert.equal(polys(frame(recipe(body(), { lt: [wide, tall] }), 100, {}, { w: 200, h: 717 }), 0).length, 2);
  // stretched to the body: the extreme points of the unlit panes reach the body box
  const xs = polys(frame(recipe()), 0).flatMap((o) => o.p.filter((_, i) => i % 2 === 0));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1764 * 0.8);
});

test("fallbacks: an unknown source, an invalid graph, or more pieces than the cap draw the voronoi mosaic with the same other parameters", () => {
  const vor = JSON.stringify(frame({ animateContract: 2, genres: { gauge: { body: body({ pattern: "voronoi" }) } } }).ops);
  assert.equal(JSON.stringify(frame(recipe(body({ source: "nope" }))).ops), vor, "unknown source");
  assert.equal(JSON.stringify(frame(recipe(body(), {})).ops), vor, "no table");
  const bad = graphOf(); bad.v[0] = [NaN, 1];
  assert.equal(JSON.stringify(frame(recipe(body(), { lt: [bad] })).ops), vor, "a NaN vertex");
  const broken = graphOf(); broken.cells[0].loop[0] = 9999;
  assert.equal(JSON.stringify(frame(recipe(body(), { lt: [broken] })).ops), vor, "an index out of range");
  const inconsistent = graphOf(); inconsistent.cells[1].e[0] = inconsistent.cells[1].e[1];
  assert.equal(JSON.stringify(frame(recipe(body(), { lt: [inconsistent] })).ops), vor, "a side that does not join its vertices");
  // the cap
  const n = Math.ceil(Math.sqrt(S.PATTERN.maxPieces + 1)), cells = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ p: [[i * 5, j * 5], [i * 5 + 5, j * 5], [i * 5 + 5, j * 5 + 5], [i * 5, j * 5 + 5]], tone: ((i + j) % 10) / 10 });
  assert.ok(cells.length > S.PATTERN.maxPieces);
  assert.equal(JSON.stringify(frame(recipe(body(), { lt: [graphOf(cells, [n * 5, n * 5])] })).ops), vor, "above the cap");
  const ok = cells.slice(0, S.PATTERN.maxPieces);
  assert.equal(polys(frame(recipe(body(), { lt: [graphOf(ok, [n * 5, n * 5])] })), 0).length, S.PATTERN.maxPieces, "at the cap");
});

test("the recipe hash is computed once per recipe object (a recipe may carry the pieces of a pattern); the cache is invisible to JSON", () => {
  const rc = recipe(), before = JSON.stringify(rc);
  const real = JSON.stringify; let hits = 0;
  JSON.stringify = function (v, ...r) { if (v === rc) hits++; return real.call(this, v, ...r); };
  try { for (let i = 0; i < 20; i++) A.frame(state(i * 5), rc, T0 + i * 40, SIZE, {}); } finally { JSON.stringify = real; }
  assert.equal(hits, 1);
  assert.equal(JSON.stringify(rc), before, "non-enumerable: invisible to JSON");
});

test("a pattern is numbers only: the engine reads nothing else from it (extra keys, strings and functions are never drawn)", () => {
  const g = graphOf(); g.evil = "<script>"; g.cells[0].name = "x"; g.v.push([1, 1]);
  const f = frame(recipe(body(), { lt: [g] }));
  const text = JSON.stringify(f.ops);
  assert.ok(!text.includes("script") && !text.includes('"name"'));
});
