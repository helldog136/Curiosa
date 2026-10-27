#!/usr/bin/env node
// Capture des pages publiques du site de référence.
//   node scripts/visual/capture.mjs <dossier-de-sortie> [--profiles night,daylight,custom,layout-centered,…] [--widths 390,768,1280,1920]
//                                   [--only <texte>] [--jobs 3] [--entries 2] [--no-prepare]
// Sortie : <dossier>/<profil>/<langue>/<largeur>/<page>[~état].png et <dossier>/manifest.json. Jamais dans le dépôt.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { CORE_DIR, WIDTHS, VIEWPORT_HEIGHT, FIXED_NOW, LOCALES, SNAPSHOT_DIR, PORT_BASE } from "./config.mjs";
import { PROFILES, PROFILE_ORDER } from "./profiles.mjs";
import { discover, crawl, selectPages, pageId, STATES, FORM_ERRORS } from "./pages.mjs";
import { loadPlaywright, chromiumPath, CHROMIUM_ARGS } from "./lib/playwright.mjs";
import { sh } from "./lib/proc.mjs";
import { fileURLToPath } from "node:url";
import { demoImage } from "./lib/images.mjs";

const SITE = fileURLToPath(new URL("./site.mjs", import.meta.url));
const argv = process.argv.slice(2);
const out = path.resolve(argv.find((a) => !a.startsWith("--")) ?? "");
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt; };
if (!argv.find((a) => !a.startsWith("--"))) { console.error("usage : capture.mjs <dossier-de-sortie> [--profiles …] [--widths …] [--only texte] [--jobs N] [--entries N]"); process.exit(2); }
if (out.startsWith(CORE_DIR + path.sep) && !process.env.VISUAL_ALLOW_IN_REPO) { console.error("Refusé : la sortie ne doit jamais être dans le dépôt (aucun PNG dans git)."); process.exit(2); }

const profiles = (opt("profiles", PROFILE_ORDER.join(","))).split(",").filter(Boolean);
const widths = (opt("widths", WIDTHS.join(","))).split(",").map(Number);
const only = opt("only", "");
const JOBS = Number(opt("jobs", "3"));
const ENTRIES = Number(opt("entries", "2"));
for (const p of profiles) if (!PROFILES[p]) { console.error(`profil inconnu : ${p}`); process.exit(2); }

const { chromium } = loadPlaywright();
fs.mkdirSync(out, { recursive: true });
const manifest = { tool: "scripts/visual/capture.mjs", core: gitHead(), snapshot: readJson(`${SNAPSHOT_DIR}/snapshot.json`), now: FIXED_NOW, widths, profiles, only, shots: [], excluded: [], discovered: {} };
function gitHead() { try { return sh("git", ["-C", CORE_DIR, "rev-parse", "HEAD"]).trim() + (sh("git", ["-C", CORE_DIR, "status", "--porcelain", "--", "src", "prisma"]).trim() ? "+modifié" : ""); } catch { return "inconnu"; } }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const STILL_CSS = `*,*::before,*::after{animation:none!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}
html{cursor:none!important}*{cursor:none!important}::-webkit-scrollbar{display:none}`;
const SHIM = fs.readFileSync(new URL("./lib/page-shim.js", import.meta.url), "utf8").replace("__NOW__", FIXED_NOW);
// Toute image tierce (jaquettes, miniatures, tuiles de carte, avatars) est remplacée par une illustration locale, la même à chaque fois pour la même adresse.
const artCache = new Map();
async function externalImage(u) {
  const tile = u.hostname.endsWith("openstreetmap.org");
  const key = tile ? "tile" : u.hostname + u.pathname;
  if (!artCache.has(key)) {
    const n = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;
    artCache.set(key, tile ? await demoImage(256, 256, 2, "png") : await demoImage(u.hostname.includes("rawg") ? 640 : 480, u.hostname.includes("rawg") ? 360 : 270, n));
  }
  return { body: artCache.get(key), contentType: tile ? "image/png" : "image/jpeg" };
}

async function newContext(browser, { width, port, consent }) {
  const ctx = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] ?? 900 }, deviceScaleFactor: 1, locale: "fr-FR", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce",
    serviceWorkers: "block", acceptDownloads: false, permissions: [], geolocation: undefined, javaScriptEnabled: true,
  });
  await ctx.addInitScript(SHIM);
  if (consent) await ctx.addCookies([{ name: "curiosa_cookies", value: "no", domain: "127.0.0.1", path: "/", expires: Math.floor(Date.parse(FIXED_NOW) / 1000) + 86400 * 20 }]);
  const blocked = (ctx.blocked = new Set());
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    blocked.add(`${u.hostname}${u.pathname}`);
    return route.request().resourceType() === "image" ? route.fulfill({ status: 200, ...(await externalImage(u)) }) : route.abort("blockedbyclient");
  });
  return ctx;
}

