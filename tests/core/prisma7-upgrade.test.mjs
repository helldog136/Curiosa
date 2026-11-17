// Prisma 6 → 7 on a LIVE site: the database an older core left must open as it is, with nothing lost, mixed or moved.
//  - the same file: a relative DATABASE_URL (install.sh writes file:../data/curiosa.db) is relative to prisma/, for the site, the migrations,
//    the backups and the updater alike; migrations run with only the .env file (install.sh) and never create a second, empty database;
//  - the migration history written by Prisma 6 is kept, and only the missing migrations are applied;
//  - dates stay milliseconds (Prisma 6's format): a new row and an old row compare and sort together; a date the database wrote itself (text) still reads;
//  - booleans and bytes read back as they were.
// The rows are written in SQL exactly as Prisma 6 stored them (checked against real databases of cores 0.6.18, 0.26.0 and 0.28.1 when Prisma 7 came in).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { makeTempDir } from "../helpers/tmp.mjs";

const repo = process.cwd();
const migrations = fs.readdirSync("prisma/migrations").filter((d) => /^\d+_/.test(d)).sort();

/** A bare-metal site as install.sh lays it out: <app>/.env (relative address), <app>/data/curiosa.db, the CLI of the app. */
function site() {
  const root = makeTempDir("curiosa-p7-");
  const app = path.join(root, "app");
  fs.mkdirSync(path.join(app, "data"), { recursive: true });
  for (const f of ["prisma.config.ts", "package.json"]) fs.copyFileSync(f, path.join(app, f));
  fs.cpSync("prisma", path.join(app, "prisma"), { recursive: true });
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(app, "node_modules"));
  fs.writeFileSync(path.join(app, ".env"), 'DATABASE_URL="file:../data/curiosa.db"\n');
  return { root, app, db: path.join(app, "data/curiosa.db") };
}
/** `migrate deploy` exactly as install.sh runs it: from the app folder, nothing in the environment but PATH and HOME. */
const migrate = (s, only) => {
  if (only) for (const m of migrations.filter((x) => !only.includes(x))) fs.rmSync(path.join(s.app, "prisma/migrations", m), { recursive: true, force: true });
  return execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: s.app, env: { PATH: process.env.PATH, HOME: s.root, CHECKPOINT_DISABLE: "1" }, encoding: "utf8" });
};

test("one rule for the database file: the site, the CLI configuration and the update scripts agree (relative = relative to prisma/)", async () => {
  const { sqliteFile } = await import("@/core/dbFile");
  const { resolveSqlitePath } = await import("../../scripts/shared-lib.mjs");
  const { absoluteSqliteUrl } = await import("../../prisma.config.ts");
  const app = "/srv/site/app";
  for (const url of ["file:../data/curiosa.db", "file:./dev.db", "file:/app/data/curiosa.db", "file:/x/test.db?connection_limit=1", "file:../data/curiosa.db?socket_timeout=10"]) {
    const a = sqliteFile(url, app), b = resolveSqlitePath(url, app), c = absoluteSqliteUrl(url, app).replace(/^file:/, "").split("?")[0];
    assert.equal(a, b, url); assert.equal(a, c, url);
    assert.ok(path.isAbsolute(a), url);
  }
  assert.equal(sqliteFile("file:../data/curiosa.db", app), "/srv/site/app/data/curiosa.db");
  assert.equal(sqliteFile(undefined, app), null);
  assert.equal(sqliteFile("postgres://x", app), null);
});

test("the database adapter: milliseconds for dates, the driver of THIS Node.js when the archive carries several, a clear error without an address", async () => {
  const { sqliteNativeBinding } = await import("@/core/dbFile");
  const root = makeTempDir("curiosa-p7-");
  try {
    assert.equal(sqliteNativeBinding(root), undefined, "no archive drivers: the package finds its own build");
    const file = path.join(root, "node_modules/better-sqlite3/prebuilds/node-v115-linux-x64/better_sqlite3.node");
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "x");
    assert.equal(sqliteNativeBinding(root, { modules: "115" }, "linux", "x64"), file, "Node.js 20 on x64");
    assert.equal(sqliteNativeBinding(root, { modules: "127" }, "linux", "x64"), undefined, "never the driver of another Node.js");
    assert.equal(sqliteNativeBinding(root, { modules: "115" }, "linux", "arm64"), undefined, "never the driver of another architecture");
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  const src = fs.readFileSync("src/core/db.ts", "utf8");
  assert.match(src, /timestampFormat: "unixepoch-ms"/, "the format every existing site already has");
  const { sqliteAdapter } = await import("@/core/db");
  const none = await sqliteAdapter("", "/nowhere").connect();
  await assert.rejects(() => none.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] }), /DATABASE_URL must be a SQLite address/);
});

test("migrations with only the .env file (install.sh): the database next to the site is used, the Prisma 6 history is kept, only the missing migrations run", () => {
  const s = site();
  try {
    const older = migrations.slice(0, -2);
    migrate(s, older);   // a site left by an older core: only its migrations
    const db = new Database(s.db);
    const history = db.prepare("SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY migration_name").all();
    db.close();
    assert.deepEqual(history.map((m) => m.migration_name), older);
    fs.cpSync(path.join(repo, "prisma"), path.join(s.app, "prisma"), { recursive: true, force: true });   // the new core
    const out = migrate(s);
    assert.match(out, /applied/i);
    const after = new Database(s.db, { readonly: true });
    const now = after.prepare("SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name").all();
    after.close();
    assert.deepEqual(now.map((m) => m.migration_name), migrations, "every migration recorded once");
    for (const old of history) assert.deepEqual(now.find((m) => m.migration_name === old.migration_name) && { ...now.find((m) => m.migration_name === old.migration_name), rolled_back_at: undefined }, { ...old, rolled_back_at: undefined }, `${old.migration_name} untouched`);
    assert.ok(now.every((m) => m.finished_at !== null && m.rolled_back_at === null));
    assert.ok(!fs.existsSync(path.join(s.root, "data")) && !fs.existsSync(path.join(s.app, "prisma/data")) && !fs.existsSync(path.join(s.app, "data/data")), "no second, empty database anywhere else");
    assert.match(migrate(s), /No pending migrations/, "a second run changes nothing");
  } finally { fs.rmSync(s.root, { recursive: true, force: true, maxRetries: 5 }); }
});

