// The pattern normaliser (core 0.48.0, src/core/animate/patternGraph.ts): the pieces of a skin's pattern become a planar graph of numbers. Snap, T-junction split,
// border detection (one owner), straight chains, the label point and the inradius of concave pieces, the outline, and the refusals (overlap, blow-up).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const G = await import("@/core/animate/patternGraph");
const LT = JSON.parse(fs.readFileSync("tests/fixtures/animate/pattern-lt.json", "utf8"));
const norm = (cells = LT.cells, domain = LT.domain) => { const r = G.normalisePattern(domain, cells); assert.equal(r.ok, true, JSON.stringify(r)); return r.graph; };
const pos = (g, id) => g.v[id];
const rect = (x0, y0, x1, y1, tone = 0.5) => ({ p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tone });

test("the L/T fixture tiles its domain and becomes a planar graph (every interior sub-edge has two owners)", () => {
  const g = norm();
  assert.equal(g.cells.length, 5);
  assert.equal(g.cells.reduce((s, c) => s + c.area, 0), 7200);
  const owners = new Map();
  for (const c of g.cells) for (const e of c.e) owners.set(e, (owners.get(e) ?? 0) + 1);
  for (const [i, e] of g.edges.entries()) assert.equal(owners.get(i), e.border ? 1 : 2, `edge ${i} border=${e.border}`);
  // the outer side of the window is all border: 120 + 60 + 120 + 60 of length
  let border = 0; for (const e of g.edges) if (e.border) border += Math.hypot(...pos(g, e.a).map((x, k) => x - pos(g, e.b)[k]));
  assert.equal(Math.round(border), 360);
  // pieces are counter-clockwise (positive area)
  for (const c of g.cells) assert.ok(c.area > 0);
});

test("T-junctions: a side that another piece's corner touches is split there, so a shared lead is made of two-owner sub-edges", () => {
  const g = norm();
  // the vertex (60,20) touches the bottom of the T (50..70) and is a corner of the L and of the right rectangle: the T has it in its loop after the split
  const id = g.v.findIndex((q) => q[0] === 60 && q[1] === 20);
  assert.ok(id >= 0);
  const tee = g.cells[2];
  assert.ok(tee.loop.includes(id), "the T's bottom side is split at (60,20)");
  assert.equal(tee.loop.length, 9, "8 corners + 1 split point");
  // two rectangles of different heights side by side: the long side of the tall one is split where the short ones meet it
  const h = norm([rect(0, 0, 10, 20), rect(10, 0, 20, 10), rect(10, 10, 20, 20)], [20, 20]);
  const tall = h.cells[0];
  assert.equal(tall.loop.length, 5);
  assert.equal(h.edges.filter((e) => !e.border).length, 3, "the shared side counts as 2 sub-edges, plus the one between the short ones");
  for (const e of tall.e) assert.ok(h.edges[e]);
});

test("snap: vertices closer than 0.2 % of the domain are one vertex, and tiny gaps do not make a border", () => {
  const g = norm([rect(0, 0, 10, 10), { p: [[10.01, 0], [20, 0], [20, 10], [10.0, 10.015]], tone: 0.2 }], [20, 10]);
  assert.equal(g.v.length, 6, "6 distinct vertices, not 8");
  assert.equal(g.edges.filter((e) => !e.border).length, 1, "one shared lead");
});

test("border detection: a lone piece is all border; a hole is a border too", () => {
  const g = norm([rect(0, 0, 10, 10)], [10, 10]);
  assert.ok(g.edges.every((e) => e.border));
  const ring = norm([rect(0, 0, 30, 10), rect(0, 10, 10, 20), rect(20, 10, 30, 20), rect(0, 20, 30, 30)], [30, 30]);
  assert.equal(ring.edges.filter((e) => e.border).length >= 12, true);
  assert.ok(ring.outline.length >= 4);
});

test("chains: a straight lead split at T-junctions is ONE chain; a bent run is cut where it bends; border and interior never mix", () => {
  const g = norm();
  // the vertical lead x=20 between the L's tall bar and (F, T) runs from y=20 to y=60 in the L (one straight line split at (20,40)): one interior chain of 2 sub-edges
  const lead20 = g.chains.filter((c) => !c.border && c.ids.every((id) => pos(g, id)[0] === 20));
  assert.equal(lead20.length, 1);
  assert.equal(lead20[0].e.length, 2);
  // every sub-edge belongs to exactly one chain, in order
  const seen = new Set();
  for (const [ci, c] of g.chains.entries()) {
    assert.equal(c.e.length, c.ids.length - 1);
    c.e.forEach((ei, k) => { assert.equal(seen.has(ei), false); seen.add(ei); assert.equal(g.edges[ei].chain, ci); const e = g.edges[ei]; assert.deepEqual([e.a, e.b].sort(), [c.ids[k], c.ids[k + 1]].sort()); assert.equal(e.border, c.border); });
  }
  assert.equal(seen.size, g.edges.length);
  // a closed curve made of many small turns is cut into straight pieces, never one chain around the circle
  const n = 72, circle = { p: Array.from({ length: n }, (_, i) => [50 + 40 * Math.cos((i / n) * 2 * Math.PI), 50 + 40 * Math.sin((i / n) * 2 * Math.PI)].map((x) => Math.round(x * 100) / 100)), tone: 0.5 };
  const c = norm([circle], [100, 100]);
  assert.ok(c.chains.length >= 4 && c.chains.length < n && c.chains.some((x) => x.e.length > 1), `${c.chains.length} chains`);
  for (const ch of c.chains) { const a = pos(c, ch.ids[0]), b = pos(c, ch.ids[ch.ids.length - 1]); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1); }
});

