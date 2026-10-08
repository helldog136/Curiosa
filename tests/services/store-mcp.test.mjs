import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createStore } = await import("@/core/services/store");
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { setSetting } = await import("@/core/settings");
const { McpToolError } = await import("@/core/services/mcp/validate");

beforeEach(() => db.reset());
after(() => db.close());

async function instance(key) {
  const mod = await db.prisma.module.upsert({ where: { id: "m" }, create: { id: "m", source: "bundled", version: "1", enabled: true }, update: {} });
  return db.prisma.moduleInstance.create({ data: { moduleId: mod.id, key, basePath: key } });
}

test("stockage : ajout, lecture, mise à jour, liste (récent d'abord), comptage, suppression", async () => {
  const a = await instance("a");
  const s = createStore(a.id);
  const id1 = await s.add("notes", { n: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const id2 = await s.add("notes", { n: 2 });
  assert.equal((await s.get(id1)).data.n, 1);
  assert.deepEqual((await s.list("notes")).map((r) => r.data.n), [2, 1]);
  assert.equal((await s.list("notes", { limit: 1 })).length, 1);
  assert.equal(await s.count("notes"), 2);
  assert.equal(await s.update(id1, { n: 10 }), true);
  assert.equal((await s.get(id1)).data.n, 10);
  await s.remove(id2);
  assert.equal(await s.count("notes"), 1);
  assert.equal(await s.get(id2), null);
});

test("stockage : une instance ne voit, ne modifie ni ne supprime les données d'une autre", async () => {
  const a = await instance("a");
  const b = await instance("b");
  const sa = createStore(a.id), sb = createStore(b.id);
  const id = await sa.add("c", { secret: true });
  assert.equal(await sb.get(id), null);
  assert.equal(await sb.update(id, { hacked: true }), false);
  await sb.remove(id);
  assert.deepEqual((await sa.get(id)).data, { secret: true });
  assert.equal((await sb.list("c")).length, 0);
});

test("jetons : le texte en clair n'est jamais conservé, authentification, révocation", async () => {
  const token = await T.createToken("Mon agent", "read", "owner@x.y");
  assert.match(token, /^vit_[A-Za-z0-9_-]{40,}$/);
  const row = await db.prisma.apiToken.findFirst();
  assert.notEqual(row.hash, token);
  assert.ok(!JSON.stringify(row).includes(token));
  const authed = await T.authenticate(`Bearer ${token}`);
  assert.equal(authed.name, "Mon agent");
  assert.equal(authed.scope, "read");
  for (const bad of [null, "", "Bearer", "Bearer vit_court", `Basic ${token}`, `bearer ${token}`, `Bearer ${token}x`]) assert.equal(await T.authenticate(bad), null, String(bad));
  await T.revokeToken(row.id);
  assert.equal(await T.authenticate(`Bearer ${token}`), null);
});

test("jetons : droits action par action relus à chaque requête", async () => {
  const token = await T.createToken("a", "write", "o");
  const { id } = await db.prisma.apiToken.findFirst();
  assert.deepEqual((await T.authenticate(`Bearer ${token}`)).grants, {});
  await T.saveTokenGrants(id, { x: true });
  assert.deepEqual((await T.authenticate(`Bearer ${token}`)).grants, { x: true });
  assert.deepEqual((await T.getTokenGrants(id)).grants, { x: true });
  await T.revokeToken(id);
  assert.equal(await T.getTokenGrants(id), null);
});

test("jetons : limitation à 120 requêtes par minute et par jeton", () => {
  const id = "rl-" + Math.random();
  for (let i = 0; i < 120; i++) assert.equal(T.rateLimited(id), false);
  assert.equal(T.rateLimited(id), true);
  assert.equal(T.rateLimited("autre"), false);
});

test("jetons : MCP activé par défaut, désactivable", async () => {
  assert.equal(await T.isMcpEnabled(), true);
  await setSetting("mcp.enabled", false);
  assert.equal(await T.isMcpEnabled(), false);
});

const tool = (over = {}) => ({ name: "t", title: "T", description: "d", readOnly: true, default: true, destructive: false, input: { type: "object", properties: {} }, source: "core", call: async () => ({ ok: 1 }), ...over });
const rpc = (token, body) => new Request("http://x/api/mcp", { method: "POST", headers: { authorization: token ? `Bearer ${token}` : "" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const call = async (token, tools, body) => { const r = await handleMcpRequest(rpc(token, body), async () => tools); return { status: r.status, json: r.status === 202 ? null : await r.json() }; };

test("serveur MCP : 401 sans jeton valide, 503 si désactivé, 400 JSON invalide, 202 notification", async () => {
  const token = await T.createToken("a", "read", "o");
  assert.equal((await call(null, [], { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await call("vit_" + "x".repeat(30), [], { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await call(token, [], "{pas du json")).status, 400);
  assert.equal((await call(token, [], { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  await setSetting("mcp.enabled", false);
  assert.equal((await call(token, [], { jsonrpc: "2.0", id: 1, method: "ping" })).status, 503);
});

test("serveur MCP : initialize négocie la version, ping, méthode inconnue", async () => {
  const token = await T.createToken("a", "read", "o");
  const init = (await call(token, [], { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json;
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal((await call(token, [], { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999" } })).json.result.protocolVersion, "2025-06-18");
  assert.deepEqual((await call(token, [], { jsonrpc: "2.0", id: 2, method: "ping" })).json.result, {});
  assert.equal((await call(token, [], { jsonrpc: "2.0", id: 3, method: "nope" })).json.error.code, -32601);
});

test("serveur MCP : un jeton en lecture ne voit ni n'appelle les outils d'écriture", async () => {
  const token = await T.createToken("lecteur", "read", "o");
  const tools = [tool({ name: "lire" }), tool({ name: "ecrire", readOnly: false, default: true })];
  const list = (await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools.map((t) => t.name);
  assert.deepEqual(list, ["lire"]);
  const r = (await call(token, tools, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ecrire", arguments: {} } })).json;
  assert.equal(r.error.code, -32602);
  const missing = (await call(token, tools, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "n-existe-pas" } })).json;
  assert.equal(missing.error.message.replace("n-existe-pas", "ecrire"), r.error.message, "même réponse : aucune fuite sur l'existence");
});

test("serveur MCP : une action non accordée est invisible, l'accorder prend effet tout de suite", async () => {
  const token = await T.createToken("a", "write", "o");
  const { id } = await db.prisma.apiToken.findFirst();
  const tools = [tool({ name: "supprimer", readOnly: false, default: false, destructive: true })];
  assert.deepEqual((await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools, []);
  await T.saveTokenGrants(id, { supprimer: true });
  assert.deepEqual((await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools.map((t) => t.name), ["supprimer"]);
  await T.saveTokenGrants(id, { supprimer: false });
  assert.deepEqual((await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools, []);
});

test("serveur MCP : appel réussi, annotations, écriture consignée dans l'audit, lecture non", async () => {
  const token = await T.createToken("agent", "write", "o");
  const tools = [tool({ name: "lire" }), tool({ name: "ecrire", readOnly: false, source: "partners", call: async (a, actor) => ({ got: a, by: actor.name }) })];
  const l = (await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json.result.tools;
  assert.equal(l.find((t) => t.name === "lire").annotations.readOnlyHint, true);
  assert.equal(l.find((t) => t.name === "ecrire").annotations.readOnlyHint, false);
  const ok = (await call(token, tools, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ecrire", arguments: { a: 1 } } })).json;
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { got: { a: 1 }, by: "agent" });
  await call(token, tools, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lire" } });
  const audit = await db.prisma.auditLog.findMany();
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].actor, audit[0].action, audit[0].target], ["mcp:agent", "mcp.ecrire", "partners"]);
});

test("serveur MCP : une erreur interne n'est jamais révélée, une erreur volontaire l'est", async () => {
  const token = await T.createToken("a", "read", "o");
  const log = console.error; console.error = () => {};
  try {
    const tools = [
      tool({ name: "boom", call: async () => { throw new Error("secret: /etc/passwd SELECT * FROM x"); } }),
      tool({ name: "poli", call: async () => { throw new McpToolError("Titre requis"); } }),
      tool({ name: "expose", call: async () => { throw Object.assign(new Error("Introuvable"), { expose: true }); } }),
    ];
    const run = async (name) => (await call(token, tools, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name } })).json.result;
    const boom = await run("boom");
    assert.equal(boom.isError, true);
    assert.equal(boom.content[0].text, "The action failed.");
    assert.equal((await run("poli")).content[0].text, "Titre requis");
    assert.equal((await run("expose")).content[0].text, "Introuvable");
  } finally { console.error = log; }
});

test("serveur MCP : lot de requêtes (réponses groupées, notifications omises), limité à 20", async () => {
  const token = await T.createToken("a", "read", "o");
  const batch = [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }];
  const r = (await call(token, [], batch)).json;
  assert.deepEqual(r.map((x) => x.id), [1, 2]);
  const many = Array.from({ length: 30 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
  assert.equal((await call(token, [], many)).json.length, 20);
});

test("serveur MCP : corps trop gros refusé (413)", async () => {
  const token = await T.createToken("a", "read", "o");
  assert.equal((await call(token, [], JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(1_100_000) } }))).status, 413);
});
