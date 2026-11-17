import test, { beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// The owner's lift and "start over" also cover the files a module tool receives through ctx.api.files.upload (core 0.28.2).
// Bug replayed: the daily quota of files (30 files / 250 MB per 24 hours) was used up by uploads spread over the previous afternoon; the owner lifted the
// limits (and started over) in Admin > AI assistants > Settings, yet the assistant calling the module's upload_begin / _finish was still refused, because the
// 0.28.0 lift only covered media_upload and media_import. The real MCP server, a real module (fixture demo-uploads, the same three steps as the alerts
// overlay), real video files, the test database and the real staging folder: nothing is mocked but the clock of the lift.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const SL = await import("@/core/maintenance/slots");
const L = await import("@/core/services/mcp/uploadLift");
const U = await import("@/core/services/assistantUploads");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest } = await import("@/core/modules/manifest");
const { getActiveInstances } = await import("@/core/modules/registry");
const { prisma } = await import("@/core/db");
const { UPLOADS_DIR } = await import("@/core/config");

const FIX = path.resolve(import.meta.dirname, "../fixtures/media");
const clip = fs.readFileSync(path.join(FIX, "tiny-vp9.webm"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const HOUR = 3_600_000;
let key;

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  SL.resetAllSlots();
  L.resetLiftDeps();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  fs.rmSync(U.STAGING_DIR, { recursive: true, force: true });
  await db.fixture("demo-uploads");
  const parsed = parseManifest(JSON.parse(fs.readFileSync("tests/fixtures/extras/modules/demo-uploads/module.json", "utf8")));
  assert.ok(parsed.ok, parsed.error);
  await createInstance(prisma, { manifest: parsed.manifest, names: { en: "uploads" } });
  key = (await getActiveInstances()).find((a) => a.mod.manifest.id === "demo-uploads").instance.key;
});
afterEach(() => L.resetLiftDeps());
after(() => db.close());

