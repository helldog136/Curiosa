import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const RT = await import("@/core/modules/runtime");
const { buildContext } = await import("@/core/modules/context");
const Topics = await import("@/core/services/topics");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { listMcpTools, listMcpToolCatalogue } = await import("@/core/platform");
const { mcpInstanceKey } = await import("@/core/modules/mcpProvider");
const { parseManifest } = await import("@/core/modules/manifest");
const { BUILTIN_MODULES } = await import("@/modules-builtin");

beforeEach(() => db.reset());
after(() => db.close());

const base = (over) => ({ apiVersion: 2, version: "1.0.0", ...over });

const PROVIDER = {
  "module.json": base({
    id: "prov", name: "Fournisseur", provides: [{ topic: "demo.item" }], page: true, basePath: "prov",
    settings: [{ key: "greeting", type: "text", label: "Salut", default: "bonjour" }],
    mcp: [
      { name: "echo", description: "Répète", readOnly: true, default: true, input: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 10 } } } },
      { name: "wipe", description: "Efface", destructive: true },
      { name: "edit", description: "Modifie" },
      { name: "sans_code", description: "Déclaré mais non implémenté", readOnly: true },
    ],
    sections: [{ id: "hello", label: "Bonjour" }, { id: "boom", label: "Casse" }],
    main: "index.mjs",
  }),
  "locales/en.json": { hi: "Hi {who}" },
  "locales/fr.json": { hi: "Salut {who}" },
  "index.mjs": `export default {
    exports: { "demo.item": async (ctx, q) => [
      { id: "1", title: "Bon", extra: "ignoré" },
      { id: "2" },
      { id: 3, title: "mauvais type" },
      { id: "4", title: "Autre", tagged: q.tags.join(",") },
    ] },
    sections: {
      hello: (ctx, o) => [{ type: "markdown", text: ctx.t("hi", { who: ctx.setting("greeting") }) + ":" + (o.n ?? "-") }],
      boom: () => { throw new Error("section cassée"); },
    },
    slots: { "layout.footer": (ctx) => [{ type: "markdown", text: "pied " + ctx.instance.key }], "layout.banner": () => { throw new Error("slot cassé"); } },
    filters: { entryBody: (body) => body + "!" },
    page: (ctx, { segments }) => segments[0] === "x" ? { blocks: [{ type: "markdown", text: "page x" }] } : segments[0] === "err" ? (() => { throw new Error("page cassée"); })() : null,
    mcp: {
      echo: (ctx, args) => ({ said: args.text, from: ctx.instance.key }),
      wipe: () => ({ wiped: true }),
      edit: () => ({ edited: true }),
    },
  };`,
};
const CONSUMER = {
  "module.json": base({
    id: "cons", name: "Consommateur", type: "overlay", instances: "multiple",
    consumes: [{ topic: "demo.item", label: "Items", schema: [{ key: "id", type: "string", required: true }, { key: "title", type: "string", required: true }, { key: "tagged", type: "string" }], tags: true }],
    main: "index.mjs",
  }),
  "index.mjs": "export default {};",
};

async function setup() {
  await installModule(makeRepo(PROVIDER).url);
  await installModule(makeRepo(CONSUMER).url);
  await setModuleEnabled("prov", true);
  await setModuleEnabled("cons", true);
  const mk = async (id, nickname) => {
    const mod = await R.getModule(id);
    return createInstance(db.prisma, { manifest: mod.manifest, nickname, names: { en: nickname ?? id } });
  };
  return { p1: await mk("prov", "Alpha"), p2: await mk("prov", "Beta"), c: await mk("cons") };
}
const active = async (key) => (await R.getActiveInstances()).find((a) => a.instance.key === key);

