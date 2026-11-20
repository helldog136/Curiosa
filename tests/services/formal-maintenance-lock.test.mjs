import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

/**
 * FORMAL REVIEW, maintenance lock and closeInterrupted (spec: docs/formal/maintenance-lock.md, model docs/formal/tla/MaintenanceLock.tla).
 * These replay, on the REAL code and with an injected clock, the traces TLC found in the model:
 *   - the lock of an operation that is slow but alive is ignored after 30 minutes: a second operation starts while the first still works
 *     (model MaintenanceLock_Code.cfg: AtMostOneLive violated). REPORTED, NOT FIXED: the stale rule trades safety for "never blocked for ever" (MaintenanceLock_NoStaleRule.cfg),
 *     the fix is a policy decision (a lease renewed by progress, MaintenanceLock_Lease.cfg). The test pins today's behaviour and what stays true around it, so that a fix changes it on purpose;
 *   - a request run inline (not in BACKGROUND_LEVEL3, so not in active()) is shown as "failed: interrupted" after 2 minutes while it is still running, and its real result replaces that
 *     when it ends (model MaintenanceLock_Inline.cfg: NoFalseInterrupt violated, transiently).
 * Files covered: src/core/maintenance/background.ts, requests.ts. Last synced with: core 0.46.0 (commit 57236d6).
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const B = await import("@/core/maintenance/background");
const D = await import("@/core/maintenance/deps");
const Q = await import("@/core/maintenance/requests");

let clock;
beforeEach(async () => {
  await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
  D.resetMaintenanceDeps();
  D.setMaintenanceDeps({ now: () => clock });
  B.resetLock();
  clock = 1_800_000_000_000;
});
after(() => db.close());

const MIN = 60_000;

test("one operation at a time: a second one is refused while the first holds the lock, and released only by its owner", () => {
  const a = B.takeLock({ name: "module_update", by: "Camille" });
  assert.equal(a.ok, true);
  const b = B.takeLock({ name: "module_install", by: "lune_douce" });
  assert.equal(b.ok, false);
  assert.match(b.outcome.message, /Another maintenance operation is running \(module_update/);
  a.release();
  a.release(); // twice is harmless
  const c = B.takeLock({ name: "module_install", by: "lune_douce" });
  assert.equal(c.ok, true, "free again after the release");
  c.release();
});

test("trace of MaintenanceLock_Code.cfg: after 30 minutes the lock of a slow operation is ignored and a second operation starts while the first still works (KNOWN, reported)", () => {
  const first = B.takeLock({ name: "modules_update_all", by: "Camille" });
  assert.equal(first.ok, true);
  clock += 29 * MIN;
  assert.equal(B.takeLock({ name: "module_install", by: "x" }).ok, false, "still held at 29 minutes");
  clock += 2 * MIN; // 31 minutes: the first operation has NOT released anything, its work goes on
  const second = B.takeLock({ name: "module_install", by: "lune_douce" });
  assert.equal(second.ok, true, "today's behaviour: the lock was ignored although the first operation is alive (two operations at once)");
  // what stays true around it: the late release of the first never frees the lock of the second
  first.release();
  assert.equal(B.takeLock({ name: "module_update", by: "y" }).ok, false, "the second operation still holds the lock");
  second.release();
  assert.equal(B.takeLock({ name: "module_update", by: "y" }).ok, true);
});

test("anti-vacuity of the replay: below the limit nothing is ignored, and a lock that is never released does not block for ever (the reason for the rule)", () => {
  const held = B.takeLock({ name: "module_reinstall", by: "Camille" });
  clock += B.LOCK_STALE_MS;
  assert.equal(B.takeLock({ name: "a", by: "b" }).ok, false, "exactly at the limit: still held (the rule is strictly greater)");
  clock += 1;
  const next = B.takeLock({ name: "a", by: "b" });
  assert.equal(next.ok, true, "one millisecond later a hung operation no longer blocks the site");
  next.release(); held.release();
});

test("trace of MaintenanceLock_Inline.cfg: an inline request that runs longer than 2 minutes is shown as interrupted, and its real result replaces that when it ends", async () => {
  const made = await Q.createRequest({ action: "skin_activate", plan: { skin: "basic" }, tokenId: "tok_a", tokenName: "Camille" }, clock);
  const id = made.request.id;
  assert.equal((await Q.claimRequest(id, clock)).ok, true); // running; nothing registers it in active() (it is not a background action)
  clock += 3 * MIN;
  assert.equal((await Q.getRequest(id, clock)).status, "failed", "model: NoFalseInterrupt is violated while the work is alive");
  assert.match((await Q.getRequest(id, clock)).result.message, /Interrupted/);
  await Q.finishRequest(id, { ok: true, message: "done for real" }, clock);
  const end = await Q.getRequest(id, clock);
  assert.equal(end.status, "done", "the final record tells the truth");
  assert.equal(end.result.message, "done for real");
});

test("a request whose work IS registered (a background action) is never closed as interrupted, however long it runs", async () => {
  const made = await Q.createRequest({ action: "module_update", plan: { module: "m1", from: "1.0.0", to: "1.0.1" }, tokenId: "tok_a", tokenName: "Camille" }, clock);
  const id = made.request.id;
  await Q.claimRequest(id, clock);
  let release; const hold = new Promise((r) => { release = r; });
  D.setMaintenanceDeps({ quickWaitMs: 0 }); // answer "started" at once, the work goes on
  const lock = B.takeLock({ name: "module_update", by: "Camille", requestId: id });
  const started = await B.runInBackground({ id, store: { setPlan: async () => {}, setProgress: async () => {}, finish: (r) => Q.finishRequest(id, r, clock) }, lock, work: async () => { await hold; return { ok: true, message: "updated" }; }, after: async () => {} });
  assert.equal(started.started, true, "the work was started and goes on");
  clock += 90 * MIN;
  assert.equal((await Q.getRequest(id, clock)).status, "running", "alive work is never declared dead (model: NoFalseInterrupt holds when registered)");
  release();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await Q.getRequest(id, clock)).status, "done");
});