/** Attend que la page soit posée : polices, images (défilement pour les images paresseuses), puis deux captures identiques de suite (jusqu'à 5 essais). */
async function settle(tab) {
  await tab.addStyleTag({ content: STILL_CSS }).catch(() => {});
  await tab.bringToFront().catch(() => {});
  await withTimeout(tab.evaluate(async () => {
    const cap = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    await cap(document.fonts.ready, 5000);
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 20)); }
    window.scrollTo(0, 0);
    const imgs = [...document.images];
    await Promise.all(imgs.map((i) => (i.complete ? null : cap(new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }), 6000))));
    await Promise.all(imgs.map((i) => (i.decode ? cap(i.decode().catch(() => {}), 3000) : null)));
    await cap(document.fonts.ready, 5000);
  }), 30000, "attente de la page").catch(() => {});
  await tab.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

async function stableShot(tab) {
  let prev = null, buf = null;
  for (let i = 0; i < 5; i++) {
    buf = await tab.screenshot({ fullPage: true, animations: "disabled", caret: "hide", type: "png" });
    if (process.env.VISUAL_DEBUG) fs.writeFileSync(`/dev/shm/visual/dbg-${i}.png`, buf);
    if (prev && buf.equals(prev)) return { buf, stable: true };
    prev = buf;
    await tab.waitForTimeout(120);
  }
  return { buf, stable: false };
}

const tasks = [];
let browser;
function addTask(t) { if (!only || `${t.profile}/${t.locale}/${t.id}`.includes(only)) tasks.push(t); }

const TASK_MS = Number(process.env.VISUAL_TASK_TIMEOUT_MS || 90000);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`délai dépassé (${ms} ms) : ${what}`)), ms))]);
async function runTask(ctxFor, t, port) {
  const label = `${t.profile}/${t.locale}/${t.width}/${t.id}${t.state ? "~" + t.state.id : ""}`;
  const t0 = Date.now(); if (process.env.VISUAL_VERBOSE) console.log(`  > ${label}`);
  try { await withTimeout(runTaskInner(ctxFor, t, port), TASK_MS, label); if (process.env.VISUAL_VERBOSE) console.log(`  < ${label} ${Date.now() - t0} ms`); }
  catch (e) { manifest.shots.push({ file: null, profile: t.profile, locale: t.locale, width: t.width, page: t.path, id: t.id, state: t.state?.id ?? null, status: 0, error: String(e.message).slice(0, 300) }); console.log(`  ÉCHEC ${label} : ${e.message}`); }
}
async function runTaskInner(ctxFor, t, port) {
  const ctx = await ctxFor(t.width, t.fresh);
  const tab = await ctx.newPage();
  const errors = [];
  tab.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  tab.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
  tab.on("dialog", (d) => d.dismiss().catch(() => {}));
  const url = `http://127.0.0.1:${port}${t.path}`;
  let status = 0;
  try {
    const resp = await tab.goto(url, { waitUntil: "load", timeout: 45000 });
    status = resp?.status() ?? 0;
    await settle(tab);
    if (t.state?.run) { await t.state.run(tab); await settle(tab); }
    const V = (m) => process.env.VISUAL_VERBOSE && console.log(`    . ${m}`);
    V("avant capture");
    const { buf, stable } = await stableShot(tab);
    V("capture faite");
    const rel = `${t.profile}/${t.locale}/${t.width}/${t.id}${t.state ? "~" + t.state.id : ""}.png`;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), buf);
    const info = await tab.evaluate(() => ({ h: document.documentElement.scrollHeight, next: document.querySelector('[data-pagination] a[rel="next"]')?.getAttribute("href") ?? null })).catch(() => ({ h: 0, next: null }));
    V("info faite");
    manifest.shots.push({ file: rel, profile: t.profile, locale: t.locale, width: t.width, page: t.path, id: t.id, state: t.state?.id ?? null, status, height: info.h, bytes: buf.length, sha256: sha(buf), stable, errors: errors.slice(0, 5) });
    if (!t.state && info.next && !t.path.includes("page=") && t.locale === LOCALES[0]) {
      addTask({ ...t, path: `${t.path.replace(/\?.*$/, "")}?page=2`, id: pageId(`${t.path}?page=2`), later: true });
      manifest.__more = (manifest.__more ?? 0) + 1;
    }
  } catch (e) {
    manifest.shots.push({ file: null, profile: t.profile, locale: t.locale, width: t.width, page: t.path, id: t.id, state: t.state?.id ?? null, status, error: String(e.message).slice(0, 300) });
  } finally { await Promise.race([tab.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]); }
}

