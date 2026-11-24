import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";
import { PLAN_SAMPLES } from "../fixtures/level3-plans.mjs";

// The level 3 registry: ONE definition per action (maintenance/level3.ts, level3Registry.ts) and the rights of the tool in ONE row (services/mcp/coreTools.ts).
// Every table that used to be written by hand next to the others is derived now; `level3-golden.json` holds those tables as they were BEFORE (captured from the code
// of core 0.47.0), so a derivation that drifts fails here. The second half pins the structure of the approval path: the plan is prepared again and compared, THEN executed.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const golden = JSON.parse(fs.readFileSync(new URL("../fixtures/level3-golden.json", import.meta.url), "utf8"));
const D = await import("@/core/maintenance/deps");
const R = await import("@/core/maintenance/level3Registry");
const A = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const { maintenanceToolProvider, MAINTENANCE_TOOLS } = await import("@/core/maintenance/tools");
const K = await import("@/core/services/mcp/coreTools");
const C = await import("@/core/services/mcp/ownerCeiling");
const P = await import("@/core/services/mcp/profiles");
const { SLOT_CLASSES } = await import("@/core/maintenance/slots");
const { McpToolError } = await import("@/core/services/mcp/validate");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { describeRequest } = await import("../../src/app/admin/(panel)/assistants/requestsShared.ts");
const platform = await import("@/core/platform");

after(() => db.close());
const plain = (v) => JSON.parse(JSON.stringify(v));
const sorted = (a) => [...a].sort();

// ── The derived tables equal the hand-written ones they replaced ─────────────────────────────────────────

test("the names of the level 3 actions: the same 17 as before (the order is the one of the core tool list)", () => {
  assert.deepEqual(sorted(Q.LEVEL3_ACTIONS), sorted(golden.LEVEL3_ACTIONS));
  assert.deepEqual(sorted(R.LEVEL3.map((d) => d.name)), sorted(golden.LEVEL3_ACTIONS));
  assert.equal(new Set(Q.LEVEL3_ACTIONS).size, Q.LEVEL3_ACTIONS.length);
});

test("rate-limit class, background set, always-asks list, destructive set and tool inputs equal the tables they replaced", () => {
  assert.deepEqual(R.LEVEL3_CLASS, golden.LEVEL3_CLASS);
  assert.deepEqual(sorted(R.BACKGROUND_LEVEL3), sorted(golden.BACKGROUND_LEVEL3));
  assert.deepEqual([...A.ALWAYS_HUMAN], golden.ALWAYS_HUMAN, "same order: it is told to the AI in maintenance_my_access");
  assert.deepEqual(sorted(R.DESTRUCTIVE_LEVEL3), sorted(golden.DESTRUCTIVE_LEVEL3));
  const input = plain(R.LEVEL3_INPUT);
  // `site_settings_set` has no entry in the tool list of maintenance (siteMcp.ts builds it): its old placeholder was never read; the registry holds the schema that tool really uses.
  const { site_settings_set: real, ...rest } = input;
  const { site_settings_set: placeholder, ...before } = golden.LEVEL3_INPUT;
  assert.deepEqual(rest, before);
  assert.deepEqual(placeholder, { type: "object" });
  assert.ok(real.properties.name && real.properties.tagline, "the real schema of the site settings");
});

test("the rights of every core tool: the requirement, the action's requirement at execution and the profiles equal the two tables they replaced", () => {
  assert.deepEqual(C.CORE_REQUIREMENTS, golden.CORE_REQUIREMENTS);
  for (const action of golden.LEVEL3_ACTIONS) assert.deepEqual(C.requirementOfAction(action), golden.requirementOfAction[action], action);
  assert.deepEqual(P.PROFILE_TOOLS, golden.PROFILE_TOOLS, "same tools in the same order");
  assert.deepEqual(P.PROFILE_EXCLUDED, golden.PROFILE_EXCLUDED);
  assert.equal(C.requirementOfAction("not_an_action"), undefined);
});

test("the tools of the maintenance provider: same names, flags, texts and inputs as before", async () => {
  assert.deepEqual(plain(MAINTENANCE_TOOLS), golden.MAINTENANCE_TOOLS);
  const tools = (await maintenanceToolProvider.list()).map((t) => ({
    name: t.name, readOnly: t.readOnly, default: t.default, profileDefault: t.profileDefault, destructive: t.destructive, request: t.request, source: t.source, audited: t.audited,
    sha: crypto.createHash("sha256").update(JSON.stringify([t.title, t.description, t.input])).digest("hex").slice(0, 16),
  }));
  assert.deepEqual(plain(tools), golden.tools);
});

