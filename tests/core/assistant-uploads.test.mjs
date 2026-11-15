// Assistant uploads (core 0.18.0): a module's MCP action that declares `uploads: true` receives a file from an AI assistant through ctx.api.files.upload.
// Real files made with ffmpeg (tests/fixtures/media), the real database, the real staging folder and the real route function.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const U = await import("@/core/services/assistantUploads");
const C = await import("@/core/services/assistantUploadCheck");
const P = await import("@/core/mediaProbe");
const F = await import("@/core/services/files");
const { UPLOADS_DIR } = await import("@/core/config");
const { makeApi } = await import("@/core/modules/api");
const { parseManifest } = await import("@/core/modules/manifest");
const { toolGrantedByDefault } = await import("@/core/modules/mcpProvider");
const { placementOf } = await import("@/core/services/mcp/profiles");
const { resetAllSlots } = await import("@/core/maintenance/slots");

const FIX = path.resolve(import.meta.dirname, "../fixtures/media");
const media = (n) => fs.readFileSync(path.join(FIX, n));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const WHO = { tokenId: "tok-1", tokenName: "Studio" };
const OTHER_WHO = { tokenId: "tok-2", tokenName: "Other" };
const OWNER = { moduleId: "alerts-overlay", instanceId: "i-a1", instanceKey: "alerts-1" };
const OTHER_OWNER = { moduleId: "alerts-overlay", instanceId: "i-a2", instanceKey: "alerts-2" };
let clock = Date.now();
U.deps.now = () => clock;

beforeEach(async () => {
  await db.reset(); resetAllSlots(); clock = Date.now();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); fs.rmSync(U.STAGING_DIR, { recursive: true, force: true });
});
after(() => db.close());

/** Sends a whole file through base64 pieces, like an assistant that can only call tools. */
async function viaPieces(buf, { who = WHO, owner = OWNER, accept = ["image", "video", "audio"], label = "Follow clip" } = {}) {
  const b = await U.beginUpload(who, owner, { bytes: buf.length, sha256: sha(buf), accept, label });
  assert.equal(b.ok, true, JSON.stringify(b));
  for (let i = 0; i < b.chunks; i++) {
    const r = await U.uploadChunk(who, owner, { upload: b.upload, index: i, data: buf.subarray(i * U.CHUNK_BYTES, (i + 1) * U.CHUNK_BYTES).toString("base64") });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  return b;
}
const ticketOf = (b) => b.putUrl.split("/").pop();
const stream = (buf) => new Blob([buf]).stream();

// ── The probe: real containers, polyglots, cut files ─────────────────────────────────────────────────────────────

test("probe: real webm (VP9, a recorder's VP8 without duration), mp4 (H.264+AAC) and GIF are read with their size and duration", () => {
  assert.deepEqual(P.probeWebm(media("tiny-vp9.webm")), { ok: true, container: "webm", width: 64, height: 36, durationSeconds: 1, video: "V_VP9", audio: null, alpha: false });
  assert.equal(P.probeWebm(media("alpha-vp9.webm")).alpha, true, "a transparent VP9 (AlphaMode 1)");
  const live = P.probeWebm(media("live-vp8.webm"));
  assert.equal(live.ok, true); assert.ok(live.durationSeconds > 1.5 && live.durationSeconds <= 2, String(live.durationSeconds));
  assert.deepEqual(P.probeMp4(media("tiny-h264.mp4")), { ok: true, container: "mp4", width: 64, height: 36, durationSeconds: 1, video: "avc1", audio: "mp4a", alpha: false });
  assert.deepEqual(P.probeGif(media("tiny.gif")), { ok: true, container: "gif", width: 64, height: 36, durationSeconds: 1, frames: 5 });
});

test("probe: a zip or a page glued behind a video, a GIF or a PNG (polyglot) is refused; so is a cut file, HEVC and a fragmented mp4", () => {
  const zip = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(60, 1)]);
  const html = Buffer.from("<script>alert(1)</script>");
  for (const [name, probe] of [["tiny-vp9.webm", P.probeWebm], ["tiny-h264.mp4", P.probeMp4], ["tiny.gif", P.probeGif]]) {
    for (const tail of [zip, html]) assert.equal(probe(Buffer.concat([media(name), tail])).ok, false, `${name} + tail`);
    const cut = media(name).subarray(0, Math.floor(media(name).length * 0.6));
    assert.equal(probe(cut).ok, false, `${name} cut`);
  }
  assert.equal(P.probeMp4(media("tiny-hevc.mp4")).problem, "codec");
  assert.match(P.probeMp4(media("frag.mp4")).detail, /fragmented/);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  assert.equal(P.imageTail(png, "png"), null);
  assert.equal(P.imageTail(Buffer.concat([png, zip]), "png").problem, "trailing");
});

