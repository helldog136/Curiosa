// Animation engine (core 0.30.0, docs/OVERLAY-ANIMATIONS.md): the principle's view and the draw list are pure functions of (state, recipe, instant, size),
// bursts merge, celebrations queue, every phase ends, nothing is replayed after a reload, the basic rendering stands in for missing roles and for unknown
// contracts, texts stay readable and are never transformed, the calm and minimal modes drop what they must; the recipe checker, the skin folder
// (contract 4), the hand-off by the overlay page and a real Chromium render.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTempDir } from "../helpers/tmp.mjs";

const K = await import("@/core/animate/kit");
const S = await import("@/core/animate/spec");
const RC = await import("@/core/animate/recipe");
const ST = await import("@/core/animate/state");
const V = await import("@/core/skins/validate");
const M = await import("@/core/skins/manifest");
const R = await import("@/core/overlays/render");
const SS = await import("@/core/overlays/skinSheet");
const OK = await import("@/core/overlays/moduleKit");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { getCoreVersion } = await import("@/core/modules/compat");

/** A fresh engine, run from its page text exactly as OBS runs it. */
const engine = () => { const win = {}; new Function("window", K.animateScript())(win); return win.CuriosaAnimate; };
const A = engine();
const mosaic = JSON.parse(fs.readFileSync("tests/fixtures/animate/mosaic-sample.json", "utf8"));
const neon = JSON.parse(fs.readFileSync("tests/fixtures/animate/night-neon.json", "utf8"));
const RECIPES = { basic: null, mosaic, neon };
const T0 = 1_800_000_000_000;
const SIZE = { w: 1764, h: 717 };
const steps = (n, from, gap = 150) => Array.from({ length: n }, (_, i) => ({ id: `s${from}-${i}`, at: from + i * gap, kind: "step", amount: 1 }));
const STATES = {
  gauge: { genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [...steps(5, T0), { id: "m", at: T0 + 2000, kind: "milestone" }] },
  subathon: { genre: "gauge", format: "time", value: 0, target: 14400, label: "Subathon", timer: { endsAt: T0 + 7200e3, total: 14400e3 }, highlights: [{ id: "x", at: T0, kind: "extend", amount: 300 }] },
  levels: { genre: "levels", value: 620, target: 1000, level: 3, label: "Hype", timer: { endsAt: T0 + 180e3, total: 300e3 }, highlights: [{ id: "l", at: T0, kind: "milestone" }] },
  counter: { genre: "counter", format: "money", currency: "€", value: 1234.5, label: "Session", highlights: steps(3, T0) },
};
const textOps = (f) => f.ops.filter((o) => o.k === "text");

// ── purity, determinism ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("frame by frame: the same state at the same instant gives the same draw list, in any order, from two separate engines", () => {
  const B = engine();
  for (const [rn, rc] of Object.entries(RECIPES)) for (const [sn, st] of Object.entries(STATES)) {
    const instants = [-5000, 0, 120, 450, 900, 1500, 2100, 3300, 6000].map((d) => T0 + d);
    const forward = instants.map((t) => JSON.stringify(A.frame(st, rc, t, SIZE, { quality: "full" })));
    const backward = instants.slice().reverse().map((t) => JSON.stringify(B.frame(st, rc, t, SIZE, { quality: "full" }))).reverse();
    assert.deepEqual(forward, backward, `${rn}/${sn}`);
    assert.equal(new Set(forward).size > 1, true, `${rn}/${sn}: the picture moves over time`);
  }
});

