import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// Long maintenance actions answer "started" instead of making the AI client wait for its 60-second timeout: the work goes on in the background, the result comes
// through maintenance_request_status. These tests use slow fake dependencies (no network, no process) and real clocks of a few hundred milliseconds.

const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const B = await import("@/core/maintenance/background");
const mail = await import("@/core/services/mail");
const P = await import("@/core/platform");

const app = makeTempDir("curiosa-app-");
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.1.14" }));
fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ repo: "owner/repo" }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = { email: "owner@example.org", owner: true };
let report;

beforeEach(async () => {
  await db.reset();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  mail.setMailTransportFactory();
  fs.rmSync(path.join(db.dir, "backups"), { recursive: true, force: true });
  report = { checkedAt: Date.now(), checked: 3, outdated: [], unchecked: [] };
  D.setMaintenanceDeps({
    appDir: app,
    disk: () => ({ freeBytes: 50 * 2 ** 30, totalBytes: 100 * 2 ** 30 }),
    latestStable: async () => ({ tag: "v0.1.14", notes: "" }),
    recheckCore: async () => {},
    modulesReport: async () => report,
    savedModulesReport: async () => null,
    mail: async () => ({ ok: true }),
    quickWaitMs: 100,
    checkTimeoutMs: 150,
  });
});
after(() => { fs.rmSync(app, { recursive: true, force: true }); return db.close(); });

const rpc = (token, name, args = {}, init = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), P.listMcpTools);
async function call(token, name, args) {
  const body = await (await rpc(token, name, args)).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function maintenanceToken(grant = [], name = "Maintenance AI") {
  const token = await T.createToken(name, "write", "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
async function threeModules() {
  for (const id of ["a", "b", "c"]) await db.prisma.module.create({ data: { id, source: "git", repoUrl: `https://example.org/${id}.git`, ref: "v1.0.0", version: "1.0.0", enabled: true } });
  report = { checkedAt: Date.now(), checked: 3, unchecked: [], outdated: ["a", "b", "c"].map((id) => ({ id, current: "1.0.0", target: "1.0.1" })) };
}
/** An updater that takes `ms` per module and tells the progress as each one ends; `fail` modules fail. */
function slowUpdater(ms, { fail = [] } = {}) {
  const log = { started: [], finished: false };
  D.setMaintenanceDeps({
    updateModules: async (ids, onEach) => {
      log.started.push(ids);
      const updated = [], failed = [];
      for (const id of ids) {
        await sleep(ms);
        if (fail.includes(id)) { failed.push({ id, error: "modules.error.clone", migration: false }); onEach?.({ id, ok: false, error: "modules.error.clone" }); } else { updated.push(id); onEach?.({ id, ok: true }); }
      }
      log.finished = true;
      return { updated, failed, skipped: [], stoppedOn: null };
    },
  });
  return log;
}
async function untilStatus(token, requestId, wanted, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { value } = await call(token, "maintenance_request_status", { requestId });
    if (wanted.includes(value.status) || Date.now() > end) return value;
    await sleep(25);
  }
}

test("modules_update_all (direct mode): answers in well under a second while the updater is slow; the result comes through request_status, module by module", async () => {
  const { token, id } = await maintenanceToken(["modules_update_all"]);
  await S.setApprovalMode(id, "direct");
  await threeModules();
  const log = slowUpdater(150, { fail: ["b"] });
  const t0 = Date.now();
  const { value } = await call(token, "maintenance_modules_update_all");
  assert.ok(Date.now() - t0 < 1000, `answered in ${Date.now() - t0} ms`);
  assert.equal(value.status, "started");
  assert.match(value.requestId, /^run_/);
  assert.match(value.message, /maintenance_request_status/);
  assert.equal(log.finished, false, "the work is still going on");

  const running = (await call(token, "maintenance_request_status", { requestId: value.requestId })).value;
  assert.equal(running.status, "running");
  const done = await untilStatus(token, value.requestId, ["done", "failed"]);
  assert.equal(done.status, "failed", "one module failed: the whole is reported failed, with the details");
  assert.deepEqual(done.plan.modules.map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(done.progress.items.map((i) => [i.id, i.status]), [["a", "updated"], ["b", "failed"], ["c", "updated"]]);
  assert.equal(done.progress.total, 3);
  assert.deepEqual(done.result.details.updated, ["a", "c"]);
  assert.deepEqual(done.result.details.failed.map((f) => f.id), ["b"]);
  // The audit line and the owner's notice are written by the work, once, when it ends.
  const rows = await db.prisma.auditLog.findMany({ where: { action: "mcp.maintenance.modules_update_all" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "mcp:Maintenance AI");
  assert.equal(B.currentLock(), null, "lock given back");
});

test("modules_update_all (direct mode): a quick update still answers done at once, like before; nothing to update is still a tool error", async () => {
  const { token, id } = await maintenanceToken(["modules_update_all"]);
  await S.setApprovalMode(id, "direct");
  const none = await call(token, "maintenance_modules_update_all");
  assert.match(none.error, /No module can be updated by an AI right now/);
  await threeModules();
  slowUpdater(1);
  const { value } = await call(token, "maintenance_modules_update_all");
  assert.equal(value.status, "done");
  assert.match(value.message, /updated: a, b, c/);
});

test("approved request: the owner's approval answers at once with 'running'; progress and result are on the request", async () => {
  const { token } = await maintenanceToken(["modules_update_all"]);
  await threeModules();
  const log = slowUpdater(120);
  const req = (await call(token, "maintenance_modules_update_all")).value;
  assert.equal(req.status, "pending_approval");
  const t0 = Date.now();
  const r = await M.approveRequest(req.requestId, owner);
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual([r.ok, r.reason], [true, "running"]);
  assert.equal((await Q.getRequest(req.requestId)).status, "running");
  const done = await untilStatus(token, req.requestId, ["done", "failed"]);
  assert.equal(done.status, "done");
  assert.equal(done.progress.done, 3);
  assert.deepEqual(done.result.details.updated, ["a", "b", "c"]);
  assert.equal(log.started.length, 1, "executed once");
  assert.equal((await M.approveRequest(req.requestId, owner)).ok, false, "a second approval does nothing");
});

test("module_reinstall and check_updates: long ones answer 'started' with a requestId; the lock message says who holds it, since when and which request to follow", async () => {
  const { token } = await maintenanceToken(["module_reinstall", "check_updates"], "Slow Helper");
  let release;
  D.setMaintenanceDeps({ reinstall: () => new Promise((resolve) => { release = () => resolve({ ok: true, id: "x", changed: true, before: { version: "1.0.0" }, after: { version: "1.0.1" }, migrations: [] }); }) });
  const first = (await call(token, "maintenance_module_reinstall", { module: "alpha" })).value;
  assert.equal(first.status, "started");
  assert.equal(first.ok, true);
  const busy = (await call(token, "maintenance_check_updates")).value;
  assert.equal(busy.busy, true);
  assert.match(busy.message, /Another maintenance operation is running \(module_reinstall, started by "Slow Helper" \d+ s ago\)/);
  assert.ok(busy.message.includes(first.requestId), "the message names the request to follow");
  release();
  const done = await untilStatus(token, first.requestId, ["done", "failed"]);
  assert.equal(done.status, "done");
  assert.match(done.result.message, /renewed/);
  assert.equal((await call(token, "maintenance_check_updates")).value.ok, true, "lock given back");
});

test("a client that goes away in the middle changes nothing: the work finishes, the record is closed, the lock is given back, the audit is written once", async () => {
  const { token, id } = await maintenanceToken(["modules_update_all"]);
  await S.setApprovalMode(id, "direct");
  await threeModules();
  D.setMaintenanceDeps({ quickWaitMs: 5000 });   // the caller would wait for a long time...
  const log = slowUpdater(120);
  const controller = new AbortController();
  const answer = rpc(token, "maintenance_modules_update_all", {}, { signal: controller.signal });
  await sleep(150);
  controller.abort();                              // ...and gives up (its 60 s timeout)
  await answer.catch(() => {});
  await sleep(700);
  assert.equal(log.finished, true, "the updates went on to the end");
  assert.equal(B.currentLock(), null);
  const runs = await B.listRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "done");
  assert.deepEqual(runs[0].result.details.updated, ["a", "b", "c"]);
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "mcp.maintenance.modules_update_all" } })).length, 1);
  assert.equal((await call(token, "maintenance_request_status", { requestId: runs[0].id })).value.status, "done");
});

