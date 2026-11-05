// The code that both paths share: database copy, migrations, restore, the data-version marker and its gate, and the container start-up executor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";
import { applyMigrations, backupDatabase, checkDataVersion, readDataVersion, readFloor, restoreBackup, runStartup, writeDataVersion } from "../../scripts/shared-lib.mjs";
import { DATA_VERSION_FILE } from "../../scripts/install-kind.mjs";

/** An app folder (with its upgrade.json floor) and a data folder holding a database file. */
function volume({ floor = "0.6.10", db = "DB-BEFORE" } = {}) {
  const root = makeTempDir("curiosa-start-");
  const appDir = path.join(root, "app"), dataDir = path.join(root, "data");
  fs.mkdirSync(appDir); fs.mkdirSync(dataDir);
  if (floor) fs.writeFileSync(path.join(appDir, "upgrade.json"), JSON.stringify({ minFrom: floor }));
  const dbFile = path.join(dataDir, "curiosa.db");
  if (db !== null) fs.writeFileSync(dbFile, db);
  const calls = [];
  const exec = (over) => async (cmd, args, o) => { calls.push(`${cmd} ${args.join(" ")}`); if (over) return over(cmd, args, o); return { stdout: "applied" }; };
  return { root, appDir, dataDir, dbFile, databaseUrl: `file:${dbFile}`, calls, exec, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const backups = (v) => (fs.existsSync(path.join(v.dataDir, "backups")) ? fs.readdirSync(path.join(v.dataDir, "backups")) : []);
const state = (v) => JSON.parse(fs.readFileSync(path.join(v.dataDir, "update", "startup.json"), "utf8"));

test("backupDatabase: copies the file, names it pre-update-<label>-<time>.db, keeps the last 5; nothing to copy on a fresh install", () => {
  const v = volume(); try {
    let t = 1000;
    for (let i = 0; i < 7; i++) backupDatabase({ dbFile: v.dbFile, dataDir: v.dataDir, label: "v1.0.0", now: () => ++t });
    assert.deepEqual(backups(v), [1003, 1004, 1005, 1006, 1007].map((n) => `pre-update-v1.0.0-${n}.db`));
    assert.equal(fs.readFileSync(path.join(v.dataDir, "backups", "pre-update-v1.0.0-1007.db"), "utf8"), "DB-BEFORE");
    fs.writeFileSync(path.join(v.dataDir, "backups", "autre.db"), "x");
    backupDatabase({ dbFile: v.dbFile, dataDir: v.dataDir, label: "v1.0.0", now: () => ++t });
    assert.ok(backups(v).includes("autre.db"), "only pre-update copies are rotated");
    const fresh = volume({ db: null });
    assert.equal(backupDatabase({ dbFile: fresh.dbFile, dataDir: fresh.dataDir, label: "v1.0.0" }), null);
    assert.deepEqual(backups(fresh), []);
    fresh.cleanup();
  } finally { v.cleanup(); }
});

test("restoreBackup: the copy comes back over the live file, no temporary file left", () => {
  const v = volume(); try {
    const copy = backupDatabase({ dbFile: v.dbFile, dataDir: v.dataDir, label: "v1" });
    fs.writeFileSync(v.dbFile, "DB-HALF-MIGRATED");
    restoreBackup(copy, v.dbFile);
    assert.equal(fs.readFileSync(v.dbFile, "utf8"), "DB-BEFORE");
    assert.deepEqual(fs.readdirSync(v.dataDir).filter((f) => f.endsWith(".restore")), []);
  } finally { v.cleanup(); }
});

test("applyMigrations: npx prisma by default (bare metal, unchanged), node on the Prisma binary when asked (container, no npx)", async () => {
  const seen = [];
  await applyMigrations(async (c, a) => seen.push([c, ...a].join(" ")));
  await applyMigrations(async (c, a) => seen.push([c, ...a].join(" ")), { prismaBin: "node_modules/prisma/build/index.js" });
  assert.deepEqual(seen, ["npx prisma migrate deploy", "node node_modules/prisma/build/index.js migrate deploy"]);
});

test("data-version marker: written atomically, read back as a plain version; garbage or a missing file reads as nothing", () => {
  const v = volume(); try {
    assert.equal(readDataVersion(v.dataDir), null);
    assert.equal(writeDataVersion(v.dataDir, "v0.6.13", () => 0), true);
    assert.equal(readDataVersion(v.dataDir), "0.6.13");
    assert.deepEqual(fs.readdirSync(v.dataDir).filter((f) => f.endsWith(".tmp")), []);
    fs.writeFileSync(path.join(v.dataDir, DATA_VERSION_FILE), "0.6.9\n");
    assert.equal(readDataVersion(v.dataDir), "0.6.9", "a plain text marker is accepted");
    fs.writeFileSync(path.join(v.dataDir, DATA_VERSION_FILE), "n'importe quoi");
    assert.equal(readDataVersion(v.dataDir), null);
    assert.equal(writeDataVersion(path.join(v.dataDir, "inexistant", "\0"), "1.0.0"), false, "a folder that cannot be written never throws");
  } finally { v.cleanup(); }
});

test("gate: refuses data below the floor and data newer than the image, in plain words naming the version to use; allows equal, newer image, release candidates, no marker", () => {
  const v = volume(); try {
    const gate = (marker, version, floor = "0.6.10") => { if (marker) writeDataVersion(v.dataDir, marker); else fs.rmSync(path.join(v.dataDir, DATA_VERSION_FILE), { force: true }); return checkDataVersion({ dataDir: v.dataDir, version, floor }); };
    assert.equal(gate("0.6.10", "0.7.0").ok, true, "exactly the floor");
    assert.equal(gate("0.7.0", "0.7.0").ok, true, "same version (a restart)");
    assert.equal(gate("0.6.20", "0.7.0").ok, true);
    assert.equal(gate("0.7.0", "0.7.0-rc.1").ok, true, "a release candidate counts as its stable");
    const unknown = checkDataVersion({ dataDir: (fs.rmSync(path.join(v.dataDir, DATA_VERSION_FILE), { force: true }), v.dataDir), version: "0.7.0", floor: "0.6.10", hasData: true });
    assert.deepEqual([unknown.ok, unknown.marker, unknown.unknown], [true, null, true], "no marker: allowed, flagged");
    const below = gate("0.6.3", "0.7.0");
    assert.deepEqual([below.ok, below.code], [false, "below-floor"]);
    assert.match(below.message, /0\.6\.3/); assert.match(below.message, /0\.6\.10/); assert.match(below.message, /CURIOSA_VERSION=0\.6\.10/); assert.match(below.message, /Nothing was changed/);
    const newer = gate("0.8.1", "0.7.0");
    assert.deepEqual([newer.ok, newer.code], [false, "newer-than-image"]);
    assert.match(newer.message, /0\.8\.1/); assert.match(newer.message, /newer/); assert.match(newer.message, /Nothing was changed|nothing was changed/);
    assert.equal(gate("0.6.3", "0.7.0", null).ok, true, "no floor known: only the downgrade check applies");
  } finally { v.cleanup(); }
});

test("readFloor: minFrom of the upgrade.json shipped with the code; absent or invalid means no floor", () => {
  const v = volume(); try {
    assert.equal(readFloor(v.appDir), "0.6.10");
    fs.writeFileSync(path.join(v.appDir, "upgrade.json"), JSON.stringify({ minFrom: "pas une version" }));
    assert.equal(readFloor(v.appDir), null);
    fs.rmSync(path.join(v.appDir, "upgrade.json"));
    assert.equal(readFloor(v.appDir), null);
  } finally { v.cleanup(); }
});

test("start-up: a normal start copies the database FIRST (even with nothing pending), then migrates, and records the result", async () => {
  const v = volume(); try {
    writeDataVersion(v.dataDir, "0.7.0");
    const order = [];
    const exec = v.exec(() => { order.push(`migrate-sees-${backups(v).length}-copy`); return { stdout: "No pending migrations to apply." }; });
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec, prismaBin: "node_modules/prisma/build/index.js", now: () => 5 });
    assert.equal(r.ok, true);
    assert.deepEqual(order, ["migrate-sees-1-copy"], "the copy exists before Prisma runs");
    assert.deepEqual(v.calls, ["node node_modules/prisma/build/index.js migrate deploy"]);
    assert.equal(fs.readFileSync(path.join(v.dataDir, "backups", backups(v)[0]), "utf8"), "DB-BEFORE");
    assert.match(backups(v)[0], /^start-v0\.7\.0-5\.db$/, "same version restarting: a start copy");
    assert.deepEqual([state(v).status, state(v).version, state(v).backup === r.backup], ["ok", "0.7.0", true]);
    assert.match(fs.readFileSync(path.join(v.dataDir, "update", "update.log"), "utf8"), /container start, version 0\.7\.0[\s\S]*migrations applied/);
  } finally { v.cleanup(); }
});