test("check: kind from the bytes only, per-kind caps, 30 s and 1920x1080 at most, accepted kinds respected, messages say what to do", async () => {
  assert.equal((await C.checkAssistantFile(media("tiny-vp9.webm"), ["video"])).ext, "webm");
  assert.equal((await C.checkAssistantFile(media("tiny.mp3"), ["audio"])).kind, "audio");
  const notVideo = await C.checkAssistantFile(media("tiny.gif"), ["video"]);
  assert.equal(notVideo.reason, "type"); assert.match(notVideo.message, /only a video/);
  const long = await C.checkAssistantFile(media("long-vp8.webm"), ["video"]);
  assert.equal(long.reason, "probe"); assert.match(long.message, /lasts 40 s.*30 s at most.*ffmpeg -t 30/);
  const big = await C.checkAssistantFile(media("big-vp8.webm"), ["video"]);
  assert.match(big.message, /2560x1440.*scale=1280:-2/);
  const text = await C.checkAssistantFile(Buffer.from("#!/bin/sh\nrm -rf /\n".repeat(10)), ["video", "image", "audio"]);
  assert.equal(text.reason, "type");
});

// ── The service: begin, pieces, finish ───────────────────────────────────────────────────────────────────────────

test("happy path through base64 pieces: the file is stored under a random name, already OWNED by the instance, audited with the access name", async () => {
  const buf = media("tiny-vp9.webm");
  const b = await viaPieces(buf);
  assert.equal(b.chunkBytes, 700_000); assert.ok(b.putUrl.startsWith("http")); assert.match(b.expiresAt, /^\d{4}-/);
  const done = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  assert.equal(done.ok, true); assert.equal(done.already, false);
  assert.match(done.url, /^\/uploads\/[0-9a-f-]{36}\.webm$/);
  assert.deepEqual([done.kind, done.width, done.height, done.durationSeconds, done.label, done.codec, done.alpha], ["video", 64, 36, 1, "Follow clip", "V_VP9", false]);
  assert.deepEqual(fs.readFileSync(path.join(UPLOADS_DIR, done.url.slice(9))), buf);
  const row = await db.prisma.uploadFile.findUnique({ where: { name: done.url.slice(9) } });
  assert.deepEqual([row.ownerInstance, row.ownerModule, row.uploaderId, row.bytes], ["i-a1", "alerts-overlay", "assistant:tok-1", buf.length]);
  assert.equal(await F.ownsFile(OWNER, done.url), true);
  const logs = await db.prisma.auditLog.findMany({ where: { action: "file.upload" } });
  assert.equal(logs.length, 1); assert.equal(logs[0].actor, "mcp:Studio"); assert.equal(logs[0].actorKind, "assistant");
  assert.match(logs[0].target, /^alerts-1: [0-9a-f-]{36}\.webm \d+ bytes video 64x36 1s "Follow clip"$/);
  assert.deepEqual(fs.readdirSync(U.STAGING_DIR).filter((n) => n.endsWith(".part")), [], "the staged bytes are gone");
  // the owner (the module) can delete it like any claimed file
  assert.deepEqual(await F.removeFile(OWNER, "admin@example.org", done.url), { ok: true, removed: true });
});

