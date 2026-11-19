// Scenes (core 0.40.0, docs/OVERLAY-ANIMATIONS.md "Scenes"): still frames and frame-time measurements of a skin that ships a scene, in headless Chromium.
//
//   node --import ./tests/helpers/register.mjs scripts/visual/scene-bench.mjs shots <dir> [skin-folder]   the bar at key instants: dark and light backgrounds, full / light / minimal, calm
//   node --import ./tests/helpers/register.mjs scripts/visual/scene-bench.mjs clip <dir> [skin-folder]   6 s at 15 frames a second (full and calm) as numbered PNG files; `ffmpeg -framerate 15 -i full-%03d.png out.webm` makes the video
//   node --import ./tests/helpers/register.mjs scripts/visual/scene-bench.mjs bench [seconds] [skin-folder]   ms per frame by effects level (a busy scene) and by size
//
// The skin folder defaults to the test skin of the core (tests/fixtures/scene-skins/lantern-vine). A small local server plays the part of the site: it serves the page under
// the very security policy of the stream-goals element page (`connect-src 'self'` and NO `img-src`: pictures can only arrive through fetch) and the skin's pictures through the
// core's own serving functions (core/skins/serve.ts, SVG as PNG with `?raster=1`). Headless Chromium draws in SOFTWARE here: an upper bound, not OBS.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadPlaywright, chromiumPath, CHROMIUM_ARGS } from "./lib/playwright.mjs";

const K = await import("../../src/core/animate/kit.ts");
const V = await import("../../src/core/skins/validate.ts");
const SV = await import("../../src/core/skins/serve.ts");
const [mode = "shots", ...rest] = process.argv.slice(2);
const T0 = 1_800_000_000_000;
export const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'";

/** The skin folder as the site would serve it: `<root>/<id>/<version>/images/…`, and the scene payload the page hands to the engine. */
export function prepare(folder) {
  const v = V.validateSkinFolder(folder, { coreVersion: JSON.parse(fs.readFileSync("package.json", "utf8")).version });
  if (!v.ok) throw new Error("skin refused: " + JSON.stringify(v.issues.map((i) => i.code)));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scene-bench-")), base = `/skins/${v.manifest.id}/${v.manifest.version}/`;
  for (const f of v.installFiles) { const to = path.join(root, v.manifest.id, v.manifest.version, f.path); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, f.content); }
  return { root, base, recipe: { animateContract: 3, scene: v.scene, base }, manifest: v.manifest };
}
export function serve(skin, pages) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (q, r) => {
      const u = new URL(q.url, "http://x");
      if (u.pathname.startsWith("/skins/")) {
        const [, , id, version, dir, name] = u.pathname.split("/");
        const a = SV.resolveSkinAsset(id, version, dir, name, skin.root);
        if (!a) { r.writeHead(404); r.end(); return; }
        if (a.type === "image/svg+xml" && u.searchParams.get("raster") === "1") { const png = await SV.rasterizeSvg(a.file); r.writeHead(200, SV.rasterHeaders(png.length)); r.end(png); return; }
        r.writeHead(200, SV.assetHeaders(a)); fs.createReadStream(a.file).pipe(r); return;
      }
      r.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP }); r.end(pages.get(u.pathname) ?? "");
    }).listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}
const steps = (n, from, gap = 150) => Array.from({ length: n }, (_, i) => ({ id: `s${from}-${i}`, at: from + i * gap, kind: "step", amount: 1 }));
export const STATES = {
  rest: { genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [25, 50, 75] },
  steps: { genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: steps(5, T0) },
  milestone: { genre: "gauge", value: 75, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [{ id: "a", at: T0, kind: "step", amount: 3 }, { id: "m", at: T0, kind: "milestone" }] },
  complete: { genre: "gauge", value: 100, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [{ id: "c", at: T0, kind: "complete", amount: 5 }] },
  low: { genre: "gauge", value: 8, target: 100, label: "Follower goal", milestones: [25, 50, 75] },
};
const browser = () => loadPlaywright().chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
const pageFor = (skin, o) => K.animateKitPage({ state: o.state, recipe: skin.recipe, width: o.w, height: o.h, at: o.at ?? null, startAt: o.startAt, quality: o.quality ?? "full", calm: !!o.calm, background: o.bg ?? "dark", lang: "en" });

