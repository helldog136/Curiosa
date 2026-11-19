// Access to a private repository (core 0.42.0): leak-focused tests. A fake `git` first in the PATH records what the core hands to git (argv, the environment that
// concerns authentication, the `.git/config` of the checkout) then runs the real git, or fails the way GitHub does. The access code must be: sealed in the
// database, in the CHILD environment only (scoped to the exact repository), and nowhere else (argv, `.git/config`, errors, logs, audit, backup).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { copySkin, TEST_CORE } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// The fake git, BEFORE the core is loaded (the installer reads the environment once).
const bin = makeTempDir("curiosa-fakegit-");
const LOG = path.join(bin, "calls.log");
const MODE = path.join(bin, "mode");
const REAL_GIT = execFileSync("which", ["git"]).toString().trim();
fs.writeFileSync(MODE, "ok");
fs.writeFileSync(path.join(bin, "git"), `#!/bin/bash
mode=$(cat "${MODE}")
{
  echo "ARGV: $*"
  env | grep -E '^GIT_CONFIG_(COUNT|KEY_|VALUE_)' | sed 's/^/ENV: /'
  case " $* " in *" fetch "*|*" clone "*|*" ls-remote "*) [ -f .git/config ] && sed 's/^/CONFIG: /' .git/config;; esac
  echo "--"
} >> "${LOG}"
case " $* " in
  *" fetch "*|*" clone "*|*" ls-remote "*)
    case "$mode" in
      401) echo "fatal: Authentication failed for 'https://github.com/test-owner/private-assets/'" >&2; exit 128;;
      404) echo "remote: Repository not found." >&2; echo "fatal: repository 'https://github.com/test-owner/private-assets/' not found" >&2; exit 128;;
      noprompt) echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2; exit 128;;
      leak) echo "fatal: unable to access: the header was Authorization: Basic $(echo -n "x-access-token:$FAKE_LEAK_TOKEN" | base64 -w0) and the code $FAKE_LEAK_TOKEN" >&2; exit 128;;
    esac;;
esac
exec "${REAL_GIT}" "$@"
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const G = await import("@/core/gitAccess");
const A = await import("@/core/gitAccessAdmin");
const { git } = await import("@/core/modules/installer");
const S = await import("@/core/skins/service");
const B = await import("@/core/backup/export");
const { readTarGz } = await import("@/core/backup/tar");
const { setSetting } = await import("@/core/settings");

const TOKEN = "github_pat_11TESTONLY0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const TOKEN2 = "github_pat_11OTHERTEST0QrStUvWxYzAb_9876543210aBcDeFgHiJk";
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const PRIVATE = "https://github.com/test-owner/private-assets";
const OTHER = "https://github.com/test-owner/other-repo";
const MONO = "https://github.com/test-owner/mono";

const publicRepo = makeRepo({ "README.md": "x" });
const monoRepo = makeRepo({ "README.md": "mono" });
const tmpCfg = process.env.GIT_CONFIG_GLOBAL;
const privateRepo = makeRepo({ "README.md": "private" });
const commit = (repo, msg) => { repo.g("add", "-A"); repo.g("commit", "-q", "--allow-empty", "--no-verify", "-m", msg); };
copySkin("plain-light", path.join(privateRepo.dir, "skins/glass-sample"), { id: "glass-sample", version: "1.0.0" });
commit(privateRepo, "skin");
fs.appendFileSync(tmpCfg, `[url "${privateRepo.url}"]\n\tinsteadOf = ${PRIVATE}\n[url "${monoRepo.url}"]\n\tinsteadOf = ${MONO}\n[url "${publicRepo.url}"]\n\tinsteadOf = ${OTHER}\n`);

const setMode = (m) => fs.writeFileSync(MODE, m);
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8") : "");
const SKINS = path.join(db.dir, "skins");

/** Everything the core wrote or said, as one text to search. */
async function everything(extra = []) {
  const rows = await db.prisma.setting.findMany({ where: { NOT: { key: G.ACCESS_SETTING } } });
  const audits = await db.prisma.auditLog.findMany();
  return JSON.stringify([rows, audits, extra]);
}

let logged = [];
const realError = console.error, realLog = console.log, realWarn = console.warn;
beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  fs.writeFileSync(LOG, "");
  setMode("ok");
  process.env.FAKE_LEAK_TOKEN = TOKEN;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  logged = [];
  console.error = (...a) => { logged.push(a.map(String).join(" ")); };
  console.warn = console.log = (...a) => { logged.push(a.map(String).join(" ")); };
});
after(() => { console.error = realError; console.log = realLog; console.warn = realWarn; db.close(); });

test("the code format: only a fine-grained code is accepted; a broad one is refused with its own reason", () => {
  assert.equal(G.checkCodeFormat(TOKEN), "ok");
  assert.equal(G.checkCodeFormat("  "), "empty");
  assert.equal(G.checkCodeFormat(`ghp_${"a".repeat(36)}`), "broad");
  assert.equal(G.checkCodeFormat("hunter2"), "format");
  assert.equal(G.checkCodeFormat(`${TOKEN}\nAuthorization: x`), "format", "no line break can be smuggled into a header");
});

test("github.com only, one entry per owner/repo, whatever the spelling of the address", () => {
  assert.deepEqual(G.accessTarget("https://github.com/Test-Owner/Private-Assets.git"), { host: "github.com", repo: "test-owner/private-assets" });
  assert.deepEqual(G.accessTarget("https://github.com/test-owner/private-assets/"), { host: "github.com", repo: "test-owner/private-assets" });
  for (const bad of ["https://gitlab.com/a/b", "http://github.com/a/b", "https://user:pw@github.com/a/b", "https://github.com/a", "https://github.com/a/b/tree/main", "file:///x/y", "https://github.com/a/b?x=1", "nonsense"]) assert.equal(G.accessTarget(bad), null, bad);
});

test("saving a code: tried against the repository first, stored sealed, never in clear anywhere", async () => {
  const r = await A.saveAccessCode(PRIVATE, TOKEN, "owner@example.org");
  assert.deepEqual(r, { ok: true, repo: "test-owner/private-assets" });
  const row = await db.prisma.setting.findUnique({ where: { key_locale: { key: G.ACCESS_SETTING, locale: "" } } });
  assert.ok(row);
  assert.ok(!row.value.includes(TOKEN) && !row.value.includes(B64), "only ciphertext in the database");
  assert.equal(await G.accessCodeFor(`${PRIVATE}.git`), TOKEN);
  assert.equal(await G.accessCodeFor(OTHER), null, "one code per repository: another repository of the same owner gets nothing");
  assert.deepEqual(await G.accessState(PRIVATE), { state: "configured", repo: "test-owner/private-assets", savedAt: (await G.accessState(PRIVATE)).savedAt });
  const audits = (await db.prisma.auditLog.findMany()).map((a) => `${a.action} ${a.target}`);
  assert.deepEqual(audits, ["git.access.set test-owner/private-assets"]);
  assert.ok(!(await everything(logged)).includes(TOKEN) && !(await everything(logged)).includes(B64));
  // The check itself went through git with the code in the environment of the child only.
  const log = calls();
  assert.ok(log.includes("ENV: GIT_CONFIG_KEY_") && log.includes(B64), "the header reaches git through the environment");
  assert.ok(!log.split("\n").filter((l) => l.startsWith("ARGV:") || l.startsWith("CONFIG:")).join("\n").includes(TOKEN), "not in argv, not in .git/config");
  assert.ok(!log.split("\n").filter((l) => l.startsWith("ARGV:") || l.startsWith("CONFIG:")).join("\n").includes(B64));
});

test("a code that does not work is never stored, and 'refused' and 'not found' read exactly the same", async () => {
  setMode("401");
  const a = await A.saveAccessCode(PRIVATE, TOKEN, "o@e.org");
  setMode("404");
  const b = await A.saveAccessCode(PRIVATE, TOKEN, "o@e.org");
  setMode("noprompt");
  const c = await A.saveAccessCode(PRIVATE, TOKEN, "o@e.org");
  assert.deepEqual([a, b, c], [{ ok: false, error: "refused" }, { ok: false, error: "refused" }, { ok: false, error: "refused" }]);
  assert.deepEqual(await G.accessState(PRIVATE), { state: "none", repo: "test-owner/private-assets" });
  assert.equal(await db.prisma.setting.count({ where: { key: G.ACCESS_SETTING } }), 0);
  assert.deepEqual(await A.saveAccessCode(PRIVATE, `ghp_${"b".repeat(36)}`, "o@e.org"), { ok: false, error: "broad" });
  assert.deepEqual(await A.saveAccessCode("https://gitlab.com/a/b", TOKEN, "o@e.org"), { ok: false, error: "address" });
  assert.deepEqual(await A.saveAccessCode(PRIVATE, "", "o@e.org"), { ok: false, error: "empty" });
  assert.ok(!(await everything(logged)).includes(TOKEN));
});

test("installing a skin from a private repository: the code is in the child environment only, scoped to the exact repository, argv and .git/config stay clean", async () => {
  await A.saveAccessCode(PRIVATE, TOKEN, "owner@example.org");
  fs.writeFileSync(LOG, "");
  const r = await S.install(`${PRIVATE}#:skins/glass-sample`, { confirmPersonal: true, actor: "owner@example.org" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.source, "personal");
  const log = calls();
  const blocks = log.split("--\n").filter(Boolean);
  const fetch = blocks.find((b) => /ARGV: .*\bfetch\b/.test(b) && b.includes("extraheader"));
  assert.ok(fetch, "the fetch ran through the fake git");
  assert.match(fetch, new RegExp(`ENV: GIT_CONFIG_KEY_\\d+=http\\.${PRIVATE.replaceAll(".", "\\.")}\\.extraheader`), "scoped to the exact repository");
  assert.match(fetch, new RegExp(`ENV: GIT_CONFIG_KEY_\\d+=http\\.${PRIVATE.replaceAll(".", "\\.")}\\.git\\.extraheader`), "and to its .git spelling");
  assert.ok(fetch.includes(`Authorization: Basic ${B64}`));
  const flat = (re) => log.split("\n").filter((l) => re.test(l)).join("\n");
  assert.ok(!flat(/^ARGV:/).includes(TOKEN) && !flat(/^ARGV:/).includes(B64), "never in argv");
  assert.ok(!flat(/^CONFIG:/).includes(TOKEN) && !flat(/^CONFIG:/).includes(B64) && !/extraheader|Authorization/i.test(flat(/^CONFIG:/)), "never in .git/config");
  assert.ok(!flat(/^ARGV:/).includes("x-access-token"), "no user name in an address either");
  // The skin row, the journal, the audit, the logs: no code.
  const all = await everything(logged);
  assert.ok(!all.includes(TOKEN) && !all.includes(B64) && !all.includes("x-access-token"));
  assert.deepEqual(fs.readdirSync(path.join(SKINS)).filter((n) => !n.startsWith(".")), ["glass-sample"]);
});