test("a run that was in progress when the site restarted is closed as interrupted, never left 'running' for ever; another access cannot read it", async () => {
  const { token, id } = await maintenanceToken(["modules_update_all"]);
  const other = await maintenanceToken([], "Other");
  const old = Date.now() - 10 * 60_000;
  await db.prisma.setting.create({ data: { key: "maintenance.runs", locale: "", value: JSON.stringify([{ id: "run_old", action: "modules_update_all", tokenId: id, tokenName: "Maintenance AI", createdAt: old, status: "running" }]) } });
  const seen = (await call(token, "maintenance_request_status", { requestId: "run_old" })).value;
  assert.equal(seen.status, "failed");
  assert.match(seen.result.message, /Interrupted: the site restarted/);
  assert.equal((await call(other.token, "maintenance_request_status", { requestId: "run_old" })).error, "Unknown request.");
  // An approved request in the same situation.
  const created = await Q.createRequest({ action: "module_update", plan: { module: "a", from: "1.0.0", to: "1.0.1" }, tokenId: id, tokenName: "Maintenance AI" });
  await Q.claimRequest(created.request.id, old);
  const req = (await call(token, "maintenance_request_status", { requestId: created.request.id })).value;
  assert.equal(req.status, "failed");
  assert.match(req.result.message, /Interrupted/);
  // But a run that this process is working on is never closed, however slow.
  const { token: t2, id: id2 } = await maintenanceToken(["module_reinstall"], "Third");
  let release;
  D.setMaintenanceDeps({ reinstall: () => new Promise((resolve) => { release = () => resolve({ ok: true, id: "x", changed: false, before: { version: "1" }, after: { version: "1" }, migrations: [] }); }) });
  const started = (await call(t2, "maintenance_module_reinstall", { module: "alpha" })).value;
  assert.equal((await B.getRun(started.requestId, Date.now() + 60 * 60_000)).status, "running");
  release(); await untilStatus(t2, started.requestId, ["done"]);
  void id2;
});

