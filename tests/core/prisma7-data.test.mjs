// Prisma 6 → 7 on a LIVE site, the data itself (see prisma7-upgrade.test.mjs for the file and the migrations). Own file: the client of
// src/core/db.ts is created once per process, with the address of THIS test.
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

test("rows stored by Prisma 6 read back unchanged with Prisma 7, and new rows use the same formats (no mixed dates)", async () => {
  const s = site();
  migrate(s);
  // Exactly what Prisma 6 wrote: dates as INTEGER milliseconds, booleans 0/1, bytes as BLOB; and a date the database wrote itself (TEXT).
  const t0 = Date.UTC(2026, 9, 1, 8, 30, 15, 123);
  const db = new Database(s.db);
  db.prepare(`INSERT INTO "User" ("id","email","name","role","coordinator","passwordHash","advanced","sessionVersion","mustChangePassword","createdAt","updatedAt") VALUES ('u1','camille@example.org','Camille','owner',1,'x',0,3,0,?,?)`).run(t0, t0 + 1000);
  db.prepare(`INSERT INTO "Passkey" ("id","userId","credentialId","publicKey","counter","name","backedUp","createdAt") VALUES ('k1','u1','cred',?,7,'Clé',1,?)`).run(Buffer.from([1, 2, 3, 255, 0]), t0);
  db.prepare(`INSERT INTO "Module" ("id","source","version","updatedAt") VALUES ('m1','catalogue','1.0.0',?)`).run(t0);   // installedAt: DEFAULT CURRENT_TIMESTAMP (text)
  db.close();
  process.env.DATABASE_URL = "file:../data/curiosa.db";   // relative, as on bare-metal sites
  const cwd = process.cwd();
  process.chdir(s.app);
  try {
    const { prisma } = await import("@/core/db");
    const u = await prisma.user.findUnique({ where: { id: "u1" } });
    assert.equal(u.createdAt.toISOString(), new Date(t0).toISOString());
    assert.equal(u.coordinator, true); assert.equal(u.advanced, false); assert.equal(u.sessionVersion, 3);
    const k = await prisma.passkey.findUnique({ where: { id: "k1" } });
    assert.deepEqual([...k.publicKey], [1, 2, 3, 255, 0]); assert.equal(k.backedUp, true); assert.equal(k.lastUsedAt, null);
    const m = await prisma.module.findUnique({ where: { id: "m1" } });
    assert.ok(m.installedAt instanceof Date && !Number.isNaN(m.installedAt.getTime()) && Math.abs(m.installedAt.getTime() - Date.now()) < 3_600_000, "a text date written by the database reads as a date");
    const n = await prisma.user.create({ data: { email: "lune_douce@example.org", name: "lune_douce", passwordHash: "x" } });
    await prisma.user.update({ where: { id: "u1" }, data: { totpEnabledAt: new Date(t0 + 5000) } });
    const check = new Database(s.db, { readonly: true });
    const kinds = check.prepare(`SELECT DISTINCT typeof("createdAt") t FROM "User"`).all().map((r) => r.t);
    const totp = check.prepare(`SELECT typeof("totpEnabledAt") t, "totpEnabledAt" v FROM "User" WHERE id = 'u1'`).get();
    check.close();
    assert.deepEqual(kinds, ["integer"], "old and new rows: one date format");
    assert.deepEqual(totp, { t: "integer", v: t0 + 5000 });
    assert.equal(await prisma.user.count({ where: { createdAt: { gte: new Date(t0) } } }), 2, "a date filter covers old and new rows");
    assert.equal((await prisma.user.findMany({ orderBy: { createdAt: "desc" } }))[0].id, n.id, "sorting on dates puts the new row first");
    await prisma.$disconnect();
  } finally { process.chdir(cwd); fs.rmSync(s.root, { recursive: true, force: true, maxRetries: 5 }); }
});