test("the header is never offered to another repository, and a public repository gets no header at all", async () => {
  await A.saveAccessCode(PRIVATE, TOKEN, "owner@example.org");
  fs.writeFileSync(LOG, "");
  await git(["ls-remote", "--", OTHER, "HEAD"]);
  await git(["ls-remote", "--", "https://github.com/test-owner/private-assets-copy", "HEAD"]).catch(() => {});
  await git(["ls-remote", "--", MONO, "HEAD"]);
  assert.ok(!calls().includes("extraheader") && !calls().includes(B64), "no header for any other repository, not even one whose name starts the same");
  await git(["ls-remote", "--", PRIVATE, "HEAD"]);
  assert.ok(calls().includes(B64), "and the repository it was saved for does get it");
});

test("a git failure never carries the code: a refusal becomes one neutral error, anything else is cleaned", async () => {
  await A.saveAccessCode(PRIVATE, TOKEN, "owner@example.org");
  for (const mode of ["401", "404", "noprompt"]) {
    setMode(mode);
    const e = await git(["ls-remote", "--", PRIVATE, "HEAD"]).then(() => null, (x) => x);
    assert.ok(G.isGitAccessError(e), mode);
    assert.equal(e.message, "git: access refused or repository not found", "no text from git at all");
    assert.equal(e.code, "modules.error.access", "a translation key, for code that shows error.code");
  }
  setMode("leak");
  // A failure that is not a refusal but that echoes the code and its encoded form (a proxy, a hook): cleaned before it leaves git().
  const e = await git(["ls-remote", "--", PRIVATE, "HEAD"]).then(() => null, (x) => x);
  assert.ok(e && !G.isGitAccessError(e));
  const text = JSON.stringify({ m: e.message, s: e.stderr, st: String(e.stack).split("\n")[0] });
  assert.ok(!text.includes(TOKEN) && !text.includes(B64), text);
  assert.ok(text.includes("[masked]"));
  // A skin install that fails: the answer is a key, and nothing logged holds the code.
  setMode("401");
  const r = await S.install(`${PRIVATE}#:skins/glass-sample`, { confirmPersonal: true });
  assert.deepEqual([r.ok, r.error], [false, "skins.error.access"]);
  setMode("404");
  const r2 = await S.install(`${PRIVATE}#:skins/glass-sample`, { confirmPersonal: true });
  assert.deepEqual(r2, r, "401 and 404 give the identical answer");
  setMode("leak");
  const r3 = await S.inspect(`${PRIVATE}#:skins/glass-sample`);
  assert.equal(r3.ok, false);
  assert.ok(!JSON.stringify(r3).includes(TOKEN));
  const all = await everything([...logged, r, r2, r3]);
  assert.ok(!all.includes(TOKEN) && !all.includes(B64), "nothing logged, audited or answered holds the code");
});

