// Compositions on VIDEOS (core 0.21.0): the data rules (how a video plays, its sound, the alert as long as the video), copying a placement between pictures
// and videos, the gallery option `video`, and the engine in a REAL Chromium with real VP9 files made by ffmpeg (tests/fixtures/media/compose-*.webm): a
// transparent video stays transparent, "once" and "hold", one video at a time, the next alert loaded ahead, a refused sound falls back to muted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const M = await import("@/core/compose/model");
const R = await import("@/core/compose/render");
const O = await import("@/core/compose/option");
const { composeKit } = await import("@/core/compose/kit");
const C = await import("@/core/compose/contrast");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const PNG = "/uploads/00000001-0000-4000-8000-000000000000.png";
const GIF = "/uploads/00000002-0000-4000-8000-000000000000.gif";
const VID = "/uploads/00000003-0000-4000-8000-000000000000.webm";
const VID2 = "/uploads/00000004-0000-4000-8000-000000000000.webm";
const codes = (r) => (r.ok ? [] : r.errors.map((e) => `${e.path}:${e.code}`));

test("video data: how it plays, its sound and its still picture belong to a video; 'the video's own length' too", () => {
  assert.equal(M.checkComposition({ v: 1, backdrop: { src: VID, play: "hold", sound: true }, duration: { mode: "media", seconds: 8 }, boxes: [{ id: "a" }] }).ok, true);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: GIF, play: "once" }, boxes: [{ id: "a" }] })), ["backdrop.play:choice"], "a GIF always loops");
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: PNG, sound: true }, boxes: [{ id: "a" }] })), ["backdrop.sound:choice"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: PNG, poster: PNG }, boxes: [{ id: "a" }] })), ["backdrop.poster:choice"]);
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: PNG }, duration: { mode: "media", seconds: 8 }, boxes: [{ id: "a" }] })), ["duration.mode:choice"]);
  assert.equal(M.checkComposition({ v: 1, backdrop: { src: PNG }, duration: { mode: "fixed", seconds: 8 }, boxes: [{ id: "a" }] }).ok, true, "a picture may last a chosen time");
  assert.deepEqual(codes(M.checkComposition({ v: 1, backdrop: { src: VID }, duration: { mode: "media", seconds: 61 }, boxes: [{ id: "a" }] })), ["duration.seconds:range"]);
  // a picture's composition of step 1 is byte for byte the same text
  const pic = M.checkComposition({ v: 1, backdrop: { src: PNG }, boxes: [{ id: "a" }] }).value;
  assert.equal(M.canonicalComposition(pic).includes("play"), false);
  assert.equal("duration" in pic, false);
});

test("video lengths: rounded up, 2 to 60 s; a new placement on a video plays once and lasts as long as the video", () => {
  assert.deepEqual([0.4, 2, 7.2, 8.0, 8.04, 59.9, 300].map(M.mediaSeconds), [2, 2, 8, 8, 8, 60, 60]);
  const c = M.defaultVideoComposition(VID, { seconds: 7.2 });
  assert.equal(M.checkComposition(c, { src: VID }).ok, true);
  assert.deepEqual(c.backdrop, { src: VID, fit: "cover", focus: [50, 50], play: "once" });
  assert.deepEqual(c.duration, { mode: "media", seconds: 8 });
  assert.equal(M.alertSeconds(c), 8);
  assert.equal(M.alertSeconds(M.defaultComposition(PNG)), null, "a picture without a length: the place decides, as before");
  assert.equal(M.isVideoSrc(VID), true); assert.equal(M.isVideoSrc(GIF), false);
  // the kit gives modules the same
  assert.deepEqual([...composeKit.features], ["video"]);
  assert.equal(composeKit.defaultComposition(VID, { seconds: 3.5 }).duration.seconds, 4);
  assert.equal(composeKit.defaultComposition(PNG).backdrop.play, undefined);
  assert.equal(composeKit.alertSeconds({ duration: { mode: "fixed", seconds: 12 } }), 12);
});

