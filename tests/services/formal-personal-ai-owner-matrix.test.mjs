import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

/**
 * FORMAL REVIEW, personal AI ceiling, END TO END (spec: docs/formal/personal-ai-ceiling.md). The real MCP server, the real resolver, the real database.
 *
 * (1) Answered or inert: every combination of {site switch, per-person override, account locked, access paused, level of the person} is compared with an ORACLE written
 *     from the documented rules (policy.ts and owner.ts header comments). 3 x 2 x 2 x 4 = 48 combinations (the site switch is gone in 0.47.0), each one a real request.
 * (2) What is visible and callable: a token whose grants tick EVERY tool of the catalogue (written by hand in the database, so "a grant above the owner's rights" is the
 *     normal case) sees exactly the tools the person's level allows, at each level of a demotion chain owner > coordinator > admin > editor > nothing, and the visible set
 *     only ever shrinks. A tool that is not visible is not callable.
 * Both parts have an anti-vacuity check (some combinations answer, some do not; the sets differ per level).
 *
 * Files covered: src/core/personalAi/{owner,policy}.ts, src/core/services/mcp/{ownerCeiling,access,tokens,server}.ts, src/core/auth/{access,rights}.ts.
 * Last synced with: core 0.46.0 (commit 57236d6).
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const POL = await import("@/core/personalAi/policy");
await import("@/core/personalAi/owner"); // registers the resolver of the owner (fail closed without it)
const { columnsOf } = await import("@/core/auth/rights");
const Roles = await import("@/core/auth/roles");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const blog = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
const hash = bcrypt.hashSync("correct horse 12", 4);

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  await setSetting("i18n.default", "en");
  await setSetting("i18n.enabled", ["en", "fr"]);
  await db.fixture("blog");
  await createInstance(db.prisma, { manifest: blog, nickname: "News", names: { en: "News" } });
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
const visible = async (token) => { const r = await rpc(token, "tools/list"); const b = await r.json(); if (!b.result) throw new Error(r.status + " " + JSON.stringify(b)); return b.result.tools.map((t) => t.name); };

/** A person at a level, with an access that ticks EVERY tool of the catalogue (by hand: the ceiling must ignore what is above the person). */
async function personWithEverythingTicked(name, level) {
  const user = await db.prisma.user.create({ data: { email: `${name}@example.org`, name, passwordHash: hash, ...columnsOf(level) } });
  await Roles.syncSystemAssignments();
  const grants = Object.fromEntries((await P.listMcpToolCatalogue()).map((t) => [t.name, true]));
  const code = await T.createToken(`${name}, assistant`, "write", user.email, { ownerId: user.id, grants });
  return { user, code, tokenId: await T.findTokenId(code) };
}

const NONE_TOOLS = ["site_info", "maintenance_my_access", "maintenance_available_operations", "maintenance_request_status"];
const EDITOR_TOOLS = ["redirects_list", "redirects_stats", "redirects_summary", "redirects_create", "redirects_update", "redirects_delete", "media_list", "media_upload", "media_import", "media_set_alt"];
const RESERVED_TOOLS = ["maintenance_check_updates", "maintenance_core_update", "maintenance_module_update", "maintenance_modules_update_all", "maintenance_backup_run", "maintenance_module_install", "maintenance_module_uninstall", "maintenance_module_reinstall", "maintenance_module_restart", "maintenance_instance_add", "maintenance_skin_install", "maintenance_skin_remove", "maintenance_skin_activate", "maintenance_catalog_list", "maintenance_catalog_get", "maintenance_catalog_plan"];

/** The documented answer for a level (ownerCeiling.ts header, rights.ts): editors work on content, links and images; administrators add the site; the technical levels add the reserved upkeep. */
function expectedFor(level, catalogue) {
  const core = catalogue.filter((t) => !t.instanceId && !t.moduleId && !t.name.includes("__")).map((t) => t.name);
  const content = catalogue.filter((t) => t.instanceId);
  const pick = (names) => names.filter((n) => core.includes(n));
  if (level === "none") return [];
  const out = [...pick(NONE_TOOLS), ...pick(EDITOR_TOOLS), ...content.map((t) => t.name)];
  if (level === "admin" || level === "coordinator" || level === "owner") out.push(...core.filter((n) => !NONE_TOOLS.includes(n) && !EDITOR_TOOLS.includes(n) && !RESERVED_TOOLS.includes(n)));
  if (level === "coordinator" || level === "owner") out.push(...pick(RESERVED_TOOLS));
  return out.sort();
}