async function pool(list, fn, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (true) { const k = i++; if (k >= list.length) return; await fn(list[k]); } }));
}

const t0 = Date.now();
browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
manifest.browser = browser.version();
manifest.fonts = (() => { try { return sha(execFileSync("fc-list", [":", "family", "style"], { encoding: "utf8" }).split("\n").sort().join("\n")); } catch { return "fc-list absent"; } })();
let found = null;
for (const profile of profiles) {
  const port = PORT_BASE + PROFILE_ORDER.indexOf(profile);
  console.log(`\n== profil ${profile} (port ${port}) ==`);
  execFileSync("node", [SITE, "up", profile], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } });
  try {
    const base = `http://127.0.0.1:${port}`;
    if (!found) { found = await crawl(base, await discover(base)); manifest.discovered = { count: found.length, paths: found.map((f) => f.path) }; }
    tasks.length = 0;
    const scope = PROFILES[profile].scope;
    const locales = scope === "all" && profile === "night" ? LOCALES : [LOCALES[0]];
    for (const locale of locales) {
      const sel = selectPages(found, { scope, locale, entries: ENTRIES });
      const extra = [{ path: locale === LOCALES[0] ? "/page-introuvable" : `/${locale}/page-introuvable`, bare: "/page-introuvable", locale, depth: 1, notFound: true }];
      for (const p of [...sel, ...extra]) {
        for (const width of widths) {
          const id = pageId(p.bare === "/" ? "/" : p.bare);
          addTask({ profile, locale, width, path: p.path, id, bare: p.bare });
        }
        if (scope !== "sample" && locale === LOCALES[0] || (locale !== LOCALES[0] && p.bare === "/")) {
          for (const st of STATES) {
            if (locale !== LOCALES[0] && st.id !== "cookies") continue;
            if (!st.when({ bare: p.bare })) continue;
            for (const width of widths) if (!st.widths || st.widths.includes(width)) addTask({ profile, locale, width, path: p.path, id: pageId(p.bare === "/" ? "/" : p.bare), bare: p.bare, state: st, fresh: !!st.fresh });
          }
        }
      }
    }
    // Un contexte par (largeur, visiteur neuf ou non) ; les tâches de même largeur partagent la même fenêtre mais chaque page a son onglet.
    const ctxs = new Map();
    const ctxFor = async (width, fresh) => { const k = `${width}|${fresh ? 1 : 0}`; if (!ctxs.has(k)) ctxs.set(k, newContext(browser, { width, port, consent: !fresh })); return ctxs.get(k); };
    let done = 0;
    for (let round = 0; round < 3; round++) {
      const batch = tasks.splice(0);
      if (!batch.length) break;
      await pool(batch, async (t) => { await runTask(ctxFor, t, port); if (++done % 25 === 0) process.stdout.write(`  ${done} captures\r`); }, JOBS);
    }
    for (const c of ctxs.values()) { const x = await c; for (const b of x.blocked) manifest.excluded.push({ profile, blockedExternal: b }); await x.close().catch(() => {}); }
    console.log(`  ${done} captures pour ${profile}`);
  } finally {
    execFileSync("node", [SITE, "down", profile], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } });
  }
}
await browser.close();
delete manifest.__more;
manifest.excluded = [...new Map(manifest.excluded.map((e) => [JSON.stringify(e), e])).values()];
manifest.durationSec = Math.round((Date.now() - t0) / 1000);
manifest.shots.sort((a, b) => (a.file ?? a.page).localeCompare(b.file ?? b.page));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
const bad = manifest.shots.filter((s) => !s.file || s.status >= 500);
const unstable = manifest.shots.filter((s) => s.file && s.stable === false);
console.log(`\n${manifest.shots.length} captures, ${bad.length} en erreur, ${unstable.length} instables, ${manifest.durationSec} s → ${out}`);
if (bad.length) for (const b of bad.slice(0, 10)) console.log("  erreur :", b.profile, b.page, b.error ?? b.status);
process.exit(bad.length ? 1 : 0);
