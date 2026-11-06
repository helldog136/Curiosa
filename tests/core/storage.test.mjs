// STORAGE: thresholds, sizes, the bounded measurement, the cache, Docker / bare metal, and no file path in anything shown.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const L = await import("@/core/storage/level");
const { formatBytes } = await import("@/core/storage/format");
const U = await import("@/core/storage/usage");
const S = await import("@/core/storage/service");
const { presentStorage } = await import("@/core/storage/present");
const { storageForTool } = await import("@/core/storage/tool");
const { setMaintenanceDeps, resetMaintenanceDeps } = await import("@/core/maintenance/deps");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { makeTempDir } = await import("../helpers/tmp.mjs");

const GB = 2 ** 30, MB = 2 ** 20;
const write = (file, size) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(size, 1)); };

let root;
const savedInstall = process.env.CURIOSA_INSTALL;
beforeEach(() => { root = makeTempDir("curiosa-storage-secret-"); S.resetStorageCache(); });
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  resetMaintenanceDeps();
  if (savedInstall === undefined) delete process.env.CURIOSA_INSTALL; else process.env.CURIOSA_INSTALL = savedInstall;
});

test("thresholds: ok, getting low, very low, with the share rule capped on big disks", () => {
  assert.equal(L.diskLevel(50 * GB, 100 * GB), "ok");
  assert.equal(L.diskLevel(1.4 * GB, 20 * GB), "low"); // under 1.5 GB
  assert.equal(L.diskLevel(5 * GB, 100 * GB), "low"); // 5 % of the disk and under 10 GB
  assert.equal(L.diskLevel(150 * GB, 2000 * GB), "ok"); // 7.5 % but a lot of room: not low
  assert.equal(L.diskLevel(200 * MB, 100 * GB), "critical");
  assert.equal(L.diskLevel(1 * GB, 100 * GB), "critical"); // 1 % of the disk and under 2 GB
  assert.equal(L.diskLevel(1.9 * GB, 20 * GB), "ok"); // 9.5 % and over the 1.5 GB floor
  assert.equal(L.diskLevel(400 * MB, 20 * GB), "critical"); // 1.95 % of the disk and under 2 GB

  assert.equal(L.diskLevel(0, 0), "critical");
  const d = L.describeDisk(3 * GB, 20 * GB);
  assert.deepEqual([d.freePercent, d.level], [15, "ok"]);
});

test("sizes are localized", () => {
  assert.match(formatBytes(3.2 * GB, "en"), /^3\.2\s?GB$/);
  assert.match(formatBytes(3.2 * GB, "fr"), /^3,2\s?Go$/);
  assert.match(formatBytes(512, "en"), /^512\s?byte$|^512\s?B$/);
  assert.match(formatBytes(1536 * 1024, "en"), /^1\.5\s?MB$/);
  assert.match(formatBytes(20 * GB, "fr"), /^20\s?Go$/);
  assert.match(formatBytes(-5, "en"), /^0/);
  assert.match(formatBytes(Number.NaN, "en"), /^0/);
});

test("categories are measured from the data folder", async () => {
  write(path.join(root, "uploads", "a.png"), 1000);
  write(path.join(root, "uploads", "sub", "b.png"), 500);
  write(path.join(root, "fonts", "u-1.woff2"), 100);
  write(path.join(root, "curiosa.db"), 4000);
  write(path.join(root, "curiosa.db-wal"), 200);
  write(path.join(root, "backups", "pre-update-1.db"), 3000);
  write(path.join(root, "modules", "m", "index.js"), 700);
  write(path.join(root, "skins", "s", "skin.json"), 50);
  write(path.join(root, "cache", "x"), 20);
  write(path.join(root, ".secret"), 10);
  const u = await U.measureUsage(root);
  assert.deepEqual(u.categories, { files: 1600, database: 4200, backups: 3000, modules: 750, other: 30 });
  assert.equal(u.totalBytes, 9580);
  assert.equal(u.partial, false);
});

