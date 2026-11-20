// A skin dropped as a .zip (core 0.46.1): check, preview copy, add, replace, cancel, expiry, refusals, provenance, and the proof that the archive is never kept.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { copySkin, TEST_CORE } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";
import { makeZip, zipFolder } from "../helpers/zip.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const S = await import("@/core/skins/service");
const U = await import("@/core/skins/uploadService");
const R = await import("@/core/skins/registry");
const B = await import("@/core/skins/restore");
const M = await import("@/core/skins/uploadMessages");

const SKINS = path.join(db.dir, "skins");
const work = makeTempDir("curiosa-skin-zip-");
after(() => db.close());

/** A skin shaped like a hand-made one with pictures: manifest, tokens, style sheet, README, preview, license text and ten SVG pictures (16 files). */
function makeSkin(id = "verre-teinte", version = "1.0.0", patch) {
  const dir = path.join(work, `${id}-${version}-${crypto.randomBytes(3).toString("hex")}`);
  copySkin("customizable", dir, { id, version, patch });
  return dir;
}
const rows = () => R.readRows();
const audits = async () => (await db.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).filter((a) => a.action.startsWith("skin.")).map((a) => ({ action: a.action, target: a.target, actor: a.actor }));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function walk(dir) {
  const out = [];
  const go = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) { out.push(p + "/"); go(p); } else out.push(p); } };
  go(dir);
  return out;
}

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  S.setServiceHooksForTests({});
  S.clearSkinCaches();
});

test("the file of a skin shaped like a hand-made one is checked, previewed, added: the zip is never kept", async () => {
  const dir = makeSkin();
  assert.ok(fs.readdirSync(dir).length >= 6);
  const zip = zipFolder(dir, { top: "verre-teinte", junk: true });
  const st = await U.stageUpload(zip, { actor: "camille@test" });
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.deepEqual([st.id, st.version, st.token, st.previewable, st.replaces], ["verre-teinte", "1.0.0", sha(zip), true, undefined]);
  assert.equal(st.summary.files >= 15, true);
  // staged: the skin files are in place for the preview, nothing is added, the registry is untouched
  assert.deepEqual(await rows(), []);
  assert.equal(U.stagedId(st.token), "verre-teinte");
  const staged = U.loadStagedSkin("verre-teinte");
  assert.equal(staged.ok, true);
  assert.equal(staged.assetBase, "/skins/verre-teinte/1.0.0/");
  assert.equal((await S.loadInstalledSkin("verre-teinte")).ok, false, "not added: the site's own loader does not know it");
  // add
  const added = await U.addStaged(st.token, { actor: "camille@test" });
  assert.deepEqual({ ok: added.ok, id: added.id, version: added.version, source: added.source }, { ok: true, id: "verre-teinte", version: "1.0.0", source: "personal" });
  const [row] = await rows();
  assert.equal(row.repo, "");
  assert.deepEqual(row.upload, { sha256: sha(zip), bytes: zip.length });
  assert.equal(row.ref, null);
  assert.ok(Date.parse(row.installedAt) > 0);
  assert.equal((await S.loadInstalledSkin("verre-teinte")).ok, true);
  const listed = (await S.installed()).find((s) => s.id === "verre-teinte");
  assert.deepEqual([listed.status, listed.upload?.sha256], ["ok", sha(zip)]);
  assert.deepEqual(await audits(), [{ action: "skin.install", target: `verre-teinte@1.0.0 uploaded file sha256:${sha(zip)} ${zip.length}B`, actor: "camille@test" }]);
  // THE ARCHIVE IS NOT KEPT: no .zip anywhere, no staging note or folder, only the skin files at their normal place
  const left = walk(db.dir);
  assert.deepEqual(left.filter((p) => /\.zip$/i.test(p)), []);
  assert.deepEqual(fs.readdirSync(path.join(SKINS, ".staged")), [], "the staging notes are gone");
  assert.deepEqual(fs.readdirSync(SKINS).filter((n) => n.startsWith(".incoming-")), [], "no temporary folder");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "verre-teinte")), ["1.0.0"]);
  const installedFiles = walk(path.join(SKINS, "verre-teinte", "1.0.0")).filter((p) => !p.endsWith("/")).map((p) => path.relative(path.join(SKINS, "verre-teinte", "1.0.0"), p)).sort();
  assert.ok(!installedFiles.some((f) => /DS_Store|Thumbs|^\._|MACOSX/.test(f)), "no junk is installed");
  const needle = zip.subarray(0, 64);
  for (const p of walk(db.dir).filter((f) => !f.endsWith("/"))) assert.equal(fs.readFileSync(p).includes(needle), false, `${p} does not hold the archive`);
});

