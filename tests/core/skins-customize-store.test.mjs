// Skin customization, with a database (docs/SKINS.md "Customization", "Storage"): one setting per skin kept when the owner switches skins, versioning, the rendering of the
// public sheet, pictures (owner rows, quota, replaced and abandoned files, erase), the upload route (rights, origin, size, forged slot), the backup and its restore.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const sharp = (await import("sharp")).default;
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const C = await import("@/core/skins/customizeStore");
const D = await import("@/core/skins/customizeDraft");
const { definitionOf } = await import("@/core/skins/appearanceView");
const { resolveLook } = await import("@/core/skins/render");
const { getSiteConfig, setSetting, getSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { readTarGz } = await import("@/core/backup/tar");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");
const PW = "un-mot-de-passe-solide";

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
  globalThis.curiosaTestSession = null;
});
after(() => { db.close(); cat.close(); });

async function install(id, from = id) {
  await cat.publish(id, { from });
  const r = await S.installFromCatalogue(id);
  assert.equal(r.ok, true, JSON.stringify(r));
}
const solid = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
const banner = async (w = 1600, h = 300) => solid(w, h, "#445566").png().toBuffer();
const emblem = async () => solid(144, 184, "#aa5522").png().toBuffer();
const declared = async (id = "customizable") => { const d = await definitionOf(id); assert.ok(d?.customize, "the skin declares a customization"); return { id: d.id, version: d.version, customize: d.customize }; };
const uploads = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).sort() : []);
const owned = (skin = "customizable") => db.prisma.uploadFile.findMany({ where: { ownerModule: `skin:${skin}` }, orderBy: { name: "asc" } });
const person = async (role = "owner") => (await db.prisma.user.findUnique({ where: { email: `${role}@example.org` } })) ?? db.prisma.user.create({ data: { email: `${role}@example.org`, name: role, role, passwordHash: "x" } });

// ── storage and versioning ──────────────────────────────────────────────────────────────────────────────────────────

test("saving stores only what differs from the skin's defaults, in ONE setting for the skin; nothing at all when everything is the skin's own", async () => {
  await install("customizable");
  const skin = await declared();
  const r = await C.saveCustom(skin, { values: { banner: "crimson", pennants: "royal", corner: 0.2, trim: "gold", nope: 3 }, look: null }, { actor: "owner@example.org" });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.deepEqual(await getSetting("skin.custom.customizable"), { v: 1, skinVersion: "1.0.0", values: { banner: "crimson" } });
  const again = await C.saveCustom(skin, { values: { banner: "crimson" } });
  assert.equal(again.changed, false, "the same state saved again changes nothing");
  const back = await C.saveCustom(skin, { values: {} });
  assert.equal(back.ok, true);
  assert.equal(await getSetting("skin.custom.customizable"), undefined, "back to the skin's own: no setting left");
  const audit = (await db.prisma.auditLog.findMany()).filter((a) => a.action === "skin.custom");
  assert.equal(audit.length, 2, "each real change is journalled, a save that changes nothing is not");
});

