import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest, methodNotAllowed } = await import("@/core/services/mcp/server");
const { setSetting } = await import("@/core/settings");
const { AUDIT_ACTIONS } = await import("@/core/auditLabels");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
// Le composant est du TSX (non chargeable ici) : on lit la liste de clés dans sa source.
const GUIDE_KEYS = [...read("src/components/admin/McpConnectGuide.tsx").match(/GUIDE_KEYS = \[([^\]]+)\]/)[1].matchAll(/"([\w.]+)"/g)].map((m) => m[1]);
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const PANEL = "src/app/admin/(panel)/mcp";

const tool = (over = {}) => ({ name: "lire", title: "Lire", description: "d", readOnly: true, default: true, destructive: false, input: { type: "object", properties: {} }, source: "core", call: async () => ({ ok: 1 }), ...over });
const post = (body, headers = {}, url = "http://x/api/mcp") => new Request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const viaHeader = (token, body, tools = [tool()]) => handleMcpRequest(post(body, { authorization: `Bearer ${token}` }), async () => tools);
const viaUrl = (value, body, tools = [tool()]) => handleMcpRequest(post(body, {}, `http://x/api/mcp/${value}`), async () => tools, { token: value });
const parse = async (r) => (r.status === 202 ? null : await r.json());

// ── Transport « Streamable HTTP » ──────────────────────────────────────────────────────────────────────────────────────────────

test("transport : la séquence exacte d'un client (initialize, notifications/initialized, tools/list, tools/call)", async () => {
  const token = await T.createToken("Claude Code", "read", "o");
  const init = await viaHeader(token, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } });
  assert.equal(init.status, 200);
  assert.match(init.headers.get("content-type"), /^application\/json/);
  const i = (await init.json()).result;
  assert.equal(i.protocolVersion, "2025-06-18");
  assert.ok(i.capabilities.tools, "capacité « tools » annoncée");
  assert.ok(!i.capabilities.resources && !i.capabilities.prompts, "on n'annonce que ce qu'on sait faire");
  assert.ok(i.serverInfo.name && i.serverInfo.version);
  assert.equal(init.headers.get("mcp-session-id"), null, "pas de session obligatoire");

  const ready = await viaHeader(token, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(ready.status, 202);
  assert.equal(await ready.text(), "", "202 sans corps");

  const list = (await parse(await viaHeader(token, { jsonrpc: "2.0", id: 1, method: "tools/list" }))).result;
  assert.equal(list.nextCursor, undefined, "pas de pagination");
  assert.equal(list.tools[0].name, "lire");
  assert.equal(list.tools[0].inputSchema.type, "object");
  assert.equal(list.tools[0].inputSchema.additionalProperties, false);

  const called = (await parse(await viaHeader(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lire", arguments: {} } }))).result;
  assert.equal(called.content[0].type, "text");
  assert.deepEqual(JSON.parse(called.content[0].text), { ok: 1 });
  assert.ok(called.isError !== true);
});

test("transport : toute notification (sans id) reçoit 202 sans corps et n'exécute rien ; une réponse du client aussi", async () => {
  const token = await T.createToken("a", "write", "o");
  let calls = 0;
  const tools = [tool({ name: "ecrire", readOnly: false, call: async () => { calls++; return {}; } })];
  for (const m of ["notifications/initialized", "notifications/cancelled", "notifications/roots/list_changed", "ping", "tools/list", "inconnue"]) {
    const r = await viaHeader(token, { jsonrpc: "2.0", method: m }, tools);
    assert.equal(r.status, 202, m);
    assert.equal(await r.text(), "");
  }
  assert.equal((await viaHeader(token, { jsonrpc: "2.0", method: "tools/call", params: { name: "ecrire" } }, tools)).status, 202);
  assert.equal(calls, 0, "une notification n'appelle jamais une action");
  assert.equal((await viaHeader(token, { jsonrpc: "2.0", id: 9, result: {} }, tools)).status, 202);
  assert.equal((await db.prisma.auditLog.count()), 0);
});

test("transport : requêtes invalides, lot vide, erreurs JSON-RPC, ping, versions", async () => {
  const token = await T.createToken("a", "read", "o");
  const code = async (b) => (await parse(await viaHeader(token, b))).error.code;
  assert.equal(await code({ id: 1, method: "ping" }), -32600, "jsonrpc manquant");
  assert.equal(await code({ jsonrpc: "2.0", id: 1 }), -32600, "méthode manquante");
  assert.equal(await code("42"), -32600, "ni objet ni lot");
  assert.equal((await viaHeader(token, [])).status, 400, "lot vide");
  assert.equal(await code({ jsonrpc: "2.0", id: 1, method: "n'existe/pas" }), -32601);
  assert.equal((await viaHeader(token, "{pas du json")).status, 400);
  assert.deepEqual((await parse(await viaHeader(token, { jsonrpc: "2.0", id: "a", method: "ping" }))), { jsonrpc: "2.0", id: "a", result: {} }, "l'id (même texte) est repris tel quel");
  for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) assert.equal((await parse(await viaHeader(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } }))).result.protocolVersion, v);
  assert.equal((await parse(await viaHeader(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } }))).result.protocolVersion, "2025-06-18", "version inconnue : on propose la nôtre");
  assert.equal((await parse(await viaHeader(token, { jsonrpc: "2.0", id: 1, method: "initialize" }))).result.protocolVersion, "2025-06-18");
});

