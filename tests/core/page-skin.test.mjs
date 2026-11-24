// "Skin for this page" (core 0.45.0, docs/PAGE-SKIN.md): the rule, the rendering of one page with another installed site skin, the entry editor, the assistant
// tools, the approval text, backups, and the guarantees (one skin per request, nothing leaks to another page, plain links, a removed skin falls back).
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
const S = await import("@/core/skins/service");
const K = await import("@/core/skins/pageSkinCheck");
const P = await import("@/core/skins/pageSkin");
const C = await import("@/core/skins/customizeStore");
const { definitionOf } = await import("@/core/skins/appearanceView");
const { resolveLook } = await import("@/core/skins/render");
const { setSetting, getSiteConfig } = await import("@/core/settings");
const { SKINS_DIR } = await import("@/core/config");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { requestedPageSkin } = await import("@/core/content/pageSkin");
const { contentToolProvider } = await import("@/core/content/mcp");
const { prepareEntryPublish } = await import("@/core/maintenance/publish");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const cat = createSkinsRepo();
const ACTOR = { name: "assistant", tokenId: "t1" };
const read = (p) => fs.readFileSync(p, "utf8");

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS_DIR, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
});
after(() => { db.close(); cat.close(); });

async function install(id, from = id) {
  await cat.publish(id, { from });
  const r = await S.installFromCatalogue(id);
  assert.equal(r.ok, true, JSON.stringify(r));
}
/** An extension with the entry-level feature (here the fixture "pages", mounted at the root) and one published page. */
async function pagesSite({ feature = true, status = "published", skin = null } = {}) {
  await db.fixture("pages");
  const manifest = FIXTURE_MODULES.find((b) => b.manifest.id === "pages").manifest;
  const inst = await createInstance(db.prisma, { manifest, names: { en: "Pages", fr: "Pages" }, nickname: "Pages" });
  if (feature) await db.prisma.moduleInstance.update({ where: { id: inst.id }, data: { features: JSON.stringify([...(manifest.content?.features ?? []), "skin"]) } });
  const entry = await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Showcase", slug: "showcase", status, skin });
  return { inst, entry };
}
const tool = async (key, name) => (await contentToolProvider.list()).find((t) => t.name === `${key}__${name}`);

// ── the rule (pure) ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the setting is offered only with at least two installed site skins", () => {
  assert.equal(K.pageSkinOffered([]), false);
  assert.equal(K.pageSkinOffered(["duo"]), false);
  assert.equal(K.pageSkinOffered(["duo", "customizable"]), true);
});

test("checkPageSkin: valid id, none or empty (the site's skin), unknown id, an overlay or basic id, a single-skin site, free text", () => {
  const two = ["duo", "customizable"];
  assert.deepEqual(K.checkPageSkin("duo", two), { ok: true, skin: "duo" });
  assert.deepEqual(K.checkPageSkin(" duo ", two), { ok: true, skin: "duo" });
  for (const none of ["", "none", "NONE", "  "]) assert.deepEqual(K.checkPageSkin(none, two), { ok: true, skin: null }, `"${none}" means the site's skin`);
  assert.deepEqual(K.checkPageSkin("nope", two), { ok: false, reason: "unknown" });
  assert.deepEqual(K.checkPageSkin("basic", two), { ok: false, reason: "unknown" }, "basic is not an installed skin");
  assert.deepEqual(K.checkPageSkin("an-overlay-skin", two), { ok: false, reason: "unknown" }, "an overlay skin is not among the installed SITE skins");
  assert.deepEqual(K.checkPageSkin("duo", ["duo"]), { ok: false, reason: "single" }, "one skin installed: refused");
  assert.deepEqual(K.checkPageSkin("", ["duo"]), { ok: true, skin: null }, "but clearing is always allowed");
  for (const bad of ["../x", "a b", "Duo", "x;}", "a".repeat(80), "1abc", 7, {}, []]) assert.equal(K.checkPageSkin(bad, two).ok, false, String(bad));
  assert.deepEqual(K.checkPageSkin(undefined, two, "duo"), { ok: true, skin: "duo" }, "absent = unchanged");
  assert.deepEqual(K.checkPageSkin("gone-skin", two, "gone-skin"), { ok: true, skin: "gone-skin" }, "the stored value sent back unchanged is accepted even if the skin is gone");
});

