// The pattern checker (core 0.48.0, src/core/animate/pattern.ts) and the recipe words that name a pattern (animateContract 4, `patterns`, mosaic `pattern: "file"` + `source`).
// A pattern is numbers only: the checker is pure, whitelists its keys, never throws whatever it is given (a fuzz in the style of the sanitiser's), refuses what cannot be drawn
// safely and only warns about what can be drawn but is probably a mistake.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const PC = await import("@/core/animate/pattern");
const RC = await import("@/core/animate/recipe");
const S = await import("@/core/animate/spec");
const Kit = await import("@/core/animate/kit");
const ENGINE = (() => { const win = {}; new Function("window", Kit.animateScript())(win); return win.CuriosaAnimate; })();
// what the engine really draws for a graph: one unlit pane per piece when it trusts the graph (its own bounds check), the simple mosaic otherwise
const drawsPieces = (graph) => ENGINE.frame({ genre: "gauge", value: 100, target: 100 }, { animateContract: 4, genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "p", seed: 1 } } }, patterns: { p: [graph] } }, 1_800_000_000_000, { w: 400, h: 300 }, { quality: "light" }).ops.filter((o) => o.k === "poly" && o.L === 0).length === graph.cells.length;
const LT = JSON.parse(fs.readFileSync("tests/fixtures/animate/pattern-lt.json", "utf8"));
const codes = (r, sev) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
const mk = (cells, domain = [100, 100], extra = {}) => ({ patternContract: 1, domain, cells, ...extra });
const sq = (x0, y0, x1, y1, tone = 0.5) => ({ p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tone });

test("valid patterns: the L/T fixture, a triangle pair, one piece; the clean result is counter-clockwise, rounded, whitelisted, with its graph", () => {
  const r = PC.checkPattern(LT);
  assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.deepEqual(r.issues, []);
  assert.equal(r.pattern.cells.length, 5); assert.ok(r.graph && r.graph.cells.length === 5);
  const tri = PC.checkPattern(mk([{ p: [[0, 0], [100, 0], [0, 100]], tone: 0.2 }, { p: [[100, 0], [100, 100], [0, 100]], tone: 0.8 }]));
  assert.equal(tri.ok, true, JSON.stringify(tri.issues));
  assert.equal(PC.checkPattern(mk([sq(0, 0, 100, 100)])).ok, true);
  // clockwise input is normalised; coordinates are rounded to 2 decimals
  const cw = PC.checkPattern(mk([{ p: [[0, 0], [0, 100], [100.004, 100], [100, 0]], tone: 1 }]));
  assert.equal(cw.ok, true); assert.deepEqual(cw.pattern.cells[0].p.map((q) => q.join(",")), ["100,0", "100,100", "0,100", "0,0"]);
  // tiny overshoot (0.5 %) is clamped into the domain
  assert.equal(PC.checkPattern(mk([{ p: [[-0.4, 0], [100.4, 0], [100.4, 100], [-0.4, 100]], tone: 0 }])).pattern.cells[0].p.every((q) => q[0] >= 0 && q[0] <= 100), true);
});

test("whitelist: unknown keys are warnings and are dropped, `$comment` is allowed, nothing is spread", () => {
  const r = PC.checkPattern({ ...LT, evil: { url: "http://x.example/y" }, __proto__x: 1, cells: LT.cells.map((c, i) => (i === 0 ? { ...c, onload: "x()", $comment: "ok" } : c)) });
  assert.equal(r.ok, true);
  const w = r.issues.filter((i) => i.code === "pattern-ignored").map((i) => i.path);
  assert.ok(w.includes("evil") && w.includes("cells.0.onload") && !w.includes("$comment") && !w.includes("cells.0.$comment"), JSON.stringify(w));
  assert.equal(JSON.stringify(r.pattern).includes("evil") || JSON.stringify(r.pattern).includes("onload") || JSON.stringify(r.pattern).includes("http"), false);
  assert.deepEqual(Object.keys(r.pattern).sort(), ["cells", "domain", "patternContract"]);
  assert.deepEqual(Object.keys(r.pattern.cells[0]).sort(), ["p", "rank", "tone"]);
});

