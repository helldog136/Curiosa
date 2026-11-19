// Conversion of old backups (core 0.39.0, docs/BACKUP.md "Old backups"): the conversions of the deleted one-time migrations rebuilt as pure functions on backup data,
// the report (converted / set aside / failed, with the manual path), the checks before anything is installed, the staging copy that stops a bad restore before the live site
// is touched, and the folder swap. Demo data only.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const db = await useTestDb();
const C = await import("@/core/backup/conversion/coreConversions");
const S = await import("@/core/backup/conversion/stage");
const P = await import("@/core/backup/conversion/plan");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { createTarGz, readTarGz } = await import("@/core/backup/tar");
const { encryptBackup } = await import("@/core/backup/crypto");
const { setSetting, getSetting } = await import("@/core/settings");
const { UPLOADS_DIR, FONTS_DIR } = await import("@/core/config");
const { createHash } = await import("node:crypto");

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
const NOW = new Date("2026-01-01T00:00:00Z");
beforeEach(async () => { await db.reset(); await db.prisma.retiredInstance.deleteMany(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });
after(() => db.close());

const data = (over = {}) => ({ users: [], settings: [], modules: [], instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [], retired: [], ...over });
const inst = (id, moduleId, extra = {}) => ({ id, moduleId, key: id, nickname: null, basePath: id, showInNav: false, navOrder: 0, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", ...extra });

test("switched-off items (before 0.1.20): set aside with their data in the same block as the SQL migration, never switched on", () => {
  const d = data({
    modules: [{ id: "blog", name: "Blog", enabled: true }, { id: "radio", name: "Radio", enabled: false, repoUrl: "https://example.org/r", ref: "v1.0.0", subdir: null }],
    instances: [inst("i1", "blog"), inst("i2", "blog", { enabled: false, nickname: "Archive" }), inst("i3", "radio")],
    instanceTranslations: [{ id: "t1", instanceId: "i2", locale: "fr", name: "Archive", description: "" }],
    entries: [{ id: "e1", instanceId: "i2", status: "published" }, { id: "e2", instanceId: "i1", status: "published" }],
    entryTranslations: [{ id: "x1", entryId: "e1", instanceId: "i2", locale: "fr", slug: "a", title: "A", summary: "", body: "" }],
    records: [{ id: "r1", instanceId: "i2", collection: "c", data: { a: 1 } }, { id: "r2", instanceId: "i3", collection: "c", data: {} }],
    settings: [{ key: "instance.i2.color", locale: "", value: "red" }, { key: "site.name", locale: "fr", value: "Demo" }],
  });
  const result = C.convertSwitchedOff(d, NOW);
  assert.deepEqual(d.instances.map((i) => i.id), ["i1"], "the instance of the switched-off module and the switched-off instance both leave");
  assert.deepEqual(d.modules.map((m) => m.id), ["blog"], "a switched-off module is uninstalled");
  assert.equal("enabled" in d.modules[0], false);
  assert.deepEqual(d.retired.map((r) => [r.id, r.reason, r.label]).sort(), [["i2", "legacy", "Archive"], ["i3", "legacy", "i3"]]);
  const kept = d.retired.find((r) => r.id === "i2");
  assert.deepEqual([kept.payload.v, kept.payload.entries.length, kept.payload.entryTranslations.length, kept.payload.records.length, kept.payload.settings], [1, 1, 1, 1, [{ key: "instance.i2.color", locale: "", value: "\"red\"" }]]);
  assert.equal("enabled" in kept.payload.instance, false);
  assert.deepEqual(d.entries.map((e) => e.id), ["e2"]);
  assert.deepEqual(d.records, [], "the records of both set-aside instances went with them");
  assert.deepEqual(d.settings.map((s) => s.key), ["site.name"]);
  assert.equal(result.setAside[0].id, "core.switched-off");
  assert.match(result.setAside[0].path, /data\/instances\.json/);
  assert.deepEqual(C.convertSwitchedOff(d, NOW), {}, "idempotent");
});

test("menu (before 0.2.6): frozen into nav.menu from the instances shown in the menu and nav.custom; a stored menu is never touched", () => {
  const d = data({
    instances: [inst("i2", "blog", { showInNav: true, navOrder: 2 }), inst("i1", "links", { showInNav: true, navOrder: 1 }), inst("i3", "x", { showInNav: false })],
    entries: [{ id: "e1", instanceId: "root", status: "published" }],
    entryTranslations: [{ id: "x", entryId: "e1", instanceId: "root", locale: "fr", slug: "about", title: "A", summary: "", body: "" }],
    settings: [{ key: "i18n.default", locale: "", value: "fr" }, { key: "nav.custom", locale: "", value: [{ label: { fr: "A propos" }, href: "/about" }, { label: { fr: "Aide" }, href: "https://example.org/help" }] }],
  });
  d.instances.push(inst("root", "pages", { basePath: "" }));
  const out = C.freezeMenu(d);
  const menu = d.settings.find((s) => s.key === "nav.menu").value;
  assert.deepEqual(menu.items.map((n) => [n.kind, n.ref ?? n.href]), [["instance", "i1"], ["instance", "i2"], ["entry", "e1"], ["link", "https://example.org/help"]]);
  assert.equal(out.converted[0].id, "core.menu");
  const before = JSON.stringify(d.settings);
  assert.deepEqual(C.freezeMenu(d), {}, "already stored: nothing to do");
  assert.equal(JSON.stringify(d.settings), before);
});

test("placement (before 0.2.6): an instance without a chosen place keeps Overlays when its module has a page and serves an overlay", () => {
  const d = data({ instances: [inst("a", "mix"), inst("b", "mix"), inst("c", "plain")], settings: [{ key: "instance.b.__placement", locale: "", value: "menu" }] });
  const manifests = { mix: { type: "integration", permissions: ["overlay"], page: true }, plain: { type: "integration", permissions: [] } };
  const out = C.freezePlacements(d, (id) => manifests[id] ?? null, "0.2.1");
  assert.deepEqual(C.freezePlacements(data({ instances: [inst("z", "mix")] }), (id) => manifests[id] ?? null, "0.2.14"), {}, "a backup from 0.2.6 on never needed it");
  assert.deepEqual(d.settings.filter((s) => /__placement$/.test(s.key)).map((s) => [s.key, s.value]), [["instance.b.__placement", "menu"], ["instance.a.__placement", "overlays"]]);
  assert.equal(out.converted[0].params.count, 1);
  assert.deepEqual(C.freezePlacements(d, (id) => manifests[id] ?? null, "0.2.1"), {}, "the marker is in the data: nothing more");
});

test("RAWG hand-over (before 0.3.0): code, fixes and to-check list prepared; the old module key counts only when the core has none; done = nothing", () => {
  const s = (key, value) => ({ key, locale: "", value });
  const d = data({ instances: [inst("p", "planning")], settings: [s("rawg.fixes", { hades: { title: "Hades" }, junk: 5 }), s("rawg.toCheck", [{ key: "doom" }, 3]), s("instance.p.rawgApiKey", "code-demo-0001")] });
  const p = C.rawgCarryOver(d);
  assert.deepEqual([p.key, Object.keys(p.fixes), p.todo.length], ["code-demo-0001", ["hades"], 1]);
  assert.deepEqual(C.rawgSummary(p), { key: true, fixes: 1, todo: 1 }, "the summary never carries the value");
  d.settings.push(s("rawg.key", "code-core-0002"));
  assert.equal(C.rawgCarryOver(d).key, "code-core-0002");
  d.settings.push(s("rawg.handover", { doneAt: "2026-01-01T00:00:00Z" }));
  assert.equal(C.rawgCarryOver(d), null, "the site that made the backup had already handed over");
  assert.equal(C.rawgCarryOver(data()), null);
});

/* ───────────── a whole restore ───────────── */

async function oldBackup(mutate) {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  await setSetting("site.name", "Mon site", "fr");
  await setSetting("i18n.default", "fr");
  const b = await B.createBackup(PW, { iterations: FAST });
  const files = readTarGz(b.plain).map((f) => ({ ...f }));
  const manifest = JSON.parse(files.find((f) => f.path === "backup.json").content.toString());
  const edit = (p, fn) => { const f = files.find((x) => x.path === p); f.content = Buffer.from(JSON.stringify(fn(JSON.parse(f.content.toString())))); };
  const add = (p, value) => files.push({ path: p, content: Buffer.from(JSON.stringify(value)) });
  mutate({ manifest, edit, add });
  for (const e of manifest.files) e.sha256 = createHash("sha256").update(files.find((f) => f.path === e.path).content).digest("hex");
  for (const f of files) if (!manifest.files.some((e) => e.path === f.path) && !["backup.json", "README.txt"].includes(f.path)) manifest.files.push({ path: f.path, sha256: createHash("sha256").update(f.content).digest("hex"), bytes: f.content.length });
  files.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(manifest));
  const opened = Rs.openBackup(encryptBackup(createTarGz(files), PW, FAST), PW, FAST);
  assert.ok(opened.ok, JSON.stringify(opened));
  await db.reset();
  return opened.backup;
}

test("a backup with a switched-off instance and no stored menu is restored: set aside in the report with the exact file, menu frozen, nothing switched on", async () => {
  const backup = await oldBackup(({ manifest, edit }) => {
    manifest.frameworkVersion = "0.1.5"; manifest.schemaVersion = "20200101000000_ancien";
    edit("data/instances.json", () => [inst("i1", "blog", { enabled: false, showInNav: true }), inst("i2", "blog", { showInNav: true, navOrder: 1 })]);
    edit("data/settings.json", (rows) => [...rows, { key: "nav.custom", locale: "", value: [{ label: { fr: "Aide" }, href: "https://example.org/help" }] }]);
  });
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report.report));
  assert.deepEqual(await db.prisma.moduleInstance.findMany({ select: { id: true } }).then((r) => r.map((x) => x.id)), ["i2"]);
  const kept = await db.prisma.retiredInstance.findMany();
  assert.deepEqual(kept.map((k) => [k.id, k.reason]), [["i1", "legacy"]]);
  const aside = report.report.setAside.find((i) => i.id === "core.switched-off");
  assert.deepEqual([aside.note, aside.params.count, /data\/instances\.json/.test(aside.path)], ["switchedOff", 1, true]);
  assert.ok(report.report.converted.some((i) => i.id === "core.menu"));
  assert.deepEqual((await getSetting("nav.menu")).items.map((n) => n.kind), ["instance", "link"], "the switched-off instance is not in the frozen menu");
  assert.ok(report.safetyCopy && fs.existsSync(path.join(report.safetyCopy, "database.db")));
});