test("effectivePageSkin: a removed skin, a single-skin site, the site's own skin, a bad id all mean 'the site skin'", () => {
  const two = ["duo", "customizable"];
  assert.equal(K.effectivePageSkin("duo", two, "customizable"), "duo");
  assert.equal(K.effectivePageSkin("duo", two, "duo"), null, "same as the site's own skin: nothing to change");
  assert.equal(K.effectivePageSkin("gone", two, "customizable"), null, "removed");
  assert.equal(K.effectivePageSkin("duo", ["duo"], "basic"), null, "only one skin left");
  assert.equal(K.effectivePageSkin("../../etc", two, "basic"), null);
  assert.equal(K.effectivePageSkin(null, two, "basic"), null);
  assert.equal(K.effectivePageSkin("duo", two, "basic"), "duo", "a site on basic can show a page with an installed skin");
});

// ── the installed list ──────────────────────────────────────────────────────────────────────────────────────────────

test("installed site skins: overlay skins and skins without files are never offered; the choices appear only from two", async () => {
  assert.deepEqual(await P.installedSiteSkinIds(), []);
  await install("duo");
  assert.deepEqual(await P.pageSkinChoices(), [], "one skin: nothing to choose");
  // an overlay skin row with its files in place is still not a site skin
  const rows = JSON.parse((await db.prisma.setting.findFirst({ where: { key: "skin.installed" } })).value);
  fs.mkdirSync(path.join(SKINS_DIR, "glass", "1.0.0"), { recursive: true });
  fs.writeFileSync(path.join(SKINS_DIR, "glass", "1.0.0", "skin.json"), "{}");
  await setSetting("skin.installed", [...rows, { ...rows[0], id: "glass", version: "1.0.0", kind: "overlay" }]);
  assert.deepEqual(await P.installedSiteSkinIds(), ["duo"], "overlay skin not counted");
  assert.deepEqual(await P.pageSkinChoices(), [], "still one site skin");
  await install("customizable");
  const choices = await P.pageSkinChoices();
  assert.deepEqual(choices.map((c) => c.id).sort(), ["customizable", "duo"]);
  assert.equal((await P.pageSkinOptions(["body"], "en")).length, 0, "an extension without the feature offers nothing");
  assert.equal((await P.pageSkinOptions(["body", "skin"], "fr")).length, 2);
});

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("a page with its own skin: the other skin's sheet and customization only, the site's skin not loaded in addition; other pages unchanged", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "duo");
  await C.saveCustom(await (async () => { const d = await definitionOf("customizable"); return { id: d.id, version: d.version, customize: d.customize }; })(), { values: { banner: "crimson" } });
  const config = await getSiteConfig();
  const site = await resolveLook(config);
  const page = await resolveLook(config, { pageSkinId: "customizable" });
  assert.equal(site.composed.skinId, "duo");
  assert.equal(page.composed.skinId, "customizable");
  assert.match(page.sheet, /:root\[data-skin="customizable"\]/);
  assert.ok(!page.sheet.includes('data-skin="duo"'), "the site's skin is not loaded in addition to the page's");
  assert.ok(!site.sheet.includes('data-skin="customizable"'), "no leak to the other pages");
  assert.match(page.sheet, /--sk-cz-banner:#5e1414/i, "the owner's saved customization of that skin applies");
});

