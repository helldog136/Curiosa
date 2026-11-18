// Migration 20261118090000_drop_enabled_columns (core 0.32.0): the legacy "switched off" state ends, the columns Module.enabled and ModuleInstance.enabled go.
// A real database is built exactly as the updater does it (`prisma migrate deploy`, first up to the migration before, then the whole folder), filled with
// rows stored the way Prisma writes them (dates in milliseconds, booleans 0/1), then migrated:
//  - a site with nothing switched off: every row survives the two table rewrites (entries included: no cascading delete), the columns are gone;
//  - a site with switched-off rows (an instance, and a whole module): they are never switched on and never lost: set aside as kept data (reason "legacy"), the
//    payload the SQL wrote is IDENTICAL to what the application's own `retireInstance` writes for the same rows, and the kept data is readable by the application.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { makeTempDir } from "../helpers/tmp.mjs";

const repo = process.cwd();
const NEW = "20261118090000_drop_enabled_columns";
const all = fs.readdirSync("prisma/migrations").filter((d) => /^\d+_/.test(d)).sort();
assert.ok(all.includes(NEW));

function site() {
  const root = makeTempDir("curiosa-drop-enabled-");
  const app = path.join(root, "app");
  fs.mkdirSync(path.join(app, "data"), { recursive: true });
  for (const f of ["prisma.config.ts", "package.json"]) fs.copyFileSync(f, path.join(app, f));
  fs.cpSync("prisma", path.join(app, "prisma"), { recursive: true });
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(app, "node_modules"));
  fs.writeFileSync(path.join(app, ".env"), 'DATABASE_URL="file:../data/curiosa.db"\n');
  return { root, app, db: path.join(app, "data/curiosa.db") };
}
const deploy = (s) => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: s.app, env: { PATH: process.env.PATH, HOME: s.root, CHECKPOINT_DISABLE: "1" }, encoding: "utf8" });
/** The site as it was just before the new migration: the folder without it. */
function siteBefore() {
  const s = site();
  const kept = path.join(s.root, "held");
  fs.renameSync(path.join(s.app, "prisma/migrations", NEW), kept);
  deploy(s);
  return { ...s, migrate: () => { fs.renameSync(kept, path.join(s.app, "prisma/migrations", NEW)); return deploy(s); } };
}

const T0 = Date.UTC(2026, 9, 1, 8, 30, 15, 123);
const D = (n) => T0 + n * 86_400_000;
const cols = (db, t) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);