test("the three layouts a person makes work: skin files at the top, in one folder (any name), backslashes from an old Windows tool", async () => {
  const dir = makeSkin();
  for (const opts of [{}, { top: "my-skin (1)" }, { top: "verre-teinte-main", junk: true }, { backslashes: true, top: "x" }]) {
    const st = await U.stageUpload(zipFolder(dir, opts), { actor: "a@test" });
    assert.equal(st.ok, true, JSON.stringify([opts, st]));
    assert.equal(st.id, "verre-teinte", "the name of the skin is the id of skin.json, never the folder's name");
    await U.discardStaged();
  }
});

test("a layout the owner can fix: a missing skin.json, a skin.json two folders deep, a folder next to files", async () => {
  const dir = makeSkin();
  const e = async (zip) => { const r = await U.stageUpload(zip, { actor: "a@test" }); assert.equal(r.ok, false); return r.error; };
  assert.equal(await e(makeZip([{ name: "readme.txt", data: "hello" }])), "skins.upload.nomanifest");
  assert.equal(await e(zipFolder(dir, { top: "a/b" })), "skins.upload.layout");
  assert.equal(await e(makeZip([{ name: "one/skin.json", data: "{}" }, { name: "two/skin.css", data: "a{}" }])), "skins.upload.layout");
  assert.equal(await e(Buffer.from("not a zip")), "skins.upload.not-zip");
  assert.deepEqual(await rows(), []);
  assert.deepEqual(fs.existsSync(path.join(SKINS, ".staged")) ? fs.readdirSync(path.join(SKINS, ".staged")) : [], [], "an error leaves nothing staged");
  assert.deepEqual(fs.existsSync(SKINS) ? fs.readdirSync(SKINS).filter((n) => n.startsWith(".incoming-")) : [], [], "an error leaves no temporary folder");
});

test("a skin that breaks the rules is refused with plain sentences, audited without content, and nothing is staged", async () => {
  const dir = makeSkin("verre-teinte", "1.0.0");
  fs.writeFileSync(path.join(dir, "evil.js"), "alert(1)");
  const r = await U.stageUpload(zipFolder(dir), { actor: "camille@test" });
  assert.deepEqual([r.ok, r.error], [false, "skins.error.invalid"]);
  assert.ok(r.issues.some((i) => i.code === "skin-file-unlisted"));
  assert.match((await audits())[0].target, /^verre-teinte skin-file-unlisted$/);
  assert.equal(fs.existsSync(path.join(SKINS, "verre-teinte")), false);
  const t = (k, v = {}) => `${k}|${JSON.stringify(v)}`;
  assert.match(M.friendlyIssue(r.issues.find((i) => i.code === "skin-file-unlisted"), t, "en"), /^skins\.upload\.issue\.skin-file-unlisted\|\{"file":"evil\.js"\}$/);
  assert.equal(M.uploadErrorKey("skins.upload.overlap"), "skins.upload.unusual");
  assert.equal(M.uploadErrorKey("skins.error.invalid"), "skins.error.invalid");
  // unreadable manifest
  const bad = makeZip([{ name: "skin.json", data: "{ not json" }]);
  const b = await U.stageUpload(bad, { actor: "camille@test" });
  assert.equal(b.ok, false);
  assert.ok(b.issues.some((i) => i.code === "manifest-unreadable"));
});

test("Cancel removes the staged copy; a new drop replaces the previous one; an unknown token adds nothing", async () => {
  const one = await U.stageUpload(zipFolder(makeSkin("etoile-nord", "1.0.0")), { actor: "a@test" });
  assert.equal(one.ok, true);
  assert.ok(fs.existsSync(path.join(SKINS, "etoile-nord", "1.0.0")));
  const two = await U.stageUpload(zipFolder(makeSkin("lune-douce", "1.0.0")), { actor: "a@test" });
  assert.equal(two.ok, true);
  assert.equal(fs.existsSync(path.join(SKINS, "etoile-nord")), false, "a new drop removes the previous staged skin");
  assert.equal(U.stagedId(one.token), null);
  assert.equal((await U.addStaged(one.token, { actor: "a@test" })).error, "skins.upload.expired");
  assert.equal((await U.addStaged("f".repeat(64), { actor: "a@test" })).error, "skins.upload.expired");
  assert.equal((await U.addStaged("../../x", { actor: "a@test" })).error, "skins.upload.expired");
  await U.discardStaged(two.token);
  assert.equal(fs.existsSync(path.join(SKINS, "lune-douce")), false, "Cancel removes the staged skin files");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, ".staged")), [], "and the staging note");
  assert.equal(U.loadStagedSkin("lune-douce").ok, false);
  assert.deepEqual(await rows(), []);
  assert.deepEqual(walk(db.dir).filter((p) => /\.zip$/i.test(p)), []);
});