test("a lock that nobody gives back (older than 30 minutes) does not block the site for ever", async () => {
  const { token } = await maintenanceToken(["check_updates"]);
  const lock = B.takeLock({ name: "modules_update_all", by: "Ghost" });
  assert.equal(lock.ok, true);
  const blocked = (await call(token, "maintenance_check_updates")).value;
  assert.equal(blocked.busy, true);
  assert.match(blocked.message, /modules_update_all, started by "Ghost"/);
  D.setMaintenanceDeps({ now: () => Date.now() + B.LOCK_STALE_MS + 1000 });
  assert.equal((await call(token, "maintenance_check_updates")).value.ok, true);
});

test("diagnose: a hung network does not hold the answer; the checks that did not finish are listed as unknown, the others are reported", async () => {
  const { token } = await maintenanceToken();
  const hang = () => new Promise(() => {});
  D.setMaintenanceDeps({ modulesReport: hang, latestStable: hang, checkTimeoutMs: 5000 });   // the real budget of a check
  const t0 = Date.now();
  const { value } = await call(token, "maintenance_diagnose");
  const took = Date.now() - t0;
  assert.ok(took < 10_000, `answered in ${took} ms`);
  assert.ok(value.unknown.length >= 1, "some checks are unknown");
  assert.ok(value.unknown.every((u) => u.check && /no answer within|check failed|no check has finished/.test(u.reason)));
  assert.equal(value.summary.complete, false);
  assert.ok(value.problems.some((p) => /No backup has ever been made/.test(p.problem)), "the local checks are still reported");
  assert.match(value.verdict, /^(nothing wrong found so far|needs attention)/);
});

test("diagnose: when the check of the repositories is not over, the last saved one is served and marked as old", async () => {
  const { token } = await maintenanceToken();
  await db.prisma.module.create({ data: { id: "a", source: "git", repoUrl: "https://example.org/a.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  const saved = { checkedAt: Date.now() - 3 * 3600_000, checked: 1, unchecked: [], outdated: [{ id: "a", current: "1.0.0", target: "1.0.1", level: "patch" }] };
  D.setMaintenanceDeps({ modulesReport: () => new Promise(() => {}), savedModulesReport: async () => saved });
  const { value } = await call(token, "maintenance_diagnose");
  assert.ok(value.problems.some((p) => /1 module update\(s\) available: a 1\.0\.0 to 1\.0\.1/.test(p.problem)), "the saved update is shown");
  assert.ok(value.notes.some((n) => /come from the check of/.test(n) && /running in the background/.test(n)));
  const updates = (await call(token, "maintenance_updates")).value;
  assert.equal(updates.stale, true);
  assert.equal(updates.modules[0].id, "a");
  const modules = (await call(token, "maintenance_modules")).value;
  assert.equal(modules.updatesStale, true);
});

test("diagnose: a complete, quick answer has no 'unknown' and keeps the former verdicts", async () => {
  const { token } = await maintenanceToken();
  await db.prisma.auditLog.create({ data: { actor: "owner@example.org", action: "backup.create", target: "x" } });
  const { value } = await call(token, "maintenance_diagnose");
  assert.equal(value.unknown, undefined);
  assert.equal(value.summary.complete, true);
  assert.equal(value.verdict, "healthy");
});

test("the update report is saved, and served after a restart without any network", async () => {
  const U = await import("@/core/modules/updateStatus");
  assert.equal(await U.readSavedModulesReport(), null);
  const fresh = await U.getModulesReport(true);   // no module with a source here: an empty report, but a real one
  const saved = await U.readSavedModulesReport();
  assert.equal(saved.checkedAt, fresh.checkedAt);
  assert.deepEqual(saved.outdated, []);
  await db.prisma.setting.update({ where: { key_locale: { key: "updates.modulesReport", locale: "" } }, data: { value: "not json" } });
  assert.equal(await U.readSavedModulesReport(), null, "a damaged copy is ignored");
});

test("the tool of a maintenance call is found without loading the modules of the site", async () => {
  const names = (list) => list.map((t) => t.name);
  const original = P.mcpProviders.map((p) => p.list);
  const modulesProvider = P.mcpProviders.find((p) => p.id === "modules");
  let asked = 0;
  modulesProvider.list = async () => { asked++; return []; };
  try {
    const only = await P.listMcpTools({ name: "maintenance_status" });
    assert.ok(names(only).includes("maintenance_status"));
    assert.equal(asked, 0, "the module tools were not computed");
    await P.listMcpTools({ name: "blog__create_draft" });
    assert.equal(asked, 1, "any other name asks the modules");
    await P.listMcpTools();
    assert.equal(asked, 2, "the full list asks them too");
  } finally { P.mcpProviders.forEach((p, i) => { p.list = original[i]; }); }
});
