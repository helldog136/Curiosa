// Motion tokens and the tolerant reader (core 0.33.0, docs/OVERLAY-ANIMATIONS.md "Motion" and "Contract 2"): named springs (analytic step responses), named durations and
// tempos, the `motion` key and the per-layer `spring` / `duration`; a recipe without `motion` keeps EXACTLY the curves of 0.32.0 (golden digests of 810 frames);
// displayed numbers never overshoot; calm mode is critically damped; unknown words of a contract-2 recipe are skipped with warnings; the CSS twins.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";

const K = await import("@/core/animate/kit");
const S = await import("@/core/animate/spec");
const RC = await import("@/core/animate/recipe");
const V = await import("@/core/skins/validate");
const SS = await import("@/core/overlays/skinSheet");
const TK = await import("@/core/overlays/tokens");
const OK = await import("@/core/overlays/moduleKit");
const { getCoreVersion } = await import("@/core/modules/compat");

const engine = () => { const win = {}; new Function("window", K.animateScript())(win); return win.CuriosaAnimate; };
const A = engine();
const glass = JSON.parse(fs.readFileSync("tests/fixtures/animate/stained-glass.json", "utf8"));
const neon = JSON.parse(fs.readFileSync("tests/fixtures/animate/night-neon.json", "utf8"));
const T0 = 1_800_000_000_000;
const SIZE = { w: 1764, h: 717 };
const steps = (n, from, gap = 150) => Array.from({ length: n }, (_, i) => ({ id: `s${from}-${i}`, at: from + i * gap, kind: "step", amount: 1 }));
const STATES = {
  gauge: { genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [...steps(5, T0), { id: "m", at: T0 + 2000, kind: "milestone" }] },
  subathon: { genre: "gauge", format: "time", value: 0, target: 14400, label: "Subathon", timer: { endsAt: T0 + 7200e3, total: 14400e3 }, highlights: [{ id: "x", at: T0, kind: "extend", amount: 300 }] },
  levels: { genre: "levels", value: 620, target: 1000, level: 3, label: "Hype", timer: { endsAt: T0 + 180e3, total: 300e3 }, highlights: [{ id: "l", at: T0, kind: "milestone" }] },
  counter: { genre: "counter", format: "money", currency: "€", value: 1234.5, label: "Session", highlights: steps(3, T0) },
  rebase: { genre: "gauge", value: 40, target: 100, rebase: { from: 70, at: T0 + 200 }, highlights: [{ id: "d", at: T0, kind: "drop", amount: -3 }] },
};
const withMotion = (rc, motion, c = 2) => ({ ...rc, animateContract: c, motion });

// ── A. a recipe without `motion` keeps exactly today's curves ───────────────────────────────────────────────────────────────────────────────────
test("regression: without `motion`, 810 frames (3 recipes x 5 states x 9 instants x 3 qualities x calm) are identical to the 0.32.0 engine's", () => {
  const golden = JSON.parse(fs.readFileSync("tests/fixtures/animate/golden-0.32.0.json", "utf8"));
  let n = 0;
  for (const [rn, rc] of Object.entries({ basic: null, glass, neon })) for (const [sn, st] of Object.entries(STATES)) for (const d of [-5000, 0, 120, 450, 900, 1500, 2100, 3300, 6000]) for (const quality of ["full", "light", "minimal"]) for (const calm of [false, true]) {
    const f = A.frame(st, rc, T0 + d, SIZE, { quality, calm });
    const digest = crypto.createHash("sha256").update(JSON.stringify({ ops: f.ops, keys: f.keys, inc1: f.inc1, layerAlpha: f.layerAlpha, animating: f.animating, view: f.view })).digest("hex").slice(0, 24);
    const key = `${rn}/${sn}/${d}/${quality}/${calm ? "calm" : "live"}`;
    assert.equal(digest, golden[key], key); n++;
  }
  assert.equal(n, Object.keys(golden).length);
});