test("seeded procedural drawing: the same seed gives the same stained mosaic, another seed another one; geometry is cut inside the frame", () => {
  const st = { genre: "gauge", value: 50, target: 100 };
  const withSeed = (seed) => ({ ...mosaic, genres: { gauge: { ...mosaic.genres.gauge, body: { ...mosaic.genres.gauge.body, seed } } } });
  const a = A.frame(st, withSeed(1), T0, SIZE, {}), b = A.frame(st, withSeed(1), T0, SIZE, {}), c = A.frame(st, withSeed(2), T0, SIZE, {});
  assert.deepEqual(a.ops, b.ops);
  assert.notDeepEqual(a.ops.filter((o) => o.L === 0), c.ops.filter((o) => o.L === 0));
  const panes = a.ops.filter((o) => o.k === "poly" && o.L === 0);
  assert.ok(panes.length >= 20, `a tessellated window (${panes.length} panes)`);
  for (const o of a.ops) if (o.k === "poly" && o.L !== 3) for (let i = 0; i < o.p.length; i += 2) { assert.ok(o.p[i] >= -60 && o.p[i] <= SIZE.w + 60, "x in frame"); assert.ok(o.p[i + 1] >= -60 && o.p[i + 1] <= SIZE.h + 60, "y in frame"); }
  // lead edges are welded and drawn once: as many lead strokes as unique edges, not twice per pane
  const lead = a.ops.filter((o) => o.L === 2 && o.k === "poly" && o.f === mosaic.colors.lead);
  assert.ok(lead.length > panes.length && lead.length < panes.length * 4, `${lead.length} lead strokes for ${panes.length} panes`);
});

test("progress lights panes one by one: the lit layer key changes only when one more pane is lit (cache), and grows monotonically", () => {
  let last = -1, keys = new Set();
  for (let v = 0; v <= 100; v += 2.5) {
    const f = A.frame({ genre: "gauge", value: v, target: 100 }, mosaic, T0, SIZE, {});
    const lit = f.ops.filter((o) => o.L === 1 && o.k === "poly" && o.pr !== undefined && o.a === 1).length;
    assert.ok(lit >= last, `value ${v}`); last = lit; keys.add(f.keys[1]);
    assert.equal(f.keys[0], A.frame({ genre: "gauge", value: 0, target: 100 }, mosaic, T0, SIZE, {}).keys[0], "the unlit window never changes");
  }
  assert.ok(keys.size > 10 && keys.size <= 41);
});

// ── the principle's view ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("bursts: five follows in two seconds make ONE highlight (+5), never five celebrations; celebrations wait in line, three at most", () => {
  const v = A.view({ genre: "gauge", value: 10, target: 100, highlights: steps(5, T0, 300) }, T0 + 1300);
  assert.equal(v.highlights.length, 1); assert.equal(v.highlights[0].count, 5); assert.equal(v.highlights[0].amount, 5);
  const many = { genre: "gauge", value: 10, target: 100, highlights: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, at: T0 + i * 1600, kind: "milestone" })) };
  for (let t = T0; t < T0 + 60000; t += 100) assert.ok(A.view(many, t).highlights.filter((h) => h.celebrate).length <= 1, "one celebration at a time");
  const starts = []; for (let t = T0; t < T0 + 60000; t += 100) for (const h of A.view(many, t).highlights) if (!starts.includes(h.start)) starts.push(h.start);
  assert.ok(starts.length < 12 && starts.length >= 8, `the line is capped: ${starts.length} of 12 celebrations shown`);
  for (let i = 0; i < starts.length; i++) assert.ok(starts[i] - T0 - 0 <= (i + 1) * 1600 + S.TIMING.queue * S.TIMING.celebration, "none waits longer than the queue");
});

test("every phase ends by itself; a reload long after the events shows the current state with nothing replayed", () => {
  for (const [rn, rc] of Object.entries(RECIPES)) for (const [sn, st] of Object.entries(STATES)) {
    const late = A.frame({ ...st, timer: undefined, format: st.format === "time" ? "count" : st.format }, rc, T0 + 60_000, SIZE, { calm: true });
    assert.equal(late.view.highlights.length, 0, `${rn}/${sn}`); assert.equal(late.view.phase === "rest" || late.view.phase === "overflow", true, `${rn}/${sn}: ${late.view.phase}`);
    assert.equal(late.animating, false, `${rn}/${sn}: at rest nothing moves (no frame drawn)`);
  }
});