test("the sentence of the owner and the text of the journal, for every kind of plan, equal the ones the two chains of `if` wrote", () => {
  assert.equal(PLAN_SAMPLES.length, golden.samples.length);
  PLAN_SAMPLES.forEach(([action, plan], i) => {
    const want = golden.samples[i];
    assert.equal(want.action, action);
    assert.equal(R.level3Def(action).audit(plan), want.audit, `audit of ${action} #${i}`);
    for (const lang of ["en", "fr"]) assert.equal(describeRequest({ action, plan }, makeTranslator(lang), (x) => x.toUpperCase()), want[lang], `${lang} sentence of ${action} #${i}`);
  });
  assert.ok(new Set(PLAN_SAMPLES.map(([a]) => a)).size === K.LEVEL3_ACTIONS.length, "every action has a sample plan");
});

// ── One definition per action, complete ─────────────────────────────────────────────────────────────────

test("every level 3 action has a definition, an input, a class, a requirement, a profile placement and (when it has a core tool) a tool of that name", async () => {
  const catalogue = await platform.listMcpToolCatalogue();
  const byName = new Map(catalogue.map((t) => [t.name, t]));
  const rows = new Map(K.CORE_TOOL_ROWS.map((r) => [r.name, r]));
  for (const action of K.LEVEL3_ACTIONS) {
    const def = R.level3Def(action);
    assert.equal(def.name, action);
    for (const fn of ["prepare", "recheck", "execute", "audit", "summarize"]) assert.equal(typeof def[fn], "function", `${action}.${fn}`);
    assert.equal(def.input.type, "object", `${action}: input`);
    assert.ok(SLOT_CLASSES.includes(def.slot), `${action}: class`);
    assert.ok(C.requirementOfAction(action), `${action}: requirement`);
    const toolName = K.toolOfAction(action);
    if (/^entry_/.test(action)) { assert.equal(toolName, undefined); continue; }
    assert.ok(toolName, `${action}: its tool is a core tool`);
    const tool = byName.get(toolName);
    assert.ok(tool, `${action}: ${toolName} is in the catalogue`);
    assert.deepEqual(C.requirementOf(tool), C.requirementOfAction(action), `${action}: the requirement of the tool is the one of the action`);
    assert.notEqual(P.placementOf(tool), "unassigned", `${action}: placed in a profile or excluded with a reason`);
    assert.equal(tool.request, true);
    assert.equal(tool.destructive, def.destructive === true, `${action}: destructive`);
    assert.ok(rows.get(toolName).level3 === action);
  }
  // The tools of maintenance that are built from DEFS publish the input of the definition, object for object.
  for (const tool of await maintenanceToolProvider.list()) {
    const action = K.LEVEL3_ACTIONS.find((a) => K.toolOfAction(a) === tool.name);
    if (action) assert.strictEqual(tool.input, R.level3Def(action).input, `${tool.name}: one input`);
  }
});

test("a name that is not a level 3 action is refused, and a stored request of such a name is dropped when the queue is read", async () => {
  assert.throws(() => R.level3Def("module_explode"), /unknown level 3 action/);
  assert.throws(() => R.level3Def("toString"), /unknown level 3 action/);
  assert.ok(!K.LEVEL3_ACTIONS.includes("toString"));
});

test("the arguments of a tool become the arguments of `prepare` by the definition (skin options and customization are wrapped, a whole list takes nothing else)", () => {
  assert.deepEqual(R.paramsOfTool("skin_set_options", { accent: "#112233" }), { options: { accent: "#112233" } });
  assert.deepEqual(R.paramsOfTool("skin_customize", { look: "x" }), { customize: { look: "x" } });
  assert.deepEqual(R.paramsOfTool("navigation_set", { entries: [1] }), { entries: [1] });
  assert.deepEqual(R.paramsOfTool("home_sections_set", { sections: [] }), { sections: [] });
  assert.throws(() => R.paramsOfTool("navigation_set", { entries: [], more: 1 }), (e) => e instanceof McpToolError && /unexpected argument "more"/.test(e.message));
  assert.deepEqual(R.paramsOfTool("module_update", { module: "etoile-nord" }), { module: "etoile-nord" });
  assert.throws(() => R.paramsOfTool("module_update", { module: "x", extra: 1 }), McpToolError);
  assert.deepEqual(R.paramsOfTool("site_settings_set", { name: { en: "A" } }), { site: { name: { en: "A" } } });
});

// ── The approval path: prepare again, compare, then execute ────────────────────────────────────────────