test("regression: a contract-2 recipe that only names `tempo: steady` and no spring on a layer still differs from nothing only by what it says", () => {
  // the same recipe, with a `motion` that restates today's tempo (steady) but springs by default, DOES change the glide: it is opt-in, not a rewrite
  const a = A.frame(STATES.gauge, glass, T0 + 300, SIZE, {}), b = A.frame(STATES.gauge, withMotion(glass, { tempo: "steady" }), T0 + 300, SIZE, {});
  assert.notDeepEqual(a.view.display, b.view.display);
  // a contract-2 recipe with an EMPTY motion object takes the documented defaults, so it moves too; a contract-1 recipe never reads `motion`
  const one = A.frame(STATES.gauge, { ...glass, motion: { value: "bouncy" } }, T0 + 300, SIZE, {});
  assert.equal(JSON.stringify(one.ops), JSON.stringify(a.ops), "contract 1 ignores `motion`");
});

// ── B. the tokens ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("tokens: the closed table (4 springs, 3 durations, 3 tempos) with the values of the study; tempos bounded 0.6 to 1.6", () => {
  assert.deepEqual(Object.keys(S.MOTION.springs), ["snappy", "smooth", "gentle", "bouncy"]);
  assert.deepEqual(S.MOTION.durations, { fast: 150, standard: 300, considered: 600 });
  assert.deepEqual(S.MOTION.tempos, { brisk: 0.8, steady: 1, stately: 1.35 });
  for (const v of Object.values(S.MOTION.tempos)) assert.ok(v >= S.MOTION.tempoRange[0] && v <= S.MOTION.tempoRange[1]);
  assert.equal(S.ANIMATE_CONTRACT, 2); assert.equal(OK.overlayKit.animateContract, 2);
  assert.equal(OK.overlayKit.animateMotion, S.MOTION);
  assert.ok(K.animateScript().includes(JSON.stringify(S.MOTION)), "the table travels with the engine");
});

test("springs: analytic step responses (0 at 0, 1 at rest), overshoot and settling as documented; each solves its own differential equation", () => {
  const M = A.motion;
  const peak = (n) => { let m = 0; for (let t = 0; t < 3; t += 0.0005) m = Math.max(m, M.spring(n, t)); return m; };
  assert.ok(Math.abs(peak("snappy") - 1.046) < 0.003, `snappy ${peak("snappy")}`);
  assert.ok(Math.abs(peak("bouncy") - 1.205) < 0.003, `bouncy ${peak("bouncy")}`);
  assert.ok(peak("smooth") <= 1 + 1e-12 && peak("gentle") <= 1 + 1e-12, "no overshoot");
  const within2 = (n) => { let t2 = 0; for (let t = 0; t < 4; t += 0.001) if (Math.abs(1 - M.spring(n, t)) > 0.02) t2 = t; return t2; };
  assert.ok(within2("snappy") < 0.26 && within2("smooth") < 0.5 && within2("gentle") < 0.95 && within2("bouncy") < 0.56);
  for (const n of M.names.springs) {
    assert.equal(M.spring(n, 0), 0); assert.equal(M.spring(n, -1), 0); assert.ok(Math.abs(M.spring(n, 20) - 1) < 1e-9);
    const { f, z } = S.MOTION.springs[n], w = 2 * Math.PI * f, h = 1e-4;
    for (const t of [0.05, 0.2, 0.5]) {
      // x'' + 2 z w x' + w^2 x = w^2 (a unit step): the response is the spring, not a look-alike curve
      const x0 = M.spring(n, t - h), x1 = M.spring(n, t), x2 = M.spring(n, t + h), acc = (x2 - 2 * x1 + x0) / (h * h), vel = (x2 - x0) / (2 * h);
      assert.ok(Math.abs(acc + 2 * z * w * vel + w * w * x1 - w * w) < 0.05 * w * w, `${n} at ${t}`);
    }
  }
  // superposition: two glides of the same spring add up (velocity stays continuous when a second one arrives mid-glide)
  const mid = 0.12, a = (t) => M.spring("snappy", t), sum = (t) => 3 * a(t) + 5 * a(t - mid), h = 1e-5;
  assert.ok(Math.abs((sum(mid + h) - sum(mid - h)) / (2 * h) - (3 * (a(mid + h) - a(mid - h))) / (2 * h) - (5 * (a(h) - 0)) / h * 0) < 60, "no jump of the slope but the one the new amount brings");
});