test("contexte : réglages avec valeurs par défaut, traductions du module avec repli, variables", async () => {
  const { p1 } = await setup();
  const a = await active(p1.key);
  const ctx = await buildContext(a.mod, a.instance, "fr");
  assert.equal(ctx.setting("greeting"), "bonjour");
  assert.equal(ctx.t("hi", { who: "Rosa" }), "Salut Rosa");
  assert.equal((await buildContext(a.mod, a.instance, "nl")).t("hi", { who: "x" }), "Hi x", "langue sans dictionnaire → anglais");
  assert.equal(ctx.t("action.save"), "Enregistrer", "clé absente du module → dictionnaire du cœur");
  assert.equal(ctx.instance.key, "alpha");
  await setSetting(`instance.${p1.id}.greeting`, "coucou");
  assert.equal((await buildContext(a.mod, a.instance, "en")).setting("greeting"), "coucou");
  const b = await active("beta");
  assert.equal((await buildContext(b.mod, b.instance, "en")).setting("greeting"), "bonjour", "réglages isolés par instance");
});

test("exécution : sections rendues avec leurs options, erreurs isolées, instance inconnue ignorée", async () => {
  await setup();
  assert.deepEqual(await RT.runSection("alpha", "hello", { n: 2 }, "fr"), [{ type: "markdown", text: "Salut bonjour:2" }]);
  const log = console.error; console.error = () => {};
  try {
    assert.deepEqual(await RT.runSection("alpha", "boom", {}, "fr"), []);
    assert.deepEqual(await RT.runSection("alpha", "inexistante", {}, "fr"), []);
    assert.deepEqual(await RT.runSection("nope", "hello", {}, "fr"), []);
  } finally { console.error = log; }
});

test("exécution : emplacements — un module en panne n'empêche pas les autres, instances désactivées muettes", async () => {
  await setup();
  const log = console.error; console.error = () => {};
  try {
    assert.deepEqual((await RT.runSlot("layout.banner", "fr")), []);
    const footer = await RT.runSlot("layout.footer", "fr");
    assert.deepEqual(footer.map((b) => b.text), ["pied alpha", "pied beta"]);
    await db.prisma.moduleInstance.update({ where: { key: "beta" }, data: { enabled: false } });
    assert.deepEqual((await RT.runSlot("layout.footer", "fr")).map((b) => b.text), ["pied alpha"]);
  } finally { console.error = log; }
});

test("exécution : filtre du corps des entrées appliqué par chaque instance active", async () => {
  await setup();
  assert.equal(await RT.filterEntryBody("txt", "fr", {}), "txt!!");
});

test("exécution : page d'un module — rendue, absente (404 du module), en erreur (404 sûr), module sans page", async () => {
  await setup();
  const log = console.error; console.error = () => {};
  try {
    assert.deepEqual(await RT.runPage("alpha", ["x"], "fr"), { blocks: [{ type: "markdown", text: "page x" }] });
    assert.equal(await RT.runPage("alpha", ["y"], "fr"), null);
    assert.deepEqual(await RT.runPage("alpha", ["err"], "fr"), { notFound: true, blocks: [] });
    assert.equal(await RT.runPage("cons", [], "fr"), undefined, "pas de page définie → le cœur décide");
    assert.equal(await RT.runPage("inconnue", [], "fr"), undefined);
  } finally { console.error = log; }
});

test("exécution : section « latest » par défaut des modules à contenu, bornée entre 1 et 50", async () => {
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  const blog = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  await createInstance(db.prisma, { manifest: blog, names: { en: "Blog" } });
  assert.deepEqual((await RT.runSection("blog", "latest", {}, "en"))[0], { type: "entries", instance: "blog", limit: 3, title: "Blog", link: true });
  assert.equal((await RT.runSection("blog", "latest", { count: 999 }, "en"))[0].limit, 50);
  assert.equal((await RT.runSection("blog", "latest", { count: -4 }, "en"))[0].limit, 1);
  assert.equal((await RT.runSection("blog", "latest", { count: "abc" }, "en"))[0].limit, 3, "valeur absurde → défaut");
});

/* ───────────── Sujets ───────────── */

