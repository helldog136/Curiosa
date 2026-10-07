import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { getSetting, setSetting, deleteSetting, getSettingByLocale, getSiteConfig } = await import("@/core/settings");
const { getBrand } = await import("@/core/brand");
const { createInstance, deleteInstance, validateBasePath, freeKey, defaultNames, KEY_RE, instanceCount } = await import("@/core/instanceService");
const { listInstances, getInstanceByKey, toInstanceView, pickName, pickDescription } = await import("@/core/instances");
const { normalizeRedirectPath, validateRedirectPath, resolveRedirect } = await import("@/core/redirects");
const { createEntry } = await import("@/core/content/service");
const E = await import("@/core/content/entries");
const { BUILTIN_MODULES } = await import("@/modules-builtin");
const { audit } = await import("@/core/permissions");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
const blog = () => manifest("blog");

async function newInstance(over = {}) {
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  return createInstance(db.prisma, { manifest: blog(), names: { fr: "Blog", en: "Blog" }, ...over });
}

/* ───────────── Réglages ───────────── */

test("réglages : valeurs JSON de tout type, absence → undefined, suppression", async () => {
  await setSetting("a", { x: [1, 2] });
  await setSetting("b", false);
  assert.deepEqual(await getSetting("a"), { x: [1, 2] });
  assert.equal(await getSetting("b"), false);
  assert.equal(await getSetting("absent"), undefined);
  await setSetting("a", "remplacé");
  assert.equal(await getSetting("a"), "remplacé", "mise à jour, pas de doublon");
  await deleteSetting("a");
  assert.equal(await getSetting("a"), undefined);
});

test("réglages : chaîne de repli langue demandée → non traduit → langue par défaut du site", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("t", "Bonjour", "fr");
  await setSetting("t", "Hello", "en");
  assert.equal(await getSetting("t", "en"), "Hello");
  assert.equal(await getSetting("t", "nl"), "Bonjour", "langue sans valeur → langue par défaut du site");
  await setSetting("u", "neutre");
  await setSetting("u", "fr!", "fr");
  assert.equal(await getSetting("u", "en"), "neutre", "valeur non traduite avant la langue par défaut");
  assert.deepEqual(await getSettingByLocale("t"), { fr: "Bonjour", en: "Hello" });
});

test("réglages : une valeur corrompue en base est ignorée sans casser la lecture des autres", async () => {
  await db.prisma.setting.create({ data: { key: "casse", locale: "", value: "{pas du json" } });
  await setSetting("ok", 1);
  assert.equal(await getSetting("casse"), undefined);
  assert.equal(await getSetting("ok"), 1);
});

test("configuration du site : valeurs par défaut d'un site vierge", async () => {
  const c = await getSiteConfig();
  assert.equal(c.defaultLocale, "en");
  assert.deepEqual(c.locales, ["en"]);
  assert.equal(c.setupCompleted, false);
  assert.equal(c.accent, "#e8a23b");
  assert.deepEqual(c.homeSections, []);
  assert.equal(c.autoDetect, false);
});

test("configuration du site : la langue par défaut figure toujours parmi les langues actives", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["en", "nl"]);
  assert.deepEqual((await getSiteConfig()).locales, ["fr", "en", "nl"]);
});

test("configuration du site : textes traduits selon la langue demandée", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("site.name", "Ma vitrine", "fr");
  await setSetting("site.name", "My showcase", "en");
  assert.equal((await getSiteConfig("en")).name, "My showcase");
  assert.equal((await getSiteConfig()).name, "Ma vitrine");
  assert.equal((await getSiteConfig("de")).name, "Ma vitrine");
});