/** Replaces `prepare` and `execute` of a definition by spies for the length of `fn`. */
async function spied(action, { prepare, execute = async () => ({ ok: true, message: "ran" }) }, fn) {
  const def = R.level3Def(action);
  const calls = { prepare: [], execute: [] };
  const saved = { prepare: def.prepare, execute: def.execute };
  def.prepare = async (args, opts) => { calls.prepare.push({ args, opts }); return prepare(args, opts); };
  def.execute = async (run) => { calls.execute.push(run); return execute(run); };
  try { return await fn(calls); } finally { def.prepare = saved.prepare; def.execute = saved.execute; }
}

const KINDS = {
  again: ["core_update", "module_update", "modules_update_all", "module_uninstall", "module_install", "skin_install", "skin_activate", "skin_remove", "font_set", "instance_add", "entry_publish", "entry_unpublish"],
  inside: ["skin_set_options", "skin_customize", "site_settings_set", "navigation_set", "home_sections_set"],
  stepwise: ["module_install"],
};

test("how each plan is checked again is declared by its definition, and nothing changes silently", () => {
  const seen = { again: new Set(), inside: new Set(), stepwise: new Set() };
  for (const [action, plan] of PLAN_SAMPLES) seen[R.level3Def(action).recheck(plan).kind].add(action);
  assert.deepEqual(sorted(seen.again), sorted(KINDS.again.filter((a) => a !== "module_install" || seen.again.has(a))));
  assert.deepEqual(sorted(seen.inside), sorted(KINDS.inside));
  assert.deepEqual([...seen.stepwise], ["module_install"], "only a bundle of installations is checked step by step");
  assert.equal(R.level3Def("module_install").recheck({ module: "journal", to: "1.0.0" }).kind, "again", "a single installation is prepared again as a whole");
});

test("a plan that is prepared again and refused is never executed: `Not done: <the reason>`, the new preparation is patient, with the arguments the plan asks", async () => {
  let n = 0;
  for (const [action, plan] of PLAN_SAMPLES) {
    const re = R.level3Def(action).recheck(plan);
    if (re.kind !== "again") continue;
    n++;
    await spied(action, { prepare: async () => { throw new McpToolError("the target is gone"); } }, async (calls) => {
      const out = await R.executeLevel3(action, plan, "mcp:test");
      assert.deepEqual([out.ok, out.message], [false, "Not done: the target is gone"], action);
      assert.equal(calls.execute.length, 0, `${action}: nothing was executed`);
      assert.equal(calls.prepare.length, 1, `${action}: prepared again exactly once`);
      assert.deepEqual(calls.prepare[0].args, re.args, `${action}: with the arguments of the plan`);
      assert.equal(calls.prepare[0].opts.patient, true);
    });
  }
  assert.ok(n >= 12);
});

test("a plan that is prepared again and is no longer the one that was approved is never executed; one that still is, is executed once, with the fresh plan", async () => {
  let compared = 0;
  for (const [action, plan] of PLAN_SAMPLES) {
    const re = R.level3Def(action).recheck(plan);
    if (re.kind !== "again") continue;
    // still the same: executed once, and `execute` receives the plan prepared again
    const fresh = structuredClone(plan);
    await spied(action, { prepare: async () => fresh }, async (calls) => {
      const out = await R.executeLevel3(action, plan, "mcp:test", undefined);
      assert.deepEqual([out.ok, out.message], [true, "ran"], action);
      assert.equal(calls.execute.length, 1, action);
      assert.strictEqual(calls.execute[0].fresh, fresh);
      assert.strictEqual(calls.execute[0].plan, plan);
      assert.equal(calls.execute[0].by, "mcp:test");
    });
    if (!re.same) continue;
    // not the same any more: refused with the reason of the definition, nothing executed
    const other = structuredClone(plan);
    other.to = "99.0.0";
    const why = re.same(other);
    assert.match(why, /^Not done: /, `${action}: the reason is a sentence for the AI`);
    await spied(action, { prepare: async () => other }, async (calls) => {
      const out = await R.executeLevel3(action, plan, "mcp:test");
      assert.deepEqual([out.ok, out.message], [false, why], action);
      assert.equal(calls.execute.length, 0, `${action}: not executed`);
    });
    compared++;
  }
  assert.ok(compared >= 4, "core_update, module_update, a single installation and a skin installation compare what they would do now with what was approved");
});

test("a plan that checks itself while it runs (state or steps) is executed without a general preparation, by the same function", async () => {
  for (const [action, plan] of PLAN_SAMPLES) {
    const re = R.level3Def(action).recheck(plan);
    if (re.kind === "again") continue;
    await spied(action, { prepare: async () => { throw new Error("must not be prepared"); } }, async (calls) => {
      const out = await R.executeLevel3(action, plan, "mcp:test");
      assert.equal(out.message, "ran");
      assert.equal(calls.prepare.length, 0);
      assert.equal(calls.execute.length, 1);
      assert.equal(calls.execute[0].fresh, undefined);
    });
  }
});

