// Second security review of the private repository access (core 0.42.0, PR #251): N1 (git-lfs), N2 (cached private content after "Remove access"), N4 (one reference
// validator), N5 (allow-list environment of every git child), N8 (concurrent saves), N10 (prefixed release series). A FAKE code is used throughout.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const G = await import("@/core/gitAccess");
const I = await import("@/core/modules/installer");
const Rd = await import("@/core/modules/readme");
const RAW = await import("@/core/modules/rawRead");
const E = await import("@/core/gitEnv");
const FC = await import("@/core/modules/ficheCache");
G.testSeam.loopback = true;

const CODE = "github_pat_11FAKEFAKE0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const B64 = Buffer.from(`x-access-token:${CODE}`).toString("base64");
const servers = [];
after(() => { for (const s of servers) s.close(); G.testSeam.loopback = false; db.close(); });
const gi = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });

// ── N5 + N1: what a git child receives ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("N5: gitChildEnv is an allow-list: the site secret and every other secret stay out, proxy and CA settings stay in", () => {
  const env = E.gitChildEnv({ GIT_INDEX_FILE: "/x/index" }, {
    PATH: "/usr/bin", HOME: "/home/u", TMPDIR: "/t", LANG: "C", LC_ALL: "C", https_proxy: "http://p:1", HTTPS_PROXY: "http://p:1", no_proxy: "x", SSL_CERT_FILE: "/ca.pem", GIT_SSL_CAINFO: "/ca.pem", NODE_EXTRA_CA_CERTS: "/ca.pem",
    AUTH_SECRET: "topsecret", DATABASE_URL: "file:/db", MY_API_TOKEN: "t", GITHUB_TOKEN: "g", GIT_TOKEN: "g2", GIT_ASKPASS: "/evil", GIT_LFS_SKIP_SMUDGE: "0", GIT_SSH_COMMAND: "evil",
  });
  for (const k of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "https_proxy", "HTTPS_PROXY", "no_proxy", "SSL_CERT_FILE", "GIT_SSL_CAINFO", "NODE_EXTRA_CA_CERTS", "GIT_INDEX_FILE"]) assert.ok(k in env, k);
  for (const k of ["AUTH_SECRET", "DATABASE_URL", "MY_API_TOKEN", "GITHUB_TOKEN", "GIT_TOKEN", "GIT_SSH_COMMAND"]) assert.ok(!(k in env), k);
  assert.equal(env.GIT_ASKPASS, "true");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_LFS_SKIP_SMUDGE, "1", "the core's value wins");
  assert.equal(E.gitChildEnv({ GIT_LFS_SKIP_SMUDGE: "0" }, {}).GIT_LFS_SKIP_SMUDGE, "1", "a caller cannot switch it off");
});