test("identité visuelle : source unique, couleurs dérivées, noms traduits", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("site.name", "Rosa", "fr");
  await setSetting("theme.accent", "#ff0066");
  await setSetting("theme.background", "#101010");
  await setSetting("theme.font", "serif");
  const b = await getBrand();
  assert.equal(b.name, "Rosa");
  assert.equal(b.font.key, "serif");
  assert.equal(b.colors.find((c) => c.key === "accent").hex, "#FF0066");
  assert.equal(b.colors.find((c) => c.key === "bg").hex, "#101010");
  assert.ok(b.colors.every((c) => /^#[0-9A-F]{6}$/.test(c.hex) && c.name && c.role));
  const en = await getBrand("en");
  assert.notEqual(en.colors[0].name, b.colors[0].name, "noms de couleurs traduits");
});

/* ───────────── Instances ───────────── */

test("instances : création avec réglages du module, noms traduits, première instance → /blog", async () => {
  const i = await newInstance();
  assert.equal(i.key, "blog");
  assert.equal(i.basePath, "blog");
  assert.equal(i.moduleId, "blog");
  const v = await getInstanceByKey("blog");
  assert.deepEqual(v.names, { fr: "Blog", en: "Blog" });
  assert.ok(KEY_RE.test(v.key));
  assert.equal(await instanceCount("blog"), 1);
});

test("instances : le surnom devient la clé technique, collisions numérotées", async () => {
  const a = await newInstance({ nickname: "Actus" });
  const b = await newInstance({ nickname: "Actus" });
  const c = await newInstance({ nickname: "Actus" });
  assert.deepEqual([a.key, b.key, c.key], ["actus", "actus-2", "actus-3"]);
  assert.equal(a.nickname, "Actus");
  assert.equal(await freeKey(db.prisma, "actus"), "actus-4");
  assert.equal(new Set([a.basePath, b.basePath, c.basePath]).size, 3, "chemins publics tous distincts");
});

test("instances : un surnom qui ressemble à un chemin réservé ou à une langue ne vole jamais /admin ni /en", async () => {
  for (const nick of ["Admin", "EN", "Api", "fr"]) {
    const i = await newInstance({ nickname: nick });
    assert.ok(i.basePath && !["admin", "en", "api", "fr"].includes(i.basePath), `${nick} → ${i.basePath}`);
  }
});

test("instances : chemin public validé (format, réservé, déjà pris, redirection existante)", async () => {
  const a = await newInstance();
  assert.equal(await validateBasePath("Pas Valide"), "instances.error.path");
  assert.equal(await validateBasePath("admin"), "instances.error.reserved");
  assert.equal(await validateBasePath("fr"), "instances.error.reserved");
  assert.equal(await validateBasePath("blog"), "instances.error.pathUsed");
  assert.equal(await validateBasePath("blog", a.id), null, "son propre chemin reste valable");
  await db.prisma.redirect.create({ data: { path: "promo", targetUrl: "https://x.y" } });
  assert.equal(await validateBasePath("promo"), "instances.error.redirectClash");
  assert.equal(await validateBasePath("libre"), null);
  assert.equal(await validateBasePath(""), null, "accueil autorisé");
});

test("instances : un module sans page n'a pas de chemin public", async () => {
  await db.prisma.module.create({ data: { id: "hero", source: "builtin", version: "1", enabled: true } });
  const i = await createInstance(db.prisma, { manifest: manifest("hero"), names: { en: "Hero" } });
  assert.equal(i.basePath, null);
});

test("instances : noms par défaut dans chaque langue, nom public avec repli", async () => {
  assert.deepEqual(defaultNames(blog(), ["fr", "en"]), { fr: "Blog", en: "Blog" });
  assert.deepEqual(defaultNames(blog(), ["fr"], "Actus"), { fr: "Actus" });
  const v = { key: "k", names: { fr: "Français", en: "English" }, descriptions: { fr: "d" } };
  assert.equal(pickName(v, "en", "fr"), "English");
  assert.equal(pickName(v, "de", "fr"), "Français");
  assert.equal(pickName({ key: "k", names: {} }, "de", "fr"), "k", "dernier recours : la clé");
  assert.equal(pickDescription(v, "en", "fr"), "d");
});

test("instances : vue sûre même avec des champs JSON corrompus en base", async () => {
  const i = await newInstance();
  await db.prisma.moduleInstance.update({ where: { id: i.id }, data: { features: "{cassé", fieldSchema: "nope", display: "inconnu", clickAction: "zz" } });
  const v = (await listInstances())[0];
  assert.deepEqual(v.features, []);
  assert.deepEqual(v.fieldSchema, []);
  assert.equal(v.display, "cards");
  assert.equal(v.clickAction, "detail");
  const row = await db.prisma.moduleInstance.findFirst({ include: { translations: true } });
  assert.equal(toInstanceView(row).id, i.id);
});

test("instances : suppression nettoie réglages, données privées, entrées — et rien d'autre", async () => {
  const a = await newInstance({ nickname: "A" });
  const b = await newInstance({ nickname: "B" });
  await setSetting(`instance.${a.id}.x`, 1);
  await setSetting(`instance.${b.id}.x`, 2);
  await db.prisma.moduleRecord.create({ data: { instanceId: a.id, collection: "c", data: "{}" } });
  await createEntry(db.prisma, { instanceId: a.id, locale: "fr", title: "T" });
  await deleteInstance(a.id);
  assert.equal(await getSetting(`instance.${a.id}.x`), undefined);
  assert.equal(await getSetting(`instance.${b.id}.x`), 2);
  assert.equal(await db.prisma.moduleRecord.count(), 0);
  assert.equal(await db.prisma.entry.count(), 0);
  assert.equal(await db.prisma.entryTranslation.count(), 0);
  assert.deepEqual((await listInstances()).map((x) => x.id), [b.id]);
  await deleteInstance("n-existe-pas");
});

/* ───────────── Redirections ───────────── */

test("redirections : normalisation et validation du chemin", async () => {
  assert.equal(normalizeRedirectPath("  /Twitch/ "), "twitch");
  assert.equal(await validateRedirectPath("Mauvais Chemin"), "redirects.error.path");
  assert.equal(await validateRedirectPath("admin"), "redirects.error.reserved");
  assert.equal(await validateRedirectPath("fr"), "redirects.error.reserved");
  assert.equal(await validateRedirectPath("promo/ete"), null);
  const i = await newInstance();
  assert.equal(await validateRedirectPath(i.basePath), "redirects.error.reserved", "pas de raccourci qui masque un module");
  const r = await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/x" } });
  assert.equal(await validateRedirectPath("twitch"), "redirects.error.exists");
  assert.equal(await validateRedirectPath("twitch", r.id), null);
});

test("redirections : cible, compteur de clics, inactive, lien d'entrée prioritaire", async () => {
  await db.prisma.redirect.create({ data: { path: "yt", targetUrl: "https://youtube.com/x", permanent: true } });
  await db.prisma.redirect.create({ data: { path: "off", targetUrl: "https://a.b", active: false } });
  assert.deepEqual(await resolveRedirect("yt"), { url: "https://youtube.com/x", permanent: true });
  assert.equal(await resolveRedirect("off"), null);
  assert.equal(await resolveRedirect("inconnu"), null);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await db.prisma.redirect.findUnique({ where: { path: "yt" } })).hits, 1);
  const i = await newInstance();
  const e = await createEntry(db.prisma, { instanceId: i.id, locale: "fr", title: "Lien", url: "https://nouveau.example/x" });
  await db.prisma.redirect.create({ data: { path: "lien", targetUrl: "https://ancien.example", entryId: e.id } });
  assert.equal((await resolveRedirect("lien")).url, "https://nouveau.example/x");
});

