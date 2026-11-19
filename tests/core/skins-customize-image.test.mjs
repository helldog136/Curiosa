// Skin customization, pictures (docs/SKINS.md "Customization", "Pictures"): what an owner uploads becomes ONE file made by the core. EXIF and GPS gone, orientation applied,
// cropped to the slot's shape around the focal point, bombs and hidden data refused, animations allowed (and given a still), SVG rewritten from recognised parts.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const sharp = (await import("sharp")).default;
const I = await import("@/core/skins/customizeImage");

const rule = (extra = {}) => ({ formats: ["png", "jpg", "webp", "gif", "svg"], maxKb: 300, ratio: [16, 3], ratioTolerance: 0.03, minPx: [640, 120], maxPx: [1920, 360], focal: true, animated: true, ...extra });
const solid = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
const meta = async (buf, opts = {}) => sharp(buf, opts).metadata();
const chunk = (type, data) => {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(I.crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};
const chunksOf = (png) => { const out = []; for (let at = 8; at + 12 <= png.length;) { const len = png.readUInt32BE(at); out.push(png.toString("latin1", at + 4, at + 8)); at += 12 + len; } return out; };
/** A real animated PNG of `n` frames: a normal PNG, with an animation control chunk, frame control chunks and frame data. */
async function apng(w, h, n, { extra = [], trailing = Buffer.alloc(0) } = {}) {
  const base = await solid(w, h, "#335577").png().toBuffer();
  const parts = [];
  for (let at = 8; at + 12 <= base.length;) { const len = base.readUInt32BE(at); parts.push({ type: base.toString("latin1", at + 4, at + 8), data: base.subarray(at + 8, at + 8 + len) }); at += 12 + len; }
  const ihdr = parts.find((p) => p.type === "IHDR"), idat = parts.filter((p) => p.type === "IDAT");
  const fctl = (seq) => { const d = Buffer.alloc(26); d.writeUInt32BE(seq, 0); d.writeUInt32BE(w, 4); d.writeUInt32BE(h, 8); d.writeUInt16BE(10, 20); d.writeUInt16BE(100, 22); return chunk("fcTL", d); };
  const actl = Buffer.alloc(8); actl.writeUInt32BE(n, 0);
  const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr.data), chunk("acTL", actl), ...extra, fctl(0), ...idat.map((p) => chunk("IDAT", p.data))];
  for (let i = 1; i < n; i++) { out.push(fctl(2 * i - 1)); for (const p of idat) out.push(chunk("fdAT", Buffer.concat([Buffer.from([0, 0, 0, 2 * i]), p.data]))); }
  out.push(chunk("IEND", Buffer.alloc(0)), trailing);
  return Buffer.concat(out);
}

test("a photo: EXIF, GPS and every piece of metadata are gone; the file is a WebP made by the core", async () => {
  const jpg = await solid(1600, 300, "#336699").jpeg().withExif({ IFD0: { ImageDescription: "SECRET-LOCATION-42", Copyright: "secret-owner" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 28/1 38/1" } }).toBuffer();
  assert.ok(jpg.includes("SECRET-LOCATION-42"), "the fixture carries a secret");
  const r = await I.processPicture(jpg, rule());
  assert.equal(r.ok, true);
  assert.equal(r.ext, "webp");
  assert.ok(!r.main.includes("SECRET") && !r.main.includes("secret-owner") && !r.main.includes("GPS"), "nothing of the metadata survives");
  const m = await meta(r.main);
  assert.equal(m.exif, undefined);
  assert.equal(m.xmp, undefined);
  assert.equal(m.format, "webp");
  assert.ok(r.main.length <= 300 * 1024);
  assert.ok(r.lum && r.lum[0] <= r.lum[1], "the luminance of the picture is measured for the legibility signal");
});

test("the EXIF orientation is applied before the shape is checked (a phone photo turned on its side)", async () => {
  const turned = await solid(300, 1600, "#336699").jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const r = await I.processPicture(turned, rule());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Math.abs(r.width / r.height - 16 / 3) < 0.05, `${r.width}x${r.height}`);
});

test("the crop follows the focal point and the result has the slot's shape and never goes above its largest size", async () => {
  const tall = await solid(1000, 1000, "#ff0000").composite([{ input: await solid(1000, 500, "#0000ff").png().toBuffer(), top: 500, left: 0 }]).png().toBuffer();
  const px = async (fy) => { const r = await I.processPicture(tall, rule(), { focal: { x: 0.5, y: fy } }); assert.equal(r.ok, true); assert.ok(Math.abs(r.width / r.height - 16 / 3) < 0.03); return [r, (await sharp(r.main).raw().toBuffer()).subarray(0, 3)]; };
  assert.deepEqual([...(await px(0))[1]], [255, 0, 0], "top of the picture");
  assert.deepEqual([...(await px(1))[1]], [0, 0, 255], "bottom of the picture");
  const big = await solid(4000, 750, "#abcdef").png().toBuffer();
  const r = await I.processPicture(big, rule());
  assert.equal(r.ok, true);
  assert.ok(r.width <= 1920 && r.height <= 360, `${r.width}x${r.height}`);
});

test("refusals: not a picture, a format the slot does not take, a hidden archive, an empty file, too heavy a file", async () => {
  assert.equal((await I.processPicture(Buffer.from("just some text, not a picture at all"), rule())).code, "format");
  assert.equal((await I.processPicture(Buffer.alloc(0), rule())).code, "format");
  assert.equal((await I.processPicture(Buffer.from("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000"), rule())).code, "format", "an executable");
  const png = await solid(1600, 300, "#336699").png().toBuffer();
  const r = await I.processPicture(png, rule({ formats: ["webp"] }));
  assert.equal(r.code, "format");
  assert.match(r.detail.allowed, /webp/);
  const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 1)]);
  assert.equal((await I.processPicture(big, rule())).code, "toolarge");
  const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  assert.equal((await I.processPicture(garbage, rule())).code, "unreadable", "a header with nothing behind it");
});