/** One instance with everything an instance can own. `off` only matters while the column exists. */
function seedInstance(db, { id, moduleId, key, nickname = null, basePath = null, off = false, withEnabled, entries = 2 }) {
  const extra = withEnabled ? ',"enabled"' : "";
  const extraV = withEnabled ? `,${off ? 0 : 1}` : "";
  db.prepare(`INSERT INTO "ModuleInstance" ("id","moduleId","key","nickname","basePath","showInNav","navOrder","display","clickAction","features","fieldSchema","fallbackToDefault","allowGoLinks","exposed","createdAt","updatedAt"${extra}) VALUES (?,?,?,?,?,1,3,'cards','detail','["a"]','[{"k":"é\\"ç"}]',1,0,1,?,?${extraV})`).run(id, moduleId, key, nickname, basePath, D(1), D(2));
  db.prepare(`INSERT INTO "InstanceTranslation" ("id","instanceId","locale","name","description") VALUES (?,?,?,?,?)`).run(`${id}-t-fr`, id, "fr", "Journal « d'hier »", "Une description\nsur deux lignes");
  db.prepare(`INSERT INTO "InstanceTranslation" ("id","instanceId","locale","name","description") VALUES (?,?,?,?,?)`).run(`${id}-t-en`, id, "en", "Yesterday's log", "");
  for (let n = 0; n < entries; n++) {
    db.prepare(`INSERT INTO "Entry" ("id","instanceId","status","publishedAt","expiresAt","cover","icon","url","code","featured","tags","position","fields","sourceLocale","authorId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`${id}-e${n}`, id, n ? "draft" : "published", n ? null : D(5), null, n ? null : "/uploads/a.png", null, null, n ? null : "CODE", n ? 0 : 1, '["x","y"]', n, '{"p":"quoted \\" text"}', "fr", null, D(3 + n), D(4 + n));
    db.prepare(`INSERT INTO "EntryTranslation" ("id","entryId","instanceId","locale","slug","title","summary","body","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`).run(`${id}-e${n}-fr`, `${id}-e${n}`, id, "fr", `slug-${id}-${n}`, `Titre ${n} 🌙`, "Résumé", "Corps\n\"cité\" 'simple' \\ fin", D(6));
    db.prepare(`INSERT INTO "EntryTranslation" ("id","entryId","instanceId","locale","slug","title","summary","body","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`).run(`${id}-e${n}-en`, `${id}-e${n}`, id, "en", `en-${id}-${n}`, `Title ${n}`, "", "", D(6));
  }
  db.prepare(`INSERT INTO "ModuleRecord" ("id","instanceId","collection","data","createdAt","key") VALUES (?,?,?,?,?,?)`).run(`${id}-r1`, id, "votes", '{"n":1}', D(7), "k1");
  db.prepare(`INSERT INTO "ModuleRecord" ("id","instanceId","collection","data","createdAt","key") VALUES (?,?,?,?,?,?)`).run(`${id}-r2`, id, "votes", '{"n":2}', D(8), null);
  db.prepare(`INSERT INTO "Setting" ("key","locale","value") VALUES (?,?,?)`).run(`instance.${id}.title`, "", '"un titre"');
  db.prepare(`INSERT INTO "Setting" ("key","locale","value") VALUES (?,?,?)`).run(`instance.${id}.intro`, "fr", '"bonjour"');
  db.prepare(`INSERT INTO "Setting" ("key","locale","value") VALUES (?,?,?)`).run(`instance.${id}.intro`, "en", '"hello"');
}
function seedModule(db, id, off, withEnabled) {
  const extra = withEnabled ? ',"enabled"' : "";
  const extraV = withEnabled ? `,${off ? 0 : 1}` : "";
  db.prepare(`INSERT INTO "Module" ("id","source","repoUrl","ref","version","updatedAt"${extra}) VALUES (?,?,?,?,?,?${extraV})`).run(id, "git", `https://example.org/${id}.git`, "main", "1.2.3", D(1));
}

/** The shared fixture: three modules, five instances. `off` = what the old column would say. */
function seed(db, withEnabled) {
  seedModule(db, "blog", false, withEnabled);
  seedModule(db, "oldmod", true, withEnabled);      // a whole module switched off
  seedModule(db, "radio", false, withEnabled);
  seedInstance(db, { id: "blog-a", moduleId: "blog", key: "blog", basePath: "blog", withEnabled });                                        // stays
  seedInstance(db, { id: "xay", moduleId: "blog", key: "archive", nickname: "  Archive  ", basePath: "archive", off: true, withEnabled }); // switched off alone; kept apart from "xzy" (same length, same ends)
  seedInstance(db, { id: "xzy", moduleId: "blog", key: "twin", withEnabled, entries: 1 });                                               // stays: its settings must not be taken for those of "xay"
  seedInstance(db, { id: "old-1", moduleId: "oldmod", key: "old-one", withEnabled });                                                     // module off: it goes with it
  seedInstance(db, { id: "old-2", moduleId: "oldmod", key: "old-two", off: true, withEnabled, entries: 0 });
  seedInstance(db, { id: "radio-1", moduleId: "radio", key: "radio", withEnabled, entries: 0 });
  db.prepare(`INSERT INTO "Redirect" ("id","path","targetUrl","updatedAt","managedBy") VALUES ('rd1','/archive','/archive-target',?,?)`).run(D(1), "xay");
  db.prepare(`INSERT INTO "Redirect" ("id","path","targetUrl","updatedAt","managedBy") VALUES ('rd2','/blog','/blog-target',?,?)`).run(D(1), "blog-a");
  db.prepare(`INSERT INTO "Setting" ("key","locale","value") VALUES ('site.name','','"Site"')`).run();
}

const live = (db, t, where = "1") => db.prepare(`SELECT count(*) n FROM "${t}" WHERE ${where}`).get().n;

test("a site with nothing switched off: the columns go, every row survives the table rewrites (entries included)", () => {
  const s = siteBefore();
  const db = new Database(s.db);
  assert.ok(cols(db, "Module").includes("enabled") && cols(db, "ModuleInstance").includes("enabled"), "the columns exist before");
  seedModule(db, "blog", false, true); seedInstance(db, { id: "i1", moduleId: "blog", key: "blog", basePath: "blog", withEnabled: true, entries: 3 });
  db.close();
  s.migrate();
  const after = new Database(s.db);
  assert.ok(!cols(after, "Module").includes("enabled") && !cols(after, "ModuleInstance").includes("enabled"), "the columns are gone");
  assert.equal(live(after, "Module"), 1); assert.equal(live(after, "ModuleInstance"), 1);
  assert.equal(live(after, "Entry"), 3, "no cascading delete when ModuleInstance is rewritten");
  assert.equal(live(after, "EntryTranslation"), 6); assert.equal(live(after, "InstanceTranslation"), 2); assert.equal(live(after, "ModuleRecord"), 2); assert.equal(live(after, "Setting"), 3);
  assert.equal(live(after, "RetiredInstance"), 0, "nothing is set aside when nothing was switched off");
  const row = after.prepare(`SELECT * FROM "ModuleInstance" WHERE id='i1'`).get();
  assert.equal(row.key, "blog"); assert.equal(row.basePath, "blog"); assert.equal(row.createdAt, D(1)); assert.equal(row.features, '["a"]');
  assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
  after.close();
});

test("switched-off rows are set aside with their data, never switched on, never lost; the rest is untouched", () => {
  const s = siteBefore();
  const db = new Database(s.db);
  seed(db, true);
  const sizes = { entries: live(db, "Entry"), records: live(db, "ModuleRecord") };
  db.close();
  s.migrate();
  const after = new Database(s.db);
  // live: only what was on (blog-a, xzy, radio-1), with all its data
  assert.deepEqual(after.prepare(`SELECT id FROM "ModuleInstance" ORDER BY id`).all().map((r) => r.id), ["blog-a", "radio-1", "xzy"]);
  assert.deepEqual(after.prepare(`SELECT id FROM "Module" ORDER BY id`).all().map((r) => r.id), ["blog", "radio"], "the switched-off module is uninstalled");
  assert.equal(live(after, "Entry", `"instanceId" IN ('blog-a','xzy')`), 3);
  assert.equal(live(after, "Entry"), 3, "no entry of a set-aside instance stays live");
  assert.equal(live(after, "ModuleRecord"), 6);   // blog-a, xzy, radio-1
  assert.equal(live(after, "InstanceTranslation"), 6);
  assert.equal(live(after, "Setting", `"key" LIKE 'instance.%'`), 9, "settings of the live instances are kept");
  assert.equal(live(after, "Setting", `"key" LIKE 'instance.xay.%' OR "key" LIKE 'instance.old-%'`), 0, "settings of set-aside instances left the live table");
  assert.deepEqual(after.prepare(`SELECT id FROM "Redirect" ORDER BY id`).all().map((r) => r.id), ["rd2"], "the short address of a set-aside instance goes with it");
  assert.equal(live(after, "Setting", `"key"='site.name'`), 1);
  // set aside: one line per instance, reason legacy
  const kept = after.prepare(`SELECT * FROM "RetiredInstance" ORDER BY id`).all();
  assert.deepEqual(kept.map((r) => [r.id, r.moduleId, r.key, r.reason, r.entryCount, r.recordCount, r.label]), [
    ["old-1", "oldmod", "old-one", "legacy", 2, 2, "Yesterday's log"],
    ["old-2", "oldmod", "old-two", "legacy", 0, 2, "Yesterday's log"],
    ["xay", "blog", "archive", "legacy", 2, 2, "Archive"],
  ]);
  assert.deepEqual([kept[2].repoUrl, kept[2].ref, kept[2].subdir], ["https://example.org/blog.git", "main", null]);
  assert.equal(kept.reduce((n, r) => n + r.entryCount, 0) + live(after, "Entry"), sizes.entries, "every entry is either live or kept");
  assert.equal(kept.reduce((n, r) => n + r.recordCount, 0) + live(after, "ModuleRecord"), sizes.records);
  assert.ok(Math.abs(kept[0].retiredAt - Date.now()) < 3_600_000, "retiredAt is a date in milliseconds like the others");
  assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
  after.close();
});

test("the kept data the SQL wrote is identical to what the application writes, and the application reads it", async () => {
  const s = siteBefore();
  const db = new Database(s.db);
  seed(db, true);
  db.close();
  s.migrate();
  const sql = new Database(s.db);
  const byId = Object.fromEntries(sql.prepare(`SELECT id, payload, label, entryCount, recordCount FROM "RetiredInstance"`).all().map((r) => [r.id, r]));
  // The same rows, live again (schema without the column), set aside by the application itself: the blocks must match.
  seedModule(sql, "oldmod", false, false); sql.prepare(`DELETE FROM "Module" WHERE id='radio'`).run();
  const ids = ["xay", "old-1", "old-2"];
  sql.prepare(`DELETE FROM "RetiredInstance"`).run();
  seedInstance(sql, { id: "xay", moduleId: "blog", key: "archive", nickname: "  Archive  ", basePath: "archive", withEnabled: false });
  seedInstance(sql, { id: "old-1", moduleId: "oldmod", key: "old-one", withEnabled: false });
  seedInstance(sql, { id: "old-2", moduleId: "oldmod", key: "old-two", withEnabled: false, entries: 0 });
  sql.close();
  process.env.DATABASE_URL = "file:../data/curiosa.db";
  const cwd = process.cwd();
  process.chdir(s.app);
  try {
    const { prisma } = await import("@/core/db");
    const Ret = await import("@/core/modules/retired");
    const { parsePayload } = await import("@/core/modules/retiredPlan");
    const norm = (p) => ({
      ...p,
      translations: [...p.translations].sort((a, b) => a.id.localeCompare(b.id)),
      entryTranslations: [...p.entryTranslations].sort((a, b) => a.id.localeCompare(b.id)),
      records: [...p.records].sort((a, b) => a.id.localeCompare(b.id)),
      entries: [...p.entries].sort((a, b) => a.id.localeCompare(b.id)),
    });
    for (const id of ids) {
      const line = await Ret.retireInstance(id, "legacy");
      assert.ok(line, id);
      const fromApp = await prisma.retiredInstance.findUnique({ where: { id } });
      const a = norm(parsePayload(fromApp.payload)), b = norm(parsePayload(byId[id].payload));
      assert.ok(a && b, `${id}: both payloads are readable`);
      assert.deepEqual(b, a, `${id}: the payload of the migration equals the one of the application`);
      assert.equal(byId[id].label, fromApp.label, `${id}: label`);
      assert.equal(byId[id].entryCount, fromApp.entryCount); assert.equal(byId[id].recordCount, fromApp.recordCount);
    }
  } finally { process.chdir(cwd); const { prisma } = await import("@/core/db"); await prisma.$disconnect(); delete process.env.DATABASE_URL; }
});