test("a staged skin that nobody added is swept after 30 minutes; fresh ones stay; Add after the delay is refused and cleans", async () => {
  const t0 = Date.UTC(2026, 10, 20, 10, 0, 0);
  const st = await U.stageUpload(zipFolder(makeSkin("etoile-nord")), { actor: "a@test", now: t0 });
  assert.equal(st.ok, true);
  assert.equal(await U.sweepStagedFiles(t0 + 29 * 60_000), 0, "still fresh");
  assert.ok(fs.existsSync(path.join(SKINS, "etoile-nord", "1.0.0")));
  assert.equal(U.stagedId(st.token, t0 + 31 * 60_000), null, "too old for the preview");
  assert.equal(U.loadStagedSkin("etoile-nord", { now: t0 + 31 * 60_000 }).ok, false);
  assert.equal(await U.sweepStagedFiles(t0 + 31 * 60_000) >= 1, true);
  assert.equal(fs.existsSync(path.join(SKINS, "etoile-nord")), false, "the stale staged files are gone");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, ".staged")), []);
  // add after the delay
  const st2 = await U.stageUpload(zipFolder(makeSkin("lune-douce")), { actor: "a@test", now: t0 });
  assert.equal((await U.addStaged(st2.token, { actor: "a@test", now: t0 + 31 * 60_000 })).error, "skins.upload.expired");
  assert.equal(fs.existsSync(path.join(SKINS, "lune-douce")), false);
  assert.deepEqual(await rows(), []);
  // a leftover temporary folder of an interrupted check
  const left = path.join(SKINS, ".incoming-abc123");
  fs.mkdirSync(left, { recursive: true });
  fs.utimesSync(left, new Date(t0 - 3_600_000), new Date(t0 - 3_600_000));
  await U.sweepStagedFiles(t0);
  assert.equal(fs.existsSync(left), false, "an old temporary folder is swept");
});

test("a staged copy that was changed on disk before Add is refused", async () => {
  const st = await U.stageUpload(zipFolder(makeSkin("etoile-nord")), { actor: "a@test" });
  fs.appendFileSync(path.join(SKINS, "etoile-nord", "1.0.0", "skin.css"), "\n/* changed */\n");
  assert.equal((await U.addStaged(st.token, { actor: "a@test" })).error, "skins.upload.expired");
  assert.deepEqual(await rows(), []);
  assert.equal(fs.existsSync(path.join(SKINS, "etoile-nord")), false);
});

test("a failure while adding leaves the registry as it was and removes the staged copy", async () => {
  const st = await U.stageUpload(zipFolder(makeSkin("etoile-nord")), { actor: "a@test" });
  S.setServiceHooksForTests({ beforeSwitch: () => { throw new Error("disk full"); } });
  const r = await U.addStaged(st.token, { actor: "a@test" });
  assert.equal(r.error, "skins.error.failed");
  assert.deepEqual(await rows(), []);
  assert.equal(fs.existsSync(path.join(SKINS, "etoile-nord")), false);
  assert.deepEqual(fs.readdirSync(path.join(SKINS, ".staged")), []);
});