test("transport : lot accepté (réponses groupées, notifications omises), erreur interne masquée", async () => {
  const token = await T.createToken("a", "read", "o");
  const r = await parse(await viaHeader(token, [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]));
  assert.deepEqual(r.map((x) => x.id), [1, 2]);
  const log = console.error; console.error = () => {};
  try {
    const res = await handleMcpRequest(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` }), async () => { throw new Error("secret interne /etc/passwd"); });
    const body = await res.json();
    assert.equal(body.error.code, -32603);
    assert.ok(!JSON.stringify(body).includes("passwd"));
  } finally { console.error = log; }
});

test("transport : GET et DELETE répondent 405 avec Allow: POST, une session Mcp-Session-Id envoyée est simplement ignorée", async () => {
  const r = methodNotAllowed();
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
  assert.match(await r.text(), /Use POST/);
  for (const file of ["src/app/api/mcp/route.ts", "src/app/api/mcp/[token]/route.ts"]) {
    const src = read(file);
    assert.match(src, /export const GET = methodNotAllowed/, file);
    assert.match(src, /export const DELETE = methodNotAllowed/, file);
  }
  const token = await T.createToken("a", "read", "o");
  const withSession = await handleMcpRequest(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${token}`, "mcp-session-id": "abc", "mcp-protocol-version": "2025-06-18" }), async () => []);
  assert.equal(withSession.status, 200);
});

test("transport : réponses jamais mises en cache, sans référent, y compris les erreurs", async () => {
  const token = await T.createToken("a", "read", "o", { byUrl: true });
  const all = [
    await viaHeader(token, { jsonrpc: "2.0", id: 1, method: "ping" }),
    await viaHeader(token, { jsonrpc: "2.0", method: "notifications/initialized" }),
    await viaHeader("vit_" + "x".repeat(30), { jsonrpc: "2.0", id: 1, method: "ping" }),
    await viaHeader(token, "{"),
    await viaUrl(token, { jsonrpc: "2.0", id: 1, method: "ping" }),
    await viaUrl("vit_" + "x".repeat(30), { jsonrpc: "2.0", id: 1, method: "ping" }),
    methodNotAllowed(),
  ];
  for (const r of all) {
    assert.equal(r.headers.get("cache-control"), "no-store", String(r.status));
    assert.equal(r.headers.get("referrer-policy"), "no-referrer", String(r.status));
  }
  const unauthorized = all[2];
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");
});