test("saving checks every value; a wrong one is refused under its own control, with nothing written", async () => {
  await install("customizable");
  const skin = await declared();
  const r = await C.saveCustom(skin, { values: { banner: "#fff;}body{display:none}", corner: "wide", pennants: "../../x", trim: "silver" } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { banner: "invalid", corner: "invalid", pennants: "invalid" });
  assert.equal(await getSetting("skin.custom.customizable"), undefined);
  const look = await C.saveCustom(skin, { values: { trim: "silver" }, look: "no-such-look" });
  assert.equal((await C.readStored("customizable")).look, undefined, "an unknown look is not stored");
  assert.equal(look.ok, true);
  const l = await C.saveCustom(skin, { values: { banner: "crimson" }, look: "crimson" });
  assert.equal((await C.readStored("customizable")).look, "crimson");
  assert.equal(l.ok, true);
});

test("the values belong to the skin and are kept when the owner switches skins; coming back finds them again", async () => {
  await install("customizable");
  await install("plain-light");
  await A.chooseSkin("customizable");
  await C.saveCustom(await declared(), { values: { banner: "forest", corner: 0.6 } });
  await A.chooseSkin("plain-light");
  assert.deepEqual((await C.readStored("customizable")).values, { banner: "forest", corner: 0.6 }, "switching does not wipe it (the retouches are, the customization is the skin's own page)");
  await A.chooseSkin("customizable");
  const sheet = (await resolveLook(await getSiteConfig())).sheet;
  assert.match(sheet, /--sk-cz-banner:#14402a/);
  assert.match(sheet, /--sk-cz-corner:0\.6rem/);
});

test("reading is tolerant: unknown keys and wrong values are ignored but KEPT until the next save; a save then drops them", async () => {
  await install("customizable");
  await setSetting("skin.custom.customizable", { v: 1, skinVersion: "0.9.0", values: { banner: "no-longer-a-swatch", oldthing: 5, corner: 0.5 } });
  const def = await definitionOf("customizable");
  const l = await C.loadResolved(def);
  assert.deepEqual(l.resolved.dropped.sort(), ["banner", "oldthing"]);
  assert.equal(l.resolved.values.banner, "royal");
  assert.equal(l.resolved.values.corner, 0.5);
  assert.deepEqual((await C.readStored("customizable")).values, { banner: "no-longer-a-swatch", oldthing: 5, corner: 0.5 }, "kept in storage");
  await C.saveCustom(await declared(), { values: l.resolved.values });
  assert.deepEqual((await C.readStored("customizable")).values, { corner: 0.5 }, "the next save drops what the skin no longer knows");
  for (const junk of ["x", 5, null, [], { v: 2, values: {} }, { v: 1 }, { v: 1, values: "x" }]) {
    await setSetting("skin.custom.customizable", junk);
    assert.equal(await C.readStored("customizable"), null, JSON.stringify(junk));
    assert.doesNotThrow(async () => resolveLook(await getSiteConfig()));
  }
  assert.equal(await C.readStored("../x"), null);
});

test("the public sheet: defaults are always written; a customization changes only the variables it names; the render cache follows the stored values", async () => {
  await install("customizable");
  await A.chooseSkin("customizable");
  const cfg = await getSiteConfig();
  const plain = (await resolveLook(cfg)).sheet;
  for (const v of ["--sk-cz-banner:#16235a", "--sk-cz-parchment:#f8f0dc", "--sk-cz-corner:0.2rem", "--sk-cz-trim:#c9962f", '--sk-cz-pennants:url("/skins/customizable/1.0.0/images/fanions.svg")', "--sk-cz-banner-image:none"]) assert.ok(plain.includes(v), v);
  assert.match(plain, /--sk-cz-parchment:#251e19/, "and the dark mode");
  await C.saveCustom(await declared(), { values: { banner: "night", pennants: "forest", "banner-image": "stone", emblem: "eagle" } });
  const custom = (await resolveLook(await getSiteConfig())).sheet;
  assert.notEqual(custom, plain);
  assert.match(custom, /--sk-cz-banner:#1c1830/);
  assert.match(custom, /--sk-cz-banner:#100e1c/, "the dark swatch");
  assert.match(custom, /fanions-foret\.svg/);
  assert.match(custom, /banniere-pierre\.svg/);
  assert.match(custom, /--sk-cz-emblem:url\("\/skins\/customizable\/1\.0\.0\/images\/aigle\.svg"\)/);
  assert.ok(custom.includes("--sk-cz-trim:#c9962f"), "untouched controls keep the skin's value");
  // the sheet carries the skin's own rule that READS the variable, and no value except validated ones
  assert.match(custom, /var\(--sk-cz-banner, #16235a\)/);
  await C.resetCustom(await declared(), "all");
  assert.equal((await resolveLook(await getSiteConfig())).sheet, plain, "reset: exactly the skin as shipped");
});

test("the preview of a skin shows its saved customization (a preview is what 'Use this skin' gives, and the customization is per skin)", async () => {
  await install("customizable");
  await C.saveCustom(await declared(), { values: { banner: "crimson" } });
  const look = await resolveLook(await getSiteConfig(), { previewSkinId: "customizable" });
  assert.match(look.sheet, /--sk-cz-banner:#5e1414/);
});

test("the draft composes like the public render: same variables, plus the signals; it writes nothing", async () => {
  await install("customizable");
  const before = await db.prisma.setting.count();
  const c = await D.composeDraft("customizable", { values: { banner: "night", trim: "#d9d2c0" } });
  assert.match(c.css, /--sk-cz-banner:#1c1830/);
  assert.ok(c.signals.some((s) => s.control === "trim"), JSON.stringify(c.signals));
  assert.equal(await db.prisma.setting.count(), before, "nothing is written");
  assert.equal(await D.composeDraft("nope", { values: {} }), null);
  await install("plain-light");
  assert.equal(await D.composeDraft("plain-light", { values: {} }), null, "a skin that declares nothing has no draft");
  assert.doesNotThrow(() => D.composeDraft("customizable", { values: { banner: { evil: 1 }, "__proto__": 1 } }));
});

// ── pictures ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("a picture: re-encoded by the core, owned by this skin and slot, saved with the customization, the replaced file deleted", async () => {
  await install("customizable");
  const skin = await declared();
  const u = await person();
  const r = await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.value.upload, /^[0-9a-f-]{36}\.webp$/);
  const rows = await owned();
  assert.deepEqual(rows.map((x) => [x.name, x.ownerModule, x.ownerInstance, x.uploaderId]), [[r.value.upload, "skin:customizable", "skin:customizable:banner-image", u.id]]);
  assert.equal(rows[0].bytes, fs.statSync(path.join(UPLOADS_DIR, r.value.upload)).size);
  const saved = await C.saveCustom(skin, { values: { "banner-image": r.value } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.match((await resolveLook(await getSiteConfig(), { previewSkinId: "customizable" })).sheet, new RegExp(`--sk-cz-banner-image:url\\("/uploads/${r.value.upload.replace(".", "\\.")}"\\)`));
  // replaced: the new file is staged, the old one stays until the save, then goes
  const r2 = await C.storePicture(skin, "banner-image", await banner(1800, 338), { uploaderId: u.id });
  assert.deepEqual(uploads().sort(), [r.value.upload, r2.value.upload].sort());
  await C.saveCustom(skin, { values: { "banner-image": r2.value } });
  assert.deepEqual(uploads(), [r2.value.upload], "the replaced picture is deleted at the save");
  assert.deepEqual((await owned()).map((x) => x.name), [r2.value.upload]);
  // back to a bundled picture: the file goes
  await C.saveCustom(skin, { values: { "banner-image": "stone" } });
  assert.deepEqual(uploads(), []);
  assert.deepEqual(await owned(), []);
});

test("a picture can only be saved into the slot it was made for, by name, as a file of this skin", async () => {
  await install("customizable");
  const skin = await declared();
  const u = await person();
  const a = await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal((await C.saveCustom(skin, { values: { "banner-image": a.value } })).errors["banner-image"], "picture", "another slot's file");
  assert.equal((await C.saveCustom(skin, { values: { emblem: { upload: "00000000-0000-4000-8000-000000000000.webp" } } })).errors.emblem, "picture", "a file nobody made");
  // a file of a media library or another module (a row with another owner) is not a skin picture
  const foreign = "11111111-1111-4111-8111-111111111111.webp";
  fs.writeFileSync(path.join(UPLOADS_DIR, foreign), Buffer.from("x"));
  await db.prisma.uploadFile.create({ data: { name: foreign, uploaderId: u.id, bytes: 1, ownerModule: "blog", ownerInstance: "inst1" } });
  assert.equal((await C.saveCustom(skin, { values: { emblem: { upload: foreign } } })).errors.emblem, "picture");
  assert.ok(fs.existsSync(path.join(UPLOADS_DIR, foreign)), "and the save never deletes it");
  assert.equal((await C.saveCustom(skin, { values: { emblem: a.value } })).ok, true);
  assert.equal((await C.storePicture(skin, "pennants", await emblem(), { uploaderId: u.id })).code, "slot", "a slot that takes no upload");
  assert.equal((await C.storePicture(skin, "nope", await emblem(), { uploaderId: u.id })).code, "slot");
});

test("limits: at most 8 files and 4 MB for a skin; abandoned staged files are deleted after a day; erasing a skin removes everything", async () => {
  await install("customizable");
  const skin = await declared();
  const u = await person();
  // the quota counts the OTHER slots: replacing a picture is always possible
  const a = await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  await C.saveCustom(skin, { values: { emblem: a.value } });
  for (let i = 0; i < 5; i++) await db.prisma.uploadFile.create({ data: { name: `${String(i).repeat(8)}-0000-4000-8000-000000000000.webp`, bytes: 10, ownerModule: "skin:customizable", ownerInstance: `skin:customizable:other${i}`, uploaderId: u.id } });
  assert.equal((await C.pictureUsage("customizable")).files, 6);
  assert.equal((await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id })).ok, true, "replacing a slot never counts that slot twice");
  assert.equal((await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id })).ok, true, "the 8th file");
  assert.equal((await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id })).ok, true, "a second try for the same slot replaces the staged file");
  await db.prisma.uploadFile.create({ data: { name: "99999999-0000-4000-8000-000000000000.webp", bytes: 10, ownerModule: "skin:customizable", ownerInstance: "skin:customizable:other9", uploaderId: u.id } });
  assert.equal((await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id })).code, "quota", "the 9th file");
  // weight
  await db.prisma.uploadFile.deleteMany({ where: { ownerInstance: { startsWith: "skin:customizable:other" } } });
  await db.prisma.uploadFile.create({ data: { name: "88888888-0000-4000-8000-000000000000.webp", bytes: 4 * 1024 * 1024, ownerModule: "skin:customizable", ownerInstance: "skin:customizable:heavy", uploaderId: u.id } });
  assert.equal((await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id })).code, "quota", "over 4 MB");
  await db.prisma.uploadFile.deleteMany({ where: { ownerInstance: "skin:customizable:heavy" } });
  // abandoned: staged and never saved, older than a day
  const staged = await C.storePicture(skin, "banner-image", await banner(), { uploaderId: u.id });
  await db.prisma.uploadFile.update({ where: { name: staged.value.upload }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  assert.ok(!(await owned()).some((r) => r.name === staged.value.upload), "an abandoned file is pruned");
  assert.ok(!uploads().includes(staged.value.upload));
  const erased = await C.eraseCustom("customizable");
  assert.ok(erased.pictures >= 1);
  assert.deepEqual(await owned(), []);
  assert.equal(await getSetting("skin.custom.customizable"), undefined);
});