test("values: increments glide in, a recalibration glides without a highlight and may go down (never celebrated), overflow is kept", () => {
  const st = { genre: "gauge", value: 64, target: 100, highlights: [{ id: "a", at: T0, kind: "step", amount: 4 }] };
  const ds = [0, 200, 500, 900, 1200].map((d) => A.view(st, T0 + d).display);
  assert.equal(ds[0], 60); assert.equal(ds.at(-1), 64); for (let i = 1; i < ds.length; i++) assert.ok(ds[i] >= ds[i - 1]);
  const down = { genre: "gauge", value: 70, target: 100, rebase: { from: 80, at: T0 } };
  assert.equal(A.view(down, T0 + 300).phase, "draining"); assert.equal(A.view(down, T0 + 300).highlights.length, 0); assert.equal(A.view(down, T0 + 5000).display, 70);
  const over = A.view({ genre: "gauge", value: 130, target: 100 }, T0);
  assert.equal(over.progress, 1); assert.equal(over.phase, "overflow"); assert.ok(Math.abs(over.overflow - 0.3) < 1e-9);
});

test("subathon: a countdown gauge whose time left grows by the amounts added, with the amount written; it ends at zero", () => {
  const st = STATES.subathon;
  const before = A.view(st, T0), after = A.view(st, T0 + 2000);
  assert.ok(Math.abs(before.display - (7200 - 300)) < 0.01, "the added time arrives gradually");
  assert.ok(Math.abs(after.display - (7200 - 2)) < 0.01, "then the clock runs");
  const f = A.frame(st, mosaic, T0 + 400, SIZE, {});
  assert.ok(textOps(f).some((o) => o.t === "+5:00"), "the +time highlight is written");
  assert.ok(textOps(f).some((o) => /^\d:\d\d:\d\d$/.test(o.t)), "the time left as h:mm:ss");
  assert.equal(A.view({ ...st, highlights: [] }, T0 + 7300e3).phase, "ended");
  const paused = { ...st, highlights: [], timer: { ...st.timer, pausedAt: T0 } };
  assert.equal(A.view(paused, T0 + 50e3).display, A.view(paused, T0).display, "a paused countdown holds");
});

// ── fallback and contracts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("fallback: a role the skin does not draw uses the basic rendering; an unknown recipe contract draws exactly the basic rendering", () => {
  const partial = { animateContract: 1, genres: { gauge: { body: mosaic.genres.gauge.body } } };
  const f = A.frame(STATES.gauge, partial, T0 + 300, SIZE, { tokens: { fg: "#ffffff", accent: "#e8a23b" } });
  assert.equal(f.skin, true);
  assert.ok(f.ops.some((o) => o.k === "poly" && o.L === 0 && o.p.length > 8), "the skin's window");
  assert.ok(textOps(f).some((o) => o.t === "62 / 100" || /\/ 100$/.test(o.t)), "the basic value text");
  for (const future of [{ ...mosaic, animateContract: 3 }, { genres: mosaic.genres }, "nonsense", 42]) {
    const a = A.frame(STATES.gauge, future, T0, SIZE, {}), b = A.frame(STATES.gauge, null, T0, SIZE, {});
    assert.equal(a.skin, false); assert.deepEqual(a.ops, b.ops);
  }
  // levels drawn by a skin that only describes gauges: the basic cells
  const lv = A.frame(STATES.levels, partial, T0, SIZE, {});
  assert.ok(lv.ops.length > 5 && textOps(lv).some((o) => o.t === "3"));
  // a primitive used for a role it cannot serve is ignored (basic instead), parameters out of bounds are clamped
  const odd = { animateContract: 1, genres: { gauge: { body: { draw: "flash" }, value: { draw: "text", size: 99, weight: 5 } } } };
  const o = A.frame(STATES.gauge, odd, T0, SIZE, {});
  const val = textOps(o).find((x) => /\/ 100$/.test(x.t));
  assert.equal(val.wt, 400); assert.ok(val.sz <= SIZE.h * 0.17 * 1.6 + 1);
});