test("a polyglot (a PNG with an archive after it) is rewritten: nothing after the end of the image survives", async () => {
  const png = await solid(1600, 300, "#336699").png().toBuffer();
  const zip = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.from("HIDDEN-PAYLOAD".repeat(20))]);
  const r = await I.processPicture(Buffer.concat([png, zip]), rule());
  assert.equal(r.ok, true);
  assert.ok(!r.main.includes("HIDDEN-PAYLOAD"));
  assert.ok(!r.main.includes("PK\u0003\u0004"));
});

test("a decompression bomb is refused by its header, before anything is decoded", async () => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(30000, 0); ihdr.writeUInt32BE(30000, 4); ihdr[8] = 8; ihdr[9] = 2;
  const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(bomb.length < 1000);
  const t0 = Date.now();
  const r = await I.processPicture(bomb, rule());
  assert.equal(r.code, "pixels");
  assert.ok(Date.now() - t0 < 5000, "answered at once");
  // 40 million pixels is the cap; just under it passes the header check (and then fails to decode for lack of data, not for size)
  const ihdr2 = Buffer.alloc(13); ihdr2.writeUInt32BE(6300, 0); ihdr2.writeUInt32BE(6300, 4); ihdr2[8] = 8; ihdr2[9] = 2;
  const edge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr2), chunk("IDAT", zlib.deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0))]);
  assert.notEqual((await I.processPicture(edge, rule())).code, "pixels");
});

test("a picture that is too small says its size and the size needed; one that cannot be made light enough says so", async () => {
  const small = await solid(300, 56, "#336699").png().toBuffer();
  const r = await I.processPicture(small, rule());
  assert.equal(r.code, "small");
  assert.deepEqual([r.detail.got, r.detail.need], [300, 640]);
  const noise = await sharp(Buffer.from(Array.from({ length: 1920 * 360 * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: 1920, height: 360, channels: 3 } }).png().toBuffer();
  const heavy = await I.processPicture(noise, rule({ maxKb: 5, maxPx: [1920, 360], minPx: [1000, 188] }));
  assert.equal(heavy.code, "heavy");
});

test("animations are allowed: GIF and animated WebP keep their frames and get a still (the first frame) for reduced motion", async () => {
  const frames = await Promise.all(["#aa3333", "#33aa33", "#3333aa"].map((c) => solid(800, 150, c).png().toBuffer()));
  const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
  const r = await I.processPicture(gif, rule());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ext, "webp");
  assert.equal(r.frames, 3);
  assert.equal((await meta(r.main, { animated: true })).pages, 3, "still animated");
  assert.ok(r.still, "a still is made");
  assert.equal((await meta(r.still, { animated: true })).pages ?? 1, 1);
  assert.deepEqual([...(await sharp(r.still).raw().toBuffer()).subarray(0, 3)].map((v) => Math.round(v / 10)), [17, 5, 5], "the still is the FIRST frame");
  const webp = await sharp(frames, { join: { animated: true } }).webp({ delay: [100, 100, 100], loop: 0 }).toBuffer();
  assert.equal((await I.processPicture(webp, rule())).frames, 3);
  // an animation is never cropped: it must already have the slot's shape
  const wrong = await sharp(await Promise.all(["#aa3333", "#33aa33"].map((c) => solid(800, 800, c).png().toBuffer())), { join: { animated: true } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await I.processPicture(wrong, rule())).code, "ratio");
  // a slot may forbid animations
  assert.equal((await I.processPicture(gif, rule({ animated: false }))).code, "animation");
  // frames are capped
  const many = await sharp(await Promise.all(Array.from({ length: 101 }, (_, i) => solid(64, 12, { r: i * 2, g: 255 - i * 2, b: i % 7 * 30 }).png().toBuffer())), { join: { animated: true } }).gif({ delay: Array(101).fill(40), loop: 0 }).toBuffer();
  assert.equal((await I.processPicture(many, rule({ minPx: [64, 12], maxPx: [64, 12], ratio: [16, 3] }))).code, "frames");
});