test("happy path through the one-time address (PUT, ?offset= parts), and mp4: the route only fills the slot, finish stores", async () => {
  const buf = media("tiny-h264.mp4");
  const b = await U.beginUpload(WHO, OWNER, { bytes: buf.length, sha256: sha(buf), accept: ["video"] });
  const half = 5000;
  let r = await U.receivePart(ticketOf(b), null, stream(buf.subarray(0, half)), half);
  assert.deepEqual([r.status, r.body.received, r.body.complete], [200, half, false]); assert.match(r.body.next, /offset=5000/);
  assert.equal((await db.prisma.uploadFile.count()), 0, "nothing stored by the route");
  r = await U.receivePart(ticketOf(b), String(half), stream(buf.subarray(half)), buf.length - half);
  assert.equal(r.body.complete, true);
  const done = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  assert.deepEqual([done.ok, done.type, done.codec], [true, "mp4", "avc1"]);
  // the address is single use: once finished it says so, it never writes again
  assert.equal((await U.receivePart(ticketOf(b), null, stream(buf), buf.length)).status, 409);
});

test("replay: finishing twice gives the SAME file (already), never a second file nor a second journal line", async () => {
  const b = await viaPieces(media("tiny.gif"), { accept: ["image"] });
  const one = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  const two = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  assert.equal(two.already, true); assert.equal(two.url, one.url);
  assert.equal(await db.prisma.uploadFile.count(), 1);
  assert.equal(await db.prisma.auditLog.count({ where: { action: "file.upload" } }), 1);
  assert.equal((await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: 0, data: "AAAA" })).reason, "invalid", "no piece after finish");
});

test("wrong sha256: refused, the received bytes are discarded and the same slot can be filled again", async () => {
  const buf = media("tiny-vp9.webm");
  const b = await U.beginUpload(WHO, OWNER, { bytes: buf.length, sha256: sha(Buffer.from("other")), accept: ["video"] });
  await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: 0, data: buf.toString("base64") });
  const r = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  assert.equal(r.reason, "hash"); assert.match(r.message, /send the file again from piece 0/);
  assert.equal((await U.finishUpload(WHO, OWNER, { upload: b.upload })).reason, "incomplete");
  assert.equal(await db.prisma.uploadFile.count(), 0);
});

test("pieces: in order, exact size except the last, never past the announced size; several pieces are joined", async () => {
  const buf = crypto.randomBytes(1_500_000);
  const b = await U.beginUpload(WHO, OWNER, { bytes: buf.length, sha256: sha(buf), accept: ["video"] });
  assert.equal(b.chunks, 3);
  const piece = (i) => buf.subarray(i * U.CHUNK_BYTES, (i + 1) * U.CHUNK_BYTES).toString("base64");
  assert.match((await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: 1, data: piece(1) })).message, /next piece starts at byte 0/);
  assert.match((await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: 0, data: buf.subarray(0, 10).toString("base64") })).message, /exactly 700000/);
  assert.equal((await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: 0, data: "data:video/webm;base64,AAAA" })).reason, "invalid");
  for (const i of [0, 1, 1, 2]) assert.equal((await U.uploadChunk(WHO, OWNER, { upload: b.upload, index: i, data: piece(i) })).ok, true, `piece ${i} (sent twice is fine)`);
  // random bytes: complete, right hash, but not a video
  const r = await U.finishUpload(WHO, OWNER, { upload: b.upload });
  assert.equal(r.reason, "type");
  const tooFar = await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: sha(Buffer.alloc(10)), accept: ["video"] });
  assert.equal((await U.uploadChunk(WHO, OWNER, { upload: tooFar.upload, index: 0, data: Buffer.alloc(20).toString("base64") })).reason, "size");
});