test("customization never crosses skins: a page wearing a skin gets ITS OWN customization, or none, never the site skin's values", async () => {
  await install("duo");
  await install("customizable");
  const d = await definitionOf("customizable");
  await C.saveCustom({ id: d.id, version: d.version, customize: d.customize }, { values: { banner: "crimson" } });
  // site skin is the customized one; the page wears "duo", which declares no customization: no --sk-cz-* variable at all, none of the site's values
  await setSetting("skin.active", "customizable");
  const config = await getSiteConfig();
  const site = await resolveLook(config);
  assert.match(site.sheet, /--sk-cz-banner:#5e1414/i, "the site skin keeps its customization");
  const page = await resolveLook(config, { pageSkinId: "duo" });
  assert.equal(page.composed.skinId, "duo");
  assert.ok(!/--sk-cz-/.test(page.sheet), "a skin without customization gets no customization variable");
  assert.ok(!/5e1414/i.test(page.sheet), "the site skin's chosen colour does not leak into the page");
  // reverse: site wears "duo"; the page wears the customized skin and gets its own saved values (covered above), and a different saved value changes only that page
  await setSetting("skin.active", "duo");
  const siteDuo = await resolveLook(config);
  assert.ok(!/--sk-cz-/.test(siteDuo.sheet), "the site skin has none either");
  const other = await resolveLook(config, { pageSkinId: "customizable" });
  assert.match(other.sheet, /--sk-cz-banner:#5e1414/i);
  assert.ok(!/--sk-cz-/.test((await resolveLook(config)).sheet), "and the site's pages stay free of it");
});

test("light and dark follow the visitor: a two-mode page skin keeps the switch and both modes in the sheet", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "customizable");
  const config = await getSiteConfig();
  const page = await resolveLook(config, { pageSkinId: "duo" });
  assert.equal(page.composed.switchAvailable, true);
  assert.match(page.sheet, /prefers-color-scheme:dark/);
  assert.match(page.sheet, /\[data-mode="dark"\]/);
  assert.ok(page.modeScriptUrl, "the visitor's switch script is loaded for that page");
});

test("a removed or damaged page skin falls back to the SITE skin (never basic); a preview link wins over the page's skin", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "duo");
  const config = await getSiteConfig();
  const fallback = await resolveLook(config, { pageSkinId: "not-installed" });
  assert.equal(fallback.composed.skinId, "duo");
  assert.equal(fallback.sheet, (await resolveLook(config)).sheet, "exactly the site's look, retouches included");
  const wins = await resolveLook(config, { previewSkinId: "customizable", pageSkinId: "duo" });
  assert.equal(wins.composed.skinId, "customizable");
});

test("cache key: the page's look and the site's look are separate cache entries, and a changed customization changes the page's sheet", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "duo");
  const config = await getSiteConfig();
  const a = await resolveLook(config, { pageSkinId: "customizable" });
  const again = await resolveLook(config, { pageSkinId: "customizable" });
  assert.equal(again.sheet, a.sheet);
  const d = await definitionOf("customizable");
  await C.saveCustom({ id: d.id, version: d.version, customize: d.customize }, { values: { banner: "forest" } });
  const b = await resolveLook(config, { pageSkinId: "customizable" });
  assert.notEqual(b.sheet, a.sheet, "the customization is part of the key: no stale sheet");
  assert.equal((await resolveLook(config)).composed.skinId, "duo", "the site's look is untouched");
  const layout = read("src/core/skins/render.ts");
  assert.match(layout, /JSON\.stringify\(\[skinCacheGeneration\(\), serial,/, "the key holds the skin and the fingerprint of its files");
});

// ── which page asks for which skin ──────────────────────────────────────────────────────────────────────────────────

test("requestedPageSkin: the address of a published page that asks for an installed skin; nothing else", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "duo");
  const { entry } = await pagesSite({ skin: "customizable" });
  assert.equal(await requestedPageSkin("/showcase", "en"), "customizable");
  assert.equal(await requestedPageSkin("/Showcase/", "en"), "customizable");
  assert.equal(await requestedPageSkin("/other", "en"), null, "another page");
  assert.equal(await requestedPageSkin("/", "en"), null);
  assert.equal(await requestedPageSkin("/a/b/c", "en"), null);
  assert.equal(await requestedPageSkin("/admin", "en"), null, "reserved paths");
  assert.equal(await requestedPageSkin("/%E0%A4%A", "en"), null, "an unreadable address is not a page");
  await db.prisma.entry.update({ where: { id: entry.id }, data: { skin: "duo" } });
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "the site's own skin: no second look");
  await db.prisma.entry.update({ where: { id: entry.id }, data: { skin: "removed-skin" } });
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "a skin that is gone: the site skin");
  await db.prisma.entry.update({ where: { id: entry.id }, data: { skin: "customizable", status: "draft" } });
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "a draft is not a public page");
});