test("the plan shows the version gap and what will be converted, and writes nothing", async () => {
  const backup = await oldBackup(({ manifest, edit }) => {
    manifest.frameworkVersion = "0.2.1";
    edit("data/instances.json", () => [inst("i1", "blog", { enabled: false })]);
  });
  const preview = await Rs.previewRestore(backup);
  assert.equal(preview.conversion.gap, "older");
  assert.equal(preview.conversion.backupVersion, "0.2.1");
  assert.deepEqual(preview.conversion.core.map((i) => i.id), ["core.switched-off"]);
  assert.equal(await db.prisma.retiredInstance.count(), 0);
  assert.equal(await db.prisma.user.count(), 0);
  const same = await P.buildConversionPlan({ data: data(), frameworkVersion: JSON.parse(fs.readFileSync("package.json", "utf8")).version, createdAt: NOW.toISOString(), modules: [] });
  assert.equal(same.gap, "same");
});

test("a newer database schema is refused BEFORE any module is installed", async () => {
  const backup = await oldBackup(({ manifest }) => { manifest.schemaVersion = "99991231000000_futur"; });
  let called = 0;
  const installers = { fromCatalogue: async () => { called++; return { ok: true, id: "x" }; }, fromRepo: async () => { called++; return { ok: true, id: "x" }; } };
  backup.data.modules = [{ id: "blog", source: "git", version: "1", origin: "catalogue", name: "Blog", repoUrl: null, ref: null, commit: null }];
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o", installers });
  assert.deepEqual([report.ok, report.error, called], [false, "newer-schema", 0]);
});

