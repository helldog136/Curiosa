import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeTempDir } from "../helpers/tmp.mjs";
import * as F from "../helpers/audio-fixtures.mjs";

const dir = makeTempDir("curiosa-audio-");
process.env.DATA_DIR = dir;
const U = await import("@/core/services/uploads");
const { GET } = await import("../../src/app/uploads/[name]/route.ts");
const { checkFieldInput } = await import("@/core/modules/settingValues");

const GOOD = {
  ogg: [["vorbis", F.oggVorbis()], ["opus", F.oggOpus()]],
  mp3: [["raw frames", F.mp3Raw()], ["ID3v2 + frames", F.mp3WithId3()], ["single frame", F.mp3Frame()], ["ID3v1 trailer", Buffer.concat([F.mp3Raw(2), Buffer.from("TAG" + "\0".repeat(125), "latin1")])]],
  wav: [["PCM 16", F.wav()], ["float", F.wav({ format: 3, bits: 32 })], ["stereo 44.1", F.wav({ channels: 2, rate: 44100 })]],
  m4a: [["M4A, moov first", F.m4a()], ["M4A, moov last", F.m4a({ moovFirst: false })], ["M4B", F.m4a({ brand: "M4B " })]],
  aac: [["ADTS 3 frames", F.aacAdts()], ["ADTS single frame", F.adtsFrame()]],
};

test("audio: every accepted format is recognised by its content", () => {
  for (const [kind, list] of Object.entries(GOOD)) for (const [label, buf] of list) assert.equal(U.sniffAudio(buf), kind, `${kind} ${label}`);
});

test("audio: the extension of a stored file comes from the content, never from a name", async () => {
  for (const [kind, list] of Object.entries(GOOD)) {
    const url = await U.saveUpload(list[0][1]);
    assert.match(url, new RegExp(`^/uploads/[0-9a-f-]{36}\\.${kind}$`), kind);
    assert.ok(U.UPLOAD_NAME_RE.test(url.slice(9)));
    assert.match(url, U.AUDIO_URL_RE);
  }
});

test("audio: refused when it is not audio (text, scripts, images, video, zeros, random bytes)", () => {
  const refused = {
    html: Buffer.from("<html><script>alert(1)</script></html>" + " ".repeat(40)),
    svg: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>" + " ".repeat(40)),
    php: Buffer.from("<?php echo 1; ?>" + " ".repeat(60)),
    zeros: Buffer.alloc(2048),
    png: F.PNG,
    mp4Video: F.MP4_VIDEO,
    webm: F.WEBM,
    theora: F.oggTheora(),
    short: Buffer.from("OggS"),
    empty: Buffer.alloc(0),
    jpegHeader: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 0x55)]),
  };
  for (const [name, buf] of Object.entries(refused)) assert.equal(U.sniffAudio(buf), null, name);
});

test("audio: spoofed and polyglot files are refused", () => {
  // A script that only begins with a plausible header.
  assert.equal(U.sniffAudio(Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x10", "latin1"), Buffer.from("<script>alert(1)</script>")])), null, "ID3 then text");
  assert.equal(U.sniffAudio(Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WAVE<script>alert(1)</script>"), Buffer.alloc(60)])), null, "RIFF WAVE without fmt/data");
  assert.equal(U.sniffAudio(Buffer.concat([Buffer.from("OggS\0\x02", "latin1"), Buffer.alloc(40, 0x41)])), null, "OggS with no valid page");
  assert.equal(U.sniffAudio(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.from("<script>alert(1)</script>".repeat(30))])), null, "frame sync then text");
  assert.equal(U.sniffAudio(Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.from("<script>alert(1)</script>".repeat(30))])), null, "adts sync then text");
  // A WebP image is also RIFF.
  const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(40)]);
  assert.equal(U.sniffAudio(webp), null, "webp is not wav");
  assert.equal(U.sniffImage(webp), "webp");
  // An audio brand never makes a video, and a video brand never makes audio.
  assert.equal(U.sniffVideo(F.m4a()), null);
  assert.equal(U.sniffAudio(F.MP4_VIDEO), null);
  assert.equal(U.sniffVideo(F.MP4_VIDEO), "mp4");
  // An image whose tail looks like audio is still an image (checked first), and a sound never becomes an image.
  assert.equal(U.sniffImage(F.mp3WithId3()), null);
});