test("requestedPageSkin: nothing when only one skin is installed, or the extension lacks the feature", async () => {
  await install("customizable");
  await pagesSite({ skin: "customizable" });
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "one site skin installed");
  await install("duo");
  assert.equal(await requestedPageSkin("/showcase", "en"), "customizable");
  await db.prisma.moduleInstance.updateMany({ data: { features: JSON.stringify(["body"]) } });
  const R = await import("@/core/modules/registry");
  R.resetModuleRegistry?.();
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "feature off: a stored value is ignored");
});

// ── assistant tools ─────────────────────────────────────────────────────────────────────────────────────────────────

test("assistant tools: `skin` exists only on instances with the feature; valid id, none, unknown id, overlay id", async () => {
  await install("duo");
  await install("customizable");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  const update = await tool(inst.key, "update_draft");
  const get = await tool(inst.key, "get_entry");
  assert.ok(create.input.properties.skin && update.input.properties.skin);
  const made = await create.call({ title: "Look", skin: "duo" }, ACTOR);
  assert.equal(made.status, "draft");
  assert.equal(made.skin, "duo");
  assert.equal((await get.call({ id: made.id }, ACTOR)).skin, "duo");
  assert.equal((await get.call({ id: made.id }, ACTOR)).skinInstalled, true);
  await update.call({ id: made.id, skin: "none" }, ACTOR);
  assert.equal((await get.call({ id: made.id }, ACTOR)).skin, null);
  await update.call({ id: made.id, skin: "customizable" }, ACTOR);
  await update.call({ id: made.id, title: "Renamed" }, ACTOR);
  assert.equal((await get.call({ id: made.id }, ACTOR)).skin, "customizable", "an update without skin keeps it");
  await assert.rejects(() => update.call({ id: made.id, skin: "nope" }, ACTOR), /Unknown site skin "nope"\. Installed site skins: .*duo/);
  await assert.rejects(() => create.call({ title: "x", skin: "glass-overlay" }, ACTOR), /Unknown site skin/);
  await assert.rejects(() => create.call({ title: "x", skin: "../x" }, ACTOR), /must be the id of an installed site skin/);
  assert.equal((await get.call({ id: made.id }, ACTOR)).skin, "customizable", "a refused call changes nothing");
  assert.ok(!(await tool((await pagesSite({ feature: false })).inst.key, "create_draft")).input.properties.skin, "no feature, no argument");
});

test("assistant tools: a single-skin site refuses a skin with a plain message, but 'none' is fine", async () => {
  await install("duo");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  await assert.rejects(() => create.call({ title: "x", skin: "duo" }, ACTOR), /more than one site skin installed/);
  assert.equal((await create.call({ title: "ok", skin: "none" }, ACTOR)).skin, undefined);
});

test("assistant tools: a draft is editable, a published page is not (so its skin is not either); a removed skin is reported, not fatal", async () => {
  await install("duo");
  await install("customizable");
  const { inst, entry } = await pagesSite({ status: "published", skin: "duo" });
  const update = await tool(inst.key, "update_draft");
  const get = await tool(inst.key, "get_entry");
  await assert.rejects(() => update.call({ id: entry.id, skin: "customizable" }, ACTOR), /only drafts can be edited/);
  assert.equal((await get.call({ id: entry.id }, ACTOR)).skin, "duo");
  await S.remove("duo");
  const after = await get.call({ id: entry.id }, ACTOR);
  assert.equal(after.skin, "duo", "the stored value is still readable");
  assert.equal(after.skinInstalled, false, "and the assistant is told it is not installed (the site skin is shown)");
});

test("publishing a draft: the owner's request names the skin and is bound to it", async () => {
  await install("duo");
  await install("customizable");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  const made = await create.call({ title: "Page with a look", skin: "customizable" }, ACTOR);
  const plan = await prepareEntryPublish("entry_publish", { instance: inst.key, id: made.id });
  assert.equal(plan.entry.items[0].skin, "customizable");
  const plain = await create.call({ title: "Plain page" }, ACTOR);
  const plan2 = await prepareEntryPublish("entry_publish", { instance: inst.key, id: plain.id });
  assert.equal(plan2.entry.items[0].skin, undefined);
  const before = plan.entry.items[0].fp;
  await db.prisma.entry.update({ where: { id: made.id }, data: { skin: "duo" } });
  assert.notEqual((await prepareEntryPublish("entry_publish", { instance: inst.key, id: made.id })).entry.items[0].fp, before, "a skin changed after the request is not what the owner approved");
  const summary = read("src/core/maintenance/publish.ts");
  assert.match(summary, /aim\.req\.entry_skin/);
});

