// Real Chromium proof of the font loader (core 0.47.0): the page the core really renders, a frame under a STRICT policy (font-src 'none'), the real woff2 of the core (Fredoka, OFL)
// served by the core's own asset resolver. Skipped, with the reason, when no Chromium is available. Run with TMPDIR on a roomy disk if /tmp is small.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";
import { FONT, TOKENS, CSS, fontSkin } from "../helpers/overlay-font-skin.mjs";

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }

const V = await import("@/core/skins/validate");
const F = await import("@/core/overlays/skinFonts");
const Sh = await import("@/core/overlays/skinSheet");
const R = await import("@/core/overlays/render");
const Serve = await import("@/core/skins/serve");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const STRICT = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'";
const ELEMENT = '<!doctype html><meta charset="utf-8"><body style="margin:0"><span data-ov-part="title" id="t" style="font-size:40px;white-space:nowrap">Hello wide world mmmmWWWW</span>';

async function run(withFontFile, csp) {
  const root = makeTempDir("ovfont-serve-");
  const v = V.validateSkinFolder(fontSkin("emma-skin"), { coreVersion: "0.47.0" });
  assert.equal(v.ok, true);
  const dir = path.join(root, "emma-skin/1.0.0/fonts"); fs.mkdirSync(dir, { recursive: true });
  if (withFontFile) fs.writeFileSync(path.join(dir, "fredoka.woff2"), FONT);
  const skin = { ...Sh.compileSkin({ id: "emma-skin", version: "1.0.0", tokens: v.tokens.common, css: v.css, fonts: F.overlayFonts("emma-skin", "1.0.0", v.manifest.assets) }), key: "k" };
  const layout = { iframeW: 640, iframeH: 120, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 120 };
  const pg = { id: "p", name: "Page", width: 800, height: 200, active: true, style: { text: "light", background: "transparent", corners: "round" }, look: { skin: "emma-skin", byContext: { enabled: false, instance: null, context: null, rules: [] } }, rev: 1,
    elements: [{ uid: "aaaaaa1111", instance: "al", element: "alerts", x: 0, y: 0, w: 640, h: 120, visible: true, options: {} }] };
  const nonce = "N0nce";
  const html = R.renderPage({ page: pg, elements: [{ el: pg.elements[0], title: "Alerts", status: "ok", layout, follows: true, src: "/el" }], t: makeTranslator("en"), lang: "en", test: false, now: 1_000_000, nonce, stateUrl: "/state", skin });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/page") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...R.pageHeaders(R.contentSecurityPolicy(nonce, "'self'")) }); return res.end(html); }
    if (u.pathname === "/el") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp }); return res.end(ELEMENT); }
    const m = /^\/skins\/([^/]+)\/([^/]+)\/(fonts|images)\/([^/]+)$/.exec(u.pathname);
    const a = m && Serve.resolveSkinAsset(m[1], m[2], m[3], m[4], root);
    if (a) { res.writeHead(200, Serve.assetHeaders(a)); return res.end(fs.readFileSync(a.file)); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const pageObj = await browser.newPage();
    const errors = []; pageObj.on("pageerror", (e) => errors.push(String(e)));
    await pageObj.goto(`http://127.0.0.1:${server.address().port}/page`);
    const frame = pageObj.frames().find((f) => f !== pageObj.mainFrame());
    await pageObj.waitForFunction(() => document.querySelector("iframe").style.opacity === "1", null, { timeout: 8000 });
    const r = await frame.evaluate(() => {
      const el = document.getElementById("t"); const fam = "ov-emma-skin-fredoka";
      const w = (f) => { const s = document.createElement("span"); s.textContent = el.textContent; s.style.cssText = `position:absolute;white-space:nowrap;font-size:40px;font-family:${f}`; document.body.appendChild(s); const x = s.getBoundingClientRect().width; s.remove(); return x; };
      const faces = []; document.fonts.forEach((f) => faces.push([f.family.replace(/"/g, ""), f.status]));
      return { faces, withFont: w(`"${fam}", serif`), fallback: w("serif"), opacity: parent.document.querySelector("iframe").style.opacity };
    });
    return { ...r, errors };
  } finally { await browser.close(); server.close(); }
}

test("real Chromium: a strict element policy still gets the skin's font (bytes handed to the frame), and the frame is shown", { skip: pw ? false : "no Chromium/Playwright here" }, async () => {
  const r = await run(true, STRICT);
  assert.ok(r.faces.some(([f, s]) => f === "ov-emma-skin-fredoka" && s === "loaded"), JSON.stringify(r.faces));
  assert.notEqual(Math.round(r.withFont), Math.round(r.fallback), `the font changes the width: ${r.withFont} vs ${r.fallback}`);
  assert.equal(r.opacity, "1"); assert.deepEqual(r.errors, []);
});

test("real Chromium: with the same page and a permissive element policy the font loads too", { skip: pw ? false : "no Chromium/Playwright here" }, async () => {
  const r = await run(true, "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'");
  assert.ok(r.faces.some(([f, s]) => f === "ov-emma-skin-fredoka" && s === "loaded"), JSON.stringify(r.faces));
  assert.notEqual(Math.round(r.withFont), Math.round(r.fallback));
});

test("real Chromium: when the font file cannot be fetched the frame is still shown, with the fallback stack", { skip: pw ? false : "no Chromium/Playwright here" }, async () => {
  const r = await run(false, STRICT);
  assert.equal(r.opacity, "1");
  assert.equal(Math.round(r.withFont), Math.round(r.fallback), "no font: the declared stack falls back to serif");
  assert.ok(!r.faces.some(([f, s]) => f === "ov-emma-skin-fredoka" && s === "loaded"));
  assert.deepEqual(r.errors, []);
});