test("start-up: a fresh volume (no database yet) has nothing to copy, still migrates", async () => {
  const v = volume({ db: null }); try {
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec: v.exec() });
    assert.deepEqual([r.ok, r.backup], [true, null]);
    assert.deepEqual(v.calls, ["npx prisma migrate deploy"]);
    assert.deepEqual(backups(v), []);
  } finally { v.cleanup(); }
});

test("start-up: data below the floor or newer than the image is refused BEFORE anything is touched (no copy, no migration, database identical)", async () => {
  for (const [marker, code] of [["0.6.3", "below-floor"], ["0.9.0", "newer-than-image"]]) {
    const v = volume(); try {
      writeDataVersion(v.dataDir, marker);
      const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec: v.exec() });
      assert.deepEqual([r.ok, r.error], [false, code]);
      assert.deepEqual(v.calls, [], "Prisma never ran");
      assert.deepEqual(backups(v), [], "no copy made");
      assert.equal(fs.readFileSync(v.dbFile, "utf8"), "DB-BEFORE");
      assert.equal(readDataVersion(v.dataDir), marker, "the marker is untouched");
      assert.deepEqual([state(v).status, state(v).error], ["refused", code]);
    } finally { v.cleanup(); }
  }
});

test("start-up: a failing migration puts the copy back and says so; the marker is not moved", async () => {
  const v = volume(); try {
    writeDataVersion(v.dataDir, "0.6.10");
    const exec = v.exec(() => { fs.writeFileSync(v.dbFile, "DB-HALF-MIGRATED"); throw new Error("migration 2 failed"); });
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec });
    assert.deepEqual([r.ok, r.error, r.restored], [false, "migrate-failed", true]);
    assert.equal(fs.readFileSync(v.dbFile, "utf8"), "DB-BEFORE", "database back as before");
    assert.equal(readDataVersion(v.dataDir), "0.6.10");
    assert.match(r.message, /put back as it was/);
    assert.deepEqual([state(v).status, state(v).error], ["refused", "migrate-failed"]);
  } finally { v.cleanup(); }
});

