// Adding a skin from a PRIVATE repository (core 0.46.2): the check of the access code against REAL git and a fake GitHub-like smart-HTTP server (`git http-backend`
// behind a 401 unless `Authorization: Basic base64(x-access-token:<fake code>)` is present). Reported on production: the code field turned red with one "refused" message.
// What this proves: (1) a git older than 2.31 ignores the environment the header travels in, so the host never sees the code and answers 401 (emulated here by a
// `git` first in the PATH that reports 2.25.1 and drops GIT_CONFIG_*), and the credential helper path fixes it; (2) every cause now has its own answer;
// (3) the code appears in no answer, error, log line, audit row or command line. A FAKE code is used throughout. Skipped when git or git-http-backend is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

let execPath = "";
try { execPath = execFileSync("git", ["--exec-path"]).toString().trim(); } catch { /* no git */ }
const BACKEND = path.join(execPath, "git-http-backend");
const skip = !execPath || !fs.existsSync(BACKEND) ? "git or git-http-backend is not installed" : false;

const CODE = "github_pat_11FAKEFAKE0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const B64 = Buffer.from(`x-access-token:${CODE}`).toString("base64");
const REAL_GIT = skip ? "" : execFileSync("which", ["git"]).toString().trim();

// Two `git` wrappers: both log their argv (to prove the code is never on a command line); the old one also reports 2.25.1 and drops the environment configuration.
const wrappers = makeTempDir("curiosa-gitwrap-");
const ARGV_LOG = path.join(wrappers, "argv.log");
for (const [name, old] of [["modern", false], ["old", true]]) {
  fs.mkdirSync(path.join(wrappers, name));
  fs.writeFileSync(path.join(wrappers, name, "git"), `#!/bin/bash
echo "ARGV: $*" >> "${ARGV_LOG}"
${old ? `[ "$1" = "--version" ] && { echo "git version 2.25.1"; exit 0; }
for v in $(env | grep -o '^GIT_CONFIG_\\(COUNT\\|KEY_[0-9]*\\|VALUE_[0-9]*\\)'); do unset "$v"; done` : ""}
exec "${REAL_GIT}" "$@"
`, { mode: 0o755 });
}
const BASE_PATH = process.env.PATH;
const selectGit = (name) => { process.env.PATH = `${path.join(wrappers, name)}:${BASE_PATH}`; };
selectGit("modern");

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const G = await import("@/core/gitAccess");
const A = await import("@/core/gitAccessAdmin");
G.testSeam.loopback = true;

let root, servers = [];
if (!skip) {
  const src = makeRepo({ "README.md": "# private skin\n" });
  root = makeTempDir("curiosa-privaddr-");
  fs.mkdirSync(path.join(root, "owner"), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", src.dir, path.join(root, "owner/priv.git")]);
}

/** A fake GitHub: 401 without the right header, the real repository through git http-backend with it (404 for any other name). */
function serve({ redirectTo = null, acceptAnyUser = false } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString() : "";
    const good = acceptAnyUser ? given.endsWith(`:${CODE}`) : given === `x-access-token:${CODE}`;
    requests.push({ url: req.url, auth: !auth ? "none" : good ? "good" : "wrong" });
    if (redirectTo) { res.writeHead(301, { Location: `${redirectTo}${req.url.replace(/^\/[^/]+\/[^/]+/, "/owner/new.git")}` }); res.end(); return; }
    if (!good) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GitHub"' }); res.end("denied"); return; }
    const [pathInfo, query = ""] = req.url.split("?");
    const cgi = spawn(BACKEND, [], { env: { PATH: BASE_PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: pathInfo, QUERY_STRING: query, REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "x" } });
    req.pipe(cgi.stdin);
    const chunks = [];
    cgi.stdout.on("data", (c) => chunks.push(c));
    cgi.on("close", () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf("\r\n\r\n");
      const headers = {}; let status = 200;
      for (const h of out.subarray(0, split).toString().split("\r\n")) { const [k, ...v] = h.split(": "); if (k.toLowerCase() === "status") status = parseInt(v.join(": "), 10); else headers[k] = v.join(": "); }
      res.writeHead(status, headers); res.end(out.subarray(split + 4));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => { const s = { requests, port: server.address().port, close: () => server.close() }; servers.push(s); resolve(s); }));
}

let logged = [];
const real = { error: console.error, log: console.log, warn: console.warn };
console.error = console.warn = console.log = (...a) => { logged.push(a.map(String).join(" ")); };
after(() => { Object.assign(console, real); for (const s of servers) s.close(); G.testSeam.loopback = false; db.close(); });
const reset = async () => { await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } }); await db.prisma.auditLog.deleteMany({}); logged = []; fs.writeFileSync(ARGV_LOG, ""); };

/** Everything the core said or wrote about the check, as one text to search for the code. */
async function everything(results) {
  const audits = await db.prisma.auditLog.findMany();
  const settings = await db.prisma.setting.findMany({ where: { NOT: { key: G.ACCESS_SETTING } } });
  return JSON.stringify([results, audits, settings, logged, fs.readFileSync(ARGV_LOG, "utf8")]);
}
const noLeak = (text) => { assert.ok(!text.includes(CODE), "the code is nowhere"); assert.ok(!text.includes(B64), "nor its encoded form"); };