test("staging stops a bad restore before the live site is touched: data, uploads and installed modules stay as they were", async () => {
  const backup = await oldBackup(({ edit }) => { edit("data/users.json", (u) => [...u, { ...u[0] }]); });   // two accounts with the same identifier: the staging copy refuses the write
  await db.prisma.user.create({ data: { email: "live@example.org", name: "Live", role: "owner", passwordHash: "h" } });
  await setSetting("site.name", "Site en place", "fr");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"), "live");
  const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
  const report = await quiet(() => Rs.applyRestore(backup, { confirmCustom: [], actor: "o" }));
  assert.deepEqual([report.ok, report.error], [false, "invalid"]);
  assert.ok(report.report.failed.some((i) => i.id === "check.write"), JSON.stringify(report.report));
  assert.deepEqual((await db.prisma.user.findMany()).map((u) => u.email), ["live@example.org"]);
  assert.equal((await getSetting("site.name", "fr")), "Site en place");
  assert.equal(fs.readFileSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"), "utf8"), "live");
  assert.ok(report.safetyCopy, "the snapshot was taken before staging");
});

test("the staging copy checks an owner account, the counts, the claimed files and the stored records", async () => {
  const d = { ...data(), users: [{ id: "u1", email: "o@example.org", name: "O", role: "owner", passwordHash: "h", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" }], instances: [], uploadFiles: [{ name: "gone.png", ownerInstance: "i", ownerModule: "m", createdAt: "2025-01-01T00:00:00Z" }] };
  const ok = await S.validateOnStagingCopy(d, new Set(["gone.png"]), db.dir);
  assert.deepEqual(ok, []);
  const noOwner = await S.validateOnStagingCopy({ ...d, users: [{ ...d.users[0], role: "editor", id: "u2", email: "e@example.org" }] }, new Set(), db.dir);
  assert.ok(noOwner.some((i) => i.id === "check.owner"));
  assert.ok(fs.readdirSync(path.join(db.dir, "tmp", "restore-staging")).length === 0, "the staging database is deleted");
});

test("folder swap: renamed in place with the old folder kept aside; put back from the snapshot", () => {
  const dir = makeTempDir("swap-");
  const live = path.join(dir, "uploads"), staged = path.join(dir, "stage"), aside = path.join(dir, "aside");
  fs.mkdirSync(live); fs.writeFileSync(path.join(live, "old.txt"), "old");
  fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, "new.txt"), "new");
  S.swapDir(live, staged, aside, () => false);
  assert.deepEqual(fs.readdirSync(live), ["new.txt"]);
  assert.deepEqual(fs.readdirSync(aside), ["old.txt"]);
  S.restoreDirFrom(live, aside);
  assert.deepEqual(fs.readdirSync(live), ["old.txt"]);
  S.restoreDirFrom(live, path.join(dir, "none"));
  assert.deepEqual(fs.readdirSync(live), [], "a snapshot without the folder puts back an empty one");
  assert.ok(FONTS_DIR);
});