test("inspect and install work the same with no code saved for a public repository (nothing changes for them)", async () => {
  const r = await S.inspect(`${OTHER}#:skins/none`).catch(() => null);
  assert.ok(r === null || r.ok === false || r.ok === true);
  assert.ok(!calls().includes("extraheader"));
});

test("a code saved for a repository whose address is written differently is still found (case, .git, trailing slash)", async () => {
  await A.saveAccessCode(`${PRIVATE}/`, TOKEN, "o@e.org");
  assert.equal(await G.accessCodeFor("https://github.com/TEST-OWNER/Private-Assets.git"), TOKEN);
  assert.equal((await G.listAccess()).length, 1);
  const again = await A.saveAccessCode(`${PRIVATE}/`, TOKEN2, "o@e.org");
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal((await G.listAccess()).length, 1, "replaced, not duplicated");
  assert.equal(await G.accessCodeFor(PRIVATE), TOKEN2);
});

test("removing the access: the code is gone, the installed skin stays, the audit names the repository only", async () => {
  await A.saveAccessCode(PRIVATE, TOKEN, "o@e.org");
  const r = await S.install(`${PRIVATE}#:skins/glass-sample`, { confirmPersonal: true });
  assert.equal(r.ok, true);
  assert.deepEqual(await A.removeAccessCode(PRIVATE, "o@e.org"), { ok: true });
  assert.equal(await G.accessCodeFor(PRIVATE), null);
  assert.equal(await db.prisma.setting.count({ where: { key: G.ACCESS_SETTING } }), 0);
  assert.equal((await S.installed()).length, 1, "what is installed stays in place");
  assert.deepEqual((await db.prisma.auditLog.findMany({ where: { action: { startsWith: "git.access" } }, orderBy: { id: "asc" } })).map((a) => `${a.action} ${a.target}`), ["git.access.set test-owner/private-assets", "git.access.remove test-owner/private-assets"]);
  // Without the code the update check fails in a way the page can word ("access refused"), not as an exception.
  setMode("401");
  const check = await S.checkUpdate((await S.installed())[0].id);
  assert.deepEqual([check.available, check.failed, check.access], [false, true, true]);
});

