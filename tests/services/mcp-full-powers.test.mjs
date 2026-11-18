import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// Full powers of an AI access (core 0.34.0): the real MCP server, the real tools, the real database. Nothing is mocked.
// A tool of a module "installed later" is a provider pushed on the real provider list while the test runs.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const FP = await import("@/core/services/mcp/fullPowers");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");

beforeEach(async () => { await db.reset(); M.resetMaintenanceState(); });
after(() => db.close());

const send = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), P.listMcpTools);
const names = async (token) => (await (await send(token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const body = await (await send(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function access(name, scope = "write", grants = {}) {
  const token = await T.createToken(name, scope, "owner@example.org", { grants });
  return { token, id: await T.findTokenId(token) };
}
/** A provider standing for a module installed (or updated) AFTER the access was made. */
function laterModule(tools) {
  const provider = { id: "later", list: async () => tools.map((t) => ({ title: t.name, description: "A tool added later.", readOnly: false, default: false, destructive: false, input: { type: "object" }, source: "later_1", instanceId: "later_1", moduleId: "later", call: async () => "done", ...t })) };
  P.mcpProviders.push(provider);
  return () => { P.mcpProviders.splice(P.mcpProviders.indexOf(provider), 1); };
}

test("off by default: a write access with a few rights sees only those, and a dangerous tool is unknown to it", async () => {
  const { token, id } = await access("etoile_nord", "write", { site_info: true });
  assert.equal(await FP.hasFullPowers(id), false);
  const seen = await names(token);
  assert.ok(seen.includes("site_info"));
  for (const dangerous of ["maintenance_module_uninstall", "redirects_delete", "maintenance_core_update"]) assert.ok(!seen.includes(dangerous), dangerous);
  assert.match((await call(token, "redirects_delete", { path: "x" })).error, /Unknown tool/);
});

test("on: the access holds EVERY tool of the current catalogue (dangerous ones included), except what manages accesses or secrets", async () => {
  const { token, id } = await access("etoile_nord");
  assert.equal(await FP.setFullPowers(id, true), true);
  const seen = new Set(await names(token));
  const catalogue = await P.listMcpToolCatalogue();
  const expected = catalogue.filter((t) => !t.instanceOptedOut && !A.neverUnderFullPowers(t)).map((t) => t.name);
  assert.ok(expected.length > 40, "a real catalogue");
  assert.deepEqual([...seen].sort(), [...new Set(expected)].sort());
  for (const dangerous of ["maintenance_module_uninstall", "maintenance_modules_update_all", "maintenance_skin_remove", "redirects_delete", "maintenance_module_configure_advanced", "maintenance_core_update", "log_list"]) assert.ok(seen.has(dangerous), dangerous);
  // The catalogue holds nothing that manages accesses, rights, full powers or secrets: nothing is silently left out today.
  assert.deepEqual(catalogue.filter((t) => A.neverUnderFullPowers(t)).map((t) => t.name), [], "if a tool appears here, it was classified as management: read docs/MAINTENANCE-IA.md before listing it");
});

test("rights are computed at request time: a module installed after the switch is granted at once, with no admin action; an ordinary access is not", async () => {
  const full = await access("etoile_nord");
  const plain = await access("lune_douce", "write", { site_info: true });
  await FP.setFullPowers(full.id, true);
  const before = await names(full.token);
  const undo = laterModule([{ name: "later_1__wipe_everything", destructive: true }, { name: "later_1__publish" }, { name: "later_1__grant_rights" }]);
  try {
    const after = await names(full.token);
    assert.deepEqual(after.filter((n) => !before.includes(n)).sort(), ["later_1__publish", "later_1__wipe_everything"], "new tools appear granted; the one that manages rights does not");
    assert.equal((await call(full.token, "later_1__wipe_everything")).value, "done");
    assert.match((await call(full.token, "later_1__grant_rights")).error, /Unknown tool/);
    assert.ok(!(await names(plain.token)).includes("later_1__wipe_everything"), "an access without full powers needs its own right");
    // The rights list is NOT stored: nothing was written to the access.
    assert.equal((await db.prisma.apiToken.findUnique({ where: { id: full.id } })).grants, "{}");
  } finally { undo(); }
  assert.ok(!(await names(full.token)).includes("later_1__wipe_everything"), "a tool that goes away goes away");
});

test("off again: the very next request loses everything; revoking the access clears it too", async () => {
  const { token, id } = await access("etoile_nord");
  await FP.setFullPowers(id, true);
  assert.ok((await names(token)).includes("maintenance_module_uninstall"));
  await FP.setFullPowers(id, false);
  assert.ok(!(await names(token)).includes("maintenance_module_uninstall"));
  await FP.setFullPowers(id, true);
  await T.revokeToken(id);
  assert.equal(await FP.hasFullPowers(id), false, "a revoked access keeps no flag");
  assert.deepEqual(await FP.accessesWithFullPowers(), []);
});

test("a read-only access can never hold it: refused, and ignored even if the flag was written by hand", async () => {
  const { token, id } = await access("camille", "read");
  assert.equal(await FP.setFullPowers(id, true), false);
  assert.equal(await FP.hasFullPowers(id), false);
  await db.prisma.setting.upsert({ where: { key_locale: { key: FP.FULL_POWERS_KEY, locale: "" } }, create: { key: FP.FULL_POWERS_KEY, locale: "", value: JSON.stringify([id]) }, update: { value: JSON.stringify([id]) } });
  const { resetSettingsCache } = await import("@/core/settings");
  resetSettingsCache();
  assert.equal((await T.authenticate(`Bearer ${token}`)).fullPowers, false);
  const seen = await names(token);
  const catalogue = await P.listMcpToolCatalogue();
  assert.ok(seen.every((n) => catalogue.find((t) => t.name === n).readOnly), "still reading only");
  assert.deepEqual(await FP.accessesWithFullPowers(), [], "and it shows nowhere");
  assert.equal(await FP.setFullPowers("no-such-id", true), false);
});

test("journal: a dangerous action under full powers leaves its own line; a read, a draft or an access without the switch leaves none", async () => {
  const full = await access("etoile_nord");
  const plain = await access("lune_douce", "write", { later_1__wipe_everything: true, later_1__create_draft: true });
  await FP.setFullPowers(full.id, true);
  const undo = laterModule([{ name: "later_1__wipe_everything", destructive: true }, { name: "later_1__create_draft" }, { name: "later_1__publish" }, { name: "later_1__ask_install", request: true }, { name: "later_1__read", readOnly: true, default: true }]);
  try {
    const lines = () => db.prisma.auditLog.findMany({ where: { action: "mcp.fullpowers.action" }, orderBy: { id: "asc" } });
    await call(full.token, "later_1__read");
    await call(full.token, "later_1__create_draft");
    assert.equal((await lines()).length, 0, "ordinary actions are not a line each");
    await call(full.token, "later_1__wipe_everything");
    await call(full.token, "later_1__publish");
    await call(full.token, "later_1__ask_install");
    assert.deepEqual((await lines()).map((l) => [l.actor, l.target, l.actorKind]), [["mcp:etoile_nord", "later_1__wipe_everything", "assistant"], ["mcp:etoile_nord", "later_1__publish", "assistant"], ["mcp:etoile_nord", "later_1__ask_install", "assistant"]]);
    await call(plain.token, "later_1__wipe_everything");
    assert.equal((await lines()).length, 3, "same action without the switch: the usual line, not this one");
  } finally { undo(); }
});

test("maintenance_my_access tells an assistant it holds full powers, and nothing is listed as missing except what is kept out", async () => {
  const { token, id } = await access("etoile_nord");
  assert.equal((await call(token, "maintenance_my_access")).value.fullPowers, undefined, "nothing about it before");
  await FP.setFullPowers(id, true);
  const mine = (await call(token, "maintenance_my_access")).value;
  assert.equal(mine.fullPowers.on, true);
  assert.match(mine.fullPowers.meaning, /full powers/i);
  assert.deepEqual(mine.notGranted, []);
  const plain = await access("lune_douce", "write", { maintenance_my_access: true });
  assert.equal((await call(plain.token, "maintenance_my_access")).value.fullPowers, undefined);
});

test("what stays outside: the approval setting, install requests, release candidates (tests in mcp-catalog and mcp-maintenance) and the limits do not read the switch", () => {
  for (const f of ["src/core/maintenance/requests.ts", "src/core/maintenance/actions.ts", "src/core/maintenance/slots.ts", "src/core/services/mcp/uploadLift.ts", "src/core/maintenance/settings.ts", "src/core/updates/service.ts"]) {
    assert.ok(!/fullPowers|full_powers|FULL_POWERS/i.test(fs.readFileSync(f, "utf8")), `${f} must not read the switch`);
  }
});

test("NO tool and no access can turn it on: the setter is imported only by the owner-only admin action (and the revocation, which turns it OFF)", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk("src").filter((f) => /\.(ts|tsx|mjs)$/.test(f));
  const holders = (re) => files.filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => f.split(path.sep).join("/")).sort();
  assert.deepEqual(holders(/\bsetFullPowers\b/), ["src/app/admin/(panel)/assistants/fullPowersActions.ts", "src/core/services/mcp/fullPowers.ts", "src/core/services/mcp/tokens.ts"]);
  assert.deepEqual(holders(/FULL_POWERS_KEY/), ["src/core/backup/export.ts", "src/core/backup/restore.ts", "src/core/services/mcp/fullPowers.ts"]);
  // The one caller that can turn it on checks the owner, in the same file, and asks for the typed name again.
  const action = fs.readFileSync("src/app/admin/(panel)/assistants/fullPowersActions.ts", "utf8");
  assert.match(action, /^"use server";/);
  assert.match(action, /adminCtx\("owner"\)/);
  assert.match(action, /removalConfirmed\("erase"/);
  assert.ok(!/core:mcp\.tokens/.test(action.replace(/\/\*\*[\s\S]*?\*\//g, "")), "not the technical coordination's right");
  // The revocation only ever turns it off.
  assert.match(fs.readFileSync("src/core/services/mcp/tokens.ts", "utf8"), /setFullPowers\(id, false\)/);
  assert.ok(!/setFullPowers\([^)]*true/.test(fs.readFileSync("src/core/services/mcp/tokens.ts", "utf8")));
});

test("no tool of the catalogue, whatever its source, is about the switch, and no tool schema takes a setting name", async () => {
  const catalogue = await P.listMcpToolCatalogue();
  assert.deepEqual(catalogue.filter((t) => /full.?power|pouvoirs/i.test(`${t.name} ${t.title} ${t.description}`)).map((t) => t.name), []);
  const bySetting = catalogue.filter((t) => Object.keys(t.input?.properties ?? {}).some((k) => /^(setting|settingKey|key|setting_key)$/i.test(k)) && !t.readOnly);
  assert.deepEqual(bySetting.map((t) => t.name), [], "a tool that writes a setting by its name could reach the flag");
  // And a full-powers access, offered every tool, still cannot change the flag of another access through any of them: the list of ids is the same afterwards.
  const a = await access("etoile_nord"), b = await access("lune_douce", "write", { site_info: true });
  await FP.setFullPowers(a.id, true);
  for (const t of catalogue.filter((x) => x.readOnly).slice(0, 25)) await call(a.token, t.name);
  assert.deepEqual(await FP.fullPowersIds(), [a.id]);
  assert.equal(await FP.hasFullPowers(b.id), false);
});