test("N5/N1: a real child (a fake git on PATH) gets no secret, GIT_LFS_SKIP_SMUDGE=1 and the filter.lfs options, for a network command and a plain read", async () => {
  const bin = makeTempDir("fakegit-");
  const out = path.join(bin, "dump.txt");
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n{ echo "ARGV: $*"; env; echo "--"; } >> "${out}"\nexit 0\n`, { mode: 0o755 });
  const saved = { PATH: process.env.PATH };
  const secrets = { AUTH_SECRET: "sekret-auth-value", DATABASE_URL: "file:sekret-db", SOME_API_TOKEN: "sekret-token", SMTP_PASSWORD: "sekret-pass", ADMIN_KEY: "sekret-key" };
  Object.assign(process.env, secrets, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HTTPS_PROXY: "http://proxy.invalid:3128", http_proxy: "http://proxy.invalid:3128" });
  try {
    const cwd = makeTempDir("fakegit-cwd-");
    await I.git(["status", "--porcelain"], cwd);
    await I.git(["ls-remote", "--", "https://example.org/a/b.git", "HEAD"]);
  } finally {
    process.env.PATH = saved.PATH;
    for (const k of Object.keys(secrets)) delete process.env[k];
    delete process.env.HTTPS_PROXY; delete process.env.http_proxy;
  }
  const dump = fs.readFileSync(out, "utf8");
  for (const v of Object.values(secrets)) assert.ok(!dump.includes(v), `no ${v} in a git child`);
  assert.ok(!/AUTH_SECRET|DATABASE_URL/.test(dump));
  const calls = dump.split("\n--\n").filter(Boolean);
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.match(c, /^GIT_LFS_SKIP_SMUDGE=1$/m);
    assert.match(c, /^HTTPS_PROXY=http:\/\/proxy\.invalid:3128$/m);
    assert.match(c, /^http_proxy=http:\/\/proxy\.invalid:3128$/m);
    assert.match(c, /ARGV: .*-c filter\.lfs\.smudge= -c filter\.lfs\.process= -c filter\.lfs\.required=false/);
  }
});

// ── N1: git-lfs for real ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const hasLfs = (() => { try { execFileSync("git", ["lfs", "version"], { stdio: "pipe" }); return true; } catch { return false; } })();
const recorder = (name, log) => new Promise((r) => { const s = http.createServer((req, res) => { log.push(`${name} ${req.method} ${req.url} auth=${req.headers.authorization ? "yes" : "no"}`); res.writeHead(404); res.end("{}"); }); servers.push(s); s.listen(0, "127.0.0.1", () => r(s)); });
test("N1: a hostile .lfsconfig and an lfs filter in the repository trigger no request, and git-lfs writes no log that holds the code", { skip: hasLfs ? false : "git-lfs is not installed" }, async () => {
  const log = [];
  const A = await recorder("A", log), B = await recorder("B", log);
  const urlA = `http://127.0.0.1:${A.address().port}/owner/priv`;
  await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
  assert.equal(await G.storeAccess(urlA, CODE), true);
  const dir = makeTempDir("lfs-");
  gi(dir, "init", "-q", "-b", "main"); gi(dir, "remote", "add", "origin", urlA);
  fs.writeFileSync(path.join(dir, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  fs.writeFileSync(path.join(dir, ".lfsconfig"), `[lfs]\n\turl = http://127.0.0.1:${B.address().port}/lfs\n`);
  const pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 5\n";
  fs.writeFileSync(path.join(dir, "big.bin"), pointer);
  gi(dir, "add", "-A", "-f"); gi(dir, "-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "filter.lfs.clean=cat", "-c", "filter.lfs.required=false", "commit", "-q", "-m", "x");
  fs.rmSync(path.join(dir, "big.bin"));
  log.length = 0;
  // Even with a filter configured in the repository itself (the hostile case), the child must not smudge.
  gi(dir, "config", "filter.lfs.smudge", "git-lfs smudge -- %f");
  gi(dir, "config", "filter.lfs.process", "git-lfs filter-process");
  gi(dir, "config", "filter.lfs.required", "true");
  await I.git(["checkout", "--", "big.bin"], dir).catch(() => {});
  await I.git(["show", "HEAD:big.bin"], dir).catch(() => {});
  assert.deepEqual(log, [], "no request to the repository's server nor to the address of .lfsconfig");
  const logs = path.join(dir, ".git/lfs/logs");
  for (const f of fs.existsSync(logs) ? fs.readdirSync(logs) : []) {
    const t = fs.readFileSync(path.join(logs, f), "utf8");
    assert.ok(!t.includes(CODE) && !t.includes(B64), `${f} holds no code`);
  }
  assert.throws(() => execFileSync("grep", ["-rlE", `${CODE}|${B64}`, dir], { stdio: "pipe" }), "the code is nowhere in the checkout");
});

// ── N2: "Remove access" purges what was read with the code ───────────────────────────────────────────────────────────────────────────────────
const src = makeRepo({ "README.md": "# private module\nhello", "module.json": JSON.stringify({ id: "priv", version: "1.0.0", name: { fr: "P", en: "P" }, description: { fr: "d", en: "d" }, permissions: [] }) });
const root = makeTempDir("curiosa-httpgit-");
fs.mkdirSync(path.join(root, "owner"), { recursive: true });
execFileSync("git", ["clone", "-q", "--bare", src.dir, path.join(root, "owner/priv.git")]);
function openServer() {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push(req.url);
    const [pathInfo, query = ""] = req.url.split("?");
    const cgi = spawn(path.join(execFileSync("git", ["--exec-path"]).toString().trim(), "git-http-backend"), [], { env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: pathInfo, QUERY_STRING: query, REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "x", ...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: req.headers["content-encoding"] } : {}) } });
    req.pipe(cgi.stdin);
    const chunks = [];
    cgi.stdout.on("data", (c) => chunks.push(c));
    cgi.on("close", () => {
      const out = Buffer.concat(chunks); const split = out.indexOf("\r\n\r\n");
      const headers = {}; let status = 200;
      for (const h of out.subarray(0, split).toString().split("\r\n")) { const [k, ...v] = h.split(": "); if (k.toLowerCase() === "status") status = parseInt(v.join(": "), 10); else headers[k] = v.join(": "); }
      res.writeHead(status, headers); res.end(out.subarray(split + 4));
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ log, port: server.address().port })));
}
const diskCopies = () => { try { return fs.readdirSync(FC.root()); } catch { return []; } };