test("an animated PNG keeps its animation, loses its text chunks and everything after its end", async () => {
  const dirty = await apng(800, 150, 2, { extra: [chunk("tEXt", Buffer.from("Comment\0SECRET-APNG-TEXT")), chunk("eXIf", Buffer.from("SECRET-APNG-EXIF"))], trailing: Buffer.from("TRAILING-SECRET") });
  assert.ok(dirty.includes("SECRET-APNG-TEXT") && dirty.includes("TRAILING-SECRET"));
  const r = await I.processPicture(dirty, rule({ formats: ["png"] }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ext, "png");
  assert.equal(r.frames, 2);
  assert.ok(!r.main.includes("SECRET") && !r.main.includes("TRAILING"));
  assert.ok(chunksOf(r.main).includes("acTL") && chunksOf(r.main).includes("fdAT"));
  assert.ok(chunksOf(r.main).every((t) => ["IHDR", "PLTE", "tRNS", "acTL", "fcTL", "fdAT", "IDAT", "IEND"].includes(t)));
  assert.ok(r.still, "its first frame is the still");
  assert.equal((await I.processPicture(dirty, rule({ formats: ["png"], animated: false }))).code, "animation");
});

test("PNG chunks: a bad checksum, a missing end, a first chunk that is not the header are all refused", async () => {
  const png = await solid(1600, 300, "#336699").png().toBuffer();
  const flipped = Buffer.from(png); flipped[40] ^= 0xff;
  assert.equal((await I.processPicture(flipped, rule({ formats: ["png"] }))).code, "unreadable");
  assert.equal((await I.processPicture(png.subarray(0, png.length - 12), rule({ formats: ["png"] }))).code, "unreadable", "no end chunk");
  assert.equal(I.rewritePng(Buffer.from("not a png")).ok, false);
});

test("an SVG is rewritten from what is recognised; a script, a style, an outside link or a wrong shape is refused", async () => {
  const slot = rule({ formats: ["svg"], ratio: [36, 46], ratioTolerance: 0.05, maxKb: 100 });
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><path d="M3 3H33V22L18 43L3 22Z" fill="#2d4fb0"/></svg>';
  const r = await I.processPicture(Buffer.from(good), slot);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ext, "svg");
  assert.match(r.main.toString(), /^<svg/);
  const bad0 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><script>alert(1)</script></svg>';
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><path d="M0 0" onload="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><style>*{display:none}</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><image href="https://x.example/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><foreignObject><div/></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 46"><use href="https://x.example/s.svg#a"/></svg>',
  ]) assert.ok(["svg", "format"].includes((await I.processPicture(Buffer.from(bad), slot)).code), bad.slice(0, 80));
  assert.equal((await I.processPicture(Buffer.from(bad0), slot)).code, "svg");
  assert.equal((await I.processPicture(Buffer.from(good.replace("0 0 36 46", "0 0 100 10")), slot)).code, "ratio");
  assert.equal((await I.processPicture(Buffer.from(good), rule({ formats: ["png"] }))).code, "format", "an SVG where the slot takes none");
  assert.equal((await I.processPicture(Buffer.from(good + " ".repeat(120 * 1024)), slot)).code, "svg", "over the slot's weight");
});
