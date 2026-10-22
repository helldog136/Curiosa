import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
await cat.fixtures(["blog", "pages", "links", "hero"]);
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting, getSetting } = await import("@/core/settings");
const S = await import("@/core/menuStore");
const C = await import("@/core/menuCatalog");
const RS = await import("@/core/menuResolve");
const M = await import("@/core/menu");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const F = await import("@/core/backup/format");
const { readTarGz } = await import("@/core/backup/tar");

beforeEach(() => db.reset());
after(() => { cat.close(); return db.close(); });

const manifest = (id) => FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? JSON.stringify(vars) : ""}`;
const ctx = { t, locale: "fr", defaultLocale: "fr" };
const raw = async () => JSON.parse((await db.prisma.setting.findUnique({ where: { key_locale: { key: "nav.menu", locale: "" } } }))?.value ?? "null");
const publish = (instanceId, title, extra = {}) => createEntry(db.prisma, { instanceId, locale: "fr", title, body: "x", status: "published", ...extra });
const names = { fr: "Blog", en: "Blog" };

/** Un site « d'avant » : l'ancien cœur affichait les instances showInNav au menu et lisait nav.custom ; ni l'un ni l'autre n'a de nav.menu. */
async function oldSite() {
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  for (const id of ["blog", "pages", "links"]) await db.fixture(id);
  const blog = await createInstance(db.prisma, { manifest: manifest("blog"), names });
  const pages = await createInstance(db.prisma, { manifest: manifest("pages"), names: { fr: "Pages", en: "Pages" } });
  const links = await createInstance(db.prisma, { manifest: manifest("links"), names: { fr: "Liens", en: "Links" } });
  await db.prisma.moduleInstance.update({ where: { id: blog.id }, data: { showInNav: true, navOrder: 1 } });
  await db.prisma.moduleInstance.update({ where: { id: links.id }, data: { showInNav: false, navOrder: 2 } });
  const about = await publish(pages.id, "À propos");
  const slug = (await db.prisma.entryTranslation.findFirst({ where: { entryId: about.id } })).slug;
  await setSetting("nav.custom", [
    { label: { fr: "Qui suis-je", en: "About me" }, href: `/${slug}` },
    { label: { fr: "Plus", en: "More" }, href: "", children: [{ label: { fr: "Contact", en: "Contact" }, href: "/contact" }, { label: { fr: "Site", en: "Site" }, href: "https://monsite.be" }] },
  ]);
  await db.prisma.setting.deleteMany({ where: { key: "nav.menu" } });
  return { blog, pages, links, about, slug };
}

test("migration : un site existant garde EXACTEMENT son menu (instances affichées puis ancien menu), l'ancien réglage reste intact", async () => {
  const { blog, about, slug } = await oldSite();
  const before = await RS.resolvePublicMenu("fr", "fr"); // pas encore migré : l'état d'avant, reconstruit sans rien écrire
  assert.equal(await raw(), null, "afficher le menu n'écrit rien");
  assert.deepEqual(before.map((i) => i.label), ["Blog", "Qui suis-je", "Plus"]);
  const oldCustom = await getSetting("nav.custom");

  assert.equal(await S.ensureMenuMigrated(), true);
  const stored = await raw();
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.items, [
    { kind: "instance", ref: blog.id },
    { kind: "entry", ref: about.id, label: { fr: "Qui suis-je", en: "About me" } },
    { kind: "group", label: { fr: "Plus", en: "More" }, children: [{ kind: "link", href: "/contact", label: { fr: "Contact", en: "Contact" } }, { kind: "link", href: "https://monsite.be", label: { fr: "Site", en: "Site" } }] },
  ]);
  assert.deepEqual(await getSetting("nav.custom"), oldCustom, "nav.custom jamais touché (retour en arrière possible)");
  const after = await RS.resolvePublicMenu("fr", "fr");
  assert.deepEqual(after, before.map((i) => ({ ...i })).map((i) => i), "mêmes libellés, mêmes adresses, même ordre qu'avant la migration");
  assert.equal(after[1].href, `/${slug}`);
  assert.deepEqual((await RS.resolvePublicMenu("en", "fr")).map((i) => i.label), ["Blog", "About me", "More"], "libellés par langue gardés");
});

test("migration : idempotente (la 2e fois n'écrit rien), et les changements d'après ne ramènent pas l'ancien comportement", async () => {
  const { blog, links } = await oldSite();
  assert.equal(await S.ensureMenuMigrated(), true);
  const first = JSON.stringify(await raw());
  assert.equal(await S.ensureMenuMigrated(), false);
  assert.equal(await S.ensureMenuMigrated(), false);
  assert.equal(JSON.stringify(await raw()), first);
  // L'ancienne colonne ne pilote plus rien : la modifier ne change pas le menu.
  await db.prisma.moduleInstance.update({ where: { id: links.id }, data: { showInNav: true } });
  await db.prisma.moduleInstance.update({ where: { id: blog.id }, data: { showInNav: false } });
  assert.equal(JSON.stringify(await raw()), first);
  assert.ok((await RS.resolvePublicMenu("fr", "fr")).some((i) => i.label === "Blog"));
  assert.ok(!(await RS.resolvePublicMenu("fr", "fr")).some((i) => i.label === "Liens"));
});

test("migration : un réglage nav.menu illisible est refait depuis l'ancien état, jamais une page blanche", async () => {
  await oldSite();
  await setSetting("nav.menu", { version: 99, items: "bizarre" });
  assert.equal((await S.loadMenu()).stored, false);
  assert.ok((await RS.resolvePublicMenu("fr", "fr")).length >= 1);
  assert.equal(await S.ensureMenuMigrated(), true);
  assert.equal((await raw()).version, 1);
});

test("migration : un site sans aucun menu reste sans menu (rien n'est inventé)", async () => {
  assert.equal(await S.ensureMenuMigrated(), true);
  assert.deepEqual((await raw()).items, []);
  assert.deepEqual(await RS.resolvePublicMenu("fr", "fr"), []);
});

test("règle par défaut : un module installé après la mise à jour N'ENTRE PAS au menu, même s'il suggère d'y être ; le menu de départ du site, lui, retient les suggestions", async () => {
  await oldSite();
  await S.ensureMenuMigrated();
  const before = JSON.stringify(await raw());
  await db.fixture("hero");
  const created = await createInstance(db.prisma, { manifest: manifest("blog"), nickname: "Actus", names: { fr: "Actus", en: "News" } });
  assert.equal(JSON.stringify(await raw()), before, "menu inchangé");
  assert.equal(created.showInNav, true, "la colonne garde l'ancienne valeur par défaut : c'est une suggestion");
  assert.ok(!M.menuRefKeys((await S.loadMenu()).items).has(`instance:${created.id}`));
  // Premier site : la création n'ajoute rien non plus... sauf pour l'assistant de départ (option explicite).
  await db.reset();
  await db.fixture("blog"); await db.fixture("pages");
  const b = await createInstance(db.prisma, { manifest: manifest("blog"), names, menu: "suggested" });
  const p = await createInstance(db.prisma, { manifest: manifest("pages"), names: { fr: "Pages", en: "Pages" }, menu: "suggested" });
  const start = M.menuRefKeys((await S.loadMenu()).items);
  assert.ok(start.has(`instance:${b.id}`), "le blog suggère d'être au menu");
  assert.ok(!start.has(`instance:${p.id}`), "les pages (racine, ne suggèrent rien) non");
});

test("création d'une instance DANS une transaction : le gel du menu passe par la même connexion (pas de blocage)", async () => {
  await oldSite();
  await db.fixture("hero");
  await db.prisma.$transaction(async (tx) => { await createInstance(tx, { manifest: manifest("hero"), names: { fr: "Hero", en: "Hero" } }); });
  assert.equal((await raw()).version, 1);
});

test("ajouter / retirer une instance du menu : idempotent, retire aussi des sous-menus, les sous-éléments d'un parent retiré remontent, plafond respecté", async () => {
  const { blog } = await oldSite();
  await S.ensureMenuMigrated();
  assert.equal(await S.isInstanceInMenu(blog.id), true);
  assert.equal(await S.setInstanceInMenu(blog.id, true), true);
  assert.equal((await raw()).items.filter((n) => n.ref === blog.id).length, 1, "pas de doublon");
  await S.saveMenu([{ kind: "instance", ref: blog.id, children: [{ kind: "link", href: "/a", label: { fr: "A" } }] }, { kind: "link", href: "/b", label: { fr: "B" } }]);
  assert.equal(await S.setInstanceInMenu(blog.id, false), true);
  assert.deepEqual((await raw()).items.map((n) => n.href), ["/a", "/b"], "l'enfant remonte à la place du parent");
  assert.equal(await S.setInstanceInMenu(blog.id, false), true, "retirer une absente : sans effet");
  assert.equal(await S.isInstanceInMenu(blog.id), false);
  await S.saveMenu([{ kind: "group", label: { fr: "G" }, children: [{ kind: "instance", ref: blog.id }, { kind: "link", href: "/z", label: { fr: "Z" } }] }]);
  await S.setInstanceInMenu(blog.id, false);
  assert.deepEqual((await raw()).items, [{ kind: "group", label: { fr: "G" }, children: [{ kind: "link", href: "/z", label: { fr: "Z" } }] }]);
  await S.saveMenu(Array.from({ length: 40 }, (_, i) => ({ kind: "link", href: `/p${i}`, label: { fr: `P${i}` } })));
  assert.equal(await S.setInstanceInMenu(blog.id, true), false, "menu plein : refus");
  assert.equal((await raw()).items.length, 40);
});

test("références : seules celles qui existent encore sont reconnues (instance avec page, entrée, raccourci, page du cœur)", async () => {
  const { blog, about } = await oldSite();
  const r = await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/x" } });
  const known = await S.existingRefs([
    { kind: "instance", ref: blog.id }, { kind: "instance", ref: "nope" }, { kind: "entry", ref: about.id }, { kind: "entry", ref: "nope" },
    { kind: "redirect", ref: r.id }, { kind: "system", ref: "home" }, { kind: "system", ref: "nope" },
  ]);
  assert.deepEqual([...known].sort(), [`entry:${about.id}`, `instance:${blog.id}`, `redirect:${r.id}`, "system:home"].sort());
});

// ─── Catalogue ────────────────────────────────────────────────────────────────

test("catalogue : pages du site, une page par instance qui a une page propre, rien pour une instance à la racine ni sans page", async () => {
  const { blog, links, pages } = await oldSite();
  await db.fixture("hero");
  const hero = await createInstance(db.prisma, { manifest: manifest("hero"), names: { fr: "Hero", en: "Hero" } });
  const system = await C.searchCatalog("system", "", null, ctx);
  assert.deepEqual(system.items.map((i) => i.ref), ["home", "privacy"]);
  assert.deepEqual(system.items.map((i) => i.title), ["menu.system.home", "menu.system.privacy"]);
  const inst = await C.searchCatalog("instance", "", null, ctx);
  assert.deepEqual(inst.items.map((i) => i.ref), [blog.id, links.id], "ordre du site ; les pages (racine) et l'instance sans page n'y sont pas");
  assert.equal(pages.basePath, "");
  assert.equal(hero.basePath, null);
  assert.ok(inst.items[0].suggested, "le blog suggère d'être au menu");
  assert.ok(!inst.items[1].suggested, "les liens ne suggèrent rien");
  assert.deepEqual((await C.searchCatalog("instance", "ZZZ", null, ctx)).items, []);
  assert.equal((await C.searchCatalog("instance", "BLOG", null, ctx)).items.length, 1, "majuscules ignorées");
});

test("catalogue : les contenus publiés se cherchent sans tenir compte des accents ni des majuscules ; brouillons exclus", async () => {
  const { blog } = await oldSite();
  await publish(blog.id, "Les recettes de l'Été");
  await publish(blog.id, "Hiver");
  await createEntry(db.prisma, { instanceId: blog.id, locale: "fr", title: "Été brouillon" });
  const r = await C.searchCatalog("entry", "ETE recettes", null, ctx);
  assert.deepEqual(r.items.map((i) => i.title), ["Les recettes de l'Été"]);
  assert.match(r.items[0].path, /^\/blog\/.+/);
  assert.match(r.items[0].sub, /Blog/);
  assert.deepEqual((await C.searchCatalog("entry", "brouillon", null, ctx)).items, [], "un brouillon n'est pas proposé");
  assert.equal((await C.searchCatalog("entry", "", null, ctx)).items.length, 2);
});

test("catalogue : pagination bornée — 12 par page, la suite se demande avec le repère, aucune entrée vue deux fois", async () => {
  const { blog } = await oldSite();
  for (let i = 0; i < 30; i++) await publish(blog.id, `Article numéro ${String(i).padStart(2, "0")}`);
  await publish(blog.id, "Autre sujet");
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await C.searchCatalog("entry", "article", cursor, ctx);
    assert.ok(page.items.length <= C.CATALOG_PAGE);
    seen.push(...page.items.map((i) => i.ref));
    cursor = page.next;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(new Set(seen).size, 30);
  assert.ok(pages >= 3 && pages <= 4, `pages : ${pages}`);
  assert.equal((await C.searchCatalog("entry", "", "mauvais repère !", ctx)).items.length >= 0, true, "un repère invalide est ignoré, jamais une erreur");
});

test("catalogue : raccourcis de liens (actifs) cherchables par adresse ou cible ; les inactifs et les pages sans chemin n'y sont pas", async () => {
  await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/maChaine" } });
  await db.prisma.redirect.create({ data: { path: "ancien", targetUrl: "https://exemple.org", active: false } });
  assert.deepEqual((await C.searchCatalog("redirect", "", null, ctx)).items.map((i) => i.title), ["/twitch"]);
  assert.equal((await C.searchCatalog("redirect", "MACHAINE", null, ctx)).items.length, 1);
  assert.equal((await C.searchCatalog("redirect", "ancien", null, ctx)).items.length, 0);
});

test("« Pages qui ne sont pas dans le menu » : celles que le module suggère d'abord, ce qui est déjà au menu (ou en lien libre) en est exclu", async () => {
  const { blog } = await oldSite();
  await db.fixture("codes");
  const codes = await createInstance(db.prisma, { manifest: manifest("codes"), nickname: "Promos", names: { fr: "Promos", en: "Promos" } });
  const menu = [{ kind: "instance", ref: blog.id }];
  const list = await C.pagesNotInMenu(menu, ctx);
  assert.ok(!list.some((i) => i.ref === blog.id), "le blog est déjà au menu");
  assert.ok(list.some((i) => i.ref === codes.id && i.suggested), "les codes suggèrent d'être au menu");
  assert.equal(list[0].ref, codes.id, "suggérées d'abord");
  assert.ok(list.some((i) => i.ref === "home") && list.some((i) => i.ref === "privacy"));
  const withLink = await C.pagesNotInMenu([{ kind: "link", href: "/privacy/", label: { fr: "Vie privée" } }, ...menu], ctx);
  assert.ok(!withLink.some((i) => i.ref === "privacy"), "un lien libre vers /privacy compte comme présent");
  assert.ok(list.length <= C.MAX_NOT_IN_MENU);
});

test("éditeur : ce que désignent les éléments du menu — titre, adresse, ou « n'existe plus » (jamais d'erreur)", async () => {
  const { blog, about } = await oldSite();
  const info = await C.describeMenuRefs([
    { kind: "instance", ref: blog.id }, { kind: "entry", ref: about.id }, { kind: "entry", ref: "nope" },
    { kind: "group", label: { fr: "G" }, children: [{ kind: "system", ref: "home" }, { kind: "redirect", ref: "nope" }] },
  ], ctx);
  assert.deepEqual(info[`instance:${blog.id}`], { title: "Blog", sub: "/blog", missing: false });
  assert.equal(info[`entry:${about.id}`].title, "À propos");
  assert.equal(info["entry:nope"].missing, true);
  assert.equal(info["system:home"].title, "menu.system.home");
  assert.equal(info["redirect:nope"].missing, true);
});

// ─── Rendu public de bout en bout ─────────────────────────────────────────────

test("rendu public : références suivies en direct (renommage, dépublication), langue du visiteur, élément disparu ignoré, sous-menus", async () => {
  const { blog } = await oldSite();
  const e = await publish(blog.id, "Recette du jour");
  const slug = (await db.prisma.entryTranslation.findFirst({ where: { entryId: e.id } })).slug;
  const redirect = await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/x" } });
  await S.saveMenu([
    { kind: "system", ref: "home" },
    { kind: "instance", ref: blog.id, children: [{ kind: "entry", ref: e.id }, { kind: "redirect", ref: redirect.id, label: { fr: "En direct", en: "Live" } }] },
    { kind: "link", href: "javascript:alert(1)", label: { fr: "Piégé" } },
    { kind: "link", href: "/contact", label: { fr: "Contact", en: "Contact" } },
  ]);
  const fr = await RS.resolvePublicMenu("fr", "fr");
  assert.deepEqual(fr.map((i) => i.label).slice(1), ["Blog", "Contact"]);
  assert.ok(fr[0].label, "la page d'accueil a un nom dans la langue du visiteur");
  assert.equal(fr[0].href, "/");
  assert.deepEqual(fr[1].children.map((c) => [c.label, c.href]), [["Recette du jour", `/blog/${slug}`], ["En direct", "/twitch"]]);
  assert.ok(!fr.some((i) => i.label === "Piégé"), "une adresse dangereuse n'atteint jamais le site");
  const en = await RS.resolvePublicMenu("en", "fr");
  assert.equal(en[1].href, "/en/blog");
  assert.equal(en[1].children[1].label, "Live");
  assert.equal(en[2].href, "/en/contact");
  // Renommer l'instance : le menu suit.
  await db.prisma.instanceTranslation.update({ where: { instanceId_locale: { instanceId: blog.id, locale: "fr" } }, data: { name: "Journal" } });
  assert.equal((await RS.resolvePublicMenu("fr", "fr"))[1].label, "Journal");
  // Dépublier l'entrée, désactiver le raccourci : ils disparaissent sans erreur ; le parent n'a plus de sous-menu.
  await db.prisma.entry.update({ where: { id: e.id }, data: { status: "draft" } });
  await db.prisma.redirect.update({ where: { id: redirect.id }, data: { active: false } });
  const gone = await RS.resolvePublicMenu("fr", "fr");
  assert.equal(gone[1].children, undefined);
  assert.equal(gone[1].label, "Journal");
  // Supprimer l'instance : elle quitte le menu, ses éléments de sous-menu (déjà disparus ici) aussi.
  await db.prisma.moduleInstance.delete({ where: { id: blog.id } });
  assert.ok(!(await RS.resolvePublicMenu("fr", "fr")).some((i) => i.label === "Journal"));
});

// ─── Sauvegarde / restauration ────────────────────────────────────────────────

test("sauvegarde et restauration : le menu (nav.menu) est dans la sauvegarde et revient identique, références comprises", async () => {
  const { blog, about } = await oldSite();
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "fr" } });
  await setSetting("setup.completed", true);
  await S.saveMenu([{ kind: "instance", ref: blog.id, children: [{ kind: "entry", ref: about.id, label: { fr: "Moi" } }] }, { kind: "link", href: "/c", label: { fr: "C" } }]);
  const menu = await raw();
  const resolved = await RS.resolvePublicMenu("fr", "fr");
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
  assert.match(files[F.DATA_FILES.settings].toString("utf8"), /"nav\.menu"/, "le menu est dans data/settings.json");
  await db.reset();
  await setSetting("site.name", "Autre");
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok);
  assert.equal((await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" })).ok, true);
  assert.deepEqual(await raw(), menu);
  assert.deepEqual(await RS.resolvePublicMenu("fr", "fr"), resolved, "le visiteur voit le même menu");
});

test("restauration d'une sauvegarde d'AVANT ce lot (pas de nav.menu) : le visiteur voit le même menu qu'avant, l'état est figé au démarrage suivant", async () => {
  await oldSite();
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "fr" } });
  await setSetting("setup.completed", true);
  const resolved = await RS.resolvePublicMenu("fr", "fr");
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  assert.equal(await raw(), null);
  await db.reset();
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.equal((await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" })).ok, true);
  assert.deepEqual(await RS.resolvePublicMenu("fr", "fr"), resolved);
  assert.equal(await S.ensureMenuMigrated(), true);
  assert.deepEqual(await RS.resolvePublicMenu("fr", "fr"), resolved);
});

test("MCP : le menu n'est exposé à aucun assistant dans ce lot (aucun outil ne lit ni n'écrit nav.menu)", () => {
  for (const dir of ["src/core/services/mcp", "src/core/content"]) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      assert.ok(!/nav\.menu|menuStore|MENU_SETTING/.test(fs.readFileSync(`${dir}/${f}`, "utf8")), `${dir}/${f}`);
    }
  }
});
