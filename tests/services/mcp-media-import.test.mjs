import test, { beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { png } from "../helpers/images.mjs";

// media_import: images downloaded from addresses the OWNER put on the "trusted image sources" list. Every line of the threat model in
// docs/MAINTENANCE-IA.md has a test here. The "network" is a local http server on 127.0.0.1 (the test-only switch CURIOSA_TEST_IMPORT_LOCAL opens
// http://127.0.0.1 and nothing else) and a fake name server: the names below end in ".example" and never exist for real, so a success proves that the
// connection went to the pinned, verified address and not to a second resolution.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const SL = await import("@/core/maintenance/slots");
const P = await import("@/core/services/mcp/profiles");
const { setSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");
const F = await import("@/core/trustedImageFetch");
const S = await import("@/core/trustedImageSources");

const WRITE = ["media_import", "media_upload", "media_list", "maintenance_request_status"];
let server; let port; let hits; let handler;
const RESOLVE = { "allowed.example": ["127.0.0.1"], "other.example": ["127.0.0.1"], "evil.example": ["127.0.0.1"] };
let resolveCalls;

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  process.env.CURIOSA_TEST_IMPORT_LOCAL = "1";
  hits = [];
  handler = (req, res) => { res.writeHead(200, { "content-type": "image/png" }); res.end(png(16, 12)); };
  server = http.createServer((req, res) => { hits.push({ host: req.headers.host, url: req.url, headers: req.headers }); handler(req, res); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  resolveCalls = [];
  F.importDeps.resolve = async (host) => { resolveCalls.push(host); const a = RESOLVE[host]; return a ? { ok: true, addresses: a } : { ok: false, reason: "notfound" }; };
  F.importDeps.timeoutMs = 10_000;
  await sources(`allowed.example:${port}/screens/`);
});
afterEach(async () => { F.resetImportDeps(); delete process.env.CURIOSA_TEST_IMPORT_LOCAL; server.closeAllConnections(); await new Promise((r) => server.close(r)); });
after(() => db.close());

/** Replaces the owner's list (the test plays the owner; no MCP tool can do this). */
async function sources(...texts) {
  await db.prisma.setting.deleteMany({ where: { key: S.TRUSTED_SOURCES_KEY } });
  for (const t of texts) { const p = S.parseSource(t); assert.ok(p.ok, `${t}: ${JSON.stringify(p)}`); assert.ok((await S.addTrustedSource(p.source)).ok); }
}
const u = (host, p, query = "") => `http://${host}:${port}${p}${query}`;

const send = (token, body) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), listMcpTools);
const rpc = (token, method, params = {}) => send(token, { jsonrpc: "2.0", id: 1, method, params });
const listed = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function access(grant = WRITE, scope = "write") {
  const token = await T.createToken("Camille", scope, "owner@example.org", { grants: Object.fromEntries(grant.map((g) => [g, true])) });
  return { token, id: await T.findTokenId(token) };
}
const imp = (token, url, over = {}) => call(token, "media_import", { url, alt: "Home screen of the Etoile Nord module", ...over });
const files = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : []);
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });
const GOOD = "/screens/home.png";
const used = async (id) => (await SL.remainingSlots(id)).content.used;

// ── Rights ────────────────────────────────────────────────────────────────────────────────────

test("right: a separate tool right, off by default, assistant preset, never for a read-only access; media_upload does not give it", async () => {
  const tools = Object.fromEntries((await listMcpTools()).map((t) => [t.name, t]));
  const t = tools.media_import;
  assert.deepEqual([t.readOnly, t.default, t.destructive], [false, false, false]);
  assert.equal(P.placementOf(t), "assistant");
  const plain = await T.createToken("Brouillons", "write", "o");
  assert.ok(!(await listed(plain)).includes("media_import"));
  const onlyUpload = await access(["media_upload"]);
  assert.ok(!(await listed(onlyUpload.token)).includes("media_import"));
  assert.match((await imp(onlyUpload.token, u("allowed.example", GOOD))).error, /Unknown tool/);
  const readOnly = await access(WRITE, "read");
  assert.ok(!(await listed(readOnly.token)).includes("media_import"));
  assert.match((await imp(readOnly.token, u("allowed.example", GOOD))).error, /Unknown tool/);
  assert.equal(hits.length, 0);
  assert.equal(files().length, 0);
  const granted = await access();
  assert.ok((await listed(granted.token)).includes("media_import"));
});

test("right: the plain-words line exists in English and French; the profile placement lists it", async () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")); const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  assert.ok(en["aim.tool.media_import"] && fr["aim.tool.media_import"]);
  assert.ok(P.PROFILE_TOOLS.assistant.includes("media_import") && !P.PROFILE_TOOLS.read.includes("media_import"));
});