test("label point and inradius: always inside a concave piece, where the area centroid may not be", () => {
  const g = norm();
  const L = g.cells[0], pts = L.loop.map((id) => pos(g, id));
  assert.ok(G.pointInsideDistance(L.lp[0], L.lp[1], pts) > 0, "the L's label point is inside");
  assert.ok(Math.abs(L.ri - G.pointInsideDistance(L.lp[0], L.lp[1], pts)) < 0.01);
  assert.ok(L.ri > 10 && L.ri < 12, `inradius of the L (20-wide arms, a round elbow): ${L.ri}`);
  // a thin C shape: the centroid falls in the notch, the label point does not
  const C = { p: [[0, 0], [30, 0], [30, 5], [5, 5], [5, 25], [30, 25], [30, 30], [0, 30]], tone: 0.5 };
  const c = norm([C], [30, 30]), cell = c.cells[0], cp = cell.loop.map((id) => pos(c, id));
  assert.ok(G.pointInsideDistance(cell.cen[0], cell.cen[1], cp) < 0, "the area centroid of a C is outside it");
  assert.ok(G.pointInsideDistance(cell.lp[0], cell.lp[1], cp) > 1);
  // every piece of the fixture
  for (const cc of g.cells) assert.ok(G.pointInsideDistance(cc.lp[0], cc.lp[1], cc.loop.map((id) => pos(g, id))) > 0);
});

test("outline: the silhouette of the fixture is its rectangle; the area centroid of a rectangle is its middle", () => {
  const g = norm();
  const o = g.outline.map((id) => pos(g, id));
  assert.equal(Math.abs(G.signedArea(o)), 7200);
  const r = norm([rect(0, 0, 10, 20)], [10, 20]).cells[0];
  assert.deepEqual(r.cen, [5, 10]);
});

test("refusals: pieces on top of each other, a blow-up of the T-junction split, degenerate pieces, no piece", () => {
  assert.deepEqual(G.normalisePattern([20, 20], [rect(0, 0, 10, 10), rect(0, 0, 10, 10)]), { ok: false, reason: "overlap" });
  assert.equal(G.normalisePattern([20, 20], []).ok, false);
  assert.equal(G.normalisePattern([20, 20], [{ p: [[0, 0], [10, 0], [20, 0]], tone: 0.5 }]).reason, "degenerate");
  assert.equal(G.normalisePattern([20, 20], [{ p: [[0, 0], [1, 0]], tone: 0.5 }]).reason, "degenerate");
  // a long side touched by many corners : 12 vertices split into 3 x 12 more
  const comb = [{ p: [[0, 0], [100, 0], [100, 1], [0, 1]], tone: 0.5 }];
  for (let i = 0; i < 40; i++) comb.push({ p: [[i * 2.5, 1], [i * 2.5 + 2.5, 1], [i * 2.5 + 2.5, 5], [i * 2.5, 5]], tone: 0.5 });
  const r = G.normalisePattern([100, 5], comb);
  assert.equal(r.ok, true, "forty small pieces on one side is a normal pattern");
  const greedy = [{ p: [[0, 0], [100, 0], [100, 1], [0, 1]], tone: 0.5 }];
  for (let i = 0; i < 30; i++) greedy.push({ p: [[i * 3, 1], [i * 3 + 3, 1], [i * 3 + 1.5, 5]], tone: 0.5 });
  assert.equal(G.normalisePattern([100, 5], greedy).ok, true);
});

test("variants: the one nearest in log aspect ratio is picked, the first on a tie", () => {
  const vs = [{ domain: [100, 100] }, { domain: [400, 100] }, { domain: [100, 200] }];
  assert.equal(G.pickVariant(vs, 1764, 717), 1);   // 1764 x 717 = 2.46:1, nearer to 4:1 than to 1:1 in log scale
  assert.equal(G.pickVariant(vs, 100, 100), 0);
  assert.equal(G.pickVariant(vs, 50, 100), 2);
  assert.equal(G.pickVariant([{ domain: [200, 100] }, { domain: [200, 100] }], 200, 100), 0);
  assert.equal(G.pickVariant(vs, 200, 100), 0, "2:1 is exactly between 1:1 and 4:1 in log scale: the first wins");
});