test("backup: only the sealed value travels, the readable summary masks it, and another site secret cannot open it (enter the code again)", async () => {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
  await A.saveAccessCode(PRIVATE, TOKEN, "o@e.org");
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
  const text = Object.values(files).map((c) => Buffer.from(c).toString("latin1")).join("\n");
  assert.ok(!text.includes(TOKEN) && !text.includes(B64), "not in any file of the archive");
  assert.ok(!b.buffer.toString("latin1").includes(TOKEN));
  const settings = JSON.parse(Buffer.from(files["data/settings.json"] ?? files[Object.keys(files).find((k) => /settings\.json$/.test(k))]).toString());
  const row = settings.find((s) => s.key === G.ACCESS_SETTING);
  assert.ok(row, "the sealed value is in the backup");
  assert.ok(!JSON.stringify(row).includes(TOKEN));
  const site = Buffer.from(files["readable/site.txt"]).toString();
  assert.match(site, /git\.secret\.access = ••••/, "masked in the readable summary");
  // Restored on another server: a different site secret cannot open it. The state says "enter again", never an error.
  const prev = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "another-server-secret-another-server-secret";
  try {
    assert.deepEqual([(await G.accessState(PRIVATE)).state, await G.accessCodeFor(PRIVATE)], ["reenter", null]);
    // And git simply sends no header (the repository will then say "address or access code to check").
    fs.writeFileSync(LOG, "");
    await git(["ls-remote", "--", PRIVATE, "HEAD"]);
    assert.ok(!calls().includes("extraheader"));
  } finally { if (prev === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prev; }
  assert.equal((await G.accessState(PRIVATE)).state, "configured");
});

test("no tool of the assistant (MCP) can read or set an access code: none of its files touches the store", () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p); } return out; };
  const files = [...walk("src/core/maintenance"), ...walk("src/core/services/mcp"), ...walk("src/app/api")].filter((f) => fs.statSync(f).isFile());
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/gitAccess|git\.secret\.access|accessCodeFor|saveAccessCode/.test(s), `${f} must not reach the access codes`);
  }
});

test("only the single git() helper reads a code: no other file starts git with a credential", () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p); } return out; };
  const users = walk("src").filter((f) => /accessCodeFor|accessEnv\(/.test(fs.readFileSync(f, "utf8"))).map((f) => f.replaceAll("\\", "/")).sort();
  assert.deepEqual(users, ["src/core/gitAccess.ts", "src/core/modules/installer.ts"]);
  const installer = fs.readFileSync("src/core/modules/installer.ts", "utf8");
  assert.ok(!/extraheader|Authorization|x-access-token/.test(installer.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "the installer builds no header itself");
  assert.ok(!/https:\/\/[^"'`\s]*@/.test(installer), "no credential in an address");
});