test("no tool of the catalogue can write the list: nothing named like it, and only the admin actions import the writers", async () => {
  const names = (await listMcpTools()).map((t) => t.name);
  assert.ok(!names.some((n) => /trusted|import_source|source/i.test(n) && n !== "media_import"), names.filter((n) => /trusted|source/i.test(n)).join());
  const offenders = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) {
    if (/trustedImageSources\.ts$/.test(f) || /app\/admin\/\(panel\)\/assistants\/(actions\.ts|TrustedSources\.tsx)$/.test(f)) continue;
    if (/\b(addTrustedSource|removeTrustedSource|TRUSTED_SOURCES_KEY)\b/.test(fs.readFileSync(f, "utf8"))) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
  // The admin actions are guarded by the right that manages the assistants.
  const actions = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  for (const fn of ["addTrustedSourceAction", "addPresetSourceAction", "removeTrustedSourceAction"]) assert.match(actions.slice(actions.indexOf(`function ${fn}`)).split("\n").slice(0, 3).join("\n"), /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/, fn);
});

// ── The list is the owner's, and empty means off ────────────────────────────────────────────────

test("empty list: the tool answers that it is off and tells the owner where to add a source; nothing is fetched or stored; no slot is used", async () => {
  await sources();
  const { token, id } = await access();
  const r = await imp(token, u("allowed.example", GOOD));
  assert.match(r.error, /off.*Admin > AI assistants > Trusted image sources/);
  assert.match((await call(token, "media_import", { urls: [{ url: u("allowed.example", GOOD), alt: "x" }] })).error, /off/);
  assert.deepEqual([hits.length, resolveCalls.length, files().length, await used(id)], [0, 0, 0, 0]);
});

test("list management: entries are parsed strictly, saved, deduplicated, capped, removed, and a damaged list is ignored", async () => {
  const ok = (t) => { const p = S.parseSource(t); assert.ok(p.ok, t); return S.sourceLabel(p.source); };
  assert.equal(ok("raw.githubusercontent.com/helldog136/"), "raw.githubusercontent.com/helldog136/");
  assert.equal(ok("https://Images.Example.org/Screens"), "images.example.org/Screens/");
  assert.equal(ok("images.example.org"), "images.example.org/");
  assert.equal(ok("images.example.org:443/a/b/"), "images.example.org/a/b/");
  assert.equal(ok("images.example.org:8443/x"), "images.example.org:8443/x/");
  assert.deepEqual(S.PRESET_SOURCE, { host: "raw.githubusercontent.com", path: "/helldog136/" });
  const bad = {
    "": "empty", "   ": "empty", "http://images.example.org/": "scheme", "ftp://images.example.org/": "scheme",
    "*.example.org": "invalid", "images.*.org": "invalid", "https://allowed.example@evil.example/": "invalid", "user:pw@images.example.org": "invalid",
    "127.0.0.1": "host", "10.0.0.5/x/": "host", "[::1]/": "host", "localhost": "host", "printer.local": "host", "intranet": "host", "2130706433": "host",
    "images.example.org:0": "port", "images.example.org:99999": "port",
    "images.example.org/a/../b/": "path", "images.example.org//x/": "path", "images.example.org/a b/": "invalid", "images.example.org/a?x=1": "invalid",
    "images.example.org/a#top": "invalid", "images.example.org/%2e%2e/": "invalid", "images.example.org/a\\b": "invalid", "images.example.org/é/": "path", "bé.example.org": "host",
    "images..example.org": "host", ".example.org": "host", "images.example.org.": "host",
  };
  for (const [text, problem] of Object.entries(bad)) assert.deepEqual(S.parseSource(text), { ok: false, problem }, JSON.stringify(text));
  await sources();
  assert.deepEqual(await S.listTrustedSources(), []);
  const a = S.parseSource("images.example.org/screens"); assert.ok(a.ok);
  assert.equal((await S.addTrustedSource(a.source)).ok, true);
  assert.deepEqual(await S.addTrustedSource(a.source), { ok: false, problem: "duplicate" });
  for (let i = 1; i < S.MAX_SOURCES; i++) assert.equal((await S.addTrustedSource({ host: `s${i}.example.org`, path: "/" })).ok, true);
  assert.deepEqual(await S.addTrustedSource({ host: "one-more.example.org", path: "/" }), { ok: false, problem: "full" });
  assert.equal((await S.listTrustedSources()).length, S.MAX_SOURCES);
  assert.equal((await S.removeTrustedSource("images.example.org/screens/"))?.host, "images.example.org");
  assert.equal(await S.removeTrustedSource("images.example.org/screens/"), null);
  assert.equal((await S.listTrustedSources()).length, S.MAX_SOURCES - 1);
  // A damaged or hostile saved list: unreadable text, wrong shapes, an entry that would not be accepted today.
  await setSetting(S.TRUSTED_SOURCES_KEY, [{ host: "127.0.0.1", path: "/" }, { host: "*.example.org", path: "/" }, "x", null, { host: "ok.example.org", path: "/a/../" }, { host: "fine.example.org", path: "/a/" }]);
  assert.deepEqual(await S.listTrustedSources(), [{ host: "fine.example.org", path: "/a/" }]);
  await db.prisma.setting.update({ where: { key_locale: { key: S.TRUSTED_SOURCES_KEY, locale: "" } }, data: { value: "{not json" } });
  assert.deepEqual(await S.listTrustedSources(), []);
});

