// Private repository access against REAL git talking to REAL local smart-HTTP servers (core 0.42.0, security review of PR #251). The servers run `git http-backend` and
// refuse any request without the right Authorization header, so what is tested is what git really does with the header: a partial clone that fetches files later,
// a redirect to another server, and the right needed to read a private fiche. A FAKE code is used throughout. The seam `testSeam.loopback` (gitAccess.ts) lets the
// product code treat http://127.0.0.1:<port>/owner/repo like a github.com address for these tests only.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const G = await import("@/core/gitAccess");
const I = await import("@/core/modules/installer");
const Rd = await import("@/core/modules/readme");
const RAW = await import("@/core/modules/rawRead");
const PS = await import("@/core/modules/previewServe");
G.testSeam.loopback = true;

const CODE = "github_pat_11FAKEFAKE0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const B64 = Buffer.from(`x-access-token:${CODE}`).toString("base64");
const GOOD = `Basic ${B64}`;

// ── a bare repository with a module, served through git http-backend, behind the header ──
const src = makeRepo({ "README.md": "# private module\nhello", "module.json": JSON.stringify({ id: "priv", version: "1.0.0", name: { fr: "P", en: "P" }, description: { fr: "d", en: "d" }, permissions: [] }), "docs/other.txt": "other file" });
const root = makeTempDir("curiosa-httpgit-");
fs.mkdirSync(path.join(root, "owner"), { recursive: true });
execFileSync("git", ["clone", "-q", "--bare", src.dir, path.join(root, "owner/priv.git")]);
for (const [k, v] of [["http.receivepack", "false"], ["uploadpack.allowFilter", "true"], ["uploadpack.allowAnySHA1InWant", "true"]]) execFileSync("git", ["config", k, v], { cwd: path.join(root, "owner/priv.git") });

/** A server: log of requests, optional redirect target, header required. */
function serve({ redirectTo = null, requireHeader = true } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    log.push({ url: req.url, auth: auth ? (auth === GOOD ? "good" : "other") : "none" });
    if (redirectTo) { res.writeHead(301, { Location: `${redirectTo}${req.url}` }); res.end(); return; }
    if (requireHeader && auth !== GOOD) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }); res.end("denied"); return; }
    const [pathInfo, query = ""] = req.url.split("?");
    const cgi = spawn(path.join(execFileSync("git", ["--exec-path"]).toString().trim(), "git-http-backend"), [], {
      env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: pathInfo, QUERY_STRING: query, REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "x", GIT_HTTP_MAX_REQUEST_BUFFER: "100M", ...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: req.headers["content-encoding"] } : {}) },
    });
    req.pipe(cgi.stdin);
    const chunks = [];
    cgi.stdout.on("data", (c) => chunks.push(c));
    cgi.on("close", () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf("\r\n\r\n");
      const head = out.subarray(0, split).toString().split("\r\n");
      const headers = {}; let status = 200;
      for (const h of head) { const [k, ...v] = h.split(": "); if (k.toLowerCase() === "status") status = parseInt(v.join(": "), 10); else headers[k] = v.join(": "); }
      res.writeHead(status, headers); res.end(out.subarray(split + 4));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ log, port: server.address().port, close: () => server.close() })));
}

const servers = [];
const start = async (o) => { const s = await serve(o); servers.push(s); return s; };
after(() => { for (const s of servers) s.close(); G.testSeam.loopback = false; db.close(); });
beforeEach(async () => { await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } }); });
const save = async (url) => { assert.equal(await G.storeAccess(url, CODE), true); };