test("transport : la configuration impose no-referrer et no-store aux adresses /api/mcp (elle écrase la règle générale du site)", () => {
  const cfg = read("next.config.mjs");
  assert.match(cfg, /source: "\/api\/mcp\/:path\*", headers: \[\{ key: "Referrer-Policy", value: "no-referrer" \}, \{ key: "Cache-Control", value: "no-store" \}\]/);
  assert.ok(cfg.indexOf('source: "/:path*"') < cfg.indexOf('source: "/api/mcp/:path*"'), "la règle précise vient après la règle générale");
});

// ── Authentification : en-tête (inchangée) et adresse secrète ──────────────────────────────────────────────────────────────────

test("adresse secrète : désactivée par défaut ; un jeton ne s'authentifie par adresse que si l'option est active", async () => {
  const plain = await T.createToken("sans", "read", "o");
  const marked = await T.createToken("avec", "read", "o", { byUrl: true });
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await viaHeader(plain, ping)).status, 200, "l'en-tête marche toujours");
  assert.equal((await viaHeader(marked, ping)).status, 200, "et pour un jeton marqué aussi");
  assert.equal((await viaUrl(plain, ping)).status, 404, "non marqué : refusé");
  assert.equal((await viaUrl(marked, ping)).status, 200);
  const rows = await db.prisma.apiToken.findMany();
  const idOf = (name) => rows.find((r) => r.name === name).id;
  assert.equal(await T.isUrlAccessEnabled(idOf("sans")), false);
  assert.equal(await T.isUrlAccessEnabled(idOf("avec")), true);
  // Activer plus tard, retirer, et la révocation retire aussi l'option.
  await T.setUrlAccess(idOf("sans"), true);
  assert.equal((await viaUrl(plain, ping)).status, 200);
  await T.setUrlAccess(idOf("sans"), false);
  assert.equal((await viaUrl(plain, ping)).status, 404);
  await T.revokeToken(idOf("avec"));
  assert.equal((await viaUrl(marked, ping)).status, 404);
  assert.equal((await viaHeader(marked, ping)).status, 401);
  assert.deepEqual(await T.urlAccessIds(), []);
});

test("adresse secrète : le jeton de l'adresse suit les mêmes droits que celui de l'en-tête (plafond et accès relus à chaque requête)", async () => {
  const token = await T.createToken("a", "read", "o", { byUrl: true });
  const tools = [tool(), tool({ name: "ecrire", readOnly: false })];
  const names = async (via) => (await parse(await via(token, { jsonrpc: "2.0", id: 1, method: "tools/list" }, tools))).result.tools.map((t) => t.name);
  assert.deepEqual(await names(viaUrl), ["lire"]);
  assert.deepEqual(await names(viaHeader), ["lire"]);
});