test("N2: the owner reads a private fiche, removes the access: a plain admin gets no copy (memory or disk), the content is read again from the network", async () => {
  const s = await openServer();
  const url = "https://github.com/owner/priv";
  fs.appendFileSync(process.env.GIT_CONFIG_GLOBAL, `[url "http://127.0.0.1:${s.port}/owner/priv"]\n\tinsteadOf = ${url}\n`);
  const target = { kind: "repo", url };
  RAW.setRawFetch(async () => { throw new RAW.RawError("http", 404); });
  try {
    await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
    assert.equal(await G.storeAccess(url, CODE), true);
    const seen = await Rd.getModulePreview(target, { stored: true });
    assert.match(seen.readme ?? "", /private module/);
    assert.ok(diskCopies().length > 0, "the owner's read left a copy on disk (the premise of the test)");
    await Rd.getModulePreview(target, { stored: true });
    const warm = s.log.length;
    assert.equal(await G.removeAccess(url), true);   // the owner clicks "Remove access"; clearPreviewCache is NOT called
    assert.equal(diskCopies().length, 0, "the disk copy is gone");
    // A plain admin: the repository has no code any more, so nothing refuses; what is read must come from the network, never from a copy kept under the code.
    const again = await Rd.getModulePreview(target);
    assert.match(again.readme ?? "", /private module/);
    assert.ok(s.log.length > warm, "read again from the network, not served from memory or disk");
    // Saving a code (replacing it) purges as well.
    const before = diskCopies().length;
    assert.ok(before > 0);
    assert.equal(await G.storeAccess(url, CODE), true);
    assert.equal(diskCopies().length, 0);
    const e = await Rd.getModulePreview(target).then(() => null, (x) => x);
    assert.ok(G.isGitAccessError(e), "and a plain admin is refused again while the code is saved");
  } finally {
    await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
    RAW.setRawFetch(null);
  }
});

test("N2: a copy of ANOTHER repository survives the removal", async () => {
  const keep = FC.ficheKey({ url: "https://github.com/owner/other" });
  FC.writeEntry(keep, "README.md", Buffer.from("other"));
  const url = "https://github.com/owner/priv";
  await G.storeAccess(url, CODE);
  await G.removeAccess(url);
  assert.ok(FC.readEntry(keep, "README.md", 100), "unrelated copy kept");
});

// ── N8: two saves at once ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N8: saves made at the same time all survive (no lost update of the list)", async () => {
  await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
  const urls = Array.from({ length: 12 }, (_, i) => `https://github.com/owner/repo${i}`);
  await Promise.all(urls.map((u) => G.storeAccess(u, CODE)));
  assert.equal((await G.listAccess()).length, 12);
  await Promise.all(urls.slice(0, 6).map((u) => G.removeAccess(u)));
  assert.deepEqual((await G.listAccess()).map((e) => e.repo).sort(), urls.slice(6).map((u) => u.replace("https://github.com/", "")).sort());
  await db.prisma.setting.deleteMany({ where: { key: G.ACCESS_SETTING } });
});

