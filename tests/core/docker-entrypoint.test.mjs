// The container entrypoint: PUID/PGID, handing over the data folder, dropping privileges, the shared start-up executor, refusals.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";
import { dropPrivileges, main, notWritableMessage, prepareDataDir, resolveIds } from "../../scripts/docker-entrypoint.mjs";

test("PUID/PGID: default 1000:1000; whole numbers 1-65534; root and garbage are refused with an explanation", () => {
  assert.deepEqual(resolveIds({}), { uid: 1000, gid: 1000 });
  assert.deepEqual(resolveIds({ PUID: "1026", PGID: "100" }), { uid: 1026, gid: 100 });
  assert.deepEqual(resolveIds({ PUID: "", PGID: " 33 " }), { uid: 1000, gid: 33 });
  for (const bad of [{ PUID: "0" }, { PGID: "0" }, { PUID: "abc" }, { PGID: "-1" }, { PUID: "70000" }, { PUID: "10.5" }]) assert.match(resolveIds(bad).error, /PUID and PGID must be whole numbers from 1 to 65534/);
});

test("data folder: created if missing; nothing walked when the top folder already belongs to the user; otherwise everything is handed over once", () => {
  const calls = [];
  const tree = { "/d": ["a", "sub"], "/d/sub": ["b"] };
  const mk = (owner) => ({
    mkdirSync: (p) => calls.push(`mkdir ${p}`),
    statSync: () => ({ uid: owner[0], gid: owner[1] }),
    lchownSync: (p, u, g) => calls.push(`chown ${p} ${u}:${g}`),
    lstatSync: (p) => ({ isDirectory: () => p in tree }),
    readdirSync: (p) => tree[p],
  });
  assert.deepEqual(prepareDataDir("/d", { uid: 1026, gid: 100 }, mk([1026, 100])), { changed: 0 });
  assert.deepEqual(calls, ["mkdir /d"]);
  calls.length = 0;
  assert.deepEqual(prepareDataDir("/d", { uid: 1026, gid: 100 }, mk([0, 0])), { changed: 4 });
  assert.deepEqual(calls.filter((c) => c.startsWith("chown")), ["chown /d 1026:100", "chown /d/a 1026:100", "chown /d/sub 1026:100", "chown /d/sub/b 1026:100"]);
});