test("audio: truncated files are refused", () => {
  const cuts = {
    "ogg: first page cut": F.oggVorbis().subarray(0, 40),
    "ogg: header only": F.oggVorbis().subarray(0, 27),
    "mp3: frame cut": F.mp3Raw().subarray(0, 300),
    "mp3: tag cut": F.mp3WithId3().subarray(0, 30),
    "mp3: tag and nothing else": F.id3(),
    "wav: declared size not reached": F.wav().subarray(0, 60),
    "wav: no data chunk": F.wav().subarray(0, 36),
    "m4a: no moov (mdat first, cut)": F.m4a({ moovFirst: false }).subarray(0, 100),
    "m4a: moov cut": F.m4a().subarray(0, 60),
    "m4a: ftyp alone": F.m4a().subarray(0, 28),
    "aac: first frame cut": F.aacAdts().subarray(0, 60),
  };
  for (const [name, buf] of Object.entries(cuts)) assert.equal(U.sniffAudio(buf), null, name);
});

test("audio: nonsense inside a valid container is refused (bad mp3 frame header, odd wav format, second frame is junk)", () => {
  const badBitrate = F.mp3Raw(); badBitrate[2] = 0xf0;
  assert.equal(U.sniffAudio(badBitrate), null, "bitrate index 15");
  const reserved = F.mp3Raw(); reserved[1] = 0xe9; // version bits 01
  assert.equal(U.sniffAudio(reserved), null, "reserved version");
  const junkSecond = Buffer.concat([F.mp3Frame(), Buffer.alloc(100, 0x41)]);
  assert.equal(U.sniffAudio(junkSecond), null, "second frame not a frame");
  assert.equal(U.sniffAudio(F.wav({ format: 85 })), null, "unsupported wav tag");
  assert.equal(U.sniffAudio(F.wav({ channels: 0 })), null, "zero channels");
  assert.equal(U.sniffAudio(F.wav({ rate: 5 })), null, "absurd rate");
  const adtsDifferentRate = Buffer.concat([F.adtsFrame(), F.adtsFrame()]); adtsDifferentRate[100 + 2] = 0x40;
  assert.equal(U.sniffAudio(adtsDifferentRate), null, "adts rate changes");
});

test("audio: size cap (10 MB) is enforced and separate from images (5 MB) and videos (50 MB)", async () => {
  assert.equal(U.MAX_AUDIO_BYTES, 10 * 1024 * 1024);
  const frames = Math.ceil(U.MAX_AUDIO_BYTES / 417) + 1;
  const big = F.mp3Raw(frames);
  assert.ok(big.length > U.MAX_AUDIO_BYTES);
  assert.equal(U.sniffAudio(big), "mp3");
  assert.equal(await U.saveUpload(big), null, "over the cap");
  const ok = F.mp3Raw(Math.floor(U.MAX_AUDIO_BYTES / 417) - 1);
  assert.ok(ok.length <= U.MAX_AUDIO_BYTES);
  assert.match(await U.saveUpload(ok), /\.mp3$/);
});

test("audio: only:'audio' keeps images and videos out of a sound field", async () => {
  assert.equal(await U.saveUpload(F.PNG, { only: "audio" }), null);
  assert.equal(await U.saveUpload(F.MP4_VIDEO, { only: "audio" }), null);
  assert.equal(await U.saveUpload(F.WEBM, { only: "audio" }), null);
  assert.match(await U.saveUpload(F.wav(), { only: "audio" }), /\.wav$/);
});