test("demotion chain: at every level the visible set is exactly the documented one, only shrinks, and what is hidden cannot be called", async () => {
  await POL.setPersonalPolicy({ enabled: true });
  const p = await personWithEverythingTicked("camille", "owner");
  await POL.setPersonOverride(p.user.id, "allow"); // an editor has no right to an AI by role: the person is explicitly allowed, so only the CEILING is under test
  const catalogue = await P.listMcpToolCatalogue();
  const everyTool = catalogue.map((t) => t.name);
  let previous = new Set(everyTool);
  const sizes = [];
  for (const level of ["owner", "coordinator", "admin", "editor"]) {
    await db.prisma.user.update({ where: { id: p.user.id }, data: columnsOf(level) });
    await Roles.syncSystemAssignments();
    const seen = (await visible(p.code)).sort();
    assert.deepEqual(seen, expectedFor(level, catalogue), `visible tools at level ${level}`);
    for (const n of seen) assert.ok(previous.has(n), `${n} appeared after a demotion to ${level}`);
    previous = new Set(seen);
    sizes.push(seen.length);
    // a hidden tool answers like an unknown one, even though its box is ticked
    const hidden = everyTool.find((n) => !seen.includes(n) && !n.includes("__"));
    if (hidden) {
      const body = await (await rpc(p.code, "tools/call", { name: hidden, arguments: {} })).json();
      assert.match(body.error?.message ?? "", /Unknown tool/, `${hidden} at ${level}`);
    }
  }
  // anti-vacuity: the sets really differ from level to level (a ceiling that did nothing would give four equal sizes)
  assert.ok(sizes[0] >= sizes[1] && sizes[1] > sizes[2] && sizes[2] > sizes[3] && sizes[3] > 0, `sizes ${sizes}`);
  // a person who loses every level (no role, no right) is inert: the access answers nothing at all
  await db.prisma.user.update({ where: { id: p.user.id }, data: columnsOf("none") });
  await Roles.syncSystemAssignments();
  assert.equal((await rpc(p.code, "tools/list")).status, 403);
});

test("answered or inert: 48 combinations of override, lock, pause and level against the documented rule", async () => {
  const levels = ["owner", "coordinator", "admin", "editor"];
  // does the ROLE hold core:ai.personal? administrators, the coordinator and the owner do; editors do not (rights.ts)
  const roleHolds = (level) => level !== "editor";
  let answered = 0, inert = 0, n = 0;
  for (const enabled of [true]) for (const override of ["inherit", "allow", "deny"]) for (const locked of [false, true]) for (const paused of [false, true]) for (const level of levels) {
    await db.reset();
    await setSetting("i18n.default", "en");
    await POL.setPersonalPolicy({ enabled });
    const p = await personWithEverythingTicked(`etoile_nord${n++}`, level);
    await POL.setPersonOverride(p.user.id, override);
    if (locked) await db.prisma.user.update({ where: { id: p.user.id }, data: { mustChangePassword: true } });
    if (paused) await db.prisma.apiToken.update({ where: { id: p.tokenId }, data: { pausedAt: new Date() } });
    const allowedByPolicy = enabled && override !== "deny" && (override === "allow" || (roleHolds(level) && !locked));
    const shouldAnswer = allowedByPolicy && !locked && !paused;
    const res = await rpc(p.code, "tools/list");
    const label = JSON.stringify({ enabled, override, locked, paused, level });
    if (shouldAnswer) {
      assert.equal(res.status, 200, `should answer: ${label}`);
      assert.ok((await res.json()).result.tools.length > 0, label);
      answered++;
    } else {
      assert.ok([401, 403].includes(res.status), `should be inert (got ${res.status}): ${label}`);
      inert++;
    }
  }
  assert.equal(n, 48);
  // anti-vacuity: both answers happen, and neither is rare
  // (by the rule: 3 levels with the role + 4 with `allow`, switch on, not locked, not paused = 7)
  assert.ok(answered === 7 && inert === 41, `answered ${answered}, inert ${inert}`);
});

test("a revoked personal access never answers again, whatever its owner can do", async () => {
  await POL.setPersonalPolicy({ enabled: true });
  const p = await personWithEverythingTicked("lune_douce", "owner");
  assert.equal((await rpc(p.code, "tools/list")).status, 200);
  await T.revokeToken(p.tokenId);
  assert.equal((await rpc(p.code, "tools/list")).status, 401);
  assert.equal(await T.getTokenGrants(p.tokenId), null);
  // nothing brings it back: ticking, the secret address and full powers are all refused for a revoked or personal access
  await T.saveTokenGrants(p.tokenId, { site_info: true });
  await T.setUrlAccess(p.tokenId, true);
  assert.equal((await rpc(p.code, "tools/list")).status, 401);
  assert.equal(await T.authenticateByUrl(p.code), null);
  assert.equal(await T.authenticate(`Bearer ${p.code}`), null, "a header without the right shape is not an access");
});

test("what is checked when a request RUNS equals what was checked when the tool was CALLED, for every level 3 action (no drift between the two tables)", async () => {
  const C = await import("@/core/services/mcp/ownerCeiling");
  const { LEVEL3_ACTIONS } = await import("@/core/maintenance/requests");
  const catalogue = await P.listMcpToolCatalogue();
  const byName = new Map(catalogue.map((t) => [t.name, t]));
  const bare = new Set(["navigation_set", "home_sections_set", "site_settings_set"]);
  let compared = 0;
  for (const action of LEVEL3_ACTIONS) {
    const toolName = action === "entry_publish" ? "news__publish" : action === "entry_unpublish" ? "news__unpublish" : bare.has(action) ? action : `maintenance_${action}`;
    const tool = byName.get(toolName);
    assert.ok(tool, `${action}: the tool ${toolName} exists in the catalogue`);
    assert.deepEqual(C.requirementOfAction(action), C.requirementOf(tool), `${action}: the requirement at execution is the one of the tool that asked`);
    compared++;
  }
  assert.equal(compared, LEVEL3_ACTIONS.length);
  assert.ok(compared >= 17, "all the level 3 actions known today");
});