test("a recent git: the code is accepted for the address with and without .git, and is never on a command line", { skip }, async () => {
  await reset(); selectGit("modern");
  const s = await serve();
  const url = `http://127.0.0.1:${s.port}/owner/priv`;
  const r1 = await A.saveAccessCode(url, CODE, "owner@example.org");
  assert.deepEqual(r1, { ok: true, repo: "owner/priv" });
  assert.equal(s.requests.at(-1).auth, "good");
  await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
  const r2 = await A.saveAccessCode(`${url}.git`, CODE, "owner@example.org");
  assert.deepEqual(r2, { ok: true, repo: "owner/priv" });
  noLeak(await everything([r1, r2]));
});

test("an old git (< 2.31) ignores the header settings: the host never sees the code (the reported failure), and the helper path makes it work", { skip }, async () => {
  await reset(); selectGit("old");
  const s = await serve();
  const url = `http://127.0.0.1:${s.port}/owner/priv`;
  // The cause, proved: with ONLY the environment header, this git sends no Authorization at all and gets 401.
  const before = s.requests.length;
  const control = await new Promise((resolve) => {
    const child = spawn("git", ["-c", "credential.helper=", "-c", "protocol.http.allow=always", "ls-remote", "--", url, "HEAD"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true", ...G.accessEnv(url, CODE, {}) } });
    let err = ""; child.stderr.on("data", (c) => (err += c)); child.on("close", (status) => resolve({ status, err }));
  });
  assert.notEqual(control.status, 0, "the header alone fails on this git");
  assert.ok(s.requests.slice(before).every((q) => q.auth === "none"), "the host received no code at all");
  assert.match(control.err, /Authentication failed|could not read Username/);
  // The fix: the code goes through the credential helper and the environment.
  const r = await A.saveAccessCode(url, CODE, "owner@example.org");
  assert.deepEqual(r, { ok: true, repo: "owner/priv" });
  assert.equal(s.requests.at(-1).auth, "good");
  assert.equal(await G.accessCodeFor(url), CODE, "stored after a real check");
  noLeak(await everything([r]));
  const argv = fs.readFileSync(ARGV_LOG, "utf8");
  assert.match(argv, /credential\.helper=!f\(\)/, "the helper (no secret in it) is on the command line");
  assert.ok(!argv.includes(CODE));
});

test("any user name next to the code is accepted by the host: the check keeps working (GitHub does not look at it)", { skip }, async () => {
  await reset(); selectGit("modern");
  const s = await serve({ acceptAnyUser: true });
  assert.equal((await A.saveAccessCode(`http://127.0.0.1:${s.port}/owner/priv`, CODE, "o@e.org")).ok, true);
});

test("each cause has its own answer, and none holds the code", { skip }, async () => {
  const out = {};
  for (const path_ of ["modern", "old"]) {
    await reset(); selectGit(path_);
    const ok = await serve();
    const results = [];
    // a wrong code: the host answers 401
    const wrong = "github_pat_11WRONGWRONG0AbCdEfGhIjKl_0123456789zYxWvUtSr";
    results.push(await A.saveAccessCode(`http://127.0.0.1:${ok.port}/owner/priv`, wrong, "o@e.org"));
    // a repository that does not exist (or that the code cannot read)
    results.push(await A.saveAccessCode(`http://127.0.0.1:${ok.port}/owner/missing`, CODE, "o@e.org"));
    // a renamed repository: a redirect, not followed while the code is attached; the new address comes from a plain request
    const moved = await serve({ redirectTo: `http://127.0.0.1:${ok.port}` });
    results.push(await A.saveAccessCode(`http://127.0.0.1:${moved.port}/owner/priv`, CODE, "o@e.org"));
    assert.ok(moved.requests.every((q) => q.auth === "good" || q.auth === "none"));
    // nothing listens
    const dead = await serve(); const deadPort = dead.port; dead.close(); await new Promise((r) => setTimeout(r, 50));
    results.push(await A.saveAccessCode(`http://127.0.0.1:${deadPort}/owner/priv`, CODE, "o@e.org"));
    // an address that is not a repository address
    results.push(await A.saveAccessCode("https://example.org/owner/priv", CODE, "o@e.org"));
    out[path_] = results;
    assert.deepEqual(results.map((r) => r.error), ["rejected", "notFound", "redirectTo", "unreachable", "address"], path_);
    assert.equal(results[2].address, `http://127.0.0.1:${ok.port}/owner/new`);
    assert.equal(await db.prisma.setting.count({ where: { key: G.ACCESS_SETTING } }), 0, "a code that does not work is never stored");
    noLeak(await everything(results));
    const audits = (await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => `${a.action} ${a.target.replace(/:\d+/, "")}`);
    assert.ok(audits.every((a) => a.startsWith("git.access.failed ")), audits.join("|"));
  }
});