test("readability: every text has a contrasting outline (4.5:1) or an opaque plate, whatever the recipe asks; texts are never scaled or rotated", () => {
  const hostile = { animateContract: 1, genres: { gauge: { value: { draw: "text", color: "#777777", outline: "#888888", outlineWidth: 0 } }, counter: { value: { draw: "text", color: "#ffff00", outline: "#ffffff" } } } };
  for (const rc of [...Object.values(RECIPES), hostile]) for (const st of Object.values(STATES)) for (const d of [0, 400, 2500]) {
    const f = A.frame(st, rc, T0 + d, SIZE, {});
    for (const t of textOps(f)) {
      assert.ok(A.contrast(t.f, t.o) >= 4.5 && t.ow >= t.sz * 0.04 - 1e-9 || f.ops.some((p) => p.k === "poly" && p.L === 3 && p.a >= 0.8 * t.a && typeof p.f === "string" && A.contrast(t.f, p.f) >= 4.5), `${t.t}: ${t.f} on ${t.o}`);
      for (const k of Object.keys(t)) assert.ok(["k", "L", "t", "x", "y", "sz", "wt", "ff", "al", "f", "o", "ow", "a", "mw", "gl", "gc"].includes(k), `no transform on a text (${k})`);
      assert.ok(t.sz >= 18 * 0.75 - 1e-9, "never under the minimum size");
    }
  }
  // the TV minimum: a tiny frame still gets 24 px x factor text
  const small = A.frame(STATES.gauge, mosaic, T0, { w: 400, h: 120 }, { minText: 36 });
  assert.ok(textOps(small).every((t) => t.sz >= 36 * 0.62 - 1e-9));
});

test("burst label: the \"+N\" of a step or an extension never leaves the frame, at any aspect ratio, in any genre, skin and instant", () => {
  const sizes = [[700, 360], [1764, 717], [3440, 200], [1200, 150], [400, 300], [300, 700], [640, 360], [900, 120]];
  const states = { ...STATES, goal: { genre: "gauge", value: 63, target: 100, label: "Goal", highlights: steps(1, T0) }, counter: { ...STATES.counter, highlights: steps(1, T0).map((h) => ({ ...h, amount: 5 })) } };
  let checked = 0;
  for (const [rn, rc] of Object.entries(RECIPES)) for (const [sn, st] of Object.entries(states)) for (const [w, h] of sizes) for (const d of [0, 100, 200, 300, 450, 600, 800, 1000]) for (const calm of [false, true]) {
    const f = A.frame(st, rc, T0 + d, { w, h }, { calm });
    for (const t of textOps(f).filter((o) => /^[+-]/.test(o.t))) {
      const what = `${rn}/${sn} ${w}x${h} t=${d}${calm ? " calm" : ""} "${t.t}" y=${t.y} sz=${t.sz}`;
      assert.ok(t.y - t.sz / 2 >= -0.01 && t.y + t.sz / 2 <= h + 0.01, `${what}: inside the frame vertically`);
      const tw = Math.min(t.mw, t.t.length * t.sz * 0.6), x0 = t.al === "left" ? t.x : t.al === "right" ? t.x - tw : t.x - tw / 2;
      assert.ok(x0 >= -0.01 && x0 + tw <= w + 0.01, `${what}: inside the frame horizontally`);
      checked++;
    }
  }
  assert.ok(checked > 200, `the burst label was found and checked (${checked})`);
});

