import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

/**
 * FORMAL REVIEW, level 3 approval queue (spec: docs/formal/approval-queue.md). MODEL-BASED test of the REAL `requests.ts` over the real database.
 *
 * A small model (the spec) is run in lockstep with the real functions under thousands of random but reproducible command sequences (fixed seeds, an injected clock):
 * create / claim (approve) / deny / reopen / finish / expire the pending requests of one owner / let time pass / list. After EVERY command the real queue is compared
 * with the model and these invariants are checked on the real data:
 *   Q1 a request is claimed (approved) at most once: successful claims minus reopens never exceeds 1;
 *   Q2 denied and expired are terminal: they never run, never come back to pending;
 *   Q3 a request past its time is never claimable, even if nobody swept it yet;
 *   Q4 the plan a claim returns is the plan frozen at creation;
 *   Q5 at most MAX_PENDING_PER_TOKEN requests wait per access, and an identical pending request is returned, not duplicated;
 *   Q6 a request moves only along the allowed arrows (pending > running | denied | expired; running > pending | done | failed).
 * Anti-vacuity: the sequences really reach every status, every refusal reason and the per-access limit (counted and asserted at the end), and a broken copy of the
 * model (a claim that does not check the status) is caught.
 *
 * Not covered here (see the spec): two processes (this file runs in one), the eviction of old requests by `save` (see formal-approval-queue-retention.test.mjs).
 * Files covered: src/core/maintenance/requests.ts (+ closeInterrupted of background.ts). Last synced with: core 0.46.0 (commit 57236d6).
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const Q = await import("@/core/maintenance/requests");
const B = await import("@/core/maintenance/background");

beforeEach(async () => {
  await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
  B.resetLock();
});
after(() => db.close());

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

/** Deterministic pseudo-random numbers (mulberry32): a failing sequence is reproduced by its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ALLOWED = new Set(["pending>running", "pending>denied", "pending>expired", "running>pending", "running>done", "running>failed", "running>failed"]);
const TOKENS = ["tok_a", "tok_b", "tok_c"];
const OWNER_OF = { tok_a: "user_1", tok_b: "user_2", tok_c: undefined }; // two personal accesses and one independent
const PLANS = Array.from({ length: 8 }, (_, i) => ({ module: `m${i + 1}`, from: `${i + 1}.0.0`, to: `${i + 1}.0.1` })); // more distinct plans than the limit per access (5)

/** The model: the spec of the queue, written from the header comment of requests.ts, with the clock passed in. */
class Model {
  constructor() { this.list = []; this.seq = 0; }
  /** Two sweeps, like listRequests: pending past their time expire; a running request no work of this process stands behind (none here) is closed as failed after 2 minutes. */
  sweep(now) {
    for (const r of this.list) {
      if (r.status === "pending" && r.expiresAt <= now) r.status = "expired";
      if (r.status === "running" && now - (r.decidedAt ?? r.createdAt) >= B.INTERRUPTED_AFTER_MS) r.status = "failed";
    }
  }
  create(c, now) {
    this.sweep(now);
    const twin = this.list.find((r) => r.status === "pending" && r.tokenId === c.tokenId && r.action === c.action && JSON.stringify(r.plan) === JSON.stringify(c.plan));
    if (twin) return { ok: true, existing: true, id: twin.id };
    if (this.list.filter((r) => r.status === "pending" && r.tokenId === c.tokenId).length >= Q.MAX_PENDING_PER_TOKEN) return { ok: false };
    const r = { id: null, tokenId: c.tokenId, action: c.action, plan: c.plan, ownerId: c.ownerId, status: "pending", createdAt: now, expiresAt: now + Q.REQUEST_TTL_MS, claims: 0, reopens: 0 };
    this.list.push(r);
    return { ok: true, existing: false, model: r };
  }
  claim(id, now, deny) {
    this.sweep(now);
    const r = this.list.find((x) => x.id === id);
    if (!r) return { ok: false, reason: "unknown" };
    if (r.status === "expired") return { ok: false, reason: "expired" };
    if (r.status !== "pending") return { ok: false, reason: "not-pending" };
    r.status = deny ? "denied" : "running";
    if (!deny) { r.claims++; r.decidedAt = now; }
    return { ok: true };
  }
  reopen(id) { const r = this.list.find((x) => x.id === id); if (r?.status === "running") { r.status = "pending"; r.reopens++; delete r.decidedAt; } }
  finish(id, ok) { const r = this.list.find((x) => x.id === id); if (r?.status === "running") r.status = ok ? "done" : "failed"; }
  expireOwner(ownerId) { let n = 0; for (const r of this.list) if (r.status === "pending" && r.ownerId === ownerId) { r.status = "expired"; n++; } return n; }
}