test("a displayed number never overshoots, whatever the spring: it moves monotonically from the old to the new value; the decorative head of a bar may (5 % at most)", () => {
  for (const sp of ["snappy", "smooth", "gentle", "bouncy"]) {
    const rc = { animateContract: 2, motion: { value: sp, body: sp }, genres: { gauge: {} } };
    const st = { genre: "gauge", value: 60, target: 100, highlights: [{ id: "a", at: T0, kind: "step", amount: 10 }] };
    let prev = 50, maxHead = 0, headOver = 0;
    for (let d = -200; d < 3000; d += 10) {
      const f = A.frame(st, rc, T0 + d, SIZE, {}), v = f.view;
      assert.ok(v.display >= 50 - 1e-9 && v.display <= 60 + 1e-9, `${sp}: ${v.display} stays between the old (50) and the new (60) value`);
      assert.ok(v.display >= prev - 1e-9, `${sp}: monotone at ${d}`); prev = v.display;
      assert.ok(v.progress <= 0.6 + 1e-9, `${sp}: progress never above the target`);
      const fill = f.ops.find((o) => o.k === "poly" && o.L === 3 && o.f === "#e8a23b");
      if (fill) { const xs = fill.p.filter((_, i) => i % 2 === 0); const w = Math.max(...xs) - Math.min(...xs); maxHead = Math.max(maxHead, w); }
    }
    headOver = maxHead;
    const f0 = A.frame(st, rc, T0 + 5000, SIZE, {}), fillRest = f0.ops.find((o) => o.k === "poly" && o.L === 3 && o.f === "#e8a23b"), xr = fillRest.p.filter((_, i) => i % 2 === 0), restW = Math.max(...xr) - Math.min(...xr);
    const bodyW = f0.ops.find((o) => o.k === "poly" && o.L === 0).p.filter((_, i) => i % 2 === 0).reduce((m, x) => Math.max(m, x), 0) - f0.ops.find((o) => o.k === "poly" && o.L === 0).p.filter((_, i) => i % 2 === 0).reduce((m, x) => Math.min(m, x), 1e9);
    assert.ok(headOver <= restW + 0.05 * bodyW + 1, `${sp}: the head passes its rest by at most 5 % of the body (${headOver} vs ${restW} + ${0.05 * bodyW})`);
    if (sp === "bouncy" || sp === "snappy") assert.ok(headOver > restW + 0.5, `${sp}: the head does overshoot a little`); else assert.ok(headOver <= restW + 0.5, `${sp}: critically damped, no overshoot`);
  }
});

test("a glide ends by itself and the loop stops: nothing moves 3 s after the last highlight; mid-glide the frame says it is still animating", () => {
  const rc = { animateContract: 2, motion: { value: "gentle", body: "bouncy" }, genres: { gauge: {} } };
  const st = { genre: "gauge", value: 60, target: 100, highlights: [{ id: "a", at: T0, kind: "step", amount: 10 }] };
  assert.equal(A.frame(st, rc, T0 + 400, SIZE, {}).animating, true);
  assert.equal(A.frame(st, rc, T0 + 3000, SIZE, {}).animating, false);
  assert.equal(A.frame(st, rc, T0 + 3000, SIZE, {}).view.phase, "rest");
  // a reload mid-glide shows the exact current frame (pure in time)
  assert.deepEqual(JSON.stringify(A.frame(st, rc, T0 + 400, SIZE, {})), JSON.stringify(engine().frame(st, rc, T0 + 400, SIZE, {})));
});