test("begin: size, sha256 and kinds are checked first; oversize per kind; 3 uploads open per access", async () => {
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 0, sha256: "a".repeat(64) })).reason, "invalid");
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "xyz" })).reason, "invalid");
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "a".repeat(64), accept: ["exe"] })).reason, "invalid");
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 26 * 1024 * 1024, sha256: "a".repeat(64), accept: ["video"] })).reason, "size");
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 6 * 1024 * 1024, sha256: "a".repeat(64), accept: ["image"] })).reason, "size");
  for (let i = 0; i < 3; i++) assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "a".repeat(64) })).ok, true);
  const fourth = await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "a".repeat(64) });
  assert.equal(fourth.reason, "busy");
  assert.equal((await U.beginUpload(OTHER_WHO, OWNER, { bytes: 10, sha256: "a".repeat(64) })).ok, true, "another access is counted apart");
});

test("an upload belongs to its access AND its instance: anyone else gets the same 'unknown' answer; bad ids never reach the disk", async () => {
  const b = await viaPieces(media("tiny-vp9.webm"));
  assert.equal((await U.finishUpload(OTHER_WHO, OWNER, { upload: b.upload })).reason, "unknown");
  assert.equal((await U.finishUpload(WHO, OTHER_OWNER, { upload: b.upload })).reason, "unknown");
  for (const bad of ["../../etc/passwd", `${b.upload}/../x`, b.upload.toUpperCase(), "", null, 42]) assert.equal((await U.finishUpload(WHO, OWNER, { upload: bad })).reason, "unknown");
  assert.equal((await U.finishUpload(WHO, OWNER, { upload: b.upload })).ok, true);
});

test("the one-time address: wrong secret, other slot, malformed or path-like tickets all answer the same 404; too many bytes 413; out of order 409", async () => {
  const buf = media("tiny-vp9.webm");
  const b = await U.beginUpload(WHO, OWNER, { bytes: buf.length, sha256: sha(buf) });
  const [id] = ticketOf(b).split(".");
  for (const t of [`${id}.${"A".repeat(43)}`, `${"0".repeat(32)}.${ticketOf(b).split(".")[1]}`, "../uploads", `${id}`, `${ticketOf(b)}x`]) {
    const r = await U.receivePart(t, null, stream(buf), buf.length);
    assert.equal(r.status, 404, t); assert.deepEqual(Object.keys(r.body), ["error"]);
  }
  assert.equal((await U.receivePart(ticketOf(b), null, stream(Buffer.concat([buf, buf])), null)).status, 413, "body bigger than announced, no length header");
  assert.equal((await U.receivePart(ticketOf(b), null, stream(buf), buf.length + 1)).status, 413);
  assert.equal((await U.receivePart(ticketOf(b), "100", stream(buf.subarray(100)), null)).status, 409);
  assert.equal((await U.receivePart(ticketOf(b), "-1", stream(buf), null)).status, 409);
});

test("expiry: after 30 minutes the slot answers 'expired' once, then is swept (bytes and description deleted); stray files are swept too", async () => {
  const b = await viaPieces(media("tiny-vp9.webm"));
  fs.writeFileSync(path.join(U.STAGING_DIR, "stray.tmp"), "x");
  clock += 31 * 60_000;
  assert.equal((await U.finishUpload(WHO, OWNER, { upload: b.upload })).reason, "unknown", "swept before it is read");
  assert.deepEqual(fs.readdirSync(U.STAGING_DIR), []);
  const c = await viaPieces(media("tiny-vp9.webm"));
  clock += 31 * 60_000;
  assert.equal((await U.uploadChunk(WHO, OWNER, { upload: c.upload, index: 0, data: "AAAA" })).reason, "expired");
});