/** Runs one random sequence; returns the coverage counters. `breakModel`: the anti-vacuity run (a model whose claim ignores the status). */
async function runSequence(seed, steps, cover, breakModel = false) {
  const next = rng(seed);
  const pick = (a) => a[Math.floor(next() * a.length)];
  const model = new Model();
  if (breakModel) model.claim = function (id, now, deny) { const r = this.list.find((x) => x.id === id); if (!r) return { ok: false, reason: "unknown" }; r.status = deny ? "denied" : "running"; return { ok: true }; };
  let now = T0;
  const idOf = new Map(); // model request -> real id
  const frozen = new Map(); // real id -> plan at creation
  const previous = new Map(); // real id -> status before the command
  const trail = [];

  for (let step = 0; step < steps; step++) {
    const roll = next();
    const known = model.list.map((r) => idOf.get(r) ?? r.id).filter(Boolean);
    const aRequest = () => (known.length && next() < 0.9 ? pick(known) : "req_unknown");
    let line;
    if (roll < 0.30) {
      const tokenId = pick(TOKENS), action = pick(["module_update", "navigation_set"]), plan = pick(PLANS), ownerId = OWNER_OF[tokenId];
      const m = model.create({ tokenId, action, plan, ownerId }, now);
      const real = await Q.createRequest({ action, plan, tokenId, tokenName: tokenId, ...(ownerId ? { ownerId } : {}) }, now);
      line = `create(${tokenId}, ${action}, ${plan.module}) @${(now - T0) / HOUR}h`;
      assert.equal(real.ok, m.ok, `${line}: the limit per access (Q5)`);
      if (real.ok) {
        assert.equal(real.existing, m.existing, `${line}: an identical pending request is returned, not duplicated (Q5)`);
        if (m.existing) assert.equal(real.request.id, m.id);
        else { m.model.id = real.request.id; idOf.set(m.model, real.request.id); frozen.set(real.request.id, structuredClone(plan)); cover.created++; }
      } else cover.limited++;
    } else if (roll < 0.50) {
      const id = aRequest();
      const real = await Q.claimRequest(id, now);
      const m = model.claim(id, now, false);
      line = `claim(${id}) @${(now - T0) / HOUR}h`;
      assert.equal(real.ok, m.ok, line);
      if (!real.ok) { assert.equal(real.reason, m.reason, line); cover.reasons.add(real.reason); } else {
        assert.deepEqual(real.request.plan, frozen.get(id), `${line}: the plan is the one frozen at creation (Q4)`);
        assert.ok(real.request.expiresAt > now, `${line}: never claimed after its time (Q3)`);
        cover.claimed++;
      }
    } else if (roll < 0.62) {
      const id = aRequest();
      const real = await Q.denyRequest(id, now);
      const m = model.claim(id, now, true);
      line = `deny(${id}) @${(now - T0) / HOUR}h`;
      assert.equal(real.ok, m.ok, line);
      if (!real.ok) assert.equal(real.reason, m.reason, line);
      else cover.denied++;
    } else if (roll < 0.70) {
      const id = aRequest();
      await Q.reopenRequest(id); model.reopen(id); line = `reopen(${id})`;
    } else if (roll < 0.80) {
      // like actions.ts, a result is only recorded for a request this caller has claimed (it is running)
      const running = model.list.filter((r) => r.status === "running").map((r) => idOf.get(r));
      const id = running.length ? pick(running) : "req_unknown", ok = next() < 0.7;
      await Q.finishRequest(id, { ok, message: ok ? "done" : "failed" }, now); model.finish(id, ok); line = `finish(${id}, ${ok})`;
    } else if (roll < 0.85) {
      const owner = pick(["user_1", "user_2"]);
      const real = await Q.expirePendingOf(owner), m = model.expireOwner(owner);
      line = `expirePendingOf(${owner})`;
      assert.equal(real, m, line);
    } else if (roll < 0.93) {
      now += pick([HOUR, 5 * HOUR, 23 * HOUR, 25 * HOUR]); line = `time +${(now - T0) / HOUR}h`;
    } else {
      await Q.listRequests(now); model.sweep(now); line = "list";
    }
    trail.push(line);

    // Compare the whole real queue with the model, and check the invariants on the REAL data.
    const real = await Q.listRequests(now); model.sweep(now);
    const byId = new Map(real.map((r) => [r.id, r]));
    for (const m of model.list) {
      const r = byId.get(idOf.get(m) ?? m.id);
      if (!r) { cover.missing++; continue; } // retention: see the other file; the model forgets nothing, here we only skip
      try {
        assert.equal(r.status, m.status, `status of ${r.id}`);
        assert.ok(m.claims - m.reopens <= 1, "Q1 claims minus reopens");
        const arrow = `${previous.get(r.id) ?? "pending"}>${r.status}`;
        if ((previous.get(r.id) ?? "pending") !== r.status) assert.ok(ALLOWED.has(arrow), `Q6 forbidden arrow ${arrow}`);
        if (["denied", "expired"].includes(previous.get(r.id))) assert.equal(r.status, previous.get(r.id), "Q2 terminal");
        assert.deepEqual(r.plan, frozen.get(r.id), "Q4 frozen plan");
        previous.set(r.id, r.status);
        cover.statuses.add(r.status);
      } catch (e) { e.message = `seed ${seed}, step ${step} (${line}): ${e.message}\n  trail: ${trail.slice(-8).join(" > ")}`; throw e; }
    }
    for (const t of TOKENS) assert.ok(real.filter((r) => r.status === "pending" && r.tokenId === t).length <= Q.MAX_PENDING_PER_TOKEN, `Q5 pending of ${t}`);
  }
}