test("tempo: brisk shortens and stately lengthens the moments the engine owns (step 900, celebration 2600, glide 900), steady keeps today's", () => {
  const step = { genre: "gauge", value: 50, target: 100, highlights: [{ id: "s", at: T0, kind: "step", amount: 1 }] }, cel = { genre: "gauge", value: 50, target: 100, highlights: [{ id: "m", at: T0, kind: "milestone" }] };
  const phase = (st, tempo, d) => A.frame(st, withMotion({ genres: { gauge: {} } }, { tempo }), T0 + d, SIZE, {}).view.highlights.length;
  assert.equal(phase(step, "steady", 850), 1); assert.equal(phase(step, "brisk", 850), 0, "brisk: 720 ms"); assert.equal(phase(step, "stately", 1100), 1, "stately: 1215 ms");
  assert.equal(phase(cel, "steady", 2500), 1); assert.equal(phase(cel, "brisk", 2200), 0, "brisk: 2080 ms"); assert.equal(phase(cel, "stately", 3300), 1, "stately: 3510 ms");
  // the glide follows the tempo too: at the same instant a brisk glide is further along than a stately one
  const g = { genre: "gauge", value: 60, target: 100, highlights: [{ id: "a", at: T0, kind: "step", amount: 10 }] };
  const at = (tempo) => A.frame(g, withMotion({ genres: { gauge: {} } }, { value: "gentle", tempo }), T0 + 400, SIZE, {}).view.display;
  assert.ok(at("brisk") > at("steady") && at("steady") > at("stately"), `${at("brisk")} ${at("steady")} ${at("stately")}`);
});

test("calm mode: every spring is critically damped (never above 1), `fast` becomes `standard`, tempo is forced to steady, movements stay removed", () => {
  const M = A.motion;
  for (const n of M.names.springs) { let m = 0; for (let t = 0; t < 3; t += 0.002) m = Math.max(m, M.spring(n, t, true)); assert.ok(m <= 1 + 1e-12, `${n} calm peak ${m}`); }
  assert.equal(M.duration("fast", true), 300); assert.equal(M.duration("fast", false), 150); assert.equal(M.duration("considered", true), 600);
  const rc = { animateContract: 2, motion: { value: "bouncy", body: "bouncy", reaction: "bouncy", celebration: "bouncy", tempo: "stately" }, genres: { gauge: { step: [{ draw: "flash", duration: "fast" }, { draw: "ring", spring: "bouncy" }, { draw: "particles", spring: "bouncy" }], burst: [{ draw: "ring" }, { draw: "particles" }, { draw: "rays" }] } } };
  const st = STATES.gauge;
  for (let d = 0; d < 3500; d += 100) {
    const live = A.frame(st, rc, T0 + d, SIZE, {}), calm = A.frame(st, rc, T0 + d, SIZE, { calm: true });
    assert.ok(calm.view.display <= 63 + 1e-9, "calm display never above the target");
    assert.equal(calm.ops.filter((o) => o.k === "poly" && o.open && o.b === "lighter").length, 0, "no sparks in calm");
    // the stately tempo is not applied in calm: the step phase lasts 900 ms (+ the burst), like steady
    assert.ok(live.view.display >= 0);
  }
  // in calm a `stately` recipe ends its step reaction on time (steady), while live it lasts longer
  const one = { genre: "gauge", value: 50, target: 100, highlights: [{ id: "s", at: T0, kind: "step", amount: 1 }] };
  assert.equal(A.frame(one, rc, T0 + 1000, SIZE, { calm: true }).view.highlights.length, 0);
  assert.equal(A.frame(one, rc, T0 + 1000, SIZE, {}).view.highlights.length, 1);
});

test("per-layer words: a layer's `spring` or `duration` changes only that layer's travel; the ring of a bouncy layer grows past its size, a critical one does not", () => {
  const ring = (sp) => ({ animateContract: 2, genres: { gauge: { step: [{ draw: "ring", size: 2, spring: sp, irregularity: 0 }] } } });
  const st = { genre: "gauge", value: 50, target: 100, highlights: [{ id: "s", at: T0, kind: "step", amount: 1 }] };
  const radius = (rc, d) => { const f = A.frame(st, rc, T0 + d, SIZE, {}), r = f.ops.find((o) => o.k === "poly" && o.s && o.open !== true && o.p && o.p.length > 40); if (!r) return 0; const xs = r.p.filter((_, i) => i % 2 === 0); return (Math.max(...xs) - Math.min(...xs)) / 2; };
  let bouncy = 0, smooth = 0, plain = 0;
  for (let d = 20; d < 800; d += 10) { bouncy = Math.max(bouncy, radius(ring("bouncy"), d)); smooth = Math.max(smooth, radius(ring("smooth"), d)); plain = Math.max(plain, radius({ animateContract: 2, genres: { gauge: { step: [{ draw: "ring", size: 2, irregularity: 0 }] } } }, d)); }
  assert.ok(bouncy > smooth * 1.12, `bouncy ${bouncy} smooth ${smooth}`);
  assert.ok(plain > 0 && plain <= smooth + 1, "no spring named: today's out-cubic curve (never past its size)");
  // `duration` sets the attack of a light reaction: a fast flash is at full strength sooner than a considered one
  const flash = (dur, d) => { const f = A.frame(st, { animateContract: 2, genres: { gauge: { step: [{ draw: "flash", duration: dur, strength: 1 }] } } }, T0 + d, SIZE, {}); return f.ops.filter((o) => o.k === "circ" && o.b === "lighter").map((o) => parseFloat(o.f.s[0][1].match(/([\d.]+)\)$/)[1])).sort((a, b) => b - a)[0] ?? 0; };
  assert.ok(flash("fast", 140) > flash("considered", 140), `${flash("fast", 140)} vs ${flash("considered", 140)}`);
});