test("a deleted file is reported (the skin's own picture shows) and the next save drops it", async () => {
  await install("customizable");
  const skin = await declared();
  const u = await person();
  const a = await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  await C.saveCustom(skin, { values: { emblem: a.value } });
  fs.rmSync(path.join(UPLOADS_DIR, a.value.upload));
  S.clearSkinCaches();
  const l = await C.loadResolved(await definitionOf("customizable"));
  assert.deepEqual(l.resolved.missing, ["emblem"]);
  assert.match((await resolveLook(await getSiteConfig(), { previewSkinId: "customizable" })).sheet, /--sk-cz-emblem:url\("\/skins\/customizable\/1\.0\.0\/images\/ecu\.svg"\)/);
});

test("reset: some controls or all; pictures no longer used go with them", async () => {
  await install("customizable");
  const skin = await declared();
  const u = await person();
  const a = await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  await C.saveCustom(skin, { values: { emblem: a.value, banner: "crimson", corner: 1 } });
  await C.resetCustom(skin, ["banner"]);
  assert.deepEqual(Object.keys((await C.readStored("customizable")).values).sort(), ["corner", "emblem"]);
  assert.equal(uploads().length, 1);
  await C.resetCustom(skin, "all");
  assert.equal(await C.readStored("customizable"), null);
  assert.deepEqual(uploads(), []);
});