test("data folder on a real folder (when the tests run as root): ownership follows PUID/PGID, files included", { skip: process.getuid?.() !== 0 }, () => {
  const d = makeTempDir("curiosa-ep-");
  try {
    fs.mkdirSync(path.join(d, "uploads")); fs.writeFileSync(path.join(d, "uploads", "a.png"), "x"); fs.writeFileSync(path.join(d, "curiosa.db"), "db");
    prepareDataDir(d, { uid: 1026, gid: 100 });
    for (const f of [d, path.join(d, "uploads"), path.join(d, "uploads", "a.png"), path.join(d, "curiosa.db")]) { const s = fs.statSync(f); assert.deepEqual([s.uid, s.gid], [1026, 100], f); }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("privileges are dropped group first, then user (the other way round would forbid the group change)", () => {
  const order = [];
  dropPrivileges({ uid: 1026, gid: 100 }, { setgroups: (g) => order.push(`groups ${g}`), setgid: (g) => order.push(`gid ${g}`), setuid: (u) => order.push(`uid ${u}`) });
  assert.deepEqual(order, ["groups 100", "gid 100", "uid 1026"]);
});

function harness(all = {}) {
  const { env: extraEnv, startup: startupResult, ...over } = all;
  const log = []; const errors = [];
  const o = {
    env: { DATA_DIR: "/data", DATABASE_URL: "file:/data/curiosa.db", ...(extraEnv ?? {}) }, appDir: makeTempDir("curiosa-app-"),
    getuid: () => 0, getgid: () => 0,
    prepare: (d, ids) => log.push(`prepare ${d} ${ids.uid}:${ids.gid}`), drop: (ids) => log.push(`drop ${ids.uid}:${ids.gid}`),
    startup: async (a) => { log.push(`startup ${a.version} ${a.prismaBin} ${a.dataDir}`); if (startupResult && !startupResult.ok) a.log(`✘ ${startupResult.message}`); return startupResult ?? { ok: true, backup: null, marker: null }; },
    spawnServer: async () => { log.push("server"); return 0; },
    sleep: async (ms) => { log.push(`sleep ${ms}`); },
    out: () => {}, err: (s) => errors.push(s), ...over,
  };
  fs.writeFileSync(path.join(o.appDir, "release.json"), JSON.stringify({ version: "0.7.0" }));
  return { o, log, errors, done: () => fs.rmSync(o.appDir, { recursive: true, force: true }) };
}

test("as root: hand over the data folder, drop privileges, run the shared start-up (Prisma called directly), then the server", async () => {
  const h = harness({ env: { PUID: "1026", PGID: "100" } }); try {
    assert.equal(await main(h.o), 0);
    assert.deepEqual(h.log, ["prepare /data 1026:100", "drop 1026:100", "startup 0.7.0 node_modules/prisma/build/index.js /data", "server"], "privileges are dropped BEFORE any data is touched");
  } finally { h.done(); }
});

test("as root with PUID=0: refused, nothing done", async () => {
  const h = harness({ env: { PUID: "0" } }); try {
    assert.equal(await main(h.o), 1);
    assert.deepEqual(h.log, []); assert.match(h.errors[0], /never runs as root/);
  } finally { h.done(); }
});

test("a data folder that cannot be handed over (network share) says what to do", async () => {
  const h = harness({ prepare: () => { throw Object.assign(new Error("x"), { code: "EPERM" }); } }); try {
    assert.equal(await main(h.o), 1);
    assert.match(h.errors[0], /Cannot give the data folder \/data to 1000:1000 \(EPERM\).*PUID\/PGID/);
  } finally { h.done(); }
});

test("unprivileged (user: in compose): no chown, no drop; an unwritable data folder is explained in plain words", async () => {
  const d = makeTempDir("curiosa-ro-"); const h = harness({ getuid: () => 4242, getgid: () => 4343, env: { DATA_DIR: path.join(d, "no", "way") } });
  try {
    fs.chmodSync(d, 0o500);
    const writable = (() => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } })();
    const code = await main(h.o);
    if (writable) { assert.equal(code, 0); assert.ok(h.log.every((l) => !l.startsWith("prepare") && !l.startsWith("drop"))); } // running as root: the folder is writable anyway
    else { assert.equal(code, 1); assert.equal(h.errors[0], notWritableMessage(path.join(d, "no", "way"), 4242, 4343)); assert.deepEqual(h.log, []); }
  } finally { fs.chmodSync(d, 0o700); fs.rmSync(d, { recursive: true, force: true }); h.done(); }
  assert.match(notWritableMessage("/app/data", 1, 2), /not writable by user 1:2.*without `user:`.*chown -R 1:2/);
});

test("a refusal of the start-up (data too old or too new) is printed, the container waits, exits 1 and never starts the site", async () => {
  const h = harness({ startup: { ok: false, error: "newer-than-image", message: "This data was last used by Curiosa 9.0.0." }, env: { CURIOSA_REFUSE_DELAY_SECONDS: "7" } }); try {
    assert.equal(await main(h.o), 1);
    assert.deepEqual(h.errors, ["[curiosa] ✘ This data was last used by Curiosa 9.0.0."], "printed once, on stderr");
    assert.ok(h.log.includes("sleep 7000") && !h.log.includes("server"));
  } finally { h.done(); }
});

test("the server's exit code is the container's", async () => {
  const h = harness({ spawnServer: async () => 143 }); try { assert.equal(await main(h.o), 143); } finally { h.done(); }
});