test("symbolic links are never followed", async () => {
  const outside = makeTempDir("curiosa-outside-");
  try {
    write(path.join(outside, "huge.bin"), 100000);
    write(path.join(root, "uploads", "a.png"), 10);
    fs.symlinkSync(outside, path.join(root, "uploads", "link"));
    const u = await U.measureUsage(root);
    assert.ok(u.totalBytes < 1000, `counted ${u.totalBytes}`);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test("the walk is bounded by entries and by time, and says so", async () => {
  for (let i = 0; i < 30; i++) write(path.join(root, "uploads", `f${i}.bin`), 10);
  const byCount = await U.measureUsage(root, { maxEntries: 10 });
  assert.equal(byCount.partial, true);
  assert.ok(byCount.totalBytes <= 100);
  let clock = 0;
  const byTime = await U.measureUsage(root, { maxMs: 5, now: () => (clock += 3) });
  assert.equal(byTime.partial, true);
  const full = await U.measureUsage(root);
  assert.equal(full.partial, false);
  assert.equal(full.totalBytes, 300);
});

test("an unreadable folder is skipped, not fatal", async () => {
  const fake = {
    readdir: async (dir) => { if (dir.endsWith("bad")) throw new Error("EACCES"); return dir === "/r" ? [{ name: "bad", isDirectory: () => true, isSymbolicLink: () => false }, { name: "ok.db", isDirectory: () => false, isSymbolicLink: () => false }] : []; },
    lstat: async () => ({ size: 7 }),
  };
  const u = await U.measureUsage("/r", { fs: fake });
  assert.equal(u.categories.database, 7);
});

for (const kind of ["docker", "bare-metal"]) {
  test(`service (${kind}): measures the data folder, free space from the disk, no path anywhere`, async () => {
    if (kind === "docker") process.env.CURIOSA_INSTALL = "docker"; else delete process.env.CURIOSA_INSTALL;
    write(path.join(root, "uploads", "a.png"), 2048);
    write(path.join(root, "backups", "b.db"), 1024);
    setMaintenanceDeps({ dataDir: root, disk: () => ({ freeBytes: 3 * GB, totalBytes: 20 * GB }) });
    const info = await S.storageInfo({ waitMs: 2000 });
    assert.equal(info.install, kind);
    assert.equal(info.pending, false);
    assert.equal(info.usage.totalBytes, 3072);
    assert.equal(info.disk.level, "ok");
    for (const locale of ["en", "fr"]) {
      const view = presentStorage(info, makeTranslator(locale), locale);
      const everything = JSON.stringify([info, view, storageForTool(info)]);
      assert.ok(!everything.includes(root), "a file path leaked");
      assert.ok(!everything.includes(os.tmpdir()), "a file path leaked");
      assert.ok(!/curiosa-storage-secret/.test(everything), "a folder name leaked");
    }
    const view = presentStorage(info, makeTranslator("en"), "en");
    assert.match(view.sentence, /^3 kB used by your site/);
    assert.match(view.sentence, /3 GB free on the server$/);
    assert.match(view.uploadLine, /^3 GB free of 20 GB$/);
    assert.equal(view.warning, null);
    assert.deepEqual(view.categories.map((c) => c.id), ["files", "database", "backups", "modules", "other"]);
  });
}

test("service: the measurement is cached, shared and refresh is rate limited", async () => {
  write(path.join(root, "uploads", "a.png"), 100);
  let now = 1_000_000;
  setMaintenanceDeps({ dataDir: root, now: () => now, disk: () => ({ freeBytes: 3 * GB, totalBytes: 20 * GB }) });
  const [one, two] = await Promise.all([S.storageInfo({ waitMs: 2000 }), S.storageInfo({ waitMs: 2000 })]);
  assert.equal(one.usage.totalBytes, 100);
  assert.equal(two.usage.totalBytes, 100);
  write(path.join(root, "uploads", "b.png"), 100);
  now += 60_000; // inside the cache
  assert.equal((await S.storageInfo({ waitMs: 2000 })).usage.totalBytes, 100);
  const refreshed = await S.storageInfo({ waitMs: 2000, refresh: true });
  assert.equal(refreshed.usage.totalBytes, 200);
  write(path.join(root, "uploads", "c.png"), 100);
  now += 5_000; // refresh again too soon: ignored
  assert.equal((await S.storageInfo({ waitMs: 2000, refresh: true })).usage.totalBytes, 200);
  now += S.CACHE_MS + 1; // expired: measured again
  assert.equal((await S.storageInfo({ waitMs: 2000 })).usage.totalBytes, 300);
});

test("service: a slow measurement never holds the caller; free space alone starts nothing", async () => {
  setMaintenanceDeps({ dataDir: root, disk: () => ({ freeBytes: 3 * GB, totalBytes: 20 * GB }) });
  const only = await S.storageInfo({ diskOnly: true });
  assert.equal(only.usage, null);
  assert.equal(only.pending, false);
  assert.equal(only.disk.freeBytes, 3 * GB);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const original = S.runner.measure;
  S.runner.measure = async () => { await gate; return { totalBytes: 9, categories: { files: 9, database: 0, backups: 0, modules: 0, other: 0 }, partial: false }; };
  try {
    const quick = await S.storageInfo({ waitMs: 0 });
    assert.equal(quick.pending, true);
    assert.equal(quick.usage, null);
    assert.equal(quick.disk.level, "ok", "the free space is still there while the walk goes on");
    release();
    const later = await S.storageInfo({ waitMs: 2000 });
    assert.equal(later.usage.totalBytes, 9);
    assert.equal(later.pending, false);
  } finally { S.runner.measure = original; release(); }
});

test("warnings: plain words in both languages, state is written, not only coloured", () => {
  const base = { usage: { totalBytes: 1 * GB, categories: { files: 1 * GB, database: 0, backups: 0, modules: 0, other: 0 }, partial: false }, pending: false, measuredAt: null, install: "bare-metal" };
  const low = { ...base, disk: L.describeDisk(1 * GB, 20 * GB) };
  const critical = { ...base, disk: L.describeDisk(200 * MB, 20 * GB) };
  for (const locale of ["en", "fr"]) {
    const t = makeTranslator(locale);
    const l = presentStorage(low, t, locale), c = presentStorage(critical, t, locale);
    assert.equal(l.level, "low");
    assert.equal(c.level, "critical");
    assert.ok(l.warning && c.warning);
    assert.notEqual(l.stateText, c.stateText);
    assert.notEqual(l.icon, c.icon);
    assert.ok(!/\{[a-z]+\}/.test(l.warning + c.warning + l.sentence + l.uploadLine), "unreplaced variable");
  }
  assert.match(presentStorage(low, makeTranslator("en"), "en").warning, /Delete old backups and large images/);
  const none = presentStorage({ ...base, disk: null }, makeTranslator("en"), "en");
  assert.equal(none.level, "unknown");
  assert.equal(none.sentence, null);
});

test("the maintenance health tool reuses the same numbers", async () => {
  const src = fs.readFileSync("src/core/maintenance/inspect.ts", "utf8");
  assert.match(src, /from "@\/core\/storage\/disk"/);
  assert.match(src, /storageInfo\(/);
  assert.ok(!/function diskSpace\(/.test(src), "the disk logic must live in core/storage only");
  const info = { disk: L.describeDisk(3 * GB, 20 * GB), usage: { totalBytes: 5, categories: { files: 5, database: 0, backups: 0, modules: 0, other: 0 }, partial: false }, pending: false, measuredAt: "2026-01-01T00:00:00.000Z", install: "docker" };
  assert.deepEqual(storageForTool(info), { install: "docker", pending: false, measuredAt: "2026-01-01T00:00:00.000Z", usedBySiteBytes: 5, partial: false, categories: { files: 5, database: 0, backups: 0, modules: 0, other: 0 } });
});
