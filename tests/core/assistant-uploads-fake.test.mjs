// The test kit's ctx.api.files.upload (testsupport/fakeCtx.mjs) follows the core: same check of the bytes, same order, sha256, expiry, replay, permission.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "../../testsupport/index.mjs";

const FIX = path.resolve(import.meta.dirname, "../fixtures/media");
const media = (n) => fs.readFileSync(path.join(FIX, n));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

test("fake upload: off unless the test says the action declares uploads; without the files permission it stays off", async () => {
  const buf = media("tiny.gif");
  assert.equal((await fakeCtx().api.files.upload.begin({ bytes: buf.length, sha256: sha(buf) })).reason, "not-allowed");
  assert.equal((await fakeCtx({ permissions: ["mcp"], assistantUploads: {} }).api.files.upload.begin({ bytes: buf.length, sha256: sha(buf) })).reason, "not-allowed");
});

test("fake upload: pieces, the real check (a GIF is not a video, a 40 s video is refused), replay, ownership", async () => {
  let now = 0;
  const ctx = fakeCtx({ permissions: ["files"], assistantUploads: { tokenId: "t9", nowMs: () => now } });
  const up = ctx.api.files.upload;
  const gif = media("tiny.gif");
  let b = await up.begin({ bytes: gif.length, sha256: sha(gif), accept: ["video"] });
  await up.chunk({ upload: b.upload, index: 0, data: gif.toString("base64") });
  assert.equal((await up.finish({ upload: b.upload })).reason, "type");
  const long = media("long-vp8.webm");
  b = await up.begin({ bytes: long.length, sha256: sha(long), accept: ["video"] });
  ctx.putUpload(b.upload, long);
  assert.match((await up.finish({ upload: b.upload })).message, /30 s at most/);
  const vid = media("tiny-vp9.webm");
  b = await up.begin({ bytes: vid.length, sha256: sha(Buffer.from("x")), accept: ["video"], label: "<b>Raid</b>" });
  ctx.putUpload(b.upload, vid);
  assert.equal((await up.finish({ upload: b.upload })).reason, "hash");
  b = await up.begin({ bytes: vid.length, sha256: sha(vid), accept: ["video"], label: "<b>Raid</b>" });
  ctx.putUpload(b.upload, vid);
  const done = await up.finish({ upload: b.upload });
  assert.deepEqual([done.ok, done.kind, done.durationSeconds, done.label, done.already], [true, "video", 1, "b Raid b", false]);
  assert.equal((await up.finish({ upload: b.upload })).already, true);
  assert.equal(await ctx.api.files.owns(done.url), true);
  assert.equal(ctx.dumpFiles().filter((f) => f.owner === "me").length, 1);
  const late = await up.begin({ bytes: vid.length, sha256: sha(vid) });
  now += 31 * 60_000;
  assert.equal((await up.finish({ upload: late.upload })).reason, "expired");
});