test("a removal takes effect at once: the next import is refused", async () => {
  const { token } = await access();
  assert.ok((await imp(token, u("allowed.example", GOOD))).value);
  await S.removeTrustedSource(`allowed.example:${port}/screens/`);
  assert.match((await imp(token, u("allowed.example", "/screens/b.png"))).error, /off/);
});

// ── The happy path, and what is (not) sent ──────────────────────────────────────────────────────

test("import: an image of a trusted source is stored under a random name with its text; no cookie, no credential, a fixed User-Agent, no compression asked", async () => {
  const { token } = await access();
  const buf = png(40, 30);
  handler = (req, res) => { res.writeHead(200, { "content-type": "image/png", "set-cookie": "sid=abc" }); res.end(buf); };
  const { value } = await imp(token, u("allowed.example", GOOD, "?token=SECRET123"));
  assert.match(value.address, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual([value.type, value.bytes, value.width, value.height, value.alt], ["image/png", buf.length, 40, 30, "Home screen of the Etoile Nord module"]);
  assert.ok(fs.readFileSync(path.join(UPLOADS_DIR, files()[0])).equals(buf));
  assert.ok(!JSON.stringify(value).includes("SECRET123"), "the query never comes back");
  assert.equal(hits.length, 1);
  const h = hits[0].headers;
  assert.equal(h["user-agent"], F.IMPORT_USER_AGENT);
  assert.match(h["user-agent"], /^Curiosa-ImageImport\/1/);
  assert.equal(h["accept-encoding"], "identity");
  for (const name of ["cookie", "authorization", "proxy-authorization", "referer", "origin"]) assert.equal(h[name], undefined, name);
  assert.deepEqual(Object.keys(h).sort(), ["accept", "accept-encoding", "connection", "host", "user-agent"]);
  // The alternative text is stored like media_upload's, and media_list shows the image.
  const list = (await call(token, "media_list")).value;
  assert.equal(list.items[0].alt, "Home screen of the Etoile Nord module");
});

test("journal: host and path without the query, the stored name and the size; never the bytes or the secret", async () => {
  const { token } = await access();
  const buf = png(20, 20);
  handler = (req, res) => { res.writeHead(200); res.end(buf); };
  const { value } = await imp(token, u("allowed.example", GOOD, "?token=SECRET123&x=1"));
  const rows = await audits("media.import");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actorKind, "assistant");
  assert.equal(rows[0].actor, "mcp:Camille");
  assert.ok(rows[0].target.includes(value.id) && rows[0].target.includes(`${buf.length} bytes`) && rows[0].target.includes(`allowed.example:${port}/screens/home.png`), rows[0].target);
  for (const secret of ["SECRET123", "token=", "?", buf.toString("base64").slice(0, 30), buf.toString("latin1").slice(0, 8)]) assert.ok(!rows[0].target.includes(secret), secret);
  assert.equal((await audits("media.upload")).length, 0);
});

test("alt text is required (125 characters at most), checked before any slot or connection", async () => {
  const { token, id } = await access();
  const url = u("allowed.example", GOOD);
  assert.match((await call(token, "media_import", { url })).error, /both "url" and "alt"/i);
  assert.match((await imp(token, url, { alt: "   " })).error, /alt/);
  assert.match((await imp(token, url, { alt: "a".repeat(126) })).error, /shorten it to 125/);
  assert.match((await imp(token, url, { alt: "line\u0000break" })).error, /control characters/);
  assert.match((await call(token, "media_import", { alt: "x" })).error, /both "url" and "alt"/i);
  assert.match((await call(token, "media_import", {})).error, /Give "url" and "alt"/);
  assert.match((await call(token, "media_import", { url, alt: "x", urls: [{ url, alt: "x" }] })).error, /not both/);
  assert.match((await call(token, "media_import", { url, alt: "x", dataBase64: "AAAA" })).error, /unexpected argument/);
  assert.deepEqual([hits.length, await used(id), files().length], [0, 0, 0]);
});

// ── Which addresses are accepted ────────────────────────────────────────────────────────────────