test("auto colour over a mostly see-through area (a transparent video): white with its outline, the stream behind is unknown", () => {
  const px = (list) => new Uint8ClampedArray(list.flat());
  const bright = [250, 250, 240, 255], clear = [0, 0, 0, 0];
  assert.equal(C.pickTextColour(px([...Array(10).fill(bright)])).colour, "#111111");
  assert.equal(C.pickTextColour(px([...Array(4).fill(bright), ...Array(6).fill(clear)])).colour, "#ffffff");
  assert.equal(C.pickTextColour(px([...Array(6).fill(bright), ...Array(4).fill(clear)])).colour, "#111111", "a picture with a few clear pixels is still measured");
});

test("Apply to the other files: between videos the playback goes along and each keeps its own length; a picture takes neither", () => {
  const from = M.checkComposition({ v: 1, backdrop: { src: VID, play: "hold", sound: true, focus: [20, 30] }, duration: { mode: "media", seconds: 8 }, boxes: [{ id: "a", y: 10 }] }).value;
  const toVid = M.copyPlacement(from, VID2, { seconds: 3.1 });
  assert.deepEqual(toVid.backdrop, { src: VID2, fit: "cover", focus: [50, 50], play: "hold", sound: true });
  assert.deepEqual(toVid.duration, { mode: "media", seconds: 4 });
  assert.equal(M.checkComposition(toVid, { src: VID2 }).ok, true);
  assert.deepEqual(M.copyPlacement(from, VID2).duration, { mode: "media", seconds: 8 }, "length unknown: the first video's");
  const toPic = M.copyPlacement(from, PNG);
  assert.deepEqual(toPic.backdrop, { src: PNG, fit: "cover", focus: [50, 50] });
  assert.equal("duration" in toPic, false);
  assert.equal(M.checkComposition(toPic, { src: PNG }).ok, true);
  const fixed = M.checkComposition({ v: 1, backdrop: { src: PNG }, duration: { mode: "fixed", seconds: 9 }, boxes: [{ id: "a" }] }).value;
  assert.deepEqual(M.copyPlacement(fixed, VID).duration, { mode: "fixed", seconds: 9 });
  assert.equal(M.copyPlacement(fixed, VID).backdrop.play, undefined, "a picture gives no playback: the video loops (the engine's default)");
});

const t = makeTranslator("fr", JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")));
const block = (value, compose) => ({ type: "adminForm", action: "save", fields: [{ name: "variants", kind: "gallery", accept: ["image", "video"], max: 12, value, compose: O.composeOption(compose) }] });

test("gallery: videos get Place the text only when the module asks for it (`video: true`); an older module keeps pictures only", () => {
  assert.equal(O.composeOption({ video: true }).video, true);
  assert.equal("video" in O.composeOption({ video: "yes" }), false);
  const value = JSON.stringify([{ src: PNG }, { src: VID, compose: M.defaultVideoComposition(VID, { seconds: 2 }) }]);
  const withVideo = block(value, { variables: [{ token: "name", label: "Pseudo", sample: "etoile_nord" }], video: true });
  const html = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i", block: withVideo, labels: formLabels(t, "fr", withVideo) }));
  assert.equal((html.match(/data-gallery-compose=/g) ?? []).length, 2);
  assert.equal((html.match(/data-gallery-with-text/g) ?? []).length, 1, "the video's placement is kept and shown");
  const older = block(value, { variables: [{ token: "name", label: "Pseudo", sample: "etoile_nord" }] });
  const html2 = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i", block: older, labels: formLabels(t, "fr", older) }));
  assert.equal((html2.match(/data-gallery-compose=/g) ?? []).length, 1, "the picture only");
});

test("texts of the video controls: FR and EN parity, short, no code words, no exclamation", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of ["compose.play", "compose.stop", "compose.listen", "compose.f.play", "compose.play.loop", "compose.play.once", "compose.play.hold", "compose.f.sound", "compose.f.duration", "compose.duration.media", "compose.duration.fixed", "compose.f.seconds", "compose.secondsRange", "compose.loadingVideo", "compose.videoHeavy"]) {
    assert.ok(fr[k] && en[k], k);
    assert.ok(fr[k].length <= 60 && en[k].length <= 60 && !fr[k].endsWith(":"), k);
    assert.deepEqual((fr[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), k);
  }
  for (const k of ["compose.playHelp", "compose.playKindHelp", "compose.videoHeavyHelp"]) assert.doesNotMatch(fr[k], /!|\b(JSON|API|cache)\b/, k);
});

