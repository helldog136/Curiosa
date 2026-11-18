import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// Full powers (core 0.34.0) leave the owner's approval setting alone: installs wait for the owner even when the access "acts without asking",
// and a core update still waits (or refuses a release candidate) exactly as for any access. Real tools, real database, a local catalogue.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const cat = createCatalogue();
const T = await import("@/core/services/mcp/tokens");
const FP = await import("@/core/services/mcp/fullPowers");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const S = await import("@/core/maintenance/settings");
const C = await import("@/core/modules/compat");
const { setSetting } = await import("@/core/settings");

const app = makeTempDir("curiosa-app-");
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.1.14" }));
fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ repo: "owner/repo" }));
const started = [];
let latest = { tag: "v0.1.15", notes: "" };

beforeEach(async () => {
  await db.reset();
  await cat.clear();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  C.setCoreVersionForTests("0.2.6");
  started.length = 0;
  latest = { tag: "v0.1.15", notes: "" };
  D.setMaintenanceDeps({ appDir: app, disk: () => ({ freeBytes: 50 * 2 ** 30, totalBytes: 100 * 2 ** 30 }), latestStable: async () => latest, recheckCore: async () => {}, startCoreUpdate: async (tag) => { started.push(tag); return { ok: true }; } });
  await cat.add("solo", { manifest: { name: "Solo", description: "One copy only.", instances: "single" } });
});
after(() => { C.setCoreVersionForTests(null); cat.close(); fs.rmSync(app, { recursive: true, force: true }); return db.close(); });

const rpc = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), P.listMcpTools);
const names = async (token) => (await (await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const body = await (await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function fullAccess() {
  const token = await T.createToken("etoile_nord", "write", "owner@example.org");
  const id = await T.findTokenId(token);
  assert.equal(await FP.setFullPowers(id, true), true);
  return { token, id };
}

test("an install request waits for the owner even when the access acts without asking; the approval setting is not changed", async () => {
  const { token, id } = await fullAccess();
  await S.setApprovalMode(id, "direct");
  assert.ok((await names(token)).includes("maintenance_module_install"), "the right comes from the switch, with no box ticked");
  const r = (await call(token, "maintenance_module_install", { module: "solo" })).value;
  assert.equal(r.status, "pending_approval");
  assert.equal(await db.prisma.module.count(), 0, "nothing installed without the owner");
  assert.equal(await S.getApprovalMode(id), "direct");
  await FP.setFullPowers(id, false);
  assert.ok(!(await names(token)).includes("maintenance_module_install"), "off: the right goes at once");
});

test("a core update still follows the approval setting, and a release candidate or a snapshot is refused whatever the access holds", async () => {
  const { token, id } = await fullAccess();
  await setSetting("updates.channel", "rc");
  const first = await call(token, "maintenance_core_update");
  assert.equal(first.value.status, "pending_approval", "ask first (the default): a request, nothing started");
  assert.equal(started.length, 0);
  await S.setApprovalMode(id, "direct");
  for (const tag of ["v0.2.0-rc.1", "dev-20261012", "main"]) {
    latest = { tag, notes: "" };
    assert.ok((await call(token, "maintenance_core_update")).error, `${tag} is refused`);
  }
  assert.equal(started.length, 0);
});