test("address rules: the host is the exact text of an entry, the path a whole-segment prefix; credentials, ports, suffix tricks, numbers and odd paths are refused before any connection", async () => {
  await sources(`allowed.example:${port}/screens/`, `other.example:${port}/`);
  const { token, id } = await access();
  const refused = {
    "userinfo trick": `http://allowed.example@evil.example:${port}/screens/a.png`,
    "userinfo with password": `http://allowed.example:x@allowed.example:${port}/screens/a.png`,
    "suffix trick": u("allowed.example.evil.example", "/screens/a.png"),
    "prefix trick": u("evil-allowed.example", "/screens/a.png"),
    "other host": u("evil.example", "/screens/a.png"),
    "trailing dot": u("allowed.example.", "/screens/a.png"),
    "wrong port": `http://allowed.example:${port + 1}/screens/a.png`,
    "no port (entry has one)": "http://allowed.example/screens/a.png",
    "other folder": u("allowed.example", "/private/a.png"),
    "sibling folder": u("allowed.example", "/screens2/a.png"),
    "parent folder": u("allowed.example", "/a.png"),
    "dot segments": u("allowed.example", "/screens/../private/a.png"),
    "encoded dot segments": u("allowed.example", "/screens/%2e%2e/private/a.png"),
    "encoded slash": u("allowed.example", "/screens/..%2fprivate/a.png"),
    "encoded backslash": u("allowed.example", "/screens/..%5cprivate/a.png"),
    "different case in the folder": u("allowed.example", "/Screens/a.png"),
    "ip number": `http://127.0.0.1:${port}/screens/a.png`,
    "ip number as an integer": `http://2130706433:${port}/screens/a.png`,
    "ipv6 loopback": `http://[::1]:${port}/screens/a.png`,
    "other scheme: ftp": "ftp://allowed.example/screens/a.png",
    "other scheme: file": "file:///etc/passwd",
    "other scheme: data": "data:image/png;base64,AAAA",
    "other scheme: javascript": "javascript:alert(1)",
    "not an address": "just some words",
    "empty host": "http:///screens/a.png",
  };
  for (const [what, url] of Object.entries(refused)) {
    const r = await imp(token, url);
    assert.ok(r.error, `${what} must be refused`);
    assert.ok(!/ECONN|ENOTFOUND|stack|at .*\.(ts|mjs)/.test(r.error), `${what}: plain words, got ${r.error}`);
  }
  assert.match((await imp(token, refused["userinfo trick"])).error, /user name or a password/);
  assert.match((await imp(token, u("evil.example", "/screens/a.png"))).error, /not in the trusted image sources.*Admin > AI assistants > Trusted image sources/);
  assert.match((await imp(token, refused["ip number"])).error, /number instead of a site name/);
  assert.deepEqual([hits.length, resolveCalls.length, files().length, await used(id)], [0, 0, 0, 0], "no connection, no name lookup, no slot");
  // And what is accepted: the host in capitals (the address parser lowers it), a deeper folder, an entry for the whole host.
  assert.ok((await imp(token, `http://ALLOWED.example:${port}/screens/deep/er/a.png`)).value);
  assert.ok((await imp(token, u("other.example", "/anything/a.png"))).value);
  assert.equal(hits.length, 2);
});

test("https only: with the test switch off, a plain http address is refused before any connection", async () => {
  delete process.env.CURIOSA_TEST_IMPORT_LOCAL;
  const { token, id } = await access();
  const r = await imp(token, u("allowed.example", GOOD));
  assert.match(r.error, /must start with https:\/\//);
  assert.deepEqual([hits.length, resolveCalls.length, await used(id)], [0, 0, 0]);
  // The switch is ignored in production.
  process.env.CURIOSA_TEST_IMPORT_LOCAL = "1";
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { assert.match((await imp(token, u("allowed.example", GOOD))).error, /must start with https:\/\//); } finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
  assert.equal(hits.length, 0);
});

test("no exemption outside the tests: without the switch, a name that resolves to 127.0.0.1 is refused before any connection", async () => {
  delete process.env.CURIOSA_TEST_IMPORT_LOCAL;
  const { token } = await access();
  await sources(`allowed.example:${port}/screens/`);
  const r = await imp(token, `https://allowed.example:${port}/screens/a.png`);
  assert.match(r.error, /private or internal network address/);
  assert.equal(hits.length, 0);
});

// ── Name resolution ─────────────────────────────────────────────────────────────────────────────

test("private, loopback, link-local, shared and metadata addresses (IPv4 and IPv6) are refused, even when only one of several addresses is bad; nothing is fetched", async () => {
  await sources(`allowed.example:${port}/screens/`);
  process.env.CURIOSA_TEST_IMPORT_LOCAL = "1";
  const { token } = await access();
  const bad = ["10.0.0.5", "172.16.3.4", "192.168.1.9", "127.0.0.2", "0.0.0.0", "169.254.169.254", "100.64.0.1", "100.127.255.254", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2001:db8::1", "ff02::1", "not an address"];
  for (const ip of bad) {
    F.importDeps.resolve = async () => ({ ok: true, addresses: [ip] });
    const r = await imp(token, u("allowed.example", GOOD));
    assert.match(r.error ?? "", /private or internal network address/, ip);
  }
  F.importDeps.resolve = async () => ({ ok: true, addresses: ["127.0.0.1", "10.0.0.5"] });
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /private or internal/, "one bad address among good ones");
  F.importDeps.resolve = async () => ({ ok: true, addresses: ["127.0.0.1", "::1"] });
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /private or internal/, "ipv6 loopback next to the test address");
  assert.equal(hits.length, 0);
  assert.equal(files().length, 0);
  F.importDeps.resolve = async () => ({ ok: false, reason: "notfound" });
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /cannot be found/);
  F.importDeps.resolve = async () => ({ ok: false, reason: "timeout" });
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /did not answer in time/);
});