// ── the upload route ────────────────────────────────────────────────────────────────────────────────────────────────

const route = await import("@/app/api/admin/skin-custom/upload/route");
const asUser = async (role) => { const u = role ? await person(role) : null; globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: 0 } } : null; return u; };
const post = async ({ file, skin = "customizable", slot = "banner-image", origin = "https://site.example", headers = {}, extra = {}, name = "p.png" }) => {
  const fd = new FormData();
  if (file) fd.set("file", new File([file], name));
  fd.set("skin", skin); fd.set("slot", slot);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  // a browser always says how big the body is; a request that does not is refused (the size is checked before anything is read)
  const length = headers["content-length"] === null ? {} : { "content-length": String((await new Response(fd).arrayBuffer()).byteLength) };
  const { "content-length": _drop, ...rest } = headers; void _drop;
  return route.POST(new Request("https://site.example/api/admin/skin-custom/upload", { method: "POST", body: fd, headers: { ...(origin ? { origin } : {}), host: "site.example", ...length, ...(headers["content-length"] ? { "content-length": headers["content-length"] } : {}), ...rest } }));
};

test("route: only the Administration role, from this site, for a slot the skin declares; the answer says what to do", async () => {
  await install("customizable");
  const file = await banner();
  await asUser(null);
  assert.equal((await post({ file })).status, 401);
  await asUser("editor");
  assert.equal((await post({ file })).status, 403, "an editor may write content, not change the look of the site");
  await asUser("admin");
  assert.equal((await post({ file, origin: "https://evil.example" })).status, 403, "another site");
  assert.equal((await post({ file, origin: null })).status, 403, "no origin");
  assert.equal((await post({ file, slot: "nope" })).status, 422, "forged slot");
  assert.equal((await post({ file, slot: "pennants" })).status, 422, "a slot that takes no upload");
  assert.equal((await post({ file, skin: "plain-light" })).status, 404, "a skin that declares nothing");
  assert.equal((await post({ file, skin: "../x" })).status, 400);
  assert.equal((await post({ file, skin: "not-installed" })).status, 404);
  assert.equal((await post({})).status, 400, "no file");
  const bad = await post({ file: Buffer.from("not an image at all, just text") });
  assert.equal(bad.status, 422);
  assert.deepEqual((await bad.json()).code, "format");
  assert.equal((await post({ file, headers: { "content-length": null } })).status, 411, "no declared size");
  const big = await post({ file, headers: { "content-length": String(6 * 1024 * 1024) } });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, "toolarge");
  const ok = await post({ file, extra: { fx: "0.2", fy: "5" } });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.ok, true);
  assert.match(j.url, /^\/uploads\/[0-9a-f-]{36}\.webp$/);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.ok(fs.existsSync(path.join(UPLOADS_DIR, j.value.upload)));
  const owner = await asUser("owner");
  assert.equal((await post({ file })).status, 200, "the owner too");
  assert.ok(owner);
});