test("quotas: the daily quota of the site (from the journal) and the module's quota stop new uploads with a plain message", async () => {
  await db.prisma.auditLog.createMany({ data: Array.from({ length: U.DAILY_FILES }, () => ({ actor: "mcp:x", actorKind: "assistant", action: "file.upload", target: "k: n 10 bytes" })) });
  const r = await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "a".repeat(64) });
  assert.equal(r.reason, "quota"); assert.match(r.message, /daily upload quota/);
  await db.prisma.auditLog.deleteMany({});
  for (let i = 0; i < 3; i++) await db.prisma.uploadFile.create({ data: { name: `${crypto.randomUUID()}.png`, bytes: 1_500_000_000, ownerModule: "alerts-overlay", ownerInstance: "i-a1" } });
  assert.equal((await U.beginUpload(WHO, OWNER, { bytes: 10, sha256: "a".repeat(64) })).reason, "quota");
});

test("labels are plain text: tags, quotes, slashes and control characters are removed", () => {
  assert.equal(U.cleanLabel(`../<img src=x onerror=alert(1)>"Raid"\u0000`), "img src x onerror alert 1 Raid");
  assert.equal(U.cleanLabel("C:\\clips\\follow.webm"), "follow.webm");
  assert.equal(U.cleanLabel("x".repeat(100)).length, 60);
});

// ── Who may: the module API, the manifest, the MCP rights ────────────────────────────────────────────────────────

const inst = { id: "i-a1", key: "alerts-1", moduleId: "alerts-overlay", basePath: "alerts" };
test("ctx.api.files.upload: refused (not-allowed) without an MCP call of an uploads action, and without the files permission; works with both", async () => {
  const buf = media("tiny.gif");
  const args = { bytes: buf.length, sha256: sha(buf), accept: ["image"] };
  assert.equal((await makeApi(inst, "en", ["files"], { person: { id: "u1", email: "a@example.org" } }).files.upload.begin(args)).reason, "not-allowed", "a person is not an assistant");
  assert.equal((await makeApi(inst, "en", ["files"], { person: null, assistant: "Studio" }).files.upload.begin(args)).reason, "not-allowed", "an assistant in an action without uploads: true");
  assert.equal((await makeApi(inst, "en", [], { person: null, assistant: "Studio", uploadsFor: WHO }).files.upload.begin(args)).reason, "not-allowed", "no files permission");
  const api = makeApi(inst, "en", ["files"], { person: null, assistant: "Studio", uploadsFor: WHO });
  const b = await api.files.upload.begin(args);
  await api.files.upload.chunk({ upload: b.upload, index: 0, data: buf.toString("base64") });
  const done = await api.files.upload.finish({ upload: b.upload });
  assert.equal(done.ok, true);
  assert.equal(await api.files.owns(done.url), true);
  // a person's claim rules are untouched: an assistant's call still cannot claim a person's upload
  await F.recordUpload(`/uploads/${crypto.randomUUID()}.png`, "u1", 10);
  const row = await db.prisma.uploadFile.findFirst({ where: { ownerInstance: null } });
  assert.equal((await api.files.claim(`/uploads/${row.name}`)).reason, "no-person");
});

const base = { apiVersion: 2, id: "demo-mod", name: { en: "Demo", fr: "Démo" }, version: "1.0.0", instances: "single" };
test("manifest: uploads needs the files permission and a writing tool that is not on by default; such a tool is never granted by default nor in a preset", () => {
  const tool = { name: "media_upload_begin", description: "Starts an upload.", uploads: true };
  assert.equal(parseManifest({ ...base, permissions: ["mcp", "files"], mcp: [tool] }).ok, true);
  assert.equal(parseManifest({ ...base, permissions: ["mcp"], mcp: [tool] }).ok, false);
  assert.equal(parseManifest({ ...base, permissions: ["mcp", "files"], mcp: [{ ...tool, readOnly: true }] }).ok, false);
  assert.equal(parseManifest({ ...base, permissions: ["mcp", "files"], mcp: [{ ...tool, default: true }] }).ok, false);
  assert.equal(toolGrantedByDefault(tool), false);
  assert.equal(placementOf({ name: "alerts_1__reaction_media_upload_begin", readOnly: false, default: false, destructive: false, instanceId: "i-a1" }), "excluded");
});