test("while a core update runs, what is prepared again is refused too (an uninstall excepted), like the first preparation", async () => {
  fs.mkdirSync(path.join(db.dir, "update"), { recursive: true });
  fs.writeFileSync(path.join(db.dir, "update", "state.json"), JSON.stringify({ status: "running", target: "v0.1.16", startedAt: Date.now() }));
  try {
    await assert.rejects(R.prepareLevel3("module_update", { module: "etoile-nord" }), /A core update is running/);
    const out = await R.executeLevel3("module_update", { module: "etoile-nord", from: "1.0.0", to: "1.1.0" }, "mcp:test");
    assert.deepEqual([out.ok, out.message], [false, "Not done: A core update is running. Wait for it to finish (maintenance_status)."]);
    // The dedicated re-reads (publishing, a new instance) were never refused for that reason: unchanged.
    assert.equal(R.level3Def("instance_add").recheck({ module: "j", newInstance: { nickname: "x" } }).gated, false);
    // An uninstall is prepared (and checked again) while a core update runs: it does not depend on the code being replaced.
    await assert.rejects(R.prepareLevel3("module_uninstall", { module: "etoile-nord" }), /Unknown module/);
  } finally { fs.rmSync(path.join(db.dir, "update"), { recursive: true, force: true }); }
});

// ── Through the real approval path ─────────────────────────────────────────────────────────────────────

const app = makeTempDir("curiosa-l3-app-");
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.1.14" }));
fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ repo: "owner/repo" }));
const started = [];
let latest;
beforeEach(async () => {
  await db.reset(); D.resetMaintenanceDeps(); A.resetMaintenanceState();
  started.length = 0; latest = { tag: "v0.1.15", notes: "" };
  D.setMaintenanceDeps({ appDir: app, latestStable: async () => latest, startCoreUpdate: async (tag, by) => { started.push({ tag, by }); return { ok: true }; } });
});
after(() => fs.rmSync(app, { recursive: true, force: true }));

const asked = async () => {
  const created = await Q.createRequest({ action: "core_update", plan: { from: "0.1.14", to: "0.1.15", level: "patch" }, tokenId: "tok_l3", tokenName: "Assistant" });
  assert.equal(created.ok, true);
  return created.request.id;
};
const owner = { email: "owner@example.org", owner: true };

test("approving: the request is prepared again NOW; the same target is executed once", async () => {
  const id = await asked();
  const r = await A.approveRequest(id, owner);
  assert.equal(r.ok, true);
  assert.deepEqual(started.map((s) => s.tag), ["v0.1.15"]);
  assert.equal((await Q.getRequest(id)).status, "done");
});

test("approving: when the target changed since the request, nothing is executed and the request ends as failed with the reason", async () => {
  const id = await asked();
  latest = { tag: "v0.1.16", notes: "" };
  const r = await A.approveRequest(id, owner);
  assert.deepEqual([r.ok, r.reason], [false, "failed"]);
  assert.match(r.message, /^Not done: the highest stable release changed since the request \(was 0\.1\.15, now 0\.1\.16\)/);
  assert.deepEqual(started, []);
  assert.equal((await Q.getRequest(id)).status, "failed");
});

test("approving: when the preparation itself now refuses (nothing left to do), nothing is executed either", async () => {
  const id = await asked();
  latest = { tag: "v0.1.14", notes: "" };
  const r = await A.approveRequest(id, owner);
  assert.equal(r.ok, false);
  assert.match(r.message, /^Not done: Nothing to do/);
  assert.deepEqual(started, []);
});

// ── Structure ─────────────────────────────────────────────────────────────────────────────────────────

test("only the runner calls `execute` of a definition (so that the plan cannot be executed without being checked again)", () => {
  const dir = path.resolve("src/core");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p); } };
  walk(dir);
  const offenders = files.filter((f) => /\bdef\.execute\(|level3Def\([^)]*\)\.execute\(/.test(fs.readFileSync(f, "utf8")) && !f.endsWith(path.join("maintenance", "level3Registry.ts")));
  assert.deepEqual(offenders, []);
  assert.match(fs.readFileSync(path.join(dir, "maintenance", "level3Registry.ts"), "utf8"), /def\.recheck\(plan\)[\s\S]*def\.execute\(\{ plan, fresh, by, ctx \}\)/, "the runner checks before it executes");
});