test("F2: a real partial clone keeps working after the code is saved: every later request (show, ls-tree, sparse-checkout, gitBlob) carries the header", async () => {
  const s = await start();
  const url = `http://127.0.0.1:${s.port}/owner/priv`;
  await save(url);
  const dir = path.join(makeTempDir("curiosa-pc-"), "repo");
  const g = (args, cwd) => I.git(args, cwd);
  await g(["clone", "-q", "--depth", "1", "--single-branch", "--filter=blob:none", "--no-checkout", "--", url, dir]);
  await g(["sparse-checkout", "set", "--no-cone", "/"], dir).catch(() => {});
  const names = (await g(["ls-tree", "--name-only", "HEAD"], dir)).split("\n");
  assert.ok(names.includes("README.md"));
  assert.match(await g(["show", "HEAD:README.md"], dir), /private module/);
  const blob = await I.gitBlob("HEAD:docs/other.txt", dir, 10_000);
  assert.equal(blob?.toString(), "other file", "a file fetched from the promisor remote");
  assert.ok(s.log.length >= 4, "several requests were made");
  assert.deepEqual([...new Set(s.log.map((r) => r.auth))], ["good"], "NO request went out without the header (a 401 would show up as 'none')");
  assert.equal(fs.readFileSync(path.join(dir, ".git/config"), "utf8").includes(CODE), false);
  assert.ok(!/extraheader|Authorization|x-access-token/i.test(fs.readFileSync(path.join(dir, ".git/config"), "utf8")));
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

test("F2: the same reads with no saved code fail with the neutral access error, never with a leak", async () => {
  const s = await start();
  const url = `http://127.0.0.1:${s.port}/owner/priv`;
  const e = await I.git(["ls-remote", "--", url, "HEAD"]).then(() => null, (x) => x);
  assert.ok(G.isGitAccessError(e));
  assert.deepEqual([...new Set(s.log.map((r) => r.auth))], ["none"]);
});

test("F3: git does not follow a redirect while a code is attached: the other server never sees the header", async () => {
  const b = await start({ requireHeader: false });
  const a = await start({ redirectTo: `http://127.0.0.1:${b.port}` });
  const url = `http://127.0.0.1:${a.port}/owner/priv`;
  await save(url);
  const e = await I.git(["ls-remote", "--", url, "HEAD"]).then(() => null, (x) => x);
  assert.ok(e, "the redirected read fails instead of following");
  assert.equal(b.log.length, 0, "the redirect target received NOTHING (neither with nor without the header)");
  assert.ok(!JSON.stringify([e.message, e.stderr]).includes(CODE));
  // For the record, what would happen without the guard: real git re-sends the header to the redirect target.
  const control = await start({ requireHeader: true });
  const front = await start({ redirectTo: `http://127.0.0.1:${control.port}` });
  const base = `http://127.0.0.1:${front.port}/owner/priv`;
  await I.git(["-c", "http.followRedirects=true", "ls-remote", "--", base, "HEAD"], undefined, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${base}.extraheader`, GIT_CONFIG_VALUE_0: `Authorization: ${GOOD}` }).catch(() => {});
  assert.ok(control.log.some((r) => r.auth === "good"), "control: without the guard the header DOES reach the other server (this is why the guard exists)");
});

test("F3: the check of a new code also refuses to follow a redirect, and an address with a port is not a github.com address", async () => {
  const b = await start({ requireHeader: false });
  const a = await start({ redirectTo: `http://127.0.0.1:${b.port}` });
  await assert.rejects(I.gitCheckAccess(`http://127.0.0.1:${a.port}/owner/priv`, CODE));
  assert.equal(b.log.length, 0);
  G.testSeam.loopback = false;
  try {
    for (const bad of ["https://github.com:8443/o/r", "https://github.com/o/r\n", "https://github.com/o/r\t", "https://github.com/o/r #x", "https://github.com/o/r#frag"]) assert.equal(G.accessTarget(bad), null, JSON.stringify(bad));
    assert.ok(G.accessTarget("https://github.com/o/r"));
  } finally { G.testSeam.loopback = true; }
});

test("F1: a repository with a saved code is private: a caller without the right (stored not true) reads NOTHING, from the caller, the memory or the disk copies, and git is not started", async () => {
  // The address is a github.com one (the gate is about saved codes); git is sent to a local open server by insteadOf, so the owner's read needs no header here.
  const s = await start({ requireHeader: false });
  const url = "https://github.com/owner/priv";
  fs.appendFileSync(process.env.GIT_CONFIG_GLOBAL, `[url "http://127.0.0.1:${s.port}/owner/priv"]\n\tinsteadOf = ${url}\n`);
  const target = { kind: "repo", url };
  RAW.setRawFetch(async () => { throw new RAW.RawError("http", 404); });
  Rd.clearPreviewCache();
  assert.equal(await G.storeAccess(url, CODE), true);
  // Owner: reads it (saved code, right to use it).
  const seen = await Rd.getModulePreview(target, { stored: true });
  assert.match(seen.readme ?? "", /private module/);
  const before = s.log.length;
  assert.ok(before > 0);
  // A plain admin: same call, no `stored`: refused with the neutral error, even though the copy is now warm in memory and on disk.
  for (const call of [() => Rd.getModulePreview(target), () => Rd.getModulePreview(target, { stored: false }), () => Rd.getModulePreview(target, { waitMs: 50 })]) {
    const e = await call().then(() => null, (x) => x);
    assert.ok(G.isGitAccessError(e), "refused");
  }
  assert.deepEqual(await Rd.getPreviewImages(target), [], "no visuals either");
  Rd.warmModulePreview(target);
  assert.deepEqual(await PS.previewImages({ repo: url }, undefined, false), []);
  assert.equal((await PS.servePreview(new URLSearchParams({ repo: url, n: "0" }), undefined, false)).status, 404);
  assert.equal(s.log.length, before, "no request at all for the caller without the right");
  // A repository WITHOUT a saved code is unaffected: public content stays readable by every admin.
  await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
  Rd.clearPreviewCache();
  const open = await Rd.getModulePreview(target);
  assert.match(open.readme ?? "", /private module/);
  RAW.setRawFetch(null);
});

test("F1: the routes and the fiche pass the right: the three entry points of a plain admin say stored only for core:modules.install", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  assert.match(read("src/app/api/admin/extension-previews/route.ts"), /servePreview\(.*can\(user, "core:modules\.install"\)/);
  assert.match(read("src/app/api/admin/extension-warm/route.ts"), /const stored = can\(user, "core:modules\.install"\)/);
  assert.match(read("src/app/admin/(panel)/extensions/add/details/DetailsView.tsx"), /getModulePreview\(target, \{ waitMs: PREVIEW_WAIT_MS, stored: isOwner \}\)/);
  assert.match(read("src/app/admin/(panel)/extensions/add/details/DetailsView.tsx"), /isOwner = canDo\(user, "core:modules\.install"\)/);
  // The default of every reader is "no stored access": the assistant's catalogue tools and the setup wizard call them without it.
  for (const f of ["src/core/modules/starter.ts", "src/core/maintenance/deps.ts"]) assert.ok(!/stored:\s*true/.test(read(f)), f);
});

test("F6/F7: only the series of the module's own id counts; a branch named like release/v1.2.0 is a branch; remoteTags reads one series", async () => {
  const V = await import("@/core/updates/versions");
  assert.equal(V.isReleaseTag("glass/v1.2.0", "glass"), true);
  for (const [ref, id] of [["release/v1.2.0", "glass"], ["release/1.2.0", "glass"], ["hotfix/v2.0.1", "glass"], ["other/v1.0.0", "glass"], ["glass/1.0.0", "glass"], ["glass/v1.0.0", undefined]]) assert.equal(V.isReleaseTag(ref, id), false, `${ref} / ${id}`);
  assert.equal(V.isReleaseTag("v1.2.0", "glass"), true);
  assert.equal(V.tagPrefix("glass/v1.0.0", "glass"), "glass/");
  assert.equal(V.tagPrefix("release/v1.0.0", "glass"), "");
  const repo = makeRepo({ "README.md": "x" });
  for (const t of ["a/v1.0.0", "a/v1.1.0", "b/v9.0.0", "v3.0.0", "release/1.2.0"]) repo.g("tag", t);
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  assert.deepEqual(await I.remoteTags(repo.url, "a/"), ["a/v1.0.0", "a/v1.1.0"]);
  assert.deepEqual(await I.remoteTags(repo.url), ["v3.0.0"]);
  assert.deepEqual(await I.remoteTags(repo.url, "b/"), ["b/v9.0.0"]);
});