const send = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), listMcpTools);
async function call(token, name, args = {}) {
  const res = await send(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function access(name = "Camille") {
  const tools = ["clip_upload_begin", "clip_upload_chunk", "clip_upload_finish"].map((n) => `${key}__${n}`);
  const token = await T.createToken(name, "write", "owner@example.org", { grants: Object.fromEntries([...tools, "maintenance_my_access"].map((g) => [g, true])) });
  return { token, id: await T.findTokenId(token) };
}
const begin = (token, buf = clip) => call(token, `${key}__clip_upload_begin`, { bytes: buf.length, sha256: sha(buf) });
async function send1(token, upload, buf = clip) {
  for (let i = 0; i * U.CHUNK_BYTES < buf.length; i++) {
    const r = await call(token, `${key}__clip_upload_chunk`, { upload, index: i, data: buf.subarray(i * U.CHUNK_BYTES, (i + 1) * U.CHUNK_BYTES).toString("base64") });
    assert.ok(r.value?.ok, JSON.stringify(r));
  }
}
const finish = (token, upload) => call(token, `${key}__clip_upload_finish`, { upload });
/** begin, every piece, finish: the whole flow of the assistant. */
async function full(token) {
  const b = await begin(token);
  if (b.error) return b;
  await send1(token, b.value.upload);
  return finish(token, b.value.upload);
}
/** The previous day's uploads, as the real finish writes them: 30 files of 2 MB spread over two hours, 20 to 18 hours ago (the quota is used up). */
const usedUp = () => db.prisma.auditLog.createMany({ data: Array.from({ length: U.DAILY_FILES }, (_, i) => ({
  actor: "mcp:lune_douce", actorKind: "assistant", action: "file.upload", target: `alerts-1: ${crypto.randomUUID()}.webm ${2 * 1024 * 1024} bytes video 1280x720 6s`,
  createdAt: new Date(Date.now() - 20 * HOUR + i * 4 * 60_000),
})) });
const QUOTA = /daily upload quota of the site for files sent by assistants is used up \(30 files or 250 MB per 24 hours, all assistants together; 30 files and 60 MB counted now\)\. The owner can press "Lift the limits" \(10, 30 or 60 minutes\) or "Start over from zero" in Admin > AI assistants > Settings, card "Uploads by assistants"/;

test("bug replay: quota used up -> refused; owner lifts -> begin, pieces and finish pass; stopped -> refused again; the journal keeps every line", async () => {
  const { token } = await access();
  await usedUp();
  const refused = await begin(token);
  assert.match(refused.error, QUOTA);
  assert.doesNotMatch(refused.error, /tomorrow/, "the assistant is told what the owner can do, not to wait for tomorrow");

  await L.liftLimits(10);
  const done = await full(token);
  assert.equal(done.value?.ok, true, JSON.stringify(done));
  assert.match(done.value.url, /^\/uploads\/[0-9a-f-]{36}\.webm$/);
  assert.ok(fs.existsSync(path.join(UPLOADS_DIR, done.value.url.slice(9))));
  assert.ok((await full(token)).value?.ok, "a second file while lifted");
  assert.equal(await db.prisma.auditLog.count({ where: { action: "file.upload" } }), U.DAILY_FILES + 2);

  assert.equal(await L.stopLift(), true);
  assert.match((await begin(token)).error, /daily upload quota of the site for files.*32 files/, "stopped: the files sent while lifted count");
});

test("boundary: lifted one millisecond before the end; refused exactly at the end; finish reads the lift again and keeps the bytes for a later finish", async () => {
  const { token } = await access();
  await usedUp();
  const t0 = Date.now();
  L.liftDeps.now = () => t0;
  const end = await L.liftLimits(10);
  L.liftDeps.now = () => end - 1;
  const b = await begin(token);
  assert.ok(b.value?.ok, JSON.stringify(b));
  await send1(token, b.value.upload);
  // the lift ends between begin and finish: finish is refused by the quota, the staged bytes stay
  L.liftDeps.now = () => end;
  const late = await finish(token, b.value.upload);
  assert.match(late.error, QUOTA);
  assert.match(late.error, /The bytes already sent stay until \d\d:\d\d UTC: after the owner's action, call the finish step again with the same upload/);
  assert.match((await begin(token)).error, QUOTA, "exactly at the end: the quota applies to begin too");
  // the owner lifts again: the same upload finishes, nothing to send again
  await L.liftLimits(10);
  const again = await finish(token, b.value.upload);
  assert.equal(again.value?.ok, true, JSON.stringify(again));
  assert.equal(again.value.already, false);
});

test("start over from zero: the files count from now on; a line before the reset is ignored, the lines after count; the journal is untouched", async () => {
  const { token } = await access();
  await usedUp();
  assert.match((await begin(token)).error, QUOTA);
  const lines = await db.prisma.auditLog.count();
  await L.resetDailyQuota();
  assert.equal(await db.prisma.auditLog.count(), lines);
  assert.deepEqual(await U.usedToday(), { files: 0, bytes: 0 });
  const done = await full(token);
  assert.equal(done.value?.ok, true, JSON.stringify(done));
  assert.equal((await U.usedToday()).files, 1, "the file sent after the reset counts");
  // the same start as the images (one button for both)
  assert.equal(await L.dailyWindowStart(), JSON.parse((await db.prisma.setting.findUnique({ where: { key_locale: { key: L.QUOTA_FROM_KEY, locale: "" } } })).value));
});

test("while lifted the hourly content counter is not taken by begin; it applies again after the lift", async () => {
  const { token, id } = await access();
  await SL.setLimits(id, { content: 10 });
  for (let i = 0; i < 10; i++) await SL.takeSlot(id, "content");
  assert.match((await begin(token)).error, /Limit reached: 10 content actions per hour/);
  await L.liftLimits(30);
  assert.ok((await full(token)).value?.ok);
  assert.equal((await SL.remainingSlots(id)).content.used, 10, "begin took no content slot while lifted");
  await L.stopLift();
  assert.match((await begin(token)).error, /Limit reached/);
});

test("never lifted: the 25 MB cap of a video, 3 uploads in progress per access, the container checks; the refusal says the lift does not change it", async () => {
  const { token } = await access();
  await L.liftLimits(10);
  const big = await call(token, `${key}__clip_upload_begin`, { bytes: 25 * 1024 * 1024 + 1, sha256: "a".repeat(64) });
  assert.match(big.error, /25 MB at most here.*The owner's lift of the upload limits is on until \d\d:\d\d UTC, but it does not change the size of one file\./);
  for (let i = 0; i < U.OPEN_PER_ACCESS; i++) assert.ok((await begin(token)).value?.ok);
  assert.match((await begin(token)).error, /already has 3 uploads in progress.*but it does not change the number of uploads in progress/);
  // a zip glued after a real video is still refused while lifted (the check of the content never moves)
  const { token: other } = await access("etoile_nord");
  const polyglot = Buffer.concat([clip, Buffer.from("PK\x03\x04"), Buffer.alloc(60, 1)]);
  const b = await begin(other, polyglot);
  await send1(other, b.value.upload, polyglot);
  assert.match((await finish(other, b.value.upload)).error, /extra data after its end/);
  await L.stopLift();
  assert.doesNotMatch((await call(token, `${key}__clip_upload_begin`, { bytes: 25 * 1024 * 1024 + 1, sha256: "a".repeat(64) })).error, /lift/, "not lifted: no note");
});

test("maintenance_my_access reports the files quota and whether it is lifted (read only)", async () => {
  const { token } = await access();
  let me = (await call(token, "maintenance_my_access")).value;
  assert.deepEqual([me.fileUploads.liftedUntil, me.fileUploads.dailyQuotaApplies, me.fileUploads.dailyQuota], [null, true, { files: 30, mb: 250 }]);
  const end = await L.liftLimits(60);
  me = (await call(token, "maintenance_my_access")).value;
  assert.equal(me.fileUploads.liftedUntil, new Date(end).toISOString());
  assert.equal(me.fileUploads.dailyQuotaApplies, false);
  assert.match(me.fileUploads.meaning, /25 MB/);
});