test("sujets : conformité — champs inconnus retirés, requis vérifiés, types stricts", () => {
  const schema = [{ key: "t", type: "string", required: true }, { key: "u", type: "url" }, { key: "n", type: "number" }, { key: "b", type: "boolean" }, { key: "l", type: "string[]" }];
  assert.deepEqual(Topics.conform({ t: "x", extra: 1 }, schema), { t: "x" });
  assert.equal(Topics.conform({}, schema), null);
  assert.equal(Topics.conform({ t: 5 }, schema), null);
  assert.deepEqual(Topics.conform({ t: "x", u: "https://a.b", n: 2, b: false, l: ["a"] }, schema), { t: "x", u: "https://a.b", n: 2, b: false, l: ["a"] });
  assert.deepEqual(Topics.conform({ t: "x", u: "/local" }, schema), { t: "x", u: "/local" });
  for (const bad of [{ u: "javascript:alert(1)" }, { n: NaN }, { n: "3" }, { b: "true" }, { l: [1] }, { l: "a" }]) assert.equal(Topics.conform({ t: "x", ...bad }, schema), null, JSON.stringify(bad));
  assert.deepEqual(Topics.conform({ t: "x", n: null }, schema), { t: "x" }, "null = absent");
});

test("sujets : fournisseurs d'un sujet, sources par défaut = tous, choix enregistré par consommateur", async () => {
  const { c } = await setup();
  assert.deepEqual((await Topics.providersOf("demo.item")).map((p) => p.instance.key).sort(), ["alpha", "beta"]);
  assert.deepEqual(await Topics.providersOf("sujet.inconnu"), []);
  assert.deepEqual(await Topics.getSources(c.id, "demo.item"), { instances: null, tags: [] });
  await Topics.setSources(c.id, "demo.item", { instances: ["alpha"], tags: ["x"] });
  assert.deepEqual(await Topics.getSources(c.id, "demo.item"), { instances: ["alpha"], tags: ["x"] });
});

test("sujets : collecte — éléments invalides écartés, source indiquée, filtrage par instance, étiquettes transmises", async () => {
  const { c } = await setup();
  const consumer = await active(c.key);
  const all = await Topics.collect(consumer, "demo.item", { locale: "en" });
  assert.equal(all.length, 4, "2 éléments valides × 2 fournisseurs");
  assert.deepEqual(all.map((i) => i.title).sort(), ["Autre", "Autre", "Bon", "Bon"]);
  assert.ok(all.every((i) => !("extra" in i)), "champs hors schéma retirés");
  assert.deepEqual(new Set(all.map((i) => i.source.instance)), new Set(["alpha", "beta"]));
  assert.equal(all[0].source.module, "prov");
  await Topics.setSources(c.id, "demo.item", { instances: ["beta"], tags: ["a", "b"] });
  const only = await Topics.collect(consumer, "demo.item", { locale: "en" });
  assert.deepEqual(new Set(only.map((i) => i.source.instance)), new Set(["beta"]));
  assert.equal(only.find((i) => i.id === "4").tagged, "a,b");
  assert.equal((await Topics.collect(consumer, "demo.item", { locale: "en", limit: 1 })).length, 1);
});

test("sujets : un consommateur ne peut collecter que ce qu'il a déclaré", async () => {
  const { p1 } = await setup();
  const notConsumer = await active(p1.key);
  await assert.rejects(() => Topics.collect(notConsumer, "demo.item", { locale: "en" }), /does not declare consuming/);
});

test("sujets : un fournisseur en panne n'empêche pas les autres d'alimenter le consommateur", async () => {
  const { c } = await setup();
  await installModule(makeRepo({ "module.json": base({ id: "cass", name: "Cassé", provides: [{ topic: "demo.item" }], main: "index.mjs" }), "index.mjs": `export default { exports: { "demo.item": () => { throw new Error("panne"); } } };` }).url);
  await setModuleEnabled("cass", true);
  const mod = await R.getModule("cass");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { en: "Cassé" } });
  const log = console.error; console.error = () => {};
  try { assert.equal((await Topics.collect(await active(c.key), "demo.item", { locale: "en" })).length, 4); } finally { console.error = log; }
});