test("calm motion (reduced motion) and quality levels: no ring, no flying piece, no flicker in calm; minimal has no blur, bloom or grain", () => {
  const busy = STATES.gauge;
  for (const rc of Object.values(RECIPES)) {
    for (let d = 0; d < 3000; d += 150) {
      const f = A.frame(busy, rc, T0 + d, SIZE, { calm: true });
      assert.equal(f.ops.filter((o) => o.k === "poly" && o.open && o.b === "lighter").length, 0, "no sparks");
      assert.ok(f.layerAlpha.every((a) => a === 1), "no flicker");
      for (const o of f.ops) if (o.k === "circ" && o.b === "lighter" && o.f && o.f.s) assert.ok(o.f.s[0][1].match(/[\d.]+\)$/) && parseFloat(o.f.s[0][1].match(/([\d.]+)\)$/)[1]) <= 0.6, "soft flashes");
    }
    const m = A.frame(busy, rc, T0 + 300, SIZE, { quality: "minimal" });
    assert.ok(m.ops.every((o) => !o.g && o.k !== "bloom" && o.k !== "grain"), "minimal: no blur, bloom, grain");
  }
  const full = A.frame(busy, mosaic, T0 + 300, SIZE, { quality: "full" });
  assert.ok(full.ops.some((o) => o.k === "bloom") && full.ops.some((o) => o.k === "grain") && full.ops.some((o) => o.g > 0));
  const light = A.frame(busy, mosaic, T0 + 300, SIZE, { quality: "light" });
  assert.ok(light.ops.every((o) => !o.g && o.k !== "bloom" && o.k !== "grain"), "light: glows drawn with gradients, no canvas blur");
  // a flicker never blinks faster than 3 Hz: count the dips over 10 s at 60 samples a second
  let dips = 0, was = false; for (let i = 0; i < 600; i++) { const a = A.frame({ genre: "gauge", value: 50, target: 100 }, neon, T0 + i * 16.67, SIZE, {}).layerAlpha[1] < 0.98; if (a && !was) dips++; was = a; }
  assert.ok(dips / 10 <= S.TIMING.maxFlashHz, `${dips} dips in 10 s`);
});

// ── the recipe checker and the skin folder ────────────────────────────────────────────────────────────────────────────────────────────────
test("recipe checker: the two reference recipes pass; out of grammar is refused with its path; a newer contract switches the animation off cleanly", () => {
  for (const rc of [mosaic, neon]) { const r = RC.checkAnimation(rc); assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.ok(r.recipe.genres.gauge); }
  const bad = (patch, code, where) => { const r = RC.checkAnimation({ animateContract: 1, genres: { gauge: patch } }); assert.equal(r.ok, false); assert.ok(r.issues.some((i) => i.code === code && i.path.includes(where)), `${code} ${where}: ${JSON.stringify(r.issues)}`); };
  bad({ body: { draw: "text" } }, "draw", "gauge.body.draw");
  bad({ wings: { draw: "bar" } }, "role", "gauge.wings");
  bad({ body: { draw: "mosaic", cells: 500 } }, "param", "cells");
  bad({ body: { draw: "mosaic", script: "alert(1)" } }, "param", "script");
  bad({ body: { draw: "mosaic", palette: ["red"] } }, "color", "palette");
  bad({ body: { draw: "bar", fill: "@nowhere" } }, "color", "fill");
  bad({ value: { draw: "text", color: "#777777", outline: "#888888" } }, "text-contrast", "gauge.value");
  bad({ burst: [{ draw: "flash" }, { draw: "ring" }, { draw: "pulse" }, { draw: "rays" }] }, "shape", "gauge.burst");
  assert.equal(RC.checkAnimation({ animateContract: 1, genres: { gauge: { value: { draw: "text", color: "#ffffff", outline: "#eeeeee", plate: "soft", plateColor: "#000000", plateAlpha: 0.9 } } } }).ok, true, "a weak outline is fine over an opaque plate that contrasts");
  const newer = RC.checkAnimation({ animateContract: 3, genres: { gauge: { body: { draw: "hologram" } } } });
  assert.equal(newer.ok, true); assert.equal(newer.recipe, null); assert.equal(newer.issues[0].code, "contract-newer");
  assert.equal(RC.checkAnimation({ animateContract: 1, genres: { sparkline: {} } }).issues[0].severity, "warning", "a genre of a later contract is ignored");
  assert.equal(RC.checkAnimation({ animateContract: 2, genres: { gauge: { body: { draw: "hologram" } } } }).ok, true, "contract 2 is read tolerantly (tests/core/animate-motion.test.mjs)");
  assert.equal(RC.checkAnimation([]).ok, false);
});