test("rebinding: the name is looked up once per hop and the connection goes to the verified address only", async () => {
  const { token } = await access();
  let calls = 0;
  F.importDeps.resolve = async () => { calls++; return { ok: true, addresses: calls === 1 ? ["127.0.0.1"] : ["10.0.0.5"] }; };
  assert.ok((await imp(token, u("allowed.example", GOOD))).value);
  assert.equal(calls, 1, "one lookup, then the pinned address is used");
  // Direct check of the connection rule: the pinned lookup answers only with the verified addresses, whatever name is asked.
  const { pinnedLookup } = await import("@/core/maintenance/content/net");
  const answer = await new Promise((resolve) => pinnedLookup(["93.184.216.34"])("anything.example", { all: true }, (e, a) => resolve(e ?? a)));
  assert.deepEqual(answer, [{ address: "93.184.216.34", family: 4 }]);
  const refused = await new Promise((resolve) => pinnedLookup(["10.0.0.5"])("anything.example", { all: true }, (e) => resolve(e)));
  assert.equal(refused.code, "ENOTFOUND");
});

// ── Redirects ───────────────────────────────────────────────────────────────────────────────────

test("redirects: followed at most twice; each hop must match the list, use https and a public address; loops and outside targets are refused", async () => {
  await sources(`allowed.example:${port}/screens/`, `other.example:${port}/`);
  const { token } = await access();
  const to = (location, status = 302) => (req, res) => { res.writeHead(status, { location }); res.end(); };
  const routes = {};
  handler = (req, res) => (routes[req.url] ?? ((q, r) => { r.writeHead(200); r.end(png(10, 10)); }))(req, res);

  // Two hops inside the list: fine, and the journal keeps both addresses.
  routes["/screens/a.png"] = to("/screens/b.png", 301);
  routes["/screens/b.png"] = to(u("other.example", "/c.png"), 307);
  assert.ok((await imp(token, u("allowed.example", "/screens/a.png"))).value);
  assert.equal(hits.length, 3);
  assert.match((await audits("media.import"))[0].target, /from allowed\.example:\d+\/screens\/a\.png via other\.example:\d+\/c\.png/);

  // Three hops: too many.
  hits.length = 0;
  routes["/screens/c1.png"] = to("/screens/c2.png"); routes["/screens/c2.png"] = to("/screens/c3.png"); routes["/screens/c3.png"] = to("/screens/ok.png");
  assert.match((await imp(token, u("allowed.example", "/screens/c1.png"))).error, /redirects more than 2 times/);
  assert.equal(hits.length, 3);

  // To a host that is not on the list: refused, and that host is never contacted.
  hits.length = 0;
  routes["/screens/x.png"] = to(u("evil.example", "/steal.png"));
  const r = await imp(token, u("allowed.example", "/screens/x.png"));
  assert.match(r.error, /redirection target.*not in the trusted image sources/);
  assert.deepEqual(hits.map((h) => h.host.split(":")[0]), ["allowed.example"]);

  // To a folder of the same host that is not on the list; to another scheme; to a number; with a user name; to a relative parent.
  for (const [what, loc, re] of [
    ["other folder", "/private/x.png", /not in the trusted image sources/],
    ["parent folder", "/screens/../secret.png", /not in the trusted image sources/],
    ["ftp", "ftp://allowed.example/screens/x.png", /must start with https/],
    ["file", "file:///etc/passwd", /must start with https/],
    ["ip number", `http://127.0.0.1:${port}/screens/x.png`, /number instead of a site name/],
    ["metadata ip", "http://169.254.169.254/latest/meta-data/", /number instead of a site name/],
    ["ipv6", `http://[::1]:${port}/screens/x.png`, /number instead of a site name/],
    ["user name", `http://allowed.example@evil.example:${port}/screens/x.png`, /user name or a password/],
    ["no destination", "", /no usable destination/],
  ]) {
    hits.length = 0;
    routes["/screens/r.png"] = (q, s) => { s.writeHead(302, loc ? { location: loc } : {}); s.end(); };
    const out = await imp(token, u("allowed.example", "/screens/r.png"));
    assert.match(out.error, re, what);
    assert.equal(hits.length, 1, `${what}: only the first hop was made`);
  }

  // A hop whose name resolves to a private address is refused after the lookup.
  RESOLVE["internal.example"] = ["10.0.0.5"];
  await sources(`allowed.example:${port}/screens/`, `internal.example:${port}/`);
  F.importDeps.resolve = async (host) => { const a = RESOLVE[host]; return a ? { ok: true, addresses: a } : { ok: false, reason: "notfound" }; };
  hits.length = 0;
  routes["/screens/p.png"] = to(u("internal.example", "/x.png"));
  assert.match((await imp(token, u("allowed.example", "/screens/p.png"))).error, /private or internal/);
  assert.equal(hits.length, 1);
  delete RESOLVE["internal.example"];

  // Loops: to itself, and A to B to A.
  hits.length = 0;
  routes["/screens/self.png"] = to("/screens/self.png");
  assert.match((await imp(token, u("allowed.example", "/screens/self.png"))).error, /in a circle/);
  assert.equal(hits.length, 1);
  routes["/screens/l1.png"] = to("/screens/l2.png"); routes["/screens/l2.png"] = to("/screens/l1.png");
  assert.match((await imp(token, u("allowed.example", "/screens/l1.png"))).error, /in a circle|redirects more than/);
  assert.equal(files().length, 1, "only the first image was ever stored");
});