test("sujets : le sujet « core.entry » expose les entrées publiées des instances à contenu, avec chemin public", async () => {
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  const blog = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  const inst = await createInstance(db.prisma, { manifest: blog, names: { en: "Blog" } });
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Hello", status: "published", tags: ["news"], summary: "S" });
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Hidden", status: "draft" });
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Old", status: "published", tags: ["old"], expiresAt: new Date(Date.now() - 1000) });
  const fake = { instance: { id: "c", key: "c", names: {} }, mod: { manifest: { id: "x", consumes: [{ topic: "core.entry", label: "E" }] } } };
  const items = await Topics.collect(fake, "core.entry", { locale: "en" });
  assert.deepEqual(items.map((i) => i.title), ["Hello"]);
  assert.equal(items[0].path, "/blog/hello");
  assert.deepEqual(items[0].tags, ["news"]);
  await Topics.setSources("c", "core.entry", { instances: null, tags: ["nothing"] });
  assert.deepEqual(await Topics.collect(fake, "core.entry", { locale: "en" }), []);
  await Topics.setSources("c", "core.entry", { instances: null, tags: [] });
  await db.prisma.moduleInstance.update({ where: { id: inst.id }, data: { exposed: false } });
  assert.deepEqual(await Topics.collect(fake, "core.entry", { locale: "en" }), [], "l'instance a décoché « proposer ses entrées »");
});

test("sujets : options d'un champ référence — titres des éléments, vide si le sujet n'est pas déclaré", async () => {
  const { c, p1 } = await setup();
  const opts = await Topics.getRefOptions(c.id, "demo.item", "en");
  assert.ok(opts.some((o) => o.value === "1" && o.label === "Bon"));
  assert.deepEqual(await Topics.getRefOptions(p1.id, "demo.item", "en"), []);
  assert.deepEqual(await Topics.getRefOptions("inconnu", "demo.item", "en"), []);
});

/* ───────────── Actions MCP des modules et du contenu ───────────── */

test("MCP modules : outils nommés <instance>__<action>, seules les actions implémentées, valeurs par défaut sûres", async () => {
  await setup();
  const tools = (await listMcpTools()).filter((t) => t.source === "alpha");
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.alpha__echo && byName.alpha__wipe && byName.alpha__edit);
  assert.ok(!byName.alpha__sans_code, "déclarée mais non implémentée → non exposée");
  assert.deepEqual([byName.alpha__echo.readOnly, byName.alpha__echo.default], [true, true]);
  assert.deepEqual([byName.alpha__edit.readOnly, byName.alpha__edit.default], [false, false], "écriture non accordée d'office");
  assert.deepEqual([byName.alpha__wipe.destructive, byName.alpha__wipe.default], [true, false], "destructif jamais par défaut");
  assert.match(byName.alpha__echo.title, /Alpha/, "libellé humain, pas la clé");
});

test("MCP modules : arguments validés avant d'atteindre le module", async () => {
  await setup();
  const echo = (await listMcpTools()).find((t) => t.name === "alpha__echo");
  assert.deepEqual(await echo.call({ text: "salut" }, { name: "a" }), { said: "salut", from: "alpha" });
  await assert.rejects(() => echo.call({}, { name: "a" }), /missing required argument "text"/);
  await assert.rejects(() => echo.call({ text: "x".repeat(11) }, { name: "a" }), /at most 10/);
  await assert.rejects(() => echo.call({ text: "x", pirate: 1 }, { name: "a" }), /unexpected argument "pirate"/);
  await assert.rejects(() => echo.call({ text: 5 }, { name: "a" }), /must be a string/);
});

test("MCP : une instance qui se retire de l'API disparaît des outils mais reste au catalogue de l'admin", async () => {
  const { p2 } = await setup();
  await setSetting(mcpInstanceKey(p2.id), false);
  assert.equal((await listMcpTools()).some((t) => t.source === "beta"), false);
  const cat = (await listMcpToolCatalogue()).filter((t) => t.source === "beta");
  assert.ok(cat.length > 0 && cat.every((t) => t.instanceOptedOut));
  assert.ok((await listMcpTools()).some((t) => t.source === "alpha"));
});