test("state checker: a module's state is checked with the same words as the engine", () => {
  for (const st of Object.values(STATES)) assert.deepEqual(ST.checkAnimateState(st), { ok: true, problems: [] });
  const r = ST.checkAnimateState({ genre: "pie", value: "3", format: "time", highlights: [{ at: "now", kind: "boom" }] });
  assert.equal(r.ok, false);
  for (const p of ["genre", "value", "timer", "highlights.0.id", "highlights.0.at", "highlights.0.kind"]) assert.ok(r.problems.some((x) => x.path === p), p);
});

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
const GOOD = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-accent": "#e8a23b" };
function skinFolder(id, { manifest = {}, animation = mosaic, kind = "overlay" } = {}) {
  const dir = makeTempDir(`anim-${id}-`);
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ skinContract: 4, kind, id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: "0.8.0", license: "MIT", tokens: "tokens.json", animation: "animation.json", previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }], ...(kind === "site" ? { modes: ["dark"] } : {}), ...manifest }));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: GOOD }));
  if (animation !== null) fs.writeFileSync(path.join(dir, "animation.json"), typeof animation === "string" ? animation : JSON.stringify(animation));
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  return dir;
}
const check = (dir) => V.validateSkinFolder(dir, { coreVersion: getCoreVersion() });

test("skin folder, contract 4: an overlay skin ships animation.json; refusals are precise; a newer recipe contract installs the skin without its animation", () => {
  const ok = check(skinFolder("glassy"));
  assert.equal(ok.ok, true, JSON.stringify(ok.issues.map((i) => i.code)));
  assert.equal(ok.animation.animateContract, 1); assert.ok(ok.files.some((f) => f.path === "animation.json" && f.kind === "animation"), "installed and fingerprinted");
  const codes = (r) => r.issues.map((i) => i.code);
  assert.ok(codes(check(skinFolder("old", { manifest: { skinContract: 3 } }))).includes("overlay-contract-v4"));
  assert.ok(codes(check(skinFolder("gone", { animation: null }))).includes("animation-missing"));
  assert.ok(codes(check(skinFolder("junk", { animation: "{nope" }))).includes("animation-unreadable"));
  assert.ok(codes(check(skinFolder("evil", { animation: { animateContract: 1, genres: { gauge: { body: { draw: "mosaic", onload: "x" } } } } }))).includes("animation-invalid"));
  assert.ok(codes(check(skinFolder("grey", { animation: { animateContract: 1, genres: { gauge: { value: { draw: "text", color: "#777777", outline: "#888888" } } } } }))).includes("animation-text-contrast"));
  const future = check(skinFolder("future", { animation: { animateContract: 9, genres: {} } }));
  assert.equal(future.ok, true); assert.equal(future.animation, null); assert.ok(codes(future).includes("animation-contract-newer"));
  assert.ok(codes(check(skinFolder("site", { kind: "site", manifest: { skinContract: 5 } }))).includes("manifest-contract-newer"), "a site skin above contract 4 is refused");
  assert.equal(M.parseSkinManifest({ skinContract: 5, kind: "overlay" }).ok, false);
});