test("redirections : jamais de redirection ouverte — une cible dangereuse n'est pas suivie", async () => {
  for (const [path, url] of [["js", "javascript:alert(1)"], ["data", "data:text/html,x"], ["rel", "//evil.example"], ["local", "/admin"]]) {
    await db.prisma.redirect.create({ data: { path, targetUrl: url } });
    assert.equal(await resolveRedirect(path), null, url);
  }
});

/* ───────────── Contenu ───────────── */

test("entrées : slug dérivé du titre, unique par langue et par instance", async () => {
  const i = await newInstance({ nickname: "Un" });
  const j = await newInstance({ nickname: "Deux" });
  const a = await createEntry(db.prisma, { instanceId: i.id, locale: "fr", title: "Mon Article !", status: "published" });
  const b = await createEntry(db.prisma, { instanceId: i.id, locale: "fr", title: "Mon Article !", status: "published" });
  const c = await createEntry(db.prisma, { instanceId: j.id, locale: "fr", title: "Mon Article !", status: "published" });
  const d = await createEntry(db.prisma, { instanceId: i.id, locale: "en", title: "Mon Article !", status: "published" });
  const slugs = async (id) => (await db.prisma.entryTranslation.findFirst({ where: { entryId: id } })).slug;
  assert.deepEqual([await slugs(a.id), await slugs(b.id), await slugs(c.id), await slugs(d.id)], ["mon-article", "mon-article-2", "mon-article", "mon-article"]);
  assert.equal(await E.uniqueSlug(db.prisma, i.id, "fr", ""), "entry");
  assert.equal(await E.uniqueSlug(db.prisma, i.id, "fr", "mon-article", a.id), "mon-article", "ignorer l'entrée en cours d'édition");
});