/* ───────────── the engine in a real Chromium, with real video files ───────────── */

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";
const FILES = { [VID]: fs.readFileSync("tests/fixtures/media/compose-alpha-vp9.webm"), [VID2]: fs.readFileSync("tests/fixtures/media/compose-sound-vp9.webm") };

test("real browser: a transparent WebM stays transparent, once and hold, one video at a time, the next one loaded ahead, a refused sound plays muted", { skip: skipBrowser, timeout: 90000 }, async () => {
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#a,#b{position:relative;width:320px;height:180px}${R.COMPOSE_CSS}</style>
    <div id="a"></div><div id="b"></div><script>${R.composeScript()}</script>`;
  const server = http.createServer((req, res) => {
    const f = FILES[req.url];
    if (f) {
      // ranges, as a real site serves media
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      res.setHeader("content-type", "video/webm"); res.setHeader("accept-ranges", "bytes");
      if (m) { const s = Number(m[1]), e = m[2] ? Number(m[2]) : f.length - 1; res.statusCode = 206; res.setHeader("content-range", `bytes ${s}-${e}/${f.length}`); return res.end(f.subarray(s, e + 1)); }
      return res.end(f);
    }
    res.setHeader("content-type", "text/html; charset=utf-8"); res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const p = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    const comp = (src, backdrop, duration) => M.resolveComposition(M.checkComposition({ v: 1, format: "16:9", backdrop: { src, ...backdrop }, ...(duration ? { duration } : {}), boxes: [{ id: "a", look: "bare", y: 5, h: 20 }] }).value, { phrase: "Merci etoile_nord" });
    // 1. transparency: the bottom half of the alpha video is see-through, its top half is opaque (left red, right green)
    const alpha = await p.evaluate(async (c) => {
      const root = window.CuriosaCompose.mount(document.getElementById("a"), c, { motion: false });
      const v = root.querySelector("video");
      await new Promise((ok) => { if (v.readyState >= 2) ok(); else v.addEventListener("loadeddata", ok, { once: true }); });
      const cv = document.createElement("canvas"); cv.width = 160; cv.height = 90;
      const g = cv.getContext("2d"); g.drawImage(v, 0, 0);
      const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
      return { top: px(40, 10), bottomL: px(40, 80), bottomR: px(120, 80), playing: !v.paused, muted: v.muted, loop: v.loop, kind: root.dataset.backdrop };
    }, comp(VID, { play: "loop" }));
    assert.equal(alpha.kind, "video");
    assert.ok(alpha.top[3] > 240 && alpha.top[0] > 200, `opaque red at the top: ${alpha.top}`);
    assert.ok(alpha.bottomL[3] < 16 && alpha.bottomR[3] < 16, `transparent at the bottom: ${alpha.bottomL} ${alpha.bottomR}`);
    assert.equal(alpha.playing, true); assert.equal(alpha.muted, true); assert.equal(alpha.loop, true);
    // the page itself shows through: a screenshot without background keeps the alpha under the video
    const shot = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 320, height: 180 } });
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.ok(at(80, 30) > 240, "opaque part painted");
    assert.ok(at(80, 160) < 16 && at(240, 160) < 16, `transparent part shows the page: ${at(80, 160)} ${at(240, 160)}`);

    // 2. one video at a time: a second one stops the first and frees its decoder
    const one = await p.evaluate(async (c) => {
      const first = document.querySelector('#a [data-ov-region="composition"] video');
      window.CuriosaCompose.mount(document.getElementById("b"), c, { motion: false });
      await new Promise((ok) => setTimeout(ok, 300));
      return { firstSrc: first.getAttribute("src"), firstPaused: first.paused, playing: [...document.querySelectorAll("video")].filter((v) => !v.paused).length };
    }, comp(VID2, { play: "loop" }));
    assert.equal(one.firstSrc, null); assert.equal(one.firstPaused, true); assert.equal(one.playing, 1);

    // 3. a sound that the browser refuses to start plays muted rather than not at all. Headless Chromium never refuses (whatever --autoplay-policy says, checked
    // by hand), so play() refuses here exactly as a browser with the autoplay rule does: a NotAllowedError for a video with sound, the real play() when muted.
    const snd = await p.evaluate(async (c) => {
      const real = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { return this.muted ? real.call(this) : Promise.reject(new DOMException("play() needs a gesture", "NotAllowedError")); };
      const host = document.getElementById("b"); host.replaceChildren();
      const root = window.CuriosaCompose.mount(host, c, { motion: false });
      const v = root.querySelector("video");
      await new Promise((ok) => setTimeout(ok, 800));
      HTMLMediaElement.prototype.play = real;
      return { muted: v.muted, paused: v.paused, flag: root.getAttribute("data-muted") };
    }, comp(VID2, { play: "loop", sound: true }));
    assert.deepEqual(snd, { muted: true, paused: false, flag: "autoplay" });

    // 4. once (a chosen length longer than the video): the video goes at its end, the text stays; hold: the last picture stays
    const ends = await p.evaluate(async ([once, hold]) => {
      const E = window.CuriosaCompose, a = document.getElementById("a"), b = document.getElementById("b");
      a.replaceChildren(); b.replaceChildren();
      const r1 = E.mount(a, once, { motion: false });
      await new Promise((ok) => r1.querySelector("video").addEventListener("ended", ok, { once: true }));
      await new Promise((ok) => setTimeout(ok, 50));
      const v1 = r1.querySelector("video"), out = { onceHidden: v1.style.visibility, onceText: r1.querySelector(".cmp-box") !== null, onceLoop: v1.loop };
      const r2 = E.mount(b, hold, { motion: false });
      const v2 = r2.querySelector("video");
      await new Promise((ok) => v2.addEventListener("ended", ok, { once: true }));
      return { ...out, holdVisible: v2.style.visibility, holdAtEnd: v2.currentTime >= v2.duration - 0.15, holdLoop: v2.loop };
    }, [comp(VID, { play: "once" }, { mode: "fixed", seconds: 5 }), comp(VID, { play: "hold" }, { mode: "media", seconds: 2 })]);
    assert.deepEqual(ends, { onceHidden: "hidden", onceText: true, onceLoop: false, holdVisible: "", holdAtEnd: true, holdLoop: false });

    // 5. the next alert loaded ahead: the same element is used, already buffered, and only one is loaded at a time
    const pre = await p.evaluate(async ([c1, c2]) => {
      const E = window.CuriosaCompose, a = document.getElementById("a");
      a.replaceChildren();
      E.preload(c2); E.preload(c1);   // the second call replaces the first
      await new Promise((ok) => setTimeout(ok, 800));
      const root = E.build(c1, {});
      const v = root.querySelector("video");
      const ready = v.readyState;
      const again = E.build(c1, {}).querySelector("video");
      return { ready, reusedOnce: v !== again, preloaded: v.dataset !== undefined };
    }, [comp(VID2, { play: "loop" }), comp(VID, { play: "loop" })]);
    assert.ok(pre.ready >= 2, `buffered before it shows: readyState ${pre.ready}`);
    assert.equal(pre.reusedOnce, true, "the element loaded ahead serves once");
    if (process.env.COMPOSE_SHOTS) await p.screenshot({ path: `${process.env.COMPOSE_SHOTS}/engine-video.png` });
  } finally { await browser.close(); server.close(); }
});
