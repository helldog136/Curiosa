// Animation engine: still frames and frame-time measurements in headless Chromium (core 0.30.0, docs/OVERLAY-ANIMATIONS.md "Performance").
//
//   node --import ./tests/helpers/register.mjs scripts/visual/animate-bench.mjs shots <dir> [recipe.json …]   still frames of every genre at key instants
//   node --import ./tests/helpers/register.mjs scripts/visual/animate-bench.mjs motion <dir>   each named spring (and calm mode) on a gauge at key instants, with the head's width measured
//   node --import ./tests/helpers/register.mjs scripts/visual/animate-bench.mjs bench [seconds] [throttle] [recipe.json …]   frame cost per size and quality
//
// Without recipe files it uses the reference recipes of tests/fixtures/animate and the basic rendering. Headless Chromium draws in SOFTWARE here
// (no GPU): an upper bound of the cost. It is not OBS: the owner's own measurement in OBS (Stats dock: render lag, skipped frames) remains the reference.
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, chromiumPath, CHROMIUM_ARGS } from "./lib/playwright.mjs";

const K = await import("../../src/core/animate/kit.ts");
const [mode = "shots", ...rest] = process.argv.slice(2);
const T0 = 1_800_000_000_000;

function recipes(files) {
  const list = files.length ? files : ["tests/fixtures/animate/stained-glass.json", "tests/fixtures/animate/night-neon.json"];
  return [{ name: "basic", recipe: null }, ...list.map((f) => ({ name: path.basename(f, ".json"), recipe: JSON.parse(fs.readFileSync(f, "utf8")) }))];
}
/** The scenes: a follower goal, a subathon time gauge, a hype train, a session counter; highlights placed around T0. */
export function scenes(t0 = T0) {
  return {
    gauge: { genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [0, 120, 260, 400, 520].map((d, i) => ({ id: `f${i}`, at: t0 + d, kind: "step", amount: 1 })) },
    goal: { genre: "gauge", value: 100, target: 100, label: "Follower goal", highlights: [{ id: "done", at: t0, kind: "complete", amount: 1 }] },
    subathon: { genre: "gauge", format: "time", value: 0, target: 4 * 3600, label: "Subathon", timer: { endsAt: t0 + 2 * 3600e3 + 754e3, total: 4 * 3600e3 }, highlights: [{ id: "s1", at: t0, kind: "extend", amount: 300 }] },
    hype: { genre: "levels", value: 620, target: 1000, level: 3, label: "Hype train", timer: { endsAt: t0 + 3 * 60e3 + 12e3, total: 5 * 60e3 }, highlights: [{ id: "h1", at: t0, kind: "milestone" }] },
    counter: { genre: "counter", format: "money", currency: "€", value: 1234.5, label: "Session", highlights: [{ id: "c1", at: t0, kind: "step", amount: 5 }] },
  };
}

async function browser() { const pw = loadPlaywright(); return pw.chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS }); }

if (mode === "motion") {
  // The motion tokens (core 0.33.0): one step of +25 on a gauge, drawn at key instants with each spring, in live and in calm mode, at two sizes.
  const dir = rest[0] || "animate-motion";
  fs.mkdirSync(dir, { recursive: true });
  const b = await browser(), page = await b.newPage({ viewport: { width: 1764, height: 717 } });
  const st = { genre: "gauge", value: 75, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [{ id: "k1", at: T0, kind: "step", amount: 25 }, { id: "k2", at: T0 + 2600, kind: "milestone" }] };
  const base = JSON.parse(fs.readFileSync("tests/fixtures/animate/night-neon.json", "utf8"));
  const report = [];
  for (const spring of ["snappy", "smooth", "gentle", "bouncy"]) for (const calm of [false, true]) for (const [w, h] of [[1764, 717], [700, 360]]) {
    const recipe = { ...base, animateContract: 2, motion: { value: spring, body: spring, reaction: spring, celebration: spring } };
    const frames = [];
    for (const dt of [0, 90, 180, 300, 500, 900, 2900]) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(K.animateKitPage({ state: st, recipe, width: w, height: h, at: T0 + dt, quality: "full", calm, background: "stream", lang: "en" }));
      await page.waitForSelector("html[data-ready='1']");
      const view = await page.evaluate(() => ({ display: window.__frame.view.display, progress: window.__frame.view.progress }));
      frames.push({ dt, display: Math.round(view.display * 100) / 100, progress: Math.round(view.progress * 1000) / 1000 });
      await page.screenshot({ path: path.join(dir, `${spring}-${calm ? "calm" : "live"}-${w}x${h}-${String(dt).padStart(4, "0")}.png`) });
    }
    report.push({ spring, calm, size: `${w}x${h}`, frames });
  }
  await b.close();
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 1));
  console.log(`motion frames written to ${dir}`);
} else if (mode === "shots") {
  const dir = rest[0] || "animate-shots";
  fs.mkdirSync(dir, { recursive: true });
  const b = await browser(), page = await b.newPage({ viewport: { width: 1764, height: 717 } });
  const sizes = { gauge: [1764, 717], goal: [1764, 717], subathon: [1200, 360], hype: [1200, 480], counter: [640, 360] };
  for (const r of recipes(rest.slice(1))) for (const [name, st] of Object.entries(scenes())) for (const [label, dt] of [["rest", -5000], ["mid", 350], ["late", 1500]]) for (const quality of ["full", "minimal"]) {
    if (quality === "minimal" && label !== "mid") continue;
    const [w, h] = sizes[name];
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(K.animateKitPage({ state: st, recipe: r.recipe, width: w, height: h, at: T0 + dt, quality, background: "stream", lang: "en" }));
    await page.waitForSelector("html[data-ready='1']");
    await page.screenshot({ path: path.join(dir, `${r.name}-${name}-${label}-${quality}.png`) });
  }
  await b.close();
  console.log(`still frames written to ${dir}`);
} else {
  const seconds = Number(rest[0] || 6), throttle = Number(rest[1] || 1);
  const b = await browser(), results = [];
  for (const r of recipes(rest.slice(2))) for (const [w, h] of [[1764, 717], [3440, 1440]]) for (const quality of ["full", "light", "minimal"]) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    const cdp = await page.context().newCDPSession(page);
    if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    // a busy scene: a highlight every 400 ms (bursts, celebrations, +amounts), the value always moving: the worst steady case
    const now = Date.now(), st = { genre: "gauge", value: 40, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, at: now + i * 400, kind: i % 10 === 9 ? "milestone" : "step", amount: 1 })) };
    st.value = 40 + 40;
    await page.setContent(K.animateKitPage({ state: st, recipe: r.recipe, width: w, height: h, quality, background: "transparent", startAt: now }));
    await page.waitForSelector("html[data-ready='1']");
    const deltas = await page.evaluate((ms) => new Promise((done) => { const d = []; let last = performance.now(); const end = last + ms; function f(t) { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else done(d); } requestAnimationFrame(f); }), seconds * 1000);
    const s = await page.evaluate(() => window.__anim.stats());
    const sorted = deltas.slice(5).sort((a, b) => a - b);
    results.push({ skin: r.name, size: `${w}x${h}`, quality, throttle, frames: s.frames, fps: Math.round((s.frames / seconds) * 10) / 10, avgMs: +s.avg.toFixed(2), p95Ms: +s.p95.toFixed(2), maxMs: +s.max.toFixed(1), rafP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), layerRedraws: s.layerRedraws });
    await page.close();
  }
  await b.close();
  console.table(results);
  if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 1));
}