test("adresse secrète : jeton inconnu, mal formé, révoqué ou non autorisé = exactement la même réponse (pas d'oracle)", async () => {
  const unmarked = await T.createToken("sans", "read", "o");
  const revoked = await T.createToken("rev", "read", "o", { byUrl: true });
  await T.revokeToken((await db.prisma.apiToken.findFirst({ where: { name: "rev" } })).id);
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  const seen = new Set();
  for (const value of [unmarked, revoked, "vit_" + "a".repeat(43), "vit_court", "pas-un-jeton", "vit_" + "!".repeat(30), "%2e%2e", "x".repeat(5000), ""]) {
    const r = await viaUrl(value, ping);
    seen.add(JSON.stringify([r.status, await r.text(), r.headers.get("content-type"), r.headers.get("www-authenticate")]));
  }
  assert.equal(seen.size, 1, [...seen].join("\n"));
  assert.match([...seen][0], /^\[404,/);
});

test("adresse secrète : MCP désactivé = 503 pour tout le monde, sans rien dire du jeton", async () => {
  const marked = await T.createToken("a", "read", "o", { byUrl: true });
  await setSetting("mcp.enabled", false);
  const a = await viaUrl(marked, { jsonrpc: "2.0", id: 1, method: "ping" });
  const b = await viaUrl("vit_" + "z".repeat(40), { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.deepEqual([a.status, await a.text()], [b.status, await b.text()]);
  assert.equal(a.status, 503);
});

test("adresse secrète : le jeton n'apparaît ni dans l'audit, ni dans les erreurs, ni dans les en-têtes de réponse", async () => {
  const token = await T.createToken("agent", "write", "o", { byUrl: true });
  const logs = [];
  const log = console.error; console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    const tools = [
      tool({ name: "ecrire", readOnly: false, call: async () => ({ fait: true }) }),
      tool({ name: "boom", call: async () => { throw new Error("échec interne"); } }),
    ];
    const out = [];
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ecrire", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom" } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inconnu" } },
      { jsonrpc: "2.0", id: 4, method: "nope" },
      "{",
    ]) {
      const r = await viaUrl(token, body, tools);
      out.push(JSON.stringify([...r.headers.entries()]), await r.text());
    }
    // Échecs : adresse mal formée, adresse d'un jeton non autorisé.
    const plain = await T.createToken("sans", "read", "o");
    const failed = await viaUrl(plain, { jsonrpc: "2.0", id: 1, method: "ping" });
    out.push(JSON.stringify([...failed.headers.entries()]), await failed.text());
    for (const text of out) { assert.ok(!text.includes(token), "jeton dans une réponse"); assert.ok(!text.includes(plain), "jeton dans une erreur"); }
  } finally { console.error = log; }
  assert.ok(logs.length > 0 && logs.every((l) => !l.includes(token)), "jeton dans les journaux du serveur");
  const audit = JSON.stringify(await db.prisma.auditLog.findMany());
  assert.ok(audit.includes("mcp:agent") && !audit.includes(token) && !audit.includes(token.slice(4, 24)));
  // Le jeton n'est jamais écrit en clair en base non plus (seulement son hash et son préfixe de 8 caractères).
  assert.ok(!JSON.stringify(await db.prisma.apiToken.findMany()).includes(token));
  assert.ok(!JSON.stringify(await db.prisma.setting.findMany()).includes(token));
});