// ── the overlay page hands the recipe over ────────────────────────────────────────────────────────────────────────────────────────────────
const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
const look0 = { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } };
function page({ anim = mosaic, contextual = false, src = "/el/0" } = {}) {
  const pg = { id: "p", name: "P", width: 1280, height: 720, active: true, style: { text: "light", background: "transparent", corners: "round" }, look: { ...look0, skin: "glassy" }, elements: [], rev: 1, testUntil: null };
  const elements = [{ el: { uid: "u0abcdefgh", instance: "i", element: "e", x: 0, y: 0, w: 640, h: 260, visible: true, options: {} }, title: "E0", status: "ok", layout, follows: true, src }];
  const skin = { ...SS.compileSkin({ id: "glassy", version: "1.0.0", tokens: GOOD, css: "" }), key: "glassy@1", ...(anim ? { anim } : {}) };
  return R.renderPage({ page: pg, elements, t: makeTranslator("en"), lang: "en", test: false, now: 0, nonce: "n", stateUrl: "", skin, contextual });
}
test("hand-off: a skin with a recipe makes the page hand it to its elements (and with a skin change); a skin without one leaves the page as before", () => {
  const html = page();
  assert.match(html, /window\.__ovAnim=function/); assert.match(html, /"anim":\{"animateContract":1/);
  assert.match(html, /if\(window\.__ovAnim\)window\.__ovAnim\(f,S\);f\.style\.opacity="1"\}/);
  assert.match(html, /anim:s\.skin\.anim\|\|null/);
  const plain = page({ anim: null });
  assert.doesNotMatch(plain, /__ovAnim|"anim"/);
  assert.match(page({ anim: null, contextual: true }), /__ovAnim/, "a context may bring an animated skin: the hand-off is ready");
  assert.equal(R.animPollScript(R.pollScript(false)).split("__ovAnim(f,S)").length - 1, 1);
  assert.equal(R.animPollScript(R.pollScript(true)).split("anim:s.skin.anim").length - 1, 1);
});