test("entrées : brouillons invisibles, publiées visibles, expirées après les autres, mises en avant d'abord", async () => {
  const i = await newInstance();
  const mk = (title, extra = {}) => createEntry(db.prisma, { instanceId: i.id, locale: "fr", title, status: "published", ...extra });
  await createEntry(db.prisma, { instanceId: i.id, locale: "fr", title: "Brouillon" });
  await mk("Normale");
  await mk("Expirée", { expiresAt: new Date(Date.now() - 86400000) });
  await mk("Vedette", { featured: true });
  const futur = await mk("Programmée");
  await db.prisma.entry.update({ where: { id: futur.id }, data: { publishedAt: new Date(Date.now() + 86400000) } });
  const titles = (await E.listEntries({ instance: "blog", locale: "fr" })).map((e) => e.title);
  assert.deepEqual(titles, ["Vedette", "Normale", "Expirée"]);
  assert.equal((await E.listEntries({ instance: "blog", locale: "fr", limit: 2 })).length, 2);
  assert.deepEqual((await E.listEntries({ instance: "blog", locale: "fr", limit: 1, offset: 1 })).map((e) => e.title), ["Normale"]);
  assert.deepEqual(await E.listEntries({ instance: "inconnue", locale: "fr" }), []);
});

test("entrées : traduction manquante → langue par défaut si l'instance l'autorise, sinon masquée", async () => {
  await setSetting("i18n.default", "fr");
  const i = await newInstance();
  await createEntry(db.prisma, { instanceId: i.id, locale: "fr", title: "Seulement FR", status: "published" });
  const shown = await E.listEntries({ instance: "blog", locale: "en" });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].locale, "fr");
  await db.prisma.moduleInstance.update({ where: { id: i.id }, data: { fallbackToDefault: false } });
  assert.deepEqual(await E.listEntries({ instance: "blog", locale: "en" }), []);
});

test("entrées : recherche par slug — trouvée, autre langue (redirection), inexistante, non publiée", async () => {
  await setSetting("i18n.default", "fr");
  const i = await newInstance();
  const e = await createEntry(db.prisma, { instanceId: i.id, locale: "fr", slug: "bonjour", title: "Bonjour", status: "published" });
  await db.prisma.entryTranslation.create({ data: { entryId: e.id, instanceId: i.id, locale: "en", slug: "hello", title: "Hello", summary: "", body: "" } });
  await createEntry(db.prisma, { instanceId: i.id, locale: "fr", slug: "secret", title: "Secret" });
  const inst = await getInstanceByKey("blog");
  assert.equal((await E.findEntryBySlug(inst, "fr", "bonjour")).kind, "found");
  assert.deepEqual(await E.findEntryBySlug(inst, "en", "bonjour"), { kind: "other-locale", locale: "en", slug: "hello" });
  assert.equal((await E.findEntryBySlug(inst, "fr", "nope")).kind, "missing");
  assert.equal((await E.findEntryBySlug(inst, "fr", "secret")).kind, "missing", "un brouillon n'est jamais accessible");
  assert.equal((await E.findEntryById(e.id, "en")).title, "Hello");
  assert.equal(await E.findEntryById("inconnu", "fr"), undefined);
});

test("entrées : chemin public selon la langue, étiquettes lues sans erreur", async () => {
  assert.equal(E.entryPath({ basePath: "blog", slug: "x", locale: "fr" }, "fr"), "/blog/x");
  assert.equal(E.entryPath({ basePath: "blog", slug: "x", locale: "en" }, "fr"), "/en/blog/x");
  assert.equal(E.entryPath({ basePath: null, slug: "x", locale: "fr" }, "fr"), "/x");
  assert.deepEqual(E.parseTags('["a","b"]'), ["a", "b"]);
  assert.deepEqual(E.parseTags("{cassé"), []);
});

test("journal d'audit : action consignée avec son auteur", async () => {
  await audit("moi@x.y", "test.action", "cible");
  const rows = await db.prisma.auditLog.findMany();
  assert.deepEqual([rows[0].actor, rows[0].action, rows[0].target], ["moi@x.y", "test.action", "cible"]);
});