test("audio: content types", () => {
  assert.equal(U.mimeFor("x.mp3"), "audio/mpeg");
  assert.equal(U.mimeFor("x.ogg"), "audio/ogg");
  assert.equal(U.mimeFor("x.wav"), "audio/wav");
  assert.equal(U.mimeFor("x.m4a"), "audio/mp4");
  assert.equal(U.mimeFor("x.aac"), "audio/aac");
  assert.equal(U.mimeFor("x.mp3.exe"), "application/octet-stream");
  assert.ok(U.isAudioName("a.mp3") && !U.isAudioName("a.png") && !U.isAudioName("a.mp4"));
});

test("audio: served with the right type, nosniff, ranges, no cross-type confusion", async () => {
  for (const [kind, mime] of [["mp3", "audio/mpeg"], ["ogg", "audio/ogg"], ["wav", "audio/wav"], ["m4a", "audio/mp4"], ["aac", "audio/aac"]]) {
    const buf = GOOD[kind][0][1];
    const name = (await U.saveUpload(buf)).slice(9);
    const call = (headers = {}) => GET(new Request("http://x/uploads/" + name, { headers }), { params: Promise.resolve({ name }) });
    const full = await call();
    assert.equal(full.status, 200, kind);
    assert.equal(full.headers.get("content-type"), mime, kind);
    assert.equal(full.headers.get("x-content-type-options"), "nosniff");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-length"), String(buf.length));
    assert.match(full.headers.get("cache-control"), /immutable/);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), buf);
    const part = await call({ range: "bytes=0-3" });
    assert.equal(part.status, 206, kind);
    assert.equal(part.headers.get("content-range"), `bytes 0-3/${buf.length}`);
    assert.equal(part.headers.get("content-type"), mime);
    assert.equal((await call({ range: `bytes=${buf.length + 9}-` })).status, 416);
  }
  assert.equal((await GET(new Request("http://x/"), { params: Promise.resolve({ name: "../x.mp3" }) })).status, 404);
  assert.equal((await GET(new Request("http://x/"), { params: Promise.resolve({ name: "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.flac" }) })).status, 404);
});

test("audio: a module setting of type 'audio' accepts only a sound of the site", () => {
  const field = { key: "sound", type: "audio" };
  for (const ok of ["mp3", "ogg", "wav", "m4a", "aac"]) assert.deepEqual(checkFieldInput(field, `/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.${ok}`), { ok: true, value: `/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.${ok}` });
  for (const bad of ["https://example.org/a.mp3", "//evil/a.mp3", "/uploads/../x.mp3", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp4", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp3?x=1", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp3#a", "javascript:alert(1)", "/uploads/x.mp3", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.MP3"]) {
    assert.deepEqual(checkFieldInput(field, bad), { ok: false, reason: "audio" }, bad);
  }
});

test("audio: wiring (manifest schema, form field, admin preview, upload route, file claims)", async () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/core/modules/manifest.ts"), /"video", "audio", "choice"/);
  assert.match(read("src/core/modules/types.ts"), /"video" \| "audio"/);
  assert.match(read("src/core/blocks.ts"), /\| "audio"/);
  assert.match(read("src/components/admin/AdminBlocks.tsx"), /f\.kind === "audio"[\s\S]*kind="audio"/);
  assert.match(read("src/components/admin/ModuleSettings.tsx"), /case "audio"[\s\S]*kind="audio"/);
  const field = read("src/components/admin/ImageField.tsx");
  assert.match(field, /<audio src=\{value\} controls preload="none" aria-label=\{label\}/, "native preview with a text label");
  assert.match(read("src/app/api/admin/upload/route.ts"), /only: "audio"/);
  // ctx.api.files can claim and remove sounds: the name test accepts them.
  const { uploadNameOf } = await import("@/core/services/files");
  assert.equal(uploadNameOf("/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.ogg"), "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.ogg");
  assert.equal(uploadNameOf("/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.flac"), null);
});

test("audio: the MCP media_upload tool is unchanged (images only)", async () => {
  const { storeCheckedImage } = await import("@/core/mediaMcp");
  await assert.rejects(() => storeCheckedImage(F.mp3WithId3(), "upload"), /not a png, jpeg, webp or gif/);
});