// ── entry editor, locale parity, guarantees (source checks) ─────────────────────────────────────────────────────────

test("entry editor: the select sits in the folded Options, only with two skins and the feature, 'Same as the site' first, and is saved only when it was on screen", () => {
  const f = read("src/app/admin/(panel)/entries/EntryForm.tsx");
  assert.match(f, /const hasSkin = has\("skin"\) && pageSkins\.length >= 2/);
  assert.ok(f.indexOf("<details open") < f.indexOf('name="skin"'), "folded under Options (R4, R7)");
  assert.match(f, /entries\.pageSkinSame/);
  assert.ok(f.indexOf("entries.pageSkinSame") < f.indexOf("...pageSkins.map"), "'Same as the site' is the first option and is not a badge on a row");
  const a = read("src/app/admin/(panel)/entries/actions.ts");
  assert.match(a, /formData\.get\("__skin"\) === "1" && collection\.features\.includes\("skin"\)/);
  assert.match(a, /checkPageSkin\(/);
  assert.match(a, /errors: \{ skin: t\("error\.pageSkin"\) \}/);
});

test("FR and EN have the same new keys with the same variables; labels are short, with no colon; the help is one short line with an example", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  const keys = ["feature.skin", "field.pageSkin", "field.pageSkinHelp", "entries.pageSkinSame", "entries.pageSkinRemoved", "entries.pageSkinGone", "error.pageSkin", "aim.req.entry_skin"];
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) { assert.equal(typeof en[k], "string", `en ${k}`); assert.equal(typeof fr[k], "string", `fr ${k}`); assert.equal(vars(en[k]), vars(fr[k]), k); assert.ok(!/[!]|Veuillez|please/i.test(en[k] + fr[k]), k); }
  assert.equal(en["field.pageSkin"], "Skin for this page");
  assert.equal(fr["field.pageSkin"], "Skin de cette page");
  for (const l of [en, fr]) {
    for (const k of ["field.pageSkin", "entries.pageSkinSame"]) assert.ok(l[k].length <= 60 && !l[k].includes(":"), k);
    assert.ok(l["field.pageSkinHelp"].length <= 60 && /Feudal|Féodal/.test(l["field.pageSkinHelp"]), "short help with a concrete example");
  }
});

test("guarantees: public links are plain (full document loads), pages are dynamic, the layout asks for the page skin only without a preview link", () => {
  for (const dir of ["src/components/site", "src/app/(site)"]) {
    for (const f of fs.readdirSync(dir, { recursive: true }).map(String).filter((x) => /\.tsx?$/.test(x))) assert.ok(!/from "next\/link"|<Link[ >]/.test(read(path.join(dir, f))), `${dir}/${f} must not use client navigation: the layout runs for every address`);
  }
  assert.match(read("src/app/(site)/[...path]/page.tsx"), /export const dynamic = "force-dynamic"/);
  const layout = read("src/app/(site)/layout.tsx");
  assert.match(layout, /const pageSkin = preview === null \? await requestedPageSkin\(await currentPath\(\), locale\) : null/);
  assert.match(layout, /pageSkinId: pageSkin/);
  const render = read("src/core/skins/render.ts");
  assert.match(render, /forced\.skin === BASIC\) forced = null/, "an unusable page skin falls back to the site's, not to basic");
});

test("migration: Entry.skin is a nullable column without default; backups carry it and a restore reads it back", async () => {
  assert.match(read("prisma/migrations/20261120090000_entry_skin/migration.sql"), /ALTER TABLE "Entry" ADD COLUMN "skin" TEXT;/);
  await install("duo");
  await install("customizable");
  const { entry } = await pagesSite({ skin: "customizable" });
  const row = await db.prisma.entry.findUnique({ where: { id: entry.id } });
  assert.equal(row.skin, "customizable");
  const other = await createEntry(db.prisma, { instanceId: row.instanceId, locale: "en", title: "Plain", status: "published" });
  assert.equal((await db.prisma.entry.findUnique({ where: { id: other.id } })).skin, null, "default: the site skin");
  const { pickKnownColumns } = await import("@/core/backup/schema");
  assert.equal(pickKnownColumns("entries", { ...row, extra: 1 }).skin, "customizable", "the restore keeps the column");
  assert.equal(pickKnownColumns("entries", { id: "x" }).skin, undefined, "a backup made before 0.45.0 restores with the default");
});

