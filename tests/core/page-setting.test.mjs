// Page facultative d'un module (cœur 0.2.12, `pageSetting`) : tant que le réglage booléen est faux, la page n'existe nulle part (plan du site, llms.txt, menu,
// éditeur de menu, script de page, résolution du chemin) ; allumée, elle est partout ; un module sans le champ ne change pas ; un manifeste incohérent est refusé.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const { parseManifest } = await import("@/core/modules/manifest");
const { hasPublicPage, pageIsOn } = await import("@/core/modules/publicPage");
const { buildSitemap } = await import("@/core/sitemap");
const { buildLlmsTxt } = await import("@/core/llms");
const { resolvePublicMenu } = await import("@/core/menuResolve");
const { searchCatalog } = await import("@/core/menuCatalog");
const { MENU_SETTING } = await import("@/core/menu");
const { setSetting } = await import("@/core/settings");
const { MODULES_DIR } = await import("@/core/config");
const { resetModuleRegistry } = await import("@/core/modules/registry");
const { GET: pageScript } = await import("@/app/m/[instance]/page-script/[name]/route");
const { makeTranslator } = await import("@/core/i18n/dictionary");

after(() => db.close());
beforeEach(async () => { await db.reset(); fs.rmSync(MODULES_DIR, { recursive: true, force: true }); resetModuleRegistry(); });

const base = (over = {}) => ({
  apiVersion: 2, id: "raid", name: "Raid", version: "2.2.0", type: "widget", page: true, permissions: ["pages"], main: "index.mjs", suggestInMenu: true,
  settings: [{ key: "publicPage", type: "boolean", label: "Page publique", default: false }], pageSetting: "publicPage", ...over,
});

async function setup(manifest, { stored } = {}) {
  const dir = path.join(MODULES_DIR, manifest.id);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "index.mjs"), "export default { page: async () => ({ title: 'Raid', blocks: [], scripts: ['ui.js'] }) };");
  fs.writeFileSync(path.join(dir, "scripts", "ui.js"), "console.log('ui');");
  await prisma.module.create({ data: { id: manifest.id, source: "git", version: manifest.version } });
  const inst = await prisma.moduleInstance.create({ data: { moduleId: manifest.id, key: "raid", basePath: "raid", translations: { create: [{ locale: "fr", name: "Raids", description: "Les raids" }] } } });
  if (stored !== undefined) await setSetting(`instance.${inst.id}.publicPage`, stored);
  await setSetting(MENU_SETTING, { version: 1, items: [{ kind: "instance", ref: inst.id }] });
  resetModuleRegistry();
  return inst;
}
const t = makeTranslator("fr");
const ctx = { t, locale: "fr", defaultLocale: "fr" };
async function observe() {
  const sitemap = (await buildSitemap()).urls.map((u) => u.url);
  const llms = await buildLlmsTxt("fr");
  const menu = JSON.stringify(await resolvePublicMenu("fr", "fr"));
  const catalog = JSON.stringify((await searchCatalog("instance", "", null, ctx)).items);
  const script = (await pageScript(new Request("http://x/m/raid/page-script/ui.js"), { params: Promise.resolve({ instance: "raid", name: "ui.js" }) })).status;
  return { inSitemap: sitemap.some((u) => u.endsWith("/raid")), inLlms: llms.includes("/raid"), inMenu: menu.includes("/raid"), inCatalog: catalog.includes("/raid"), script };
}

test("page éteinte (réglage jamais enregistré, défaut faux) : absente du plan du site, de llms.txt, du menu, du catalogue du menu ; script de page en 404", async () => {
  await setup(base());
  assert.deepEqual(await observe(), { inSitemap: false, inLlms: false, inMenu: false, inCatalog: false, script: 404 });
});

test("page éteinte explicitement (réglage faux) : même résultat", async () => {
  await setup(base(), { stored: false });
  assert.deepEqual(await observe(), { inSitemap: false, inLlms: false, inMenu: false, inCatalog: false, script: 404 });
});

test("page allumée : présente partout, script servi ; éteinte de nouveau : elle disparaît", async () => {
  const inst = await setup(base(), { stored: true });
  assert.deepEqual(await observe(), { inSitemap: true, inLlms: true, inMenu: true, inCatalog: true, script: 200 });
  await setSetting(`instance.${inst.id}.publicPage`, false);
  assert.deepEqual(await observe(), { inSitemap: false, inLlms: false, inMenu: false, inCatalog: false, script: 404 });
});

test("défaut vrai : allumée tant que personne ne l'éteint ; sans le champ pageSetting : comportement inchangé", async () => {
  await setup(base({ settings: [{ key: "publicPage", type: "boolean", label: "Page", default: true }] }));
  assert.equal((await observe()).inSitemap, true);
  await db.reset(); fs.rmSync(MODULES_DIR, { recursive: true, force: true }); resetModuleRegistry();
  const plain = base(); delete plain.pageSetting;
  await setup(plain);
  assert.deepEqual(await observe(), { inSitemap: true, inLlms: true, inMenu: true, inCatalog: true, script: 200 });
});

test("règle commune : seule `hasPublicPage` décide ; fermé si le réglage est absent ou n'est pas exactement vrai", () => {
  const m = base();
  assert.equal(pageIsOn({ settings: [] }, undefined), true, "pas de champ : allumée");
  assert.equal(pageIsOn(m, undefined), false);
  assert.equal(pageIsOn(m, true), true);
  for (const odd of [false, "true", 1, null, {}]) assert.equal(pageIsOn(m, odd), false, String(odd));
  assert.equal(pageIsOn({ pageSetting: "ghost", settings: [] }, true), false);
  assert.equal(hasPublicPage({ instance: { basePath: null } }), false);
  assert.equal(hasPublicPage({ instance: { basePath: "" } }), true);
  assert.equal(hasPublicPage({ instance: { basePath: "x" }, pageOn: false }), false);
});

test("manifeste : pageSetting doit nommer un réglage booléen de ce module, d'un module à page ; sinon refusé", () => {
  assert.equal(parseManifest(base()).ok, true);
  const bad = (o) => parseManifest(base(o));
  assert.equal(bad({ pageSetting: "absent" }).ok, false, "réglage inconnu");
  assert.equal(bad({ settings: [{ key: "publicPage", type: "text", label: "x" }] }).ok, false, "pas un booléen");
  assert.equal(bad({ page: false }).ok, false, "module sans page");
  assert.equal(bad({ pageSetting: "bad key!" }).ok, false, "clé invalide");
  assert.equal(bad({ pageSetting: 7 }).ok, false);
  assert.match(bad({ pageSetting: "absent" }).error, /pageSetting/);
});

test("branchements : tous les endroits publics passent par hasPublicPage (plus aucun filtre sur basePath seul)", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  for (const f of ["src/core/sitemap.ts", "src/core/llms.ts", "src/core/menuCatalog.ts", "src/core/menuResolve.ts", "src/app/(site)/[...path]/page.tsx", "src/app/m/[instance]/page-script/[name]/route.ts"]) {
    assert.match(read(f), /hasPublicPage/, f);
  }
  assert.ok(!/a\.instance\.basePath !== null\)/.test(read("src/core/sitemap.ts")));
  assert.ok(!/filter\(\(a\) => a\.instance\.basePath !== null\)/.test(read("src/app/(site)/[...path]/page.tsx")));
});