test("frames with motion are pure in time, in any order, from two engines; every recipe x state x instant draws without error", () => {
  const B = engine();
  const motions = [{ value: "snappy" }, "bouncy", { value: "gentle", body: "smooth", reaction: "snappy", celebration: "bouncy", fade: "considered", tempo: "stately" }, { tempo: "brisk" }];
  for (const rc of [glass, neon]) for (const m of motions) for (const [sn, st] of Object.entries(STATES)) {
    const rec = withMotion(rc, m), instants = [-5000, 0, 120, 450, 900, 1500, 2100, 3300, 6000].map((d) => T0 + d);
    const fwd = instants.map((t) => JSON.stringify(A.frame(st, rec, t, SIZE, {}))), bwd = instants.slice().reverse().map((t) => JSON.stringify(B.frame(st, rec, t, SIZE, { quality: "full" }))).reverse();
    assert.deepEqual(fwd, bwd, sn);
    for (const f of instants.map((t) => A.frame(st, rec, t, { w: 320, h: 90 }, { quality: "light", calm: true }))) assert.ok(f.ops.length > 0);
  }
});

// ── C. the checker and the tolerant reader ─────────────────────────────────────────────────────────────────────────────────────────────────
test("checker: `motion` is names only, from the closed table; unknown names and shapes are refused with their path and code; contract 1 never reads it", () => {
  const ok = (motion) => RC.checkAnimation({ animateContract: 2, motion, genres: { gauge: {} } });
  assert.equal(ok({ value: "gentle", body: "smooth", reaction: "snappy", celebration: "bouncy", fade: "standard", tempo: "stately" }).ok, true);
  assert.deepEqual(ok("snappy").recipe.motion, { value: "snappy", body: "snappy", reaction: "snappy" }, "the shorthand sets value, body and reaction");
  for (const [motion, where] of [[{ value: "wobbly" }, "motion.value"], [{ fade: "snappy" }, "motion.fade"], [{ tempo: "fast" }, "motion.tempo"], [{ value: 3 }, "motion.value"], ["wobbly", "motion"]]) {
    const r = ok(motion); assert.equal(r.ok, false, JSON.stringify(motion)); assert.ok(r.issues.some((i) => i.code === "motion-name" && i.path === where && i.severity === "error"), JSON.stringify(r.issues));
  }
  for (const bad of [42, [], null]) assert.ok(ok(bad).issues.some((i) => i.code === "motion-shape"), JSON.stringify(bad));
  assert.equal(RC.checkAnimation({ animateContract: 2, genres: { gauge: {} } }).recipe.motion, undefined, "a recipe without motion keeps none");
  const layer = (patch) => RC.checkAnimation({ animateContract: 2, genres: { gauge: { step: { draw: "ring", ...patch } } } });
  assert.equal(layer({ spring: "bouncy" }).ok, true);
  assert.ok(layer({ spring: "wobbly" }).issues.some((i) => i.code === "motion-name" && i.path.endsWith(".spring") && i.severity === "error"));
  assert.ok(RC.checkAnimation({ animateContract: 2, genres: { gauge: { step: { draw: "flash", duration: "long" } } } }).issues.some((i) => i.code === "motion-name" && i.path.endsWith(".duration")));
  // contract 1: no `motion`, no per-layer spring (the vocabulary did not exist: warning, error), exactly the old reading
  const old = RC.checkAnimation({ animateContract: 1, motion: "snappy", genres: { gauge: { step: { draw: "ring", spring: "bouncy" } } } });
  assert.equal(old.ok, false); assert.ok(old.issues.some((i) => i.code === "param" && i.path.endsWith(".spring")) && old.issues.some((i) => i.code === "shape" && i.path === "motion" && i.severity === "warning"));
  assert.equal(RC.checkAnimation({ animateContract: 1, motion: "snappy", genres: { gauge: {} } }).recipe.motion, undefined);
});