test("start-up: when the copy cannot be made, nothing is migrated", async () => {
  const v = volume(); try {
    fs.writeFileSync(path.join(v.dataDir, "backups"), "un fichier à la place du dossier");
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec: v.exec() });
    assert.deepEqual([r.ok, r.error], [false, "backup-failed"]);
    assert.deepEqual(v.calls, []);
    assert.equal(fs.readFileSync(v.dbFile, "utf8"), "DB-BEFORE");
  } finally { v.cleanup(); }
});

test("start-up: data from before markers existed starts (and says so in the journal)", async () => {
  const v = volume(); try {
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec: v.exec() });
    assert.equal(r.ok, true);
    assert.match(fs.readFileSync(path.join(v.dataDir, "update", "update.log"), "utf8"), /without a version marker/);
  } finally { v.cleanup(); }
});

test("start-up copies: a data-version change makes a pre-update copy (last 3 kept), a plain restart a start copy (last 2 kept) — a restart loop never evicts the pre-update copy", async () => {
  const v = volume(); try {
    writeDataVersion(v.dataDir, "0.6.10");
    let t = 100;
    const go = (version) => runStartup({ appDir: v.appDir, dataDir: v.dataDir, version, databaseUrl: v.databaseUrl, exec: v.exec(), now: () => ++t });
    const update = await go("0.7.0");
    assert.deepEqual([update.ok, update.backupKind], [true, "pre-update"]);
    writeDataVersion(v.dataDir, "0.7.0"); // the server's first good start
    for (let i = 0; i < 12; i++) assert.equal((await go("0.7.0")).backupKind, "start");
    const names = backups(v);
    assert.deepEqual(names.filter((n) => n.startsWith("pre-update-")).map((n) => n.split("-")[2]), ["v0.7.0"], "the copy taken before the update survived 12 restarts");
    assert.equal(names.filter((n) => n.startsWith("start-")).length, 2, "only the last 2 start copies");
    // Three more updates: the last 3 pre-update copies are kept, the oldest goes.
    for (const next of ["0.7.1", "0.7.2", "0.7.3"]) { assert.equal((await go(next)).backupKind, "pre-update"); writeDataVersion(v.dataDir, next); }
    assert.deepEqual(backups(v).filter((n) => n.startsWith("pre-update-")).map((n) => n.split("-")[2]), ["v0.7.1", "v0.7.2", "v0.7.3"]);
    assert.equal(state(v).backupKind, "pre-update");
    // Data from before markers existed counts as a change, not a restart.
    fs.rmSync(path.join(v.dataDir, DATA_VERSION_FILE));
    assert.equal((await go("0.7.3")).backupKind, "pre-update");
  } finally { v.cleanup(); }
});

test("start-up: a failing migration keeps what the command printed in the journal (the only clue to why)", async () => {
  const v = volume(); try {
    const lines = [];
    const exec = v.exec(() => { throw Object.assign(new Error("Command failed: node prisma migrate deploy"), { stderr: "Error: Can't write to /app/node_modules/@prisma/engines\nplease check permissions", stdout: "" }); });
    const r = await runStartup({ appDir: v.appDir, dataDir: v.dataDir, version: "0.7.0", databaseUrl: v.databaseUrl, exec, log: (l) => lines.push(l) });
    assert.equal(r.error, "migrate-failed");
    assert.ok(lines.some((l) => /Can't write to \/app\/node_modules\/@prisma\/engines/.test(l)), lines.join("|"));
  } finally { v.cleanup(); }
});