// ── The answer: size, time, bytes ───────────────────────────────────────────────────────────────

test("size: an announced size over 3 MB is refused before reading; an unannounced stream is cut at 3 MB; nothing is stored", async () => {
  const { token } = await access();
  handler = (req, res) => { res.writeHead(200, { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) }); res.write(Buffer.alloc(1000)); };
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /larger than 3 MB/);
  let written = 0; let closedEarly = false;
  handler = (req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.on("close", () => { closedEarly = !res.writableFinished; });
    const chunk = Buffer.alloc(256 * 1024, 7);
    const pump = () => { while (written < 100 * 1024 * 1024) { written += chunk.length; if (!res.write(chunk)) return void res.once("drain", pump); } res.end(); };
    pump();
  };
  assert.match((await imp(token, u("allowed.example", "/screens/stream.png"))).error, /larger than 3 MB/);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(closedEarly, "the server saw the connection closed");
  assert.ok(written < 40 * 1024 * 1024, `the stream was aborted early (${written} bytes written)`);
  assert.equal(files().length, 0);
  // Just under the limit passes the download rule (it is then judged as an image).
  handler = (req, res) => { res.writeHead(200, { "content-length": "100" }); res.end(png(8, 8).subarray(0, 100)); };
  assert.ok(await imp(token, u("allowed.example", "/screens/small.png")));
});

test("content is decided from the BYTES: html named .png, a lying image type, a video, a compressed answer and error pages are refused; a real image served as text is accepted", async () => {
  const { token } = await access();
  const serve = (status, headers, body) => { handler = (req, res) => { res.writeHead(status, headers); res.end(body); }; };
  serve(200, { "content-type": "image/png" }, "<html><script>alert(1)</script></html>");
  assert.match((await imp(token, u("allowed.example", "/screens/page.png"))).error, /not a png, jpeg, webp or gif.*content was checked/);
  serve(200, { "content-type": "image/jpeg" }, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300, 1)]));
  assert.match((await imp(token, u("allowed.example", "/screens/prog.jpg"))).error, /not a png/);
  serve(200, { "content-type": "image/gif" }, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(40)]));
  assert.match((await imp(token, u("allowed.example", "/screens/movie.gif"))).error, /not a png/);
  serve(200, { "content-type": "image/png", "content-encoding": "gzip" }, png(8, 8));
  assert.match((await imp(token, u("allowed.example", "/screens/z.png"))).error, /compressed/);
  serve(404, { "content-type": "image/png" }, png(8, 8));
  assert.match((await imp(token, u("allowed.example", "/screens/missing.png"))).error, /status 404/);
  serve(500, {}, "boom");
  assert.match((await imp(token, u("allowed.example", "/screens/boom.png"))).error, /status 500/);
  serve(204, {}, "");
  assert.match((await imp(token, u("allowed.example", "/screens/none.png"))).error, /status 204/);
  const bomb = png(8, 8); bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20);
  serve(200, { "content-type": "image/png" }, bomb);
  assert.match((await imp(token, u("allowed.example", "/screens/bomb.png"))).error, /too many pixels/);
  serve(200, { "content-type": "image/png" }, Buffer.alloc(0));
  assert.ok((await imp(token, u("allowed.example", "/screens/empty.png"))).error);
  assert.equal(files().length, 0);
  // The extension and the announced type do not matter in the other direction either.
  const good = png(12, 9);
  serve(200, { "content-type": "text/plain" }, good);
  const { value } = await imp(token, u("allowed.example", "/screens/notes.txt"));
  assert.deepEqual([value.type, value.width, value.height], ["image/png", 12, 9]);
  assert.match(value.address, /\.png$/);
});