test("tolerant reader: in contract 2 an unknown role, primitive, parameter, effect, genre or `motion` key is a warning and is skipped; known values stay strict", () => {
  const r = RC.checkAnimation({
    animateContract: 2, motion: { value: "gentle", wobble: "high" }, effects: { glow: { strength: 0.4 }, hologram: { strength: 1 } },
    genres: { sparkline: {}, gauge: { backdrop: { draw: "mesh" }, body: { draw: "bar", glitter: 3, fill: "#e8a23b" }, step: [{ draw: "ripples" }, { draw: "flash" }] } },
  });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  const warn = (code, where) => assert.ok(r.issues.some((i) => i.code === code && i.path.includes(where) && i.severity === "warning"), `${code} ${where}: ${JSON.stringify(r.issues)}`);
  warn("genre", "sparkline"); warn("role", "backdrop"); warn("param", "glitter"); warn("draw", "step.0.draw"); warn("param", "effects.hologram"); warn("motion-key", "motion.wobble");
  assert.equal(r.issues.some((i) => i.severity === "error"), false);
  // known words stay strict: a bound is a bound, a typo of a colour is a typo
  assert.equal(RC.checkAnimation({ animateContract: 2, genres: { gauge: { body: { draw: "mosaic", cells: 500 } } } }).ok, false);
  assert.equal(RC.checkAnimation({ animateContract: 2, genres: { gauge: { body: { draw: "bar", fill: "red" } } } }).ok, false);
  assert.equal(RC.checkAnimation({ animateContract: 2, genres: { gauge: { value: { draw: "text", color: "#777777", outline: "#888888" } } } }).issues.some((i) => i.code === "text-contrast"), true, "readability is never tolerated away");
  // contract 1 stays strict
  assert.equal(RC.checkAnimation({ animateContract: 1, genres: { gauge: { backdrop: { draw: "mesh" } } } }).ok, false);
  // and the engine draws such a recipe, skipping what it does not know (the skipped body layer falls back to the basic bar)
  const f = A.frame(STATES.gauge, r.recipe, T0 + 400, SIZE, {});
  assert.equal(f.skin, true); assert.ok(f.ops.length > 5);
});

test("contract negotiation: written for a later contract but readable by this one -> read tolerantly with a warning; a minimum above ours -> the animation is off, the skin installs", () => {
  const body = { genres: { gauge: { body: { draw: "bar" }, backdrop: { draw: "mesh" } } } };
  const ahead = RC.checkAnimation({ animateContract: 3, animateMinContract: 2, ...body });
  assert.equal(ahead.ok, true); assert.ok(ahead.recipe); assert.equal(ahead.recipe.animateContract, 2, "read as the contract this core understands");
  assert.ok(ahead.issues.some((i) => i.code === "contract-ahead" && i.severity === "warning")); assert.ok(ahead.issues.some((i) => i.code === "role" && i.severity === "warning"));
  assert.equal(RC.checkAnimation({ animateContract: 3, genres: {} }).recipe, null, "no minimum: the minimum is the written contract");
  assert.equal(RC.checkAnimation({ animateContract: 3, genres: {} }).newer, true);
  assert.equal(RC.checkAnimation({ animateContract: 5, animateMinContract: 3, genres: {} }).recipe, null);
  // a later contract tolerates even a value out of today's bounds (a later core may widen them); the engine clamps
  const wide = RC.checkAnimation({ animateContract: 3, animateMinContract: 2, genres: { gauge: { body: { draw: "mosaic", cells: 500 } } } });
  assert.equal(wide.ok, true); assert.ok(wide.issues.some((i) => i.code === "param" && i.severity === "warning"));
  assert.equal(A.frame(STATES.gauge, wide.recipe, T0, SIZE, {}).skin, true);
  for (const bad of [{ animateMinContract: 0 }, { animateMinContract: 3 }, { animateMinContract: "2" }]) assert.equal(RC.checkAnimation({ animateContract: 2, genres: {}, ...bad }).ok, false, JSON.stringify(bad));
  assert.equal(RC.checkAnimation({ animateContract: 1, animateMinContract: 1, genres: {} }).issues.some((i) => i.path === "animateMinContract"), true, "contract 1 does not know the key (warning)");
  // the engine itself accepts contracts 1 and 2 and refuses (basic rendering) what is neither
  assert.equal(A.usable({ animateContract: 1, genres: {} }), true); assert.equal(A.usable({ animateContract: 2, genres: {} }), true); assert.equal(A.usable({ animateContract: 3, genres: {} }), false);
});