test("refusals: shape, contract, domain, numbers that are not numbers, a huge coordinate, outside the domain", () => {
  const bad = (raw, code, path) => { const r = PC.checkPattern(raw); assert.equal(r.ok, false, String(JSON.stringify(raw)).slice(0, 100)); assert.equal(r.pattern, null); assert.ok(r.issues.some((i) => i.code === code && (!path || i.path.startsWith(path))), `${code} ${path} in ${JSON.stringify(r.issues)}`); };
  for (const raw of [null, 5, "x", [], undefined]) bad(raw, "pattern-invalid", "shape");
  bad({ domain: [100, 100], cells: [] }, "pattern-invalid", "patternContract");
  bad(mk([sq(0, 0, 100, 100)], [10, 100]), "pattern-invalid", "domain");
  bad(mk([sq(0, 0, 100, 100)], [100, 30000]), "pattern-invalid", "domain");
  bad(mk([sq(0, 0, 100, 100)], [100, 1000]), "pattern-invalid", "domain.aspect");   // 0.1 : 1
  bad(mk([sq(0, 0, 100, 100)], [100, "100"]), "pattern-invalid", "domain");
  bad(mk([sq(0, 0, 100, 100)], [NaN, 100]), "pattern-invalid", "domain");
  bad(mk([]), "pattern-cells", "cells");
  bad(mk("nope"), "pattern-cells", "cells");
  bad(mk([{ p: [[0, 0], [NaN, 0], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");
  bad(mk([{ p: [[0, 0], [Infinity, 0], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");
  bad(mk([{ p: [[0, 0], [1e12, 0], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");
  bad(mk([{ p: [[0, 0], ["50", 0], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");
  bad(mk([{ p: [[0, 0], [101, 0], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");   // 1 % out : beyond the 0.5 % tolerance
  bad(mk([{ p: [[0, 0], [100], [100, 100]], tone: 0.5 }]), "pattern-invalid", "cells.0.p");
  bad(mk([{ p: [[0, 0], [100, 0], [100, 100]] }]), "pattern-invalid", "cells.0.tone");
  bad(mk([{ p: [[0, 0], [100, 0], [100, 100]], tone: 1.1 }]), "pattern-invalid", "cells.0.tone");
  bad(mk([{ p: [[0, 0], [100, 0], [100, 100]], tone: NaN }]), "pattern-invalid", "cells.0.tone");
  bad(mk([{ p: [[0, 0], [100, 0], [100, 100]], tone: 0.5, rank: Infinity }]), "pattern-invalid", "cells.0.rank");
  bad(mk([5]), "pattern-invalid", "cells.0");
});

test("refusals: pieces that cannot be drawn safely (vertex counts, repeats, tiny, spikes, crossing themselves)", () => {
  const bad = (cell, code, path) => { const r = PC.checkPattern(mk([cell])); assert.equal(r.ok, false); assert.ok(r.issues.some((i) => i.code === code && i.path.includes(path)), JSON.stringify(r.issues)); };
  bad({ p: [[0, 0], [100, 0]], tone: 0.5 }, "pattern-polygon", ".p");
  const ring = (n) => Array.from({ length: n }, (_, i) => [50 + 40 * Math.cos((i / n) * 2 * Math.PI), 50 + 40 * Math.sin((i / n) * 2 * Math.PI)]);
  assert.equal(PC.checkPattern(mk([{ p: ring(12), tone: 0.5 }])).ok, true, "12 vertices are fine");
  bad({ p: ring(13), tone: 0.5 }, "pattern-polygon", ".p");
  bad({ p: [[0, 0], [100, 0], [100, 0], [100, 100]], tone: 0.5 }, "pattern-polygon", ".p");   // a repeated vertex
  bad({ p: [[0, 0], [100, 0], [100, 100], [0, 0]], tone: 0.5 }, "pattern-polygon", ".p");   // last = first
  bad({ p: [[0, 0], [1, 0], [1, 1], [0, 1]], tone: 0.5 }, "pattern-polygon", ".area");   // 0.01 % of the domain
  bad({ p: [[0, 0], [100, 100], [100, 0], [0, 100]], tone: 0.5 }, "pattern-polygon", ".self");   // a bow tie
  bad({ p: [[0, 0], [100, 0], [50, 0], [50, 100], [0, 100]], tone: 0.5 }, "pattern-polygon", "");   // folds back on itself
  bad({ p: [[0, 0], [100, 0], [100, 40], [50, 40], [50, 60], [100, 60], [100, 100], [0, 100], [0, 50], [60, 50]], tone: 0.5 }, "pattern-polygon", ".self");
  bad({ p: [[0, 0], [100, 50], [100, 52]], tone: 0.5 }, "pattern-polygon", ".angle");   // a spike under 3 degrees
  const sharp = PC.checkPattern(mk([{ p: [[0, 0], [100, 0], [100, 15]], tone: 0.5 }]));
  assert.equal(sharp.ok, true); assert.ok(sharp.issues.some((i) => i.code === "pattern-angle" && i.severity === "warning"), "8.5 degrees: a warning");
  // a simple concave shape is fine
  assert.equal(PC.checkPattern(mk([{ p: [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]], tone: 0.2 }])).ok, true);
});

test("refusals: pieces on top of each other (identical, nested, crossing, inside a notch), but never pieces that only touch", () => {
  const ov = (cells) => { const r = PC.checkPattern(mk(cells)); return !r.ok && r.issues.some((i) => i.code === "pattern-overlap"); };
  assert.equal(ov([sq(0, 0, 50, 50), sq(0, 0, 50, 50)]), true, "identical");
  assert.equal(ov([sq(0, 0, 100, 100), sq(20, 20, 40, 40)]), true, "nested");
  assert.equal(ov([sq(0, 0, 60, 60), sq(40, 40, 100, 100)]), true, "crossing");
  assert.equal(ov([sq(0, 0, 100, 100), { p: [[0, 0], [100, 0], [100, 100]], tone: 0.5 }]), true, "a triangle in a square, vertices only on its boundary");
  assert.equal(ov([sq(0, 0, 50, 100), sq(50, 0, 100, 100)]), false, "touching sides");
  assert.equal(ov(LT.cells), false, "T-junctions");
  assert.equal(ov([sq(0, 0, 50, 50), sq(50, 50, 100, 100)]), false, "touching at a corner");
  assert.equal(ov([{ p: [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]], tone: 0 }, sq(40, 40, 90, 90)]), false, "a piece in the notch of an L");
});

test("limits: 160 pieces, 1500 vertices, the file size; a warning above what the engine draws; coverage under 97 %", () => {
  const grid = (n, d = n * 10) => { const c = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c.push(sq(i * 10, j * 10, i * 10 + 10, j * 10 + 10, ((i + j) % 10) / 10)); return mk(c, [d, d]); };
  const g121 = PC.checkPattern(grid(11));
  assert.equal(g121.ok, true); assert.ok(codes(g121, "warning").includes("pattern-cells-cap"), "121 pieces: above the 120 the engine draws");
  assert.equal(codes(PC.checkPattern(grid(10)), "warning").includes("pattern-cells-cap"), false);
  const over = PC.checkPattern(mk(Array.from({ length: 161 }, (_, i) => sq((i % 20) * 5, Math.floor(i / 20) * 5, (i % 20) * 5 + 5, Math.floor(i / 20) * 5 + 5)), [100, 100]));
  assert.equal(over.ok, false); assert.ok(codes(over).includes("pattern-cells"));
  assert.equal(PC.checkPattern(LT, { bytes: 40 * 1024 }).ok, false); assert.ok(codes(PC.checkPattern(LT, { bytes: 40 * 1024 })).includes("pattern-too-large"));
  assert.equal(PC.checkPattern(LT, { bytes: 1000 }).ok, true);
  const lone = PC.checkPattern(mk([sq(0, 0, 100, 50)]));
  assert.equal(lone.ok, true); assert.ok(codes(lone, "warning").includes("pattern-coverage"), "half of the frame");
  assert.equal(codes(PC.checkPattern(LT), "warning").includes("pattern-coverage"), false);
  // 12-sided pieces: 1500 vertices is the other ceiling
  const many = []; for (let i = 0; i < 125; i++) many.push({ p: Array.from({ length: 12 }, (_, k) => [10 + (i % 25) * 8 + 3 * Math.cos((k / 12) * 2 * Math.PI), 10 + Math.floor(i / 25) * 8 + 3 * Math.sin((k / 12) * 2 * Math.PI)]), tone: 0.5 });
  assert.equal(PC.checkPattern(mk(many, [220, 60])).ok, true, "1500 vertices exactly");
  many.push({ p: [[0, 0], [2, 0], [2, 2]], tone: 0.5 });
  const tooMany = PC.checkPattern(mk(many, [220, 60])); assert.equal(tooMany.ok, false); assert.ok(tooMany.issues.some((i) => i.code === "pattern-cells" && i.path === "vertices"));
});

test("contract: a pattern written for a newer contract is skipped with a warning (the rest of the skin installs); `rank` is all or none", () => {
  const r = PC.checkPattern({ ...LT, patternContract: 2, cells: "anything" });
  assert.equal(r.ok, true); assert.equal(r.pattern, null); assert.equal(r.newer, true); assert.deepEqual(codes(r), ["pattern-contract-newer"]);
  assert.deepEqual(PC.patternInfoOf(r), { newer: true });
  assert.deepEqual(PC.patternInfoOf(PC.checkPattern(LT)), { w: 120, h: 60, cells: 5 });
  assert.equal(PC.patternInfoOf(PC.checkPattern(null)), null);
  const some = PC.checkPattern({ ...LT, cells: LT.cells.map((c, i) => (i < 2 ? { ...c, rank: i } : c)) });
  assert.equal(some.ok, true); assert.ok(some.issues.some((i) => i.code === "pattern-ignored" && i.path === "cells.rank"));
  const all = PC.checkPattern({ ...LT, cells: LT.cells.map((c, i) => ({ ...c, rank: 4 - i })) });
  assert.equal(all.issues.length, 0); assert.deepEqual(all.graph.cells.map((c) => c.rank), [4, 3, 2, 1, 0]);
});

test("fuzz: whatever the input, the checker never throws, always answers in its own vocabulary, and a pattern it accepts is safe for the engine", () => {
  let a = 20260124;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const WEIRD = [NaN, Infinity, -Infinity, 1e308, -1e308, 0, -0, 1e-300, "7", null, undefined, true, [], {}, [1], [1, 2, 3], () => 1, 2 ** 53, -1, 0.5];
  const num = () => (rnd() < 0.15 ? pick(WEIRD) : rnd() < 0.5 ? Math.round(rnd() * 100 * 100) / 100 : rnd() * 120 - 10);
  const cell = () => rnd() < 0.1 ? pick(WEIRD) : ({ p: rnd() < 0.05 ? pick(WEIRD) : Array.from({ length: Math.floor(rnd() * 15) }, () => (rnd() < 0.05 ? pick(WEIRD) : [num(), num()])), tone: rnd() < 0.2 ? pick(WEIRD) : rnd(), ...(rnd() < 0.3 ? { rank: num() } : {}), ...(rnd() < 0.1 ? { evil: "<script>" } : {}) });
  const VOCAB = new Set(["pattern-invalid", "pattern-too-large", "pattern-cells", "pattern-cells-cap", "pattern-polygon", "pattern-angle", "pattern-overlap", "pattern-coverage", "pattern-contract-newer", "pattern-ignored", "pattern-loop"]);
  // half of the inputs start from a valid tiling and are mutated a little, so that the accepted branch is exercised as much as the refused one
  const tiling = () => { const n = 1 + Math.floor(rnd() * 5), m = 1 + Math.floor(rnd() * 5), cells = []; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) cells.push({ p: [[i * (100 / n), j * (100 / m)], [(i + 1) * (100 / n), j * (100 / m)], [(i + 1) * (100 / n), (j + 1) * (100 / m)], [i * (100 / n), (j + 1) * (100 / m)]].map((q) => q.map((x) => Math.round(x * 100) / 100)), tone: rnd(), ...(rnd() < 0.3 ? { rank: i * m + j } : {}) }); if (rnd() < 0.4) { const c = pick(cells); const k = Math.floor(rnd() * 4); c.p[k] = [num(), num()]; } if (rnd() < 0.2) cells.push(cell()); return { patternContract: 1, domain: [100, 100], cells }; };
  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const raw = rnd() < 0.5 ? tiling() : rnd() < 0.08 ? pick(WEIRD) : { patternContract: rnd() < 0.9 ? 1 : pick(WEIRD), domain: rnd() < 0.9 ? [100, 100] : [num(), num()], cells: rnd() < 0.05 ? pick(WEIRD) : Array.from({ length: Math.floor(rnd() * 6) }, cell) };
    let r;
    assert.doesNotThrow(() => { r = PC.checkPattern(raw, rnd() < 0.1 ? { bytes: Math.floor(rnd() * 64 * 1024) } : {}); }, JSON.stringify(raw, (k, v) => (typeof v === "number" && !isFinite(v) ? String(v) : v)));
    for (const x of r.issues) { assert.ok(VOCAB.has(x.code), x.code); assert.ok(x.path.length <= 80); }
    assert.ok(r.issues.length <= 40);
    assert.equal(r.ok, !r.issues.some((x) => x.severity === "error"));
    if (r.ok && r.pattern) {
      accepted++;
      assert.ok(r.graph);
      if (accepted <= 150) assert.ok(drawsPieces(r.graph), "a pattern the checker accepts is a pattern the engine draws");
      for (const c of r.pattern.cells) { assert.ok(c.p.length >= 3 && c.p.length <= 12); for (const q of c.p) { assert.ok(q[0] >= 0 && q[0] <= r.pattern.domain[0] && q[1] >= 0 && q[1] <= r.pattern.domain[1]); assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1])); } assert.ok(c.tone >= 0 && c.tone <= 1); }
    } else assert.equal(r.graph, null);
  }
  assert.ok(accepted > 10, `some random inputs are valid (${accepted}), so the property is not vacuous`);
});

// ── the recipe words ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const info = new Map([["patterns/wide.json", { w: 240, h: 100, cells: 30 }], ["patterns/tall.json", { w: 100, h: 160, cells: 20 }], ["patterns/square.json", { w: 100, h: 100, cells: 20 }], ["patterns/future.json", { newer: true }]]);
const recipe = (body = {}, patterns = { arch: [{ file: "patterns/wide.json" }] }, extra = {}) => ({ animateContract: 4, patterns, genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "arch", ...body } } }, ...extra });

test("recipe words (contract 4): `patterns` names files, a mosaic uses one with `pattern: \"file\"` and `source`; the cleaned recipe keeps only checked entries", () => {
  assert.equal(S.ANIMATE_CONTRACT, 4);
  const r = RC.checkAnimation(recipe(), info);
  assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.deepEqual(r.issues, []);
  assert.deepEqual(r.recipe.patterns, { arch: [{ file: "patterns/wide.json" }] });
  assert.equal(r.recipe.genres.gauge.body.source, "arch");
  // a name can hold a variant or a list of variants; variants close in shape do not warn
  const vs = RC.checkAnimation(recipe({}, { arch: [{ file: "patterns/wide.json" }, { file: "patterns/square.json" }] }), info);
  assert.equal(vs.ok, true); assert.ok(vs.issues.some((i) => i.code === "pattern-stretch" && i.severity === "warning"), "2.4 against 1: stretched by more than 1.4 in between");
  const close = RC.checkAnimation(recipe({}, { arch: [{ file: "patterns/square.json" }, { file: "patterns/tall.json" }] }), info);
  assert.equal(close.issues.filter((i) => i.code === "pattern-stretch").length, 0, "1 against 0.625: sqrt(1.6) = 1.26");
  assert.equal(RC.checkAnimation(recipe({}, { arch: { file: "patterns/square.json" } }), info).ok, true, "a single variant needs no list");
});

test("recipe words: errors with their path (a file that is not there, a source that is not a name of the table, a bad table), warnings for what is skipped", () => {
  const bad = (rc, code, path) => { const r = RC.checkAnimation(rc, info); assert.equal(r.ok, false, JSON.stringify(rc)); assert.ok(r.issues.some((i) => i.code === code && i.path.startsWith(path)), `${code} ${path}: ${JSON.stringify(r.issues)}`); };
  bad(recipe({}, { arch: [{ file: "patterns/none.json" }] }), "pattern-missing", "patterns/none.json");
  bad(recipe({ source: "nope" }), "pattern-source", "genres.gauge.body.source");
  bad(recipe({ source: undefined }), "pattern-source", "genres.gauge.body.source");
  bad(recipe({ source: "constructor" }), "pattern-source", "genres.gauge.body.source");
  bad(recipe({}, { arch: [{ file: "images/x.json" }] }), "patterns", "patterns.arch.0.file");
  bad(recipe({}, { arch: [{ file: "patterns/../x.json" }] }), "patterns", "patterns.arch.0.file");
  bad(recipe({}, { arch: [{ file: "patterns/Wide.json" }] }), "patterns", "patterns.arch.0.file");
  bad(recipe({}, { Arch: [{ file: "patterns/wide.json" }] }), "patterns", "patterns.Arch");
  bad(recipe({}, { arch: [] }), "patterns", "patterns.arch");
  bad(recipe({}, { arch: Array(5).fill({ file: "patterns/wide.json" }) }), "patterns", "patterns.arch");
  bad(recipe({}, []), "patterns", "patterns");
  bad(recipe({}, { arch: "patterns/wide.json" }), "patterns", "patterns.arch");
  bad(recipe({ source: "bad name" }), "param", "genres.gauge.body.source");
  const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`n${i}`, { file: "patterns/wide.json" }]));
  bad(recipe({}, many), "patterns", "patterns");
  // a file written for a newer pattern contract: that variant is skipped; with no variant left, the name stays a valid source and the mosaic draws the simple pattern
  const newer = RC.checkAnimation(recipe({}, { arch: [{ file: "patterns/future.json" }, { file: "patterns/wide.json" }] }), info);
  assert.equal(newer.ok, true); assert.ok(newer.issues.some((i) => i.code === "pattern-newer")); assert.deepEqual(newer.recipe.patterns.arch, [{ file: "patterns/wide.json" }]);
  const gone = RC.checkAnimation(recipe({}, { arch: { file: "patterns/future.json" } }), info);
  assert.equal(gone.ok, true); assert.deepEqual(gone.issues.map((i) => i.code), ["pattern-newer"]); assert.equal(gone.recipe.patterns, undefined);
  // unknown keys of a variant are warnings
  const extra = RC.checkAnimation(recipe({}, { arch: [{ file: "patterns/wide.json", url: "http://x.example" }] }), info);
  assert.equal(extra.ok, true); assert.ok(extra.issues.some((i) => i.code === "patterns" && i.severity === "warning")); assert.equal(JSON.stringify(extra.recipe).includes("example"), false);
});

test("older contracts: `file` and `source` are not words of contract 2 (an error in contract 1 and 2 where they are written, `patterns` a warning); a contract-5 recipe reads them tolerantly", () => {
  const body = { genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "arch" } } } };
  const two = RC.checkAnimation({ animateContract: 2, patterns: { arch: [{ file: "patterns/wide.json" }] }, ...body }, info);
  assert.equal(two.ok, false); assert.ok(two.issues.some((i) => i.code === "param" && i.path.endsWith(".pattern") && i.severity === "error"));
  assert.ok(two.issues.some((i) => i.code === "shape" && i.path === "patterns" && i.severity === "warning"));
  assert.equal(RC.checkAnimation({ animateContract: 1, ...body }, info).ok, false);
  // the engine of an older core would have read `animateContract: 4` as "written for a later contract": the skin falls back to voronoi unless animateMinContract says otherwise
  const five = RC.checkAnimation(recipe({}, undefined, { animateContract: 5, animateMinContract: 4 }), info);
  assert.equal(five.ok, true); assert.equal(five.recipe.animateContract, 4);
  const newerCore = RC.checkAnimation({ ...recipe(), animateContract: 5, animateMinContract: 5 }, info);
  assert.equal(newerCore.recipe, null); assert.equal(newerCore.newer, true);
});

test("the skin issues: every checker finding becomes a catalogue message in both languages, severities kept", async () => {
  const PI = await import("@/core/skins/patternIssues");
  const overlapping = mk([sq(0, 0, 60, 100), sq(40, 0, 100, 100)]);
  const c = PC.checkPattern(overlapping, { bytes: 2048 });
  const list = PI.patternFileIssues("patterns/a.json", c, 2048, S.PATTERN.fileBytes);
  assert.ok(list.some((i) => i.code === "pattern-overlap" && i.severity === "error"));
  for (const i of list) assert.ok(i.message.en && i.message.fr && i.hint.en && i.hint.fr);
  const big = PI.patternFileIssues("patterns/a.json", PC.checkPattern(LT, { bytes: 40000 }), 40000, S.PATTERN.fileBytes);
  assert.deepEqual(big.map((i) => i.code), ["pattern-too-large"]);
  assert.match(big[0].message.en, /40 KB; at most 32 KB/);
  const r = RC.checkAnimation({ animateContract: 4, patterns: { Bad: [{ file: "patterns/a.json" }] }, genres: {} }, new Map());
  const mapped = r.issues.map(PI.recipePatternIssue).filter(Boolean);
  assert.ok(mapped.some((i) => i.code === "patterns-shape"));
  assert.equal(PI.recipePatternIssue({ code: "param", path: "x", severity: "error" }), null);
  assert.equal(PI.patternUnreadable("patterns/a.json").code, "pattern-unreadable");
});

test("a piece whose side is cut by dozens of neighbours is refused (the engine would draw the simple mosaic): the checker and the engine share the bound", () => {
  const n = 70, row = Array.from({ length: n }, (_, i) => sq(Math.round((i * 200 * 100) / n) / 100, 50, i === n - 1 ? 200 : Math.round(((i + 1) * 200 * 100) / n) / 100, 100));
  const raw = mk([sq(0, 0, 200, 50), ...row], [200, 100]);
  const r = PC.checkPattern(raw);
  assert.equal(r.ok, false); assert.deepEqual(r.issues.map((i) => i.code), ["pattern-loop"]);
  // 40 neighbours stay within the bound, and the engine does draw them
  const m = 40, few = Array.from({ length: m }, (_, i) => sq(Math.round((i * 200 * 100) / m) / 100, 50, i === m - 1 ? 200 : Math.round(((i + 1) * 200 * 100) / m) / 100, 100));
  const ok = PC.checkPattern(mk([sq(0, 0, 200, 50), ...few], [200, 100]));
  assert.equal(ok.ok, true, JSON.stringify(ok.issues)); assert.ok(drawsPieces(ok.graph));
  // the same graph, forced past the bound, is what the engine refuses: the two limits are the same number
  const big = PC.checkPattern(raw, {}); assert.equal(big.graph, null);
});

test("errors are never hidden by warnings: 60 unknown keys do not push an overlap error out, in the file and in the recipe", () => {
  const junk = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`junk${i}`, i]));
  const bad = { ...mk([sq(0, 0, 60, 100), sq(40, 0, 100, 100)]), ...junk };
  const r = PC.checkPattern(bad);
  assert.equal(r.ok, false); assert.equal(r.issues[0].code, "pattern-overlap"); assert.equal(r.issues[0].severity, "error");
  assert.ok(r.issues.length <= 40);
  const rec = RC.checkAnimation({ animateContract: 3, ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`x${i}`, 1])), genres: { gauge: { body: { draw: "bar" } } } });
  assert.equal(rec.ok, false); assert.equal(rec.issues[0].severity, "error");
});

test("animateContract 3 is the scene contract, never a recipe's: refused, so a scene-style number cannot switch an animation on", () => {
  const body = { genres: { gauge: { body: { draw: "bar" } } } };
  assert.equal(RC.checkAnimation({ animateContract: 3, ...body }).ok, false);
  assert.deepEqual(RC.checkAnimation({ animateContract: 3, ...body }).issues.map((i) => i.code), ["contract"]);
  assert.equal(RC.checkAnimation({ animateContract: 4, animateMinContract: 3, ...body }).ok, false);
  assert.equal(RC.checkAnimation({ animateContract: 2, ...body }).ok, true);
  assert.equal(RC.checkAnimation({ animateContract: 4, ...body }).ok, true);
});

test("a name whose variants are all written for a newer pattern contract stays a valid source: the mosaic draws the simple pattern", () => {
  const r = RC.checkAnimation({ animateContract: 4, patterns: { arch: [{ file: "patterns/a.json" }] }, genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "arch" } } } }, new Map([["patterns/a.json", { newer: true }]]));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues.map((i) => i.code), ["pattern-newer"]);
  assert.equal(r.recipe.patterns, undefined, "no variant is left to hand over");
});
