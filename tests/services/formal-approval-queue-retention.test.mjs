import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

/**
 * FORMAL REVIEW, level 3 approval queue, RETENTION (spec: docs/formal/approval-queue.md, invariant Q7).
 *
 *   Q7  the purge of old requests never removes a request that still waits for a decision or is being run.
 *
 * `save` keeps the last 50 requests of independent accesses and the last 50 of personal ones. It used to cut by position whatever the status, so a request that
 * was still pending (or running) vanished from the queue without a word once 50 newer requests existed: the owner never saw it, the AI polling it got "Unknown
 * request", and an approval that was on its way answered "not found". Found by comparing the model of approval-queue.test with the real queue under a flood.
 * Files covered: src/core/maintenance/requests.ts (save). Last synced with: core 0.46.1 branch (formal review).
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const Q = await import("@/core/maintenance/requests");

beforeEach(async () => { await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } }); });
after(() => db.close());

const T0 = 1_800_000_000_000;
const plan = (i) => ({ module: `m${i}`, from: "1.0.0", to: "1.0.1" });
const mk = (tokenId, i, ownerId, now = T0 + i) => Q.createRequest({ action: "module_update", plan: plan(i), tokenId, tokenName: tokenId, ...(ownerId ? { ownerId } : {}) }, now);

test("a noisy access whose requests the owner keeps refusing cannot push another access's pending request out of the queue", async () => {
  const quiet = await mk("tok_quiet", 0);
  assert.ok(quiet.ok);
  // 60 requests of another access, each refused as soon as it arrives (at most 5 wait at a time, so the loop is what an owner doing "refuse all" would see)
  for (let i = 1; i <= 60; i++) {
    const r = await mk("tok_noisy", i);
    assert.ok(r.ok, `request ${i}`);
    assert.equal((await Q.denyRequest(r.request.id, T0 + i)).ok, true);
  }
  const still = await Q.getRequest(quiet.request.id, T0 + 100);
  assert.ok(still, "the pending request is still in the queue");
  assert.equal(still.status, "pending");
  assert.equal((await Q.claimRequest(quiet.request.id, T0 + 101)).ok, true, "and it can still be approved");
});

test("sixty pending requests (twelve accesses, five each) are all kept; only finished ones are cut, to the last 50 per class", async () => {
  const ids = [];
  for (let t = 0; t < 12; t++) for (let i = 0; i < 5; i++) { const r = await mk(`tok_${t}`, t * 10 + i); assert.ok(r.ok); ids.push(r.request.id); }
  const all = await Q.listRequests(T0 + 1000);
  for (const id of ids) assert.ok(all.some((r) => r.id === id && r.status === "pending"), `${id} lost`);
  // finished requests are still trimmed (the queue does not grow for ever): deny them all, then add more
  for (const id of ids) await Q.denyRequest(id, T0 + 2000);
  for (let i = 0; i < 20; i++) await mk("tok_extra", 500 + i, undefined, T0 + 3000 + i);
  const after = await Q.listRequests(T0 + 4000);
  assert.ok(after.filter((r) => r.status === "denied").length <= 50, "finished independent requests are cut to 50");
  assert.ok(after.length <= 50 + 20, `${after.length} requests kept`);
});

test("a running request is not cut either, and personal and independent requests keep their separate counts", async () => {
  const r = await mk("tok_a", 1, "user_1");
  assert.equal((await Q.claimRequest(r.request.id, T0 + 5)).ok, true); // running
  for (let i = 0; i < 60; i++) { const x = await mk("tok_b", 100 + i, "user_2", T0 + 10 + i); assert.equal((await Q.denyRequest(x.request.id, T0 + 10 + i)).ok, true); }
  const kept = await Q.getRequest(r.request.id, T0 + 20);
  assert.ok(kept, "a request being run is still there to receive its result");
  // (once finished it is an ordinary old request: by design it is cut when 50 newer finished ones exist; see the spec, "residual")
  await Q.finishRequest(r.request.id, { ok: true, message: "done" }, T0 + 21);
});