// ── N4: one reference validator ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N4: a reference that starts with a dash is refused everywhere (address, catalogue entries, skin entries, index fetch, raw base)", async () => {
  const R = await import("@/core/gitRef");
  assert.equal(R.isSafeGitRef("-x"), false);
  assert.equal(R.isSafeGitRef("--upload-pack=evil"), false);
  assert.equal(R.isSafeGitRef("v1.2.0"), true);
  assert.equal(R.isSafeGitRef("mod/v1.2.0"), true);
  assert.equal(I.parseRepoUrl("https://github.com/o/r#-x").ok, false);
  const Rec = await import("@/core/modules/recognized");
  const [bad, good] = Rec.sanitizeEntries([{ id: "aa", repo: "https://github.com/o/r", ref: "--x" }, { id: "bb", repo: "https://github.com/o/r", ref: "v1.0.0" }]);
  assert.equal(bad.ref, undefined);
  assert.equal(good.ref, "v1.0.0");
  const Sk = await import("@/core/skins/catalogue");
  const skins = Sk.sanitizeSkinEntries([{ id: "aa", repo: "https://github.com/o/r", ref: "-x" }, { id: "bb", repo: "https://github.com/o/r", ref: "mod/v1.0.0" }], "0.42.0");
  assert.equal(skins.find((x) => x.id === "aa")?.ref, undefined);
  assert.equal(skins.find((x) => x.id === "bb")?.ref, "mod/v1.0.0");
  await assert.rejects(Rec.fetchCatalogueFromRepo("https://github.com/o/r", "-x", async () => { throw new Error("git must not start"); }), /bad-ref/);
  assert.equal(RAW.rawBase("https://github.com/o/r", "-x"), null);
});

test("N4: every `git fetch` of a reference puts `--` before the remote and the reference", () => {
  const files = execFileSync("grep", ["-rlE", "\\[\"fetch\"", "src/core"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of files) for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!/\["fetch"/.test(line) || !/"origin"/.test(line) || /\+refs\/heads/.test(line)) continue;
    if (/"origin"\]/.test(line)) continue;   // the whole-history fallback names no reference
    assert.match(line, /"--", "origin"/, `${f}: ${line.trim()}`);
  }
});

// ── N10: prefixed release series ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("N10: a module that follows its own prefixed series can be updated by the assistant; the core's own tags stay plain", async () => {
  const Ins = await import("@/core/maintenance/inspect");
  assert.equal(Ins.moduleUpdateRefusal({ id: "mod", ref: "mod/v1.0.0", source: "git", target: "mod/v1.1.0" }), undefined);
  assert.equal(Ins.moduleUpdateRefusal({ id: "mod", ref: "v1.0.0", source: "git", target: "v1.1.0" }), undefined);
  assert.match(Ins.moduleUpdateRefusal({ id: "mod", ref: "mod/v1.0.0", source: "git", target: "mod/v1.1.0-rc.1" }) ?? "", /not a stable release/);
  assert.match(Ins.moduleUpdateRefusal({ id: "mod", ref: "mod/v1.0.0", source: "git", target: "main" }) ?? "", /not a stable release/);
  assert.match(Ins.moduleUpdateRefusal({ id: "mod", ref: "release/v1.0.0", source: "git", target: "mod/v1.1.0" }) ?? "", /branch/);
  assert.equal(Ins.isStableVersion("mod/v1.1.0"), false, "the core's own release tag is never prefixed");
});

test("N10: the conversion chain reads the module's own series (and not another module's) from a real repository", async () => {
  const { openRepo, planChain } = await import("@/core/backup/conversion/moduleChain");
  const repo = makeRepo({ "a/module.json": { dataVersion: 1, dataFloor: 1, version: "1.0.0" } });
  for (const t of ["mod/v1.0.0", "mod/v1.2.0", "other/v9.0.0", "v0.5.0"]) repo.g("tag", t);
  const reader = await openRepo(repo.url);
  try {
    assert.deepEqual(await reader.tags(), ["v0.5.0"]);
    assert.deepEqual(await reader.tags("mod"), ["v0.5.0", "mod/v1.0.0", "mod/v1.2.0"]);
    const seen = [];
    const fake = { tags: async (id) => { seen.push(id); return ["mod/v1.0.0"]; }, manifestAt: async (ref) => (ref === "mod/v1.0.0" ? { dataVersion: 2, dataFloor: 1, version: "1.0.0" } : { dataVersion: 2, dataFloor: 2, version: "2.0.0" }), close() {} };
    const chain = await planChain(fake, { id: "mod", repo: "x", subdir: null, targetRef: null, dataVersion: 1 });
    assert.deepEqual(seen, ["mod"]);
    assert.deepEqual(chain.tags, ["mod/v1.0.0"]);
  } finally { reader.close(); }
});