test("the real queue follows the model under 120 random sequences of 80 commands (Q1 to Q6), and every status and refusal is reached", async () => {
  const cover = { created: 0, claimed: 0, denied: 0, limited: 0, missing: 0, statuses: new Set(), reasons: new Set() };
  for (let seed = 1; seed <= 120; seed++) {
    await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
    await runSequence(seed, 80, cover);
  }
  // anti-vacuity: the interesting states were really visited
  for (const s of ["pending", "running", "done", "failed", "denied", "expired"]) assert.ok(cover.statuses.has(s), `status ${s} never reached`);
  for (const r of ["unknown", "expired", "not-pending"]) assert.ok(cover.reasons.has(r), `refusal ${r} never reached`);
  assert.ok(cover.created > 500 && cover.claimed > 100 && cover.denied > 50 && cover.limited > 20, JSON.stringify({ ...cover, statuses: [...cover.statuses], reasons: [...cover.reasons] }));
});

test("anti-vacuity: a model whose claim ignores the status is caught by the same comparison", async () => {
  const cover = { created: 0, claimed: 0, denied: 0, limited: 0, missing: 0, statuses: new Set(), reasons: new Set() };
  let caught = false;
  for (let seed = 1; seed <= 20 && !caught; seed++) {
    await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
    try { await runSequence(seed, 80, cover, true); } catch { caught = true; }
  }
  assert.ok(caught, "the comparison did not notice a model that approves a request twice");
});

test("a request approved by two callers at the same time runs once (the in-process lock)", async () => {
  const created = await Q.createRequest({ action: "module_update", plan: PLANS[0], tokenId: "tok_c", tokenName: "tok_c" }, T0);
  assert.ok(created.ok);
  const answers = await Promise.all(Array.from({ length: 8 }, () => Q.claimRequest(created.request.id, T0 + 1000)));
  assert.equal(answers.filter((a) => a.ok).length, 1, "exactly one approval wins");
  assert.deepEqual([...new Set(answers.filter((a) => !a.ok).map((a) => a.reason))], ["not-pending"]);
  // denied and approved at the same time: one wins, never both
  const second = await Q.createRequest({ action: "module_update", plan: PLANS[1], tokenId: "tok_c", tokenName: "tok_c" }, T0);
  const mixed = await Promise.all([Q.claimRequest(second.request.id, T0 + 1), Q.denyRequest(second.request.id, T0 + 1), Q.claimRequest(second.request.id, T0 + 1)]);
  assert.equal(mixed.filter((a) => a.ok).length, 1);
  const final = (await Q.listRequests(T0 + 2)).find((r) => r.id === second.request.id);
  assert.ok(["running", "denied"].includes(final.status));
});