// ── D. skin folders ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
const GOOD = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-accent": "#e8a23b" };
function skinFolder(id, animation, css) {
  const dir = makeTempDir(`motion-${id}-`);
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ skinContract: 4, kind: "overlay", id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: "0.30.0", license: "MIT", tokens: "tokens.json", animation: "animation.json", ...(css ? { stylesheet: "skin.css" } : {}), previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }] }));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: GOOD }));
  fs.writeFileSync(path.join(dir, "animation.json"), JSON.stringify(animation));
  if (css) fs.writeFileSync(path.join(dir, "skin.css"), css);
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  return dir;
}
const check = (dir) => V.validateSkinFolder(dir, { coreVersion: getCoreVersion() });
const codes = (r) => r.issues.map((i) => i.code);

test("skin folder: a skin with motion installs and keeps its motion; a typo is refused with its path; a skin written for a later core installs with warnings, or without animation", () => {
  const good = check(skinFolder("moving", withMotion(glass, { value: "gentle", celebration: "bouncy", tempo: "steady" })));
  assert.equal(good.ok, true, JSON.stringify(good.issues)); assert.equal(good.animation.animateContract, 2); assert.equal(good.animation.motion.celebration, "bouncy");
  const typo = check(skinFolder("typo", withMotion(glass, { value: "wobbly" })));
  assert.equal(typo.ok, false); const i = typo.issues.find((x) => x.code === "animation-motion-name"); assert.ok(i && JSON.stringify(i).includes("motion.value"), JSON.stringify(typo.issues));
  assert.ok(codes(check(skinFolder("shape", withMotion(glass, 42)))).includes("animation-motion-shape"));
  const ahead = check(skinFolder("ahead", { animateContract: 3, animateMinContract: 2, genres: { gauge: { backdrop: { draw: "mesh" }, body: glass.genres.gauge.body } } }));
  assert.equal(ahead.ok, true, JSON.stringify(ahead.issues)); assert.ok(ahead.animation); assert.ok(codes(ahead).includes("animation-contract-ahead") && codes(ahead).includes("animation-ignored"));
  const later = check(skinFolder("later", { animateContract: 4, genres: {} }));
  assert.equal(later.ok, true); assert.equal(later.animation, null); assert.ok(codes(later).includes("animation-contract-newer"));
  const tolerant2 = check(skinFolder("tol2", { animateContract: 2, genres: { gauge: { wings: { draw: "bar" } } } }));
  assert.equal(tolerant2.ok, true); assert.ok(codes(tolerant2).includes("animation-ignored"));
  assert.equal(check(skinFolder("strict1", { animateContract: 1, genres: { gauge: { wings: { draw: "bar" } } } })).ok, false);
});