test("replacing a skin added from a file: a higher version, the old one kept for 'go back'; the same version or a skin from elsewhere is refused", async () => {
  const add = async (version, patch) => { const st = await U.stageUpload(zipFolder(makeSkin("verre-teinte", version, patch)), { actor: "a@test" }); if (!st.ok) return st; return { st, r: await U.addStaged(st.token, { actor: "a@test" }) }; };
  const first = await add("1.0.0");
  assert.equal(first.r.ok, true);
  const same = await add("1.0.0", (m) => { m.description.en = "changed"; });
  assert.deepEqual([same.ok, same.error, same.target], [false, "skins.upload.version", "1.0.0"]);
  const lower = await add("0.9.0");
  assert.equal(lower.error, "skins.upload.version");
  const second = await add("1.0.1");
  assert.equal(second.st.replaces, "1.0.0");
  assert.equal(second.r.ok, true);
  const [row] = await rows();
  assert.deepEqual([row.version, row.previous.version, row.upload.sha256 === row.previous.upload.sha256], ["1.0.1", "1.0.0", false]);
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "verre-teinte")).sort(), ["1.0.0", "1.0.1"]);
  // go back
  const back = await S.revert("verre-teinte", { actor: "a@test" });
  assert.deepEqual([back.ok, back.version], [true, "1.0.0"]);
  const [after] = await rows();
  assert.equal(after.upload.sha256, first.r.ok ? first.st.token : "");
  assert.equal(after.previous, undefined);
  // a skin added from an address is not replaced by a file
  await R.writeRows([{ ...after, upload: undefined, repo: "https://github.com/test/skins", source: "personal" }]);
  const clash = await U.stageUpload(zipFolder(makeSkin("verre-teinte", "2.0.0")), { actor: "a@test" });
  assert.deepEqual([clash.ok, clash.error, clash.detail], [false, "skins.upload.exists", "verre-teinte"]);
});

test("a skin added from a file has no address: no update, no reinstall, a plain sentence; removal works", async () => {
  const st = await U.stageUpload(zipFolder(makeSkin()), { actor: "a@test" });
  await U.addStaged(st.token, { actor: "a@test" });
  assert.deepEqual(await S.checkUpdate("verre-teinte", { fresh: true }), { available: false, upload: true });
  assert.equal((await S.update("verre-teinte", { actor: "a@test" })).error, "skins.error.uploaded");
  assert.equal((await S.reinstall("verre-teinte", { actor: "a@test" })).error, "skins.error.uploaded");
  const rem = await S.remove("verre-teinte", { actor: "a@test" });
  assert.equal(rem.ok, true);
  assert.deepEqual(await rows(), []);
  assert.equal(fs.existsSync(path.join(SKINS, "verre-teinte")), false);
});

test("backup and restore: the skin keeps its provenance; with its files gone it asks for the file again", async () => {
  const st = await U.stageUpload(zipFolder(makeSkin()), { actor: "a@test" });
  await U.addStaged(st.token, { actor: "a@test" });
  const saved = await B.backupSkins();
  assert.deepEqual([saved[0].repoUrl, saved[0].uploaded], ["", true]);
  const read = B.skinsOfBackup(saved, []);
  assert.equal(read.length, 1, "an entry without an address is kept when it was added from a file");
  assert.equal(B.skinsOfBackup([{ ...saved[0], uploaded: undefined }], []).length, 0, "but not otherwise");
  const here = await B.planSkins(read);
  assert.equal(here[0].status, "installed");
  fs.rmSync(path.join(SKINS, "verre-teinte"), { recursive: true, force: true });
  assert.equal((await B.planSkins(read))[0].status, "upload");
  const before = await B.skinsBeforeRestore();
  const out = await B.restoreSkins({ before, confirmCustom: [], actor: "a@test" });
  assert.deepEqual(out, [{ id: "verre-teinte", outcome: "failed", error: "skins.error.uploaded" }]);
  assert.equal((await S.installed())[0].status, "missing", "listed, basic applies until the file is added again");
  assert.equal(await S.activeSkinId(), "basic");
});

test("the rate limit: 12 checks per 10 minutes per person", () => {
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) assert.equal(U.uploadRateOk("camille@test", t0 + i), true);
  assert.equal(U.uploadRateOk("camille@test", t0 + 20), false);
  assert.equal(U.uploadRateOk("lune_douce@test", t0 + 20), true);
  assert.equal(U.uploadRateOk("camille@test", t0 + 11 * 60_000), true);
});

test("a zip that is a bomb or has a link never reaches the disk", async () => {
  const bomb = makeZip([{ name: "skin.json", data: Buffer.alloc(300 * 1024) }]);
  const link = makeZip([{ name: "skin.json", data: "{}", host: 3, mode: 0o120777 }]);
  for (const zip of [bomb, link]) {
    const r = await U.stageUpload(zip, { actor: "a@test" });
    assert.equal(r.ok, false);
  }
  const files = walk(SKINS).filter((p) => !p.endsWith("/"));
  assert.deepEqual(files, []);
  assert.deepEqual((await audits()).map((a) => a.action), ["skin.refused", "skin.refused"]);
  assert.ok((await audits()).every((a) => !/\.zip|skin\.json/.test(a.target) && /^upload sha256:[0-9a-f]{16} zip-/.test(a.target)));
});