test("ctx.overlay: the animation kit sits next to the composition kit; the options a module copies are the two the engine reads", async () => {
  for (const k of ["animateScript", "animateOptions", "animateKitPage", "checkAnimateState", "checkAnimation"]) assert.equal(typeof OK.overlayKit[k], "function", k);
  assert.equal(OK.overlayKit.animateContract, S.ANIMATE_CONTRACT); assert.deepEqual([...OK.overlayKit.animateGenres], ["gauge", "levels", "counter"]);
  const opts = K.animateOptions();
  // the options a module copies must pass the element declaration schema of the core (option ids: letters, digits and _)
  const D = await import("@/core/overlays/decl");
  const decl = D.overlayElementSchema.safeParse({ id: "goal", label: { en: "Goal", fr: "Objectif" }, fit: "fluid", options: opts });
  assert.equal(decl.success, true, JSON.stringify(decl.error?.issues));
  assert.deepEqual(opts.map((o) => o.id), ["animQuality", "animCalm"]);
  for (const o of opts) { assert.ok(o.label.en && o.label.fr && o.help.en && o.help.fr); assert.ok(o.help.fr.length <= 60 && o.help.en.length <= 60); }
  const q = A.optionsFromQuery("?opt-animQuality=light&opt-animCalm=1&ov-lang=fr&ov-tv=1.5");
  assert.deepEqual(q, { quality: "light", calm: true, lang: "fr", minText: 36 });
  assert.equal(A.optionsFromQuery("opt-animQuality=auto").quality, "auto");
  assert.ok(K.animateScript().includes(JSON.stringify(S.ANIMATE_SPEC.timing)), "the table travels with the engine");
  assert.doesNotMatch(K.animateScript(), /require\(|import\(|XMLHttpRequest|localStorage|document\.cookie/, "the engine reads nothing and sends nothing");
  // (0.40.0) the ONE read: a scene's own pictures, from the skin's address, without credentials (see "Scenes" in docs/OVERLAY-ANIMATIONS.md)
  assert.equal((K.animateScript().match(/fetch\(/g) || []).length, 1, "one fetch call");
  assert.match(K.animateScript(), /win\.fetch\(url, \{ credentials: "omit" \}\)/);
});

// ── real Chromium ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

test("real browser: each genre draws in each skin with a transparent background; the page hands its skin's recipe to a live element", { skip: skipBrowser, timeout: 120000 }, async () => {
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  const errors = [];
  try {
    const p = await (await browser.newContext({ viewport: { width: 900, height: 360 } })).newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    for (const [rn, rc] of Object.entries(RECIPES)) for (const [sn, st] of Object.entries(STATES)) {
      await p.setContent(K.animateKitPage({ state: st, recipe: rc, width: 900, height: 360, at: T0 + 400, background: "transparent" }));
      await p.waitForSelector("html[data-ready='1']");
      const px = await p.evaluate(() => { const c = document.getElementById("cv").getContext("2d"), d = c.getImageData(0, 0, 900, 360).data; let drawn = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) drawn++; return { drawn: drawn / (900 * 360), corner: d[3] }; });
      assert.ok(px.drawn > 0.04, `${rn}/${sn} draws (${px.drawn})`);
      assert.ok(px.corner < 40, `${rn}/${sn}: the top-left corner stays transparent (${px.corner})`);
    }
    // the hand-off in a real overlay page: the element runs the engine, the page gives it the skin's recipe
    const ELEMENT = `<!doctype html><meta charset="utf-8"><div id="st" style="position:absolute;inset:0"></div><script>${K.animateScript()}</script><script>window.__h=CuriosaAnimate.mount(document.getElementById("st"),{state:${JSON.stringify(STATES.gauge)}})</script>`;
    const html = page();
    const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(req.url.startsWith("/el/") ? ELEMENT : html); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      await p.setViewportSize({ width: 1280, height: 720 });
      await p.goto(`http://127.0.0.1:${server.address().port}/page`);
      await p.waitForFunction(() => { const f = document.querySelector("iframe"); return f && f.contentWindow && f.contentWindow.__curiosaAnimSkin; }, null, { timeout: 10000 });
      const got = await p.evaluate(() => { const w = document.querySelector("iframe").contentWindow; return { contract: w.__curiosaAnimSkin.animateContract, bodyDraw: w.__curiosaAnimSkin.genres.gauge.body.draw }; });
      assert.deepEqual(got, { contract: 1, bodyDraw: "mosaic" });
      await p.waitForFunction(() => { const w = document.querySelector("iframe").contentWindow; const f = w.__h && w.__h.frameNow(); return f && f.skin === true; }, null, { timeout: 10000 });
    } finally { server.close(); }
  } finally { await browser.close(); }
  assert.deepEqual(errors, []);
});

test("docs: OVERLAY-ANIMATIONS.md documents every genre, role, primitive, parameter and effect of the contract (a new word cannot ship undocumented)", () => {
  const doc = fs.readFileSync("docs/OVERLAY-ANIMATIONS.md", "utf8");
  for (const [g, roles] of Object.entries(S.GENRES)) { assert.ok(doc.includes("`" + g + "`"), g); for (const r of roles) assert.ok(doc.includes("`" + r + "`"), r); }
  for (const [name, p] of Object.entries(S.PRIMITIVES)) { if (name === "none") continue; assert.ok(doc.includes("#### `" + name + "`"), name); for (const k of Object.keys(p.params)) assert.ok(doc.includes("| `" + k + "` |"), `${name}.${k}`); }
  for (const [name, p] of Object.entries(S.EFFECTS)) { assert.ok(doc.includes("- `" + name + "`:"), name); for (const k of Object.keys(p)) assert.ok(doc.includes("`" + k + "`"), `${name}.${k}`); }
  assert.match(fs.readFileSync("docs/OVERLAY-SKINS.md", "utf8"), /OVERLAY-ANIMATIONS\.md/);
  assert.match(fs.readFileSync("docs/OVERLAY-ELEMENTS.md", "utf8"), /OVERLAY-ANIMATIONS\.md/);
});