test("an expired request is never claimable, even when nobody swept it before the claim, and a denied or expired one never runs after a reopen", async () => {
  const c = await Q.createRequest({ action: "module_update", plan: PLANS[0], tokenId: "tok_c", tokenName: "tok_c" }, T0);
  const late = T0 + Q.REQUEST_TTL_MS; // exactly at the limit: expiresAt <= now
  assert.deepEqual(await Q.claimRequest(c.request.id, late), { ok: false, reason: "expired" });
  await Q.reopenRequest(c.request.id);
  assert.equal((await Q.listRequests(late)).find((r) => r.id === c.request.id).status, "expired", "reopen only moves a running request");
  const d = await Q.createRequest({ action: "navigation_set", plan: PLANS[1], tokenId: "tok_c", tokenName: "tok_c" }, T0);
  assert.equal((await Q.denyRequest(d.request.id, T0 + 5)).ok, true);
  await Q.reopenRequest(d.request.id);
  await Q.finishRequest(d.request.id, { ok: true, message: "x" }, T0 + 6).catch(() => {});
  const status = (await Q.listRequests(T0 + 7)).find((r) => r.id === d.request.id).status;
  // (0.46.1) a result is only recorded on a request that is running: a late `finishRequest` never turns a refused request into "done"
  assert.equal(status, "denied");
});

test("two copies of the module (one per bundle) exclude each other: an approved request is never lost to a concurrent write of the other copy (0.46.1)", async () => {
  const Q2 = await import("../../src/core/maintenance/requests.ts?second-copy");
  assert.notEqual(Q2.claimRequest, Q.claimRequest, "really two copies");
  for (let round = 0; round < 20; round++) {
    await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
    const a = await Q.createRequest({ action: "module_update", plan: PLANS[0], tokenId: "tok_c", tokenName: "tok_c" }, T0);
    const [claim, made, claim2] = await Promise.all([Q2.claimRequest(a.request.id, T0 + 1), Q.createRequest({ action: "module_update", plan: PLANS[1], tokenId: "tok_c", tokenName: "tok_c" }, T0 + 1), Q.claimRequest(a.request.id, T0 + 1)]);
    const list = await Q.listRequests(T0 + 2);
    assert.equal([claim, claim2].filter((c) => c.ok).length, 1, "approved exactly once");
    assert.equal(list.find((r) => r.id === a.request.id).status, "running", "the approval is not undone by the other copy's write");
    assert.ok(made.ok && list.some((r) => r.id === made.request.id), "and the other copy's request is not lost either");
  }
});

test("another PROCESS writing between the read and the write is not overwritten: the write is a compare-and-swap and the change is redone from a fresh read (0.46.1)", async () => {
  const a = await Q.createRequest({ action: "module_update", plan: PLANS[0], tokenId: "tok_c", tokenName: "tok_c" }, T0);
  const setting = db.prisma.setting;
  const original = setting.updateMany.bind(setting);
  let injected = 0;
  setting.updateMany = async (args) => {
    if (injected++ === 0) { // the "other process" wins the race: it stores a list with one more request just before our write
      const row = await setting.findUnique({ where: { key_locale: { key: "maintenance.requests", locale: "" } } });
      const list = JSON.parse(row.value);
      list.push({ id: "req_foreign", action: "navigation_set", plan: { module: "x" }, tokenId: "tok_other", tokenName: "other", createdAt: T0, expiresAt: T0 + Q.REQUEST_TTL_MS, status: "pending" });
      await original({ where: { key: "maintenance.requests", locale: "" }, data: { value: JSON.stringify(list) } });
    }
    return original(args);
  };
  try {
    const claim = await Q.claimRequest(a.request.id, T0 + 1);
    assert.equal(claim.ok, true);
    assert.ok(injected >= 2, "the first write was refused (the stored value had changed) and the change was redone");
  } finally { setting.updateMany = original; }
  const list = await Q.listRequests(T0 + 2);
  assert.equal(list.find((r) => r.id === a.request.id).status, "running");
  assert.ok(list.some((r) => r.id === "req_foreign"), "the other process's request survived");
});