// ── review fixes (F1-F4) ────────────────────────────────────────────────────────────────────────────────────────────

test("requestedPageSkin follows the resolver's order: an instance mounted on the address wins, even without the feature; a short link too", async () => {
  await install("duo");
  await install("customizable");
  await setSetting("skin.active", "duo");
  const { entry } = await pagesSite({ skin: "customizable" });
  // another extension (no skin feature) is mounted on the address of the skinned root page
  await db.fixture("blog");
  const bm = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
  const blog = await createInstance(db.prisma, { manifest: bm, names: { en: "Blog", fr: "Blog" }, nickname: "Blog", basePath: "showcase" });
  assert.equal(blog.basePath, "showcase");
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "the blog list is served there, not the skinned page");
  // a short link on a root page address is served before the root instance
  await db.prisma.moduleInstance.update({ where: { id: blog.id }, data: { basePath: "blog-x" } });
  const R = await import("@/core/modules/registry");
  R.resetModuleRegistry?.();
  assert.equal(await requestedPageSkin("/showcase", "en"), "customizable", "no longer shadowed");
  await db.prisma.redirect.create({ data: { path: "showcase", targetUrl: "https://example.org/", active: true } });
  assert.equal(await requestedPageSkin("/showcase", "en"), null, "an active short link answers first");
});

test("the publish request carries only a well-formed skin id", async () => {
  await install("duo");
  await install("customizable");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  const made = await create.call({ title: "Odd", skin: "customizable" }, ACTOR);
  await db.prisma.entry.update({ where: { id: made.id }, data: { skin: "<script>x" } });
  const plan = await prepareEntryPublish("entry_publish", { instance: inst.key, id: made.id });
  assert.equal(plan.entry.items[0].skin, undefined);
});

test("update_draft: a refused call (no title for a new language) leaves the skin untouched", async () => {
  await setSetting("i18n.enabled", ["en", "fr"]);
  await install("duo");
  await install("customizable");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  const update = await tool(inst.key, "update_draft");
  const get = await tool(inst.key, "get_entry");
  const made = await create.call({ title: "Keep", skin: "duo" }, ACTOR);
  await assert.rejects(() => update.call({ id: made.id, locale: "fr", skin: "customizable" }, ACTOR), /title is required/);
  assert.equal((await get.call({ id: made.id }, ACTOR)).skin, "duo");
});

test("the skin argument is as long as an id can be, and writes accept only what the form offers (a skin whose files changed is refused)", async () => {
  await install("duo");
  await install("customizable");
  const { inst } = await pagesSite();
  const create = await tool(inst.key, "create_draft");
  const { SKIN_ID_RE } = await import("@/core/skins/allowlist");
  assert.ok(SKIN_ID_RE.test("a" + "b".repeat(40)) && !SKIN_ID_RE.test("a" + "b".repeat(41)));
  assert.equal(create.input.properties.skin.maxLength, 41);
  assert.deepEqual((await P.offeredSiteSkinIds()).sort(), ["customizable", "duo"]);
  // damage one skin: it is no longer offered, so the same check refuses it
  const rows = (await S.installed()).filter((s) => s.id === "customizable");
  const dir = path.join(SKINS_DIR, "customizable", rows[0].version);
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".css")) ?? "skin.json";
  fs.appendFileSync(path.join(dir, file), "\n/* tampered */\n");
  S.clearSkinCaches();
  const status = (await S.installed()).find((s) => s.id === "customizable").status;
  if (status !== "ok") {
    assert.deepEqual(await P.offeredSiteSkinIds(), [], "below two offered skins: nothing is offered");
    await assert.rejects(() => create.call({ title: "x", skin: "customizable" }, ACTOR), /more than one site skin/);
  }
  assert.notEqual(status, "ok", "the fixture really became a damaged skin");
});

test("release gate: the public tree has no next/link (full document loads are what makes the page skin safe)", () => {
  assert.match(read("docs/PAGE-SKIN.md"), /release gate/i);
});