if (import.meta.url === `file://${process.argv[1]}`) {
  const folder = (mode === "bench" ? rest[1] : rest[1]) || "tests/fixtures/scene-skins/lantern-vine";
  const skin = prepare(folder), pages = new Map();
  const { srv, port } = await serve(skin, pages), b = await browser();
  if (mode === "shots") {
    const dir = rest[0] || "scene-shots"; fs.mkdirSync(dir, { recursive: true });
    const W = 1280, H = 360, out = [];
    for (const bg of ["dark", "light"]) for (const [sn, st] of Object.entries(STATES)) for (const [label, dt] of sn === "rest" || sn === "low" ? [["rest", -5000]] : [["early", 150], ["mid", 600], ["late", 1500]]) for (const [qn, calm] of [["full", false], ["light", false], ["minimal", false], ["full", true]]) {
      if ((qn !== "full" || calm) && !(bg === "dark" && (label === "mid" || label === "rest") && ["steps", "milestone", "rest"].includes(sn))) continue;
      const page = await b.newPage({ viewport: { width: W, height: H } });
      pages.set("/p", K.animateKitPage({ state: st, recipe: skin.recipe, width: W, height: H, at: T0 + dt, quality: qn, calm, background: bg === "light" ? "light" : "dark", lang: "en" }));
      await page.goto(`http://127.0.0.1:${port}/p`); await page.waitForSelector("html[data-ready='1']");
      const name = `${sn}-${label}-${qn}${calm ? "-calm" : ""}-${bg}.png`; await page.screenshot({ path: path.join(dir, name) }); out.push(name); await page.close();
    }
    console.log(out.length + " frames written to " + dir);
  } else if (mode === "clip") {
    const dir = rest[0] || "scene-clip"; fs.mkdirSync(dir, { recursive: true });
    const st = { genre: "gauge", value: 78, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: [0, 1, 2, 3, 4].map((i) => ({ id: "s" + i, at: T0 + 300 + i * 140, kind: "step", amount: 2 })).concat([{ id: "m", at: T0 + 2600, kind: "milestone", amount: 2 }]) };
    for (const calm of [false, true]) {
      const page = await b.newPage({ viewport: { width: 1280, height: 360 } });
      for (let i = 0; i < 90; i++) {
        pages.set("/p", K.animateKitPage({ state: st, recipe: skin.recipe, width: 1280, height: 360, at: T0 + i * (1000 / 15), calm, background: "dark", lang: "en" }));
        await page.goto(`http://127.0.0.1:${port}/p`); await page.waitForSelector("html[data-ready='1']");
        await page.screenshot({ path: path.join(dir, `${calm ? "calm" : "full"}-${String(i).padStart(3, "0")}.png`) });
      }
      await page.close();
    }
    console.log("180 frames written to " + dir);
  } else {
    const seconds = Number(rest[0] || 6), results = [];
    for (const [w, h] of [[1280, 360], [1764, 717]]) for (const quality of ["full", "light", "minimal"]) {
      const page = await b.newPage({ viewport: { width: w, height: h } }), now = Date.now();
      const st = { genre: "gauge", value: 80, target: 100, label: "Follower goal", milestones: [25, 50, 75], highlights: Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, at: now + i * 400, kind: i % 10 === 9 ? "milestone" : "step", amount: 1 })) };
      pages.set("/b", pageFor(skin, { state: st, w, h, quality, startAt: now, bg: "dark" }));
      await page.goto(`http://127.0.0.1:${port}/b`); await page.waitForSelector("html[data-ready='1']");
      await page.waitForTimeout(500);
      const s0 = await page.evaluate(() => window.__anim.stats());
      await page.waitForTimeout(seconds * 1000);
      const s = await page.evaluate(() => window.__anim.stats());
      results.push({ skin: skin.manifest.id, size: `${w}x${h}`, quality, frames: s.frames - s0.frames, avgMs: +s.avg.toFixed(2), p95Ms: +s.p95.toFixed(2), maxMs: +s.max.toFixed(1) });
      await page.close();
    }
    console.table(results);
    if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 1));
  }
  await b.close(); srv.close(); fs.rmSync(skin.root, { recursive: true, force: true });
}