// ── Interface ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("option réservée au propriétaire : création et changement passent par adresse d'administrateur « owner », sans migration", () => {
  const actions = read(`${PANEL}/actions.ts`);
  for (const name of ["createTokenAction", "setUrlAccessAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 200), /adminCtx\("owner"\)/, name);
  }
  assert.match(actions, /audit\(user\.email, "mcp\.token\.url\.on", row\.name\)/);
  assert.match(actions, /audit\(user\.email, "mcp\.token\.url\.off", row\.name\)/);
  assert.ok(![...actions.matchAll(/audit\(([^)]*)\)/g)].some((m) => /\btoken\b(?!Id)/.test(m[1].replace(/"[^"]*"/g, ""))), "jamais le jeton dans l'audit");
  assert.ok(AUDIT_ACTIONS.includes("mcp.token.url.on") && AUDIT_ACTIONS.includes("mcp.token.url.off"));
  assert.ok(!/url|secret/i.test(read("prisma/schema.prisma").slice(read("prisma/schema.prisma").indexOf("model ApiToken"), read("prisma/schema.prisma").indexOf("model ApiToken") + 900)), "option stockée en réglage, pas de colonne");
});

test("interface : clés fr/en présentes pour le guide, la création et l'accès par adresse", () => {
  for (const k of GUIDE_KEYS) assert.ok(fr[k]?.trim() && en[k]?.trim(), k);
  const keys = Object.keys(fr).filter((k) => /^mcp\.(connect|guide|created|url|urlOption|urlOptionHelp|urlChip)/.test(k) || k.startsWith("audit.action.mcp.token.url"));
  assert.ok(keys.length > 40);
  for (const k of keys) assert.ok(en[k]?.trim(), k);
  const used = new Set();
  for (const f of [`${PANEL}/page.tsx`, `${PANEL}/[id]/page.tsx`, "src/components/admin/McpConnectGuide.tsx", "src/components/admin/McpTokenCreator.tsx"]) for (const m of read(f).matchAll(/\bt\(\s*"([\w.]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(fr[k] && en[k], `clé manquante : ${k}`);
  for (const k of ["mcp.url.title", "mcp.url.enable", "mcp.url.disable", "mcp.urlChip", "mcp.created.title", "mcp.urlOption"]) assert.ok(used.has(k) || fr[k], k);
  assert.match(fr["mcp.urlOptionHelp"], /EST le mot de passe/);
  assert.match(fr["mcp.urlOptionHelp"], /journaux de votre serveur web/);
  assert.match(fr["mcp.urlOptionHelp"], /révoquez le jeton/);
  assert.match(fr["mcp.guide.test.expected"], /jeton absent ou mal formé/);
  assert.match(en["mcp.guide.test.expected"], /missing or malformed/);
});

test("page « API & MCP » : encadré en 3 étapes en tête, un bloc par assistant, jeton réel seulement à la création", () => {
  const page = read(`${PANEL}/page.tsx`);
  const guide = read("src/components/admin/McpConnectGuide.tsx");
  const creator = read("src/components/admin/McpTokenCreator.tsx");
  assert.ok(page.indexOf('testid="mcp-connect"') < page.indexOf('testid="mcp-status"'), "l'encadré vient en premier");
  for (const k of ["mcp.connect.s1", "mcp.connect.s2", "mcp.connect.s3"].map((x) => x.replace("mcp.connect.", ""))) assert.ok(page.includes(`"${k}"`));
  for (const id of ["mcp-guide-claude", "mcp-guide-code", "mcp-guide-other", "mcp-guide-test", "mcp-guide-how"]) assert.ok(guide.includes(id), id);
  assert.match(guide, /claude mcp add --transport http curiosa \$\{endpoint\} --header "Authorization: Bearer \$\{secret\}"/);
  assert.match(guide, /mcpServers/);
  assert.match(guide, /"initialize"|method":"initialize"/);
  assert.match(guide, /tools\/list/);
  assert.match(guide, /CopyBlock/);
  assert.match(page, /<McpConnectGuide texts=\{guide\} baseUrl=\{siteUrl\} advanced=\{advanced\} \/>/, "sur la page : le marqueur, jamais de jeton");
  assert.ok(!/token=/.test(page), "la page ne passe aucun jeton au guide");
  assert.ok(!guide.includes("prisma") && !guide.includes("@/core"), "le guide ne lit rien en base");
  assert.match(creator, /token=\{created\.token\}/, "le jeton réel n'est inséré que dans l'écran de création");
  assert.match(fr["mcp.guide.marker"], /^<votre-jeton>$/);
  assert.match(en["mcp.guide.marker"], /^<your-token>$/);
  assert.match(fr["mcp.guide.how.header"], /Authorization: Bearer vit_/);
  assert.match(fr["mcp.guide.how.browser"], /Use POST/);
});

test("changelog : une entrée « Prochaine version » non technique pour la connexion simplifiée", () => {
  const md = read("CHANGELOG.md");
  const head = md.slice(md.indexOf("## 0.1.12"), md.indexOf("## 0.1.11"));
  assert.match(head, /\*Changements depuis la 0\.1\.11\.\*/);
  assert.match(head, /### Nouveautés\n- /);
});

test("page des accès d'un jeton : prévient que l'assistant relit ses outils à la connexion (pas de tools/list_changed envoyé)", async () => {
  assert.match(fr["mcp.accessIntro"], /reconnect/i);
  assert.match(en["mcp.accessIntro"], /reconnect/i);
  const init = await viaHeader(await T.createToken("c", "read", "o"), { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal((await init.json()).result.capabilities.tools.listChanged, false, "le serveur n'annonce pas de notification : le texte d'aide est donc nécessaire");
});
