// maintenance_core_update on a site that runs in a container image: the plan is returned, nothing is requested, approved or executed.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const db = await useTestDb();
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const I = await import("@/core/maintenance/inspect");

const app = makeTempDir("curiosa-app-");
const setVersion = (v) => fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: v }));
fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ repo: "owner/repo" }));
const files = { "v0.7.0": { minFrom: "0.6.10" } };
const calls = { core: [] };
let latest = { tag: "v0.7.0", notes: "Notes." };
const actor = { name: "Assistant", tokenId: "tok_1" };

beforeEach(async () => {
  await db.reset(); D.resetMaintenanceDeps(); M.resetMaintenanceState();
  process.env.CURIOSA_INSTALL = "docker";
  setVersion("0.6.10"); latest = { tag: "v0.7.0", notes: "Notes." }; calls.core = [];
  D.setMaintenanceDeps({
    appDir: app, latestStable: async () => latest,
    fetchText: async (url) => { const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url); return files[m?.[1]] ? JSON.stringify(files[m[1]]) : null; },
    startCoreUpdate: async (tag, who) => { calls.core.push({ tag, who }); return { ok: true }; },
  });
});
after(() => { delete process.env.CURIOSA_INSTALL; fs.rmSync(app, { recursive: true, force: true }); return db.close(); });

test("Docker: core_update answers with the plan and the exact command; no request is created, nothing is started, no slot is used", async () => {
  const r = await M.callLevel3("core_update", {}, actor);
  assert.deepEqual([r.status, r.install, r.from, r.to, r.level], ["manual_update_required", "docker", "0.6.10", "0.7.0", "minor"]);
  assert.deepEqual([r.steps, r.commands, r.stepsComputed], [["0.7.0"], ["docker compose pull && docker compose up -d"], true]);
  assert.match(r.message, /Nothing was done/);
  assert.equal(await Q.pendingCount(), 0, "no approval request");
  assert.deepEqual(calls.core, [], "nothing executed");
});

test("Docker: a site below the support floor gets the ordered steps (one pinned command each)", async () => {
  setVersion("0.2.0");
  const r = await M.callLevel3("core_update", {}, actor);
  assert.deepEqual(r.steps, ["0.6.10", "0.7.0"]);
  assert.equal(r.commands.length, 2);
  assert.match(r.commands[0], /^CURIOSA_VERSION=0\.6\.10 docker compose up -d$/);
});

test("Docker: already up to date, or no release found, says so; the in-place path is refused if it is ever reached", async () => {
  setVersion("0.7.0");
  assert.equal((await M.callLevel3("core_update", {}, actor)).status, "up_to_date");
  latest = null;
  await assert.rejects(M.callLevel3("core_update", {}, actor), /No stable release/);
  latest = { tag: "v0.7.0", notes: "" }; setVersion("0.6.10");
  await assert.rejects(M.prepare("core_update", {}), /container image/);
  assert.deepEqual(calls.core, []);
});

test("Docker: maintenance_updates shows the same plan and says nothing can be done from here", async () => {
  const u = await I.updates();
  assert.deepEqual([u.core.install, u.core.canUpdateFromAdmin, u.core.available, u.core.latestStable], ["docker", false, true, "0.7.0"]);
  assert.deepEqual(u.core.docker, { steps: ["0.7.0"], commands: ["docker compose pull && docker compose up -d"] });
  assert.match(u.core.note, /container image/);
});

test("bare metal is unchanged: core_update still creates a request for the owner", async () => {
  delete process.env.CURIOSA_INSTALL;
  const r = await M.callLevel3("core_update", {}, { ...actor, tokenId: undefined });
  assert.equal(r.status, "pending_approval");
  assert.equal(await Q.pendingCount(), 1);
});