test("messages: the new validation codes have EN and FR texts and a hint, with the same {arguments}", async () => {
  const M = await import("@/core/skins/messages");
  for (const k of ["animation-motion-name", "animation-motion-shape", "animation-contract-ahead"]) {
    assert.ok(M.ISSUE_CODES.includes(k), k);
    const e = M.catalogEntry(k); assert.ok(e, k);
    const flat = JSON.stringify(e);
    assert.ok(flat.includes('"fr"') && flat.includes('"en"'), `${k}: EN and FR`);
  }
  const e = M.catalogEntry("animation-motion-name");
  const args = (t) => (JSON.stringify(t).match(/\{\w+\}/g) ?? []).sort();
  assert.ok(JSON.stringify(e).includes("{detail}"), "names the place");
  assert.equal(M.fillTemplate("x {detail}", { detail: "motion.value" }, "en"), "x motion.value"); assert.ok(args(e).length >= 2);
});

// ── E. the CSS twins ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("CSS twins: --ov-dur-* and --ov-ease-* carry the same names and values in a skin that reads them, and for a module's own element", () => {
  assert.deepEqual(Object.keys(S.MOTION_CSS_VARS), ["--ov-dur-fast", "--ov-dur-standard", "--ov-dur-considered", "--ov-ease-snappy", "--ov-ease-smooth", "--ov-ease-gentle", "--ov-ease-bouncy"]);
  assert.equal(S.MOTION_CSS_VARS["--ov-dur-fast"], "150ms"); assert.equal(S.MOTION_CSS_VARS["--ov-dur-standard"], "300ms"); assert.equal(S.MOTION_CSS_VARS["--ov-dur-considered"], "600ms");
  for (const [k, v] of Object.entries(S.MOTION_CSS_VARS)) if (k.includes("ease")) assert.match(v, /^cubic-bezier\(-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+\)$/);
  assert.match(S.MOTION_CSS_VARS["--ov-ease-bouncy"], /2\.09/); // overshoots: a control point above 1
  assert.equal(TK.tokensCss({ text: "light", background: "soft", corners: "round" }).includes("--ov-dur-"), false, "pages without a skin that reads them stay byte-identical");
  assert.equal(OK.overlayKit.animateMotionCss(), S.motionCss()); assert.equal(OK.overlayKit.animateMotionCss(".el"), S.motionCss(".el"));
  const plain = SS.compileSkin({ id: "plain", version: "1.0.0", tokens: GOOD, css: "" }).css, reads = SS.compileSkin({ id: "reads", version: "1.0.0", tokens: GOOD, css: 'html[data-ov-skin="reads"] [data-ov-part="panel"]{animation-duration:var(--ov-dur-standard);animation-timing-function:var(--ov-ease-gentle)}' }).css;
  assert.equal(plain.includes("--ov-dur-"), false, "a skin that does not read them gets a sheet without them");
  assert.ok(reads.includes("--ov-dur-standard:300ms") && reads.includes("--ov-ease-gentle:cubic-bezier"));
});

test("an overlay skin may READ the motion words (animation-duration, animation-timing-function) but never define them or invent others", () => {
  const css = (id, decl) => `[data-ov-part="panel"]{animation-name:ov-fade;${decl}}`;
  const ok = check(skinFolder("css-ok", glass, css("css-ok", "animation-duration:var(--ov-dur-considered);animation-timing-function:var(--ov-ease-gentle)")));
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  for (const decl of ["animation-duration:var(--ov-dur-slow)", "animation-timing-function:var(--ov-fg)", "animation-timing-function:var(--ov-dur-fast)", "--ov-dur-fast:5s"]) assert.equal(check(skinFolder("css-bad", glass, css("css-bad", decl))).ok, false, decl);
});

test("docs: every spring, duration, tempo, motion role and new code of the contract is documented", () => {
  const doc = fs.readFileSync("docs/OVERLAY-ANIMATIONS.md", "utf8");
  for (const n of [...Object.keys(S.MOTION.springs), ...Object.keys(S.MOTION.durations), ...Object.keys(S.MOTION.tempos), ...Object.keys(S.MOTION.roles)]) assert.ok(doc.includes("`" + n + "`"), n);
  for (const n of Object.keys(S.MOTION_CSS_VARS)) assert.ok(doc.includes(n.replace(/-(fast|standard|considered|snappy|smooth|gentle|bouncy)$/, "-") ) || doc.includes(n), n);
  for (const c of ["animateMinContract", "animation-motion-name", "animation-motion-shape", "animation-contract-ahead", "animateMotionCss"]) assert.ok(doc.includes(c), c);
});
