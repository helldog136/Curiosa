// Compositions for an assistant (core 0.25.0): the approximate still picture made with sharp (decoded and inspected here, not only "it returned bytes"),
// the self-contained render kit page opened in a REAL Chromium (ready flag, frozen moment, the site's own files), the plain-English errors, and the MCP
// server sending an image content item (additive: every other tool answers as before).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
after(() => db.close());
const sharp = (await import("sharp")).default;
const M = await import("@/core/compose/model");
const P = await import("@/core/compose/preview");
const R = await import("@/core/compose/render");
const X = await import("@/core/compose/explain");
const I = await import("@/core/services/mcp/image");
const { composeKit } = await import("@/core/compose/kit");
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");

const dir = makeTempDir("compose-preview-");
const PIC = "/uploads/00000001-0000-4000-8000-000000000000.png";
const DARK = "/uploads/00000002-0000-4000-8000-000000000000.png";
const VID = "/uploads/00000003-0000-4000-8000-000000000000.webm";
const POSTER = "/uploads/00000004-0000-4000-8000-000000000000.png";
const file = (src) => path.join(dir, path.basename(src));
// a bright picture with two discs, a dark one, and the still picture of a video (transparent around a disc)
await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#f0e8c8" } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><circle cx="300" cy="300" r="200" fill="#e04080"/><circle cx="900" cy="500" r="260" fill="#40a0e0"/></svg>') }]).png().toFile(file(PIC));
await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#101018" } }).png().toFile(file(DARK));
await sharp({ create: { width: 640, height: 360, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><circle cx="320" cy="150" r="100" fill="#ff00aa"/></svg>') }]).png().toFile(file(POSTER));
fs.copyFileSync("tests/fixtures/media/compose-alpha-vp9.webm", file(VID));

const resolved = (raw, fill = {}) => { const c = M.checkComposition(raw, { variables: ["name"] }); assert.equal(c.ok, true, JSON.stringify(c.errors)); return M.resolveComposition(c.value, { phrase: "Merci etoile_nord", ...fill }); };
const raw = (src, boxes, extra = {}) => ({ v: 1, backdrop: { src }, boxes, ...extra });
async function pixels(png) { const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { at: (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)], info, data }; }
/** How many pixels differ between two pictures inside a rectangle. */
async function changed(a, b, rect) {
  const pa = await pixels(a), pb = await pixels(b);
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const i = (y * pa.info.width + x) * 4; if (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 60) n++; }
  return n;
}

test("preview: the backdrop framed as the engine frames it, the text drawn inside its box and nowhere else, a size in px of a 1080 frame", async () => {
  const empty = await P.previewComposition(resolved(raw(PIC, [{ id: "a", content: { kind: "custom", text: "{name}" } }]), { values: { name: "" } }), { uploadsDir: dir });
  assert.equal(empty.info.boxes.length, 0, "an empty box is no box");
  const r = await P.previewComposition(resolved(raw(PIC, [{ id: "a", x: 10, y: 70, w: 80, h: 25, look: "bare", size: 56 }])), { uploadsDir: dir });
  assert.equal(r.mimeType, "image/png");
  assert.deepEqual([r.info.width, r.info.height, r.info.backdrop, r.info.approximate], [960, 540, "picture", true]);
  const meta = await sharp(r.png).metadata();
  assert.deepEqual([meta.width, meta.height], [960, 540]);
  // the backdrop is there: the pink disc at (225, 225) once scaled 0.75
  const px = await pixels(r.png);
  assert.ok(px.at(225, 225)[0] > 200 && px.at(225, 225)[1] < 100, `pink disc ${px.at(225, 225)}`);
  // the text: pixels changed inside the box (x 96..864, y 378..513), none above it
  const inBox = await changed(r.png, empty.png, { x: 96, y: 378, w: 768, h: 135 });
  const above = await changed(r.png, empty.png, { x: 0, y: 0, w: 960, h: 370 });
  assert.ok(inBox > 1500, `text pixels in the box: ${inBox}`);
  assert.equal(above, 0, "nothing drawn outside the box");
  const [box] = r.info.boxes;
  assert.deepEqual([box.text, box.sizePx1080, box.lines, box.overflow, box.outline, box.readable, box.readableBy], ["Merci etoile_nord", 56, 1, false, "thick", true, "outline"]);
  assert.equal(typeof box.contrast, "number");
});

test("preview: a long name shrinks to the floor then is cut with …; a band at 85 % reads anywhere; white text without outline on a bright picture is said unreadable", async () => {
  const long = `${"etoile_nord_lune_douce_xy ".repeat(3)}`.trim();
  const r = await P.previewComposition(resolved(raw(PIC, [
    { id: "a", x: 30, y: 40, w: 40, h: 12, size: 72, minSize: 32, maxLines: 1, look: "readable", content: { kind: "custom", text: long } },
    { id: "b", x: 5, y: 5, w: 90, h: 20, look: "custom", pill: { color: "#ffffff", opacity: 0, radius: 0 }, outline: "none", color: "#ffffff" },
  ])), { uploadsDir: dir });
  const [a, b] = r.info.boxes;
  assert.equal(a.sizePx1080, 32); assert.equal(a.overflow, true); assert.match(a.text, /…$/); assert.ok(a.text.length < long.length);
  assert.deepEqual([a.band, a.readableBy], [true, "band"]);
  assert.equal(b.outline, "thin", "the kit's rule: no outline under 65 % becomes a thin outline");
  // the same box with a strong panel off and no outline cannot exist (the rule adds one); a custom white text on a bright picture: the contrast is low
  assert.ok(b.contrast < 2, `contrast ${b.contrast}`);
  // a bright text on a dark picture without any band: readable by contrast
  const d = await P.previewComposition(resolved(raw(DARK, [{ id: "a", look: "custom", pill: { color: "#000000", opacity: 0, radius: 0 }, color: "#ffffff" }])), { uploadsDir: dir });
  assert.ok(d.info.boxes[0].contrast > 10);
});

test("preview: a video shows its still picture (transparent parts on the checkerboard); without one a plain frame and a note; the moment shown hides a box not yet in", async () => {
  const v = await P.previewComposition(resolved(raw(VID, [{ id: "a", in: { anim: "pop", at: 3, dur: 0.4 } }], { backdrop: { src: VID, poster: POSTER }, format: "16:9" })), { uploadsDir: dir, at: 1 });
  assert.equal(v.info.backdrop, "video-still");
  assert.equal(v.info.boxes[0].shown, false, "at 1 s the text (in at 3 s) is not there yet");
  const px = await pixels(v.png);
  assert.ok(px.at(480, 225)[0] > 200 && px.at(480, 225)[2] > 120, `the disc of the still picture: ${px.at(480, 225)}`);
  const corner = [px.at(5, 5), px.at(15, 5)].map((c) => c[0]);
  assert.ok(corner.includes(255) && corner.some((c) => c < 230), `checkerboard behind the transparent part: ${corner}`);
  const none = await P.previewComposition(resolved(raw(VID, [{ id: "a" }])), { uploadsDir: dir, background: "dark" });
  assert.equal(none.info.backdrop, "none");
  assert.match(none.info.notes.join(" "), /no still picture/);
  assert.deepEqual((await pixels(none.png)).at(10, 10).slice(0, 3), [0x16, 0x18, 0x1d]);
  // 9:16 keeps the longest side under 1280; width bounds
  const tall = await P.previewComposition(resolved(raw(PIC, [{ id: "a" }], { format: "9:16" })), { uploadsDir: dir, width: 1280 });
  assert.deepEqual([tall.info.width, tall.info.height], [720, 1280]);
  assert.equal((await P.previewComposition(resolved(raw(PIC, [{ id: "a" }])), { uploadsDir: dir, width: 50 })).info.width, 320);
});

test("preview: texts are text for Pango (markup characters are escaped), and the look matches the engine's", async () => {
  const r = await P.previewComposition(resolved(raw(PIC, [{ id: "a", content: { kind: "custom", text: "{name}" } }]), { values: { name: '<span foreground="red">x</span> & <b>' } }), { uploadsDir: dir });
  assert.equal(r.info.boxes[0].text, '<span foreground="red">x</span> & <b>');
  const win = {};
  R.composeEngine(win);
  for (const look of ["readable", "discreet", "bare"]) for (const color of ["auto", "#ffd400", "#111111"]) {
    const b = { look, color, outline: "thin" };
    const e = win.CuriosaCompose.lookOf(b, 1), p = P.previewLook(b);
    assert.equal(e.color.toLowerCase(), p.fg, `${look} ${color}`);
    assert.equal(e.background === "transparent", p.band === null, `${look} ${color} band`);
  }
  const custom = { look: "custom", color: "auto", outline: "none", pill: { color: "#123456", opacity: 85, radius: 12 } };
  assert.equal(win.CuriosaCompose.lookOf(custom, 1).background, "rgba(18,52,86,0.85)");
  assert.deepEqual(P.previewLook(custom).band, { colour: "#123456", alpha: 0.85 });
});

test("plain English for every problem, all at once, with the place's automatic values", () => {
  const r = M.checkComposition({ v: 2, backdrop: { src: PIC, play: "once" }, duration: { mode: "media", seconds: 8 }, boxes: [{ id: "a", size: 300, colour: "#fff", content: { kind: "custom", text: "Merci {pseudo}" } }, { id: "a" }] }, { variables: ["name", "amount"] });
  const lines = X.explainComposeErrors(r.errors, { variables: ["name", "amount"] });
  assert.equal(lines.length, r.errors.length);
  const all = lines.join("\n");
  for (const want of ["v must be 1.", "backdrop.play belongs to a video backdrop", "duration.mode is not one of: fixed", "Text box 1 (boxes[0].size) must be between 24 and 220 (px on a frame 1080 high)", "boxes[0].colour is not a known key", "uses {pseudo}; this place knows {name}, {amount}", "the id \"a\" is used twice"]) assert.ok(all.includes(want), `${want}\n${all}`);
  assert.equal(X.explainComposeErrors(M.checkComposition("{").errors)[0], "The composition is not valid JSON. Send one JSON object as a string.");
  assert.deepEqual(composeKit.explainErrors(r.errors), X.explainComposeErrors(r.errors));
  assert.ok(composeKit.features.includes("preview"));
});

test("MCP: a tool that answers with an image gives an image content item then its text; others answer as before; too big or a wrong type is never sent", async () => {
  await db.reset();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const tools = [
    { name: "pic", title: "pic", description: "d", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "core", call: async () => composeKit.mcpImage(png, "image/png", { approximate: true }) },
    { name: "big", title: "big", description: "d", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "core", call: async () => I.mcpImage(new Uint8Array(I.MCP_IMAGE_MAX + 1), "image/png", { a: 1 }) },
    { name: "txt", title: "txt", description: "d", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "core", call: async () => ({ hello: "lune_douce" }) },
  ];
  const token = await T.createToken("Camille", "read", "owner@example.org", { grants: { pic: true, big: true, txt: true } });
  const call = async (name) => (await (await handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) }), async () => tools)).json()).result;
  const pic = await call("pic");
  assert.equal(pic.content[0].type, "image");
  assert.equal(pic.content[0].mimeType, "image/png");
  assert.deepEqual(Buffer.from(pic.content[0].data, "base64"), png);
  assert.deepEqual(JSON.parse(pic.content[1].text), { approximate: true });
  const big = await call("big");
  assert.equal(big.content.length, 1); assert.equal(big.content[0].type, "text"); assert.match(big.content[0].text, /not sent/);
  assert.deepEqual((await call("txt")).content, [{ type: "text", text: JSON.stringify({ hello: "lune_douce" }, null, 2) }]);
  assert.throws(() => I.mcpImage(png, "image/svg+xml"), /not PNG/);
});