test("metadata: EXIF/GPS and comments are removed from a JPEG and text chunks from a PNG, pixels untouched; media_upload keeps them", async () => {
  const { token } = await access();
  const seg = (m, body) => { const l = Buffer.alloc(4); l[0] = 0xff; l[1] = m; l.writeUInt16BE(body.length + 2, 2); return Buffer.concat([l, body]); };
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\1\1\0\0\1\0\1\0\0")), seg(0xe1, Buffer.from("Exif\0\0GPS-48.85,2.35")), seg(0xfe, Buffer.from("secret comment")), Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
  const { stripMetadata } = await import("@/core/stripMetadata");
  const clean = stripMetadata(jpeg);
  assert.ok(!clean.includes("GPS-48") && !clean.includes("secret comment") && clean.includes("JFIF") && clean.subarray(clean.length - 9).equals(jpeg.subarray(jpeg.length - 9)));
  const base = png(8, 8);
  const text = Buffer.concat([base.subarray(0, 33), (() => { const t = Buffer.from("tEXtAuthor\0Camille"); const h = Buffer.alloc(4); h.writeUInt32BE(t.length - 4); return Buffer.concat([h, t, Buffer.alloc(4)]); })(), base.subarray(33)]);
  assert.ok(text.includes("Camille"));
  assert.ok(stripMetadata(text).equals(base), "png back to the original bytes");
  assert.ok(stripMetadata(Buffer.from("not an image")).equals(Buffer.from("not an image")));
  handler = (req, res) => { res.writeHead(200); res.end(text); };
  const { value } = await imp(token, u("allowed.example", "/screens/meta.png"));
  assert.ok(!fs.readFileSync(path.join(UPLOADS_DIR, value.id)).includes("Camille"));
});

test("svg: only through the logo pipeline: a script is refused; a clean drawing is stored re-written, never as received", async () => {
  const { token } = await access();
  const serve = (body) => { handler = (req, res) => { res.writeHead(200, { "content-type": "image/svg+xml" }); res.end(body); }; };
  serve('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
  assert.match((await imp(token, u("allowed.example", "/screens/a.svg"))).error, /svg was refused/);
  serve('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><image xlink:href="http://evil.example/x.png"/></svg>');
  assert.match((await imp(token, u("allowed.example", "/screens/b.svg"))).error, /refused/);
  assert.equal(files().length, 0);
  serve('<?xml version="1.0"?><!-- drawn by hand --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/></svg>');
  const { value } = await imp(token, u("allowed.example", "/screens/c.svg"));
  assert.equal(value.type, "image/svg+xml");
  assert.match(value.address, /\.svg$/);
  assert.ok(!fs.readFileSync(path.join(UPLOADS_DIR, files()[0]), "utf8").includes("drawn by hand"), "the stored copy is the cleaned one");
});

test("time: a server that never answers, or that drips its answer, is given up on at the deadline", async () => {
  const { token } = await access();
  F.importDeps.timeoutMs = 400;
  handler = () => { /* never answers */ };
  let t0 = Date.now();
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /did not answer within/);
  assert.ok(Date.now() - t0 < 3000, "gave up quickly");
  handler = (req, res) => { res.writeHead(200, { "content-type": "image/png" }); const timer = setInterval(() => res.write(Buffer.from([1])), 50); res.on("close", () => clearInterval(timer)); };
  t0 = Date.now();
  assert.match((await imp(token, u("allowed.example", "/screens/drip.png"))).error, /did not answer within/);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(files().length, 0);
  assert.equal(F.IMPORT_TIMEOUT_MS, 10_000);
  assert.equal(F.IMPORT_MAX_REDIRECTS, 2);
  assert.equal(F.IMPORT_MAX_BYTES, 3 * 1024 * 1024);
});

test("connection problems are said in plain words", async () => {
  const { token } = await access();
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  const r = await imp(token, u("allowed.example", GOOD));
  assert.match(r.error, /could not be reached/);
  assert.ok(!/ECONNREFUSED/.test(r.error));
  server = http.createServer(); await new Promise((res) => server.listen(0, "127.0.0.1", res)); // so afterEach can close something
});

// ── Several images in one call ──────────────────────────────────────────────────────────────────