test("the upload is NOT /api/admin/upload: that one keeps what it receives, for any member", () => {
  const generic = fs.readFileSync("src/app/api/admin/upload/route.ts", "utf8");
  assert.ok(!generic.includes("skin"), "the generic route knows nothing of skins");
  const mine = fs.readFileSync("src/app/api/admin/skin-custom/upload/route.ts", "utf8");
  assert.ok(mine.includes("isSameOrigin") && mine.includes('hasRole(user, "admin")') && mine.includes("storePicture"));
  assert.ok(!/saveUpload|storeUpload/.test(mine), "never stores a file as received");
});

// ── backup ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test("the backup carries the customization AND its pictures with their owner; a restore brings them back and the skin shows them", async () => {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
  await install("customizable");
  await A.chooseSkin("customizable");
  const skin = await declared();
  const u = await person("owner");
  const a = await C.storePicture(skin, "emblem", await emblem(), { uploaderId: u.id });
  await C.saveCustom(skin, { values: { emblem: a.value, banner: "forest" } });
  const bytes = fs.readFileSync(path.join(UPLOADS_DIR, a.value.upload));
  const b = await B.createBackup(PW, { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
  assert.ok(files[`uploads/${a.value.upload}`].equals(bytes), "the picture is in the archive");
  const rows = JSON.parse(files["data/upload-files.json"].toString("utf8"));
  assert.deepEqual(rows.filter((r) => r.name === a.value.upload).map((r) => [r.ownerModule, r.ownerInstance]), [["skin:customizable", "skin:customizable:emblem"]]);
  const settings = JSON.parse(files["data/settings.json"].toString("utf8"));
  const stored = settings.find((s) => s.key === "skin.custom.customizable").value;
  assert.equal((typeof stored === "string" ? JSON.parse(stored) : stored).values.banner, "forest");
  // a new site
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  S.clearSkinCaches();
  const report = await Rs.applyRestore(Rs.openBackup(b.buffer, PW, 1000).backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.skins, [{ id: "customizable", outcome: "installed" }]);
  assert.ok(fs.readFileSync(path.join(UPLOADS_DIR, a.value.upload)).equals(bytes), "the file is back");
  assert.deepEqual((await owned()).map((r) => r.ownerInstance), ["skin:customizable:emblem"], "with its owner: a later save or reset still deletes it");
  S.clearSkinCaches();
  const sheet = (await resolveLook(await getSiteConfig())).sheet;
  assert.match(sheet, new RegExp(`--sk-cz-emblem:url\\("/uploads/${a.value.upload.replace(".", "\\.")}"\\)`));
  assert.match(sheet, /--sk-cz-banner:#14402a/);
});