/* ───────────── the render kit in a real Chromium ───────────── */

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
test("render kit: a self-contained page, the site's own files through <base>, ready flag, #t= freezes the moment, text is text", { skip: pw ? false : "Chromium or playwright not found", timeout: 90000 }, async () => {
  const server = http.createServer((req, res) => {
    const f = req.url.startsWith("/uploads/") ? file(req.url) : null;
    if (f && fs.existsSync(f)) {
      // ranges, as the site serves its files (a browser cannot seek a video without them)
      const body = fs.readFileSync(f), m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      res.setHeader("content-type", f.endsWith(".webm") ? "video/webm" : "image/png"); res.setHeader("accept-ranges", "bytes");
      if (m) { const s = Number(m[1]), e = m[2] ? Number(m[2]) : body.length - 1; res.statusCode = 206; res.setHeader("content-range", `bytes ${s}-${e}/${body.length}`); return res.end(body.subarray(s, e + 1)); }
      return res.end(body);
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const site = `http://127.0.0.1:${server.address().port}`;
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const c = resolved(raw(VID, [{ id: "a", in: { anim: "pop", at: 0.2, dur: 0.4 } }], { format: "16:9", backdrop: { src: VID, play: "loop" } }), { values: {}, phrase: '<img src=x onerror="window.hacked=1">' });
    const html = composeKit.renderKit(c, { siteUrl: `${site}/anything?x=1`, width: 640, background: "transparent" });
    assert.match(html, new RegExp(`<base href="${site}/">`));
    assert.doesNotMatch(html, /<script src=/, "no script from elsewhere");
    assert.doesNotMatch(html, /<img src=x/, "the text is JSON with < escaped");
    const pages = makeTempDir("compose-kit-");
    fs.writeFileSync(path.join(pages, "kit.html"), html);
    const p = await (await browser.newContext({ viewport: { width: 700, height: 400 } })).newPage();
    await p.goto(`file://${pages}/kit.html#t=1.0`);
    await p.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 15000 });
    const got = await p.evaluate(() => { const v = document.querySelector("video"); const box = document.querySelector(".cmp-box"); return { ready: document.documentElement.dataset.ready, paused: v.paused, t: v.currentTime, text: box.textContent, hacked: !!window.hacked, anims: document.getAnimations().map((a) => [a.playState, Math.round(a.currentTime)]), w: Math.round(document.querySelector('[data-ov-region="composition"]').getBoundingClientRect().width) }; });
    assert.equal(got.ready, "1");
    assert.equal(got.paused, true); assert.ok(Math.abs(got.t - 1) < 0.2, `video at ${got.t}`);
    assert.equal(got.text, '<img src=x onerror="window.hacked=1">'); assert.equal(got.hacked, false);
    assert.ok(got.anims.length >= 1 && got.anims.every(([s, t]) => s === "paused" && t === 1000), JSON.stringify(got.anims));
    assert.equal(got.w, 640);
    assert.throws(() => composeKit.renderKit(c, { siteUrl: "javascript:alert(1)" }), /siteUrl/);
    if (process.env.COMPOSE_SHOTS) await p.screenshot({ path: `${process.env.COMPOSE_SHOTS}/kit.png` });
  } finally { await browser.close(); server.close(); }
});