test("batch: up to 10 in one call, in order, each with its own result; one failure does not stop the others; one slot per fetched image", async () => {
  const { token, id } = await access();
  handler = (req, res) => {
    if (req.url.includes("html")) { res.writeHead(200, { "content-type": "image/png" }); return void res.end("<html></html>"); }
    res.writeHead(200); res.end(png(10, 10));
  };
  const urls = [
    { url: u("allowed.example", "/screens/1.png"), alt: "First" },
    { url: u("evil.example", "/screens/2.png"), alt: "Second, outside the list" },
    { url: u("allowed.example", "/screens/html.png"), alt: "Third, not an image" },
    { url: u("allowed.example", "/screens/4.png", "?secret=ZZZ"), alt: "Fourth" },
  ];
  const { value } = await call(token, "media_import", { urls });
  assert.deepEqual([value.imported, value.failed, value.results.length], [2, 2, 4]);
  assert.deepEqual(value.results.map((r) => r.ok), [true, false, false, true]);
  assert.match(value.results[1].error, /not in the trusted image sources/);
  assert.match(value.results[2].error, /not a png/);
  assert.equal(value.results[0].alt, "First");
  assert.ok(!JSON.stringify(value).includes("ZZZ"), "the query is never echoed");
  assert.equal(files().length, 2);
  assert.equal(await used(id), 3, "the outside-list item cost nothing; the fetched ones (even the bad one) cost one each");
  assert.equal((await audits("media.import")).length, 2);
  // Ten work; eleven are refused as a whole, with nothing done.
  const many = (n) => Array.from({ length: n }, (_, i) => ({ url: u("allowed.example", `/screens/m${i}.png`), alt: `Image ${i}` }));
  const ten = (await call(token, "media_import", { urls: many(10) })).value;
  assert.deepEqual([ten.imported, ten.failed], [10, 0]);
  const before = hits.length;
  assert.match((await call(token, "media_import", { urls: many(11) })).error, /at most 10 items/);
  assert.match((await call(token, "media_import", { urls: [] })).error, /empty/);
  assert.match((await call(token, "media_import", { urls: [{ url: u("allowed.example", GOOD) }] })).error, /urls\[0\]: missing required argument "alt"/);
  assert.match((await call(token, "media_import", { urls: ["x"] })).error, /urls\[0\]/);
  assert.match((await call(token, "media_import", { urls: [{ url: "a", alt: "b", extra: 1 }] })).error, /unexpected argument "extra"/);
  assert.equal(hits.length, before);
  // A bad alt text in one item is that item's failure, not the whole call's.
  const mixed = (await call(token, "media_import", { urls: [{ url: u("allowed.example", GOOD), alt: "" + "a".repeat(130) }, { url: u("allowed.example", "/screens/ok.png"), alt: "Fine" }] })).value;
  assert.deepEqual(mixed.results.map((r) => r.ok), [false, true]);
});

test("limits: the hourly counter stops a batch (the rest is reported as not tried); the daily quota counts imports and uploads together", async () => {
  const { token, id } = await access();
  await SL.setLimits(id, { content: 10 });
  for (let i = 0; i < 9; i++) await SL.takeSlot(id, "content");
  const { value } = await call(token, "media_import", { urls: [0, 1, 2].map((i) => ({ url: u("allowed.example", `/screens/l${i}.png`), alt: `Image ${i}` })) });
  assert.deepEqual(value.results.map((r) => r.ok), [true, false, false]);
  assert.match(value.results[1].error, /Limit reached/);
  assert.match(value.results[2].error, /^Not tried: Limit reached/);
  assert.equal(hits.length, 1, "no connection once the counter is empty");
  const single = await imp(token, u("allowed.example", GOOD));
  assert.match(single.error, /Limit reached/);
  SL.resetSlots(id);
  // Daily quota: 100 files in the last 24 hours (a mix of both journals).
  await db.prisma.auditLog.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ actor: "mcp:Camille", actorKind: "assistant", action: i % 2 ? "media.import" : "media.upload", target: `x${i}.png 1000 bytes` })) });
  const before = hits.length;
  assert.match((await imp(token, u("allowed.example", GOOD))).error, /daily image quota/);
  assert.equal(hits.length, before, "refused before connecting");
});

test("media_upload still refuses an address: no url argument, and its own errors are unchanged", async () => {
  const { token } = await access();
  assert.match((await call(token, "media_upload", { url: u("allowed.example", GOOD), alt: "x" })).error, /unexpected argument "url"/);
  assert.match((await call(token, "media_upload", { dataBase64: Buffer.from("hello").toString("base64"), alt: "x" })).error, /not a png, jpeg, webp or gif.*Convert it to one of these formats and send it again/);
  assert.equal(hits.length, 0);
});

test("the fetch helper is used by media_import and by nothing else", () => {
  const users = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk("src")) if (/from "@\/core\/trustedImageFetch"/.test(fs.readFileSync(f, "utf8")) && !/trustedImageFetch\.ts$/.test(f)) users.push(f);
  assert.deepEqual(users, ["src/core/mediaImport.ts"]);
});