test("MCP : outil « site_info » toujours présent, lecture seule, liste les instances actives", async () => {
  await setup();
  const tool = (await listMcpTools()).find((t) => t.name === "site_info");
  assert.deepEqual([tool.readOnly, tool.default, tool.destructive], [true, true, false]);
  const info = await tool.call({}, { name: "a" });
  assert.deepEqual(info.instances.map((i) => i.key).sort(), ["alpha", "beta", "cons"].sort());
});

test("MCP contenu : lister, lire, créer et modifier des BROUILLONS — jamais publier ni supprimer", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr", "en"]);
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  const blog = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  const inst = await createInstance(db.prisma, { manifest: blog, names: { fr: "Blog" } });
  const tools = (await listMcpTools()).filter((t) => t.source === "blog");
  assert.deepEqual(tools.map((t) => t.name).sort(), ["blog__create_draft", "blog__get_entry", "blog__list_entries", "blog__update_draft"]);
  assert.ok(!tools.some((t) => /publish|delete|remove/.test(t.name)));
  const T = Object.fromEntries(tools.map((t) => [t.name.split("__")[1], t]));
  const actor = { name: "agent" };

  const created = await T.create_draft.call({ title: "Idée", body: "Texte", tags: [" Foo ", ""] }, actor);
  assert.equal(created.status, "draft");
  const row = await db.prisma.entry.findUnique({ where: { id: created.id } });
  assert.equal(row.status, "draft");
  assert.equal(row.publishedAt, null);
  assert.deepEqual(JSON.parse(row.tags), ["foo"]);
  assert.equal((await db.prisma.auditLog.findFirst({ where: { action: "entry.create" } })).actor, "mcp:agent");

  await assert.rejects(() => T.create_draft.call({ title: "x", url: "javascript:alert(1)" }, actor), /url must be/);
  await assert.rejects(() => T.create_draft.call({ title: "x", locale: "xx" }, actor), /one of/);

  assert.equal((await T.list_entries.call({}, actor)).length, 0, "brouillons absents de la liste par défaut");
  assert.equal((await T.list_entries.call({ status: "draft" }, actor)).length, 1);
  assert.equal((await T.get_entry.call({ id: created.id }, actor)).body, "Texte");
  await assert.rejects(() => T.get_entry.call({ id: "inconnu" }, actor), /not found/);

  await T.update_draft.call({ id: created.id, title: "Idée v2" }, actor);
  assert.equal((await T.get_entry.call({ id: created.id }, actor)).title, "Idée v2");
  await T.update_draft.call({ id: created.id, locale: "en", title: "Idea" }, actor);
  assert.deepEqual((await T.get_entry.call({ id: created.id }, actor)).languages.sort(), ["en", "fr"]);
  await T.update_draft.call({ id: created.id, locale: "fr", summary: "résumé" }, actor);
  assert.equal((await T.get_entry.call({ id: created.id }, actor)).summary, "résumé", "mise à jour partielle d'une langue existante");

  await db.prisma.entry.update({ where: { id: created.id }, data: { status: "published", publishedAt: new Date() } });
  await assert.rejects(() => T.update_draft.call({ id: created.id, title: "Hack" }, actor), /only drafts/);
  void inst;
});

test("MCP contenu : les actions éditoriales ne sont jamais destructives et créer/modifier ne sont pas accordées par défaut aux lecteurs", async () => {
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  const blog = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  await createInstance(db.prisma, { manifest: blog, names: { en: "Blog" } });
  for (const t of (await listMcpTools()).filter((x) => x.source === "blog")) {
    assert.equal(t.destructive, false, t.name);
    if (!t.readOnly) assert.ok(t.name.endsWith("_draft"), t.name);
  }
  assert.ok(parseManifest({ apiVersion: 2, id: "zz", name: "Z", version: "1.0.0" }).ok);
});
