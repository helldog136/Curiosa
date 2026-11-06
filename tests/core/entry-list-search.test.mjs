// LISTE PUBLIQUE EN CARTES + RECHERCHE EN DIRECT : la règle de comparaison (sans majuscules ni accents), la recherche du serveur sur une liste paginée,
// le réglage « Afficher un champ de recherche » de chaque instance, et le HTML rendu (ligne-carte cliquable en entier, pièces de skin, aucun style codé en dur).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { listEntriesPage, PER_PAGE } = await import("@/core/content/entries");
const S = await import("@/core/content/search");
const { getInstanceByKey } = await import("@/core/instances");
const { manifestSchema } = await import("@/core/modules/manifest");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const { EntryList } = await import("@/components/site/EntryList");
const { EntrySearch } = await import("@/components/site/EntrySearch");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { labelProblems, toneProblems, forbiddenWords, HELP_INLINE_MAX } = await import("../../testsupport/ergonomics.mjs");

beforeEach(() => db.reset());
after(() => db.close());

async function blog() {
  await db.fixture("blog");
  const m = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
  return createInstance(db.prisma, { manifest: m, names: { fr: "blog", en: "blog" } });
}
const make = (instanceId, title, extra = {}) => createEntry(db.prisma, { instanceId, locale: "fr", title, status: "published", ...extra });

test("réglage : choix enregistré > valeur du manifeste > affichage en liste", () => {
  assert.equal(S.effectiveSearch(undefined, "list"), true);
  assert.equal(S.effectiveSearch(undefined, "cards"), false);
  assert.equal(S.effectiveSearch(undefined, "cards", true), true);
  assert.equal(S.effectiveSearch(undefined, "list", false), false);
  assert.equal(S.effectiveSearch(false, "list", true), false);
  assert.equal(S.effectiveSearch(true, "links"), true);
  assert.equal(S.searchSettingKey("abc"), "instance.abc.__search");
});

test("paramètre q : une seule valeur, espaces ramenés à un, coupée à 80 caractères", () => {
  assert.equal(S.parseListQuery("  lune   douce "), "lune douce");
  assert.equal(S.parseListQuery(["a", "b"]), "");
  assert.equal(S.parseListQuery(undefined), "");
  assert.equal(S.parseListQuery("x".repeat(500)).length, S.LIST_QUERY_MAX);
});

test("le texte cherché couvre le titre, le résumé, les mots-clés et le code, sans accents ni majuscules", () => {
  const e = { title: "Été à la plage", summary: "Les VACANCES", tags: ["Détente"], code: "ETOILE10" };
  assert.ok(S.entryMatches(e, "ete"));
  assert.ok(S.entryMatches(e, "vacances plage"));
  assert.ok(S.entryMatches(e, "detente"));
  assert.ok(S.entryMatches(e, "etoile10"));
  assert.ok(!S.entryMatches(e, "hiver"));
  assert.ok(S.entryMatches(e, ""));
});

test("le manifeste accepte content.search et refuse autre chose qu'un booléen", () => {
  const base = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
  assert.equal(manifestSchema.safeParse({ ...base, content: { ...base.content, search: false } }).success, true);
  assert.equal(manifestSchema.safeParse({ ...base, content: { ...base.content, search: "oui" } }).success, false);
});

test("recherche du serveur sur une liste paginée : toute la liste est filtrée, puis découpée en pages", async () => {
  const c = await blog();
  for (let i = 0; i < 30; i++) await make(c.id, `Article ${i}`, { summary: i % 10 === 3 ? "Une aventure à l'étoile" : "", tags: i === 7 ? ["Étoile_Nord"] : [] });
  await make(c.id, "Camille rencontre lune_douce");
  const inst = await getInstanceByKey(c.key);

  const all = await listEntriesPage({ instance: inst, locale: "fr", page: 1 });
  assert.equal(all.total, 31);
  assert.equal(all.pages, 3);
  assert.equal(all.candidates, 31);

  // résumé (3 entrées) + mot-clé (1) : trouvés au-delà de la première page, sans accent ni majuscule.
  const hits = await listEntriesPage({ instance: inst, locale: "fr", page: 1, query: "ETOILE" });
  assert.equal(hits.total, 4);
  assert.equal(hits.pages, 1);
  assert.equal(hits.candidates, 31);
  assert.ok(hits.items.every((e) => /toile/i.test(`${e.summary} ${e.tags.join(" ")}`)));

  // plusieurs mots : tous doivent être présents
  assert.equal((await listEntriesPage({ instance: inst, locale: "fr", page: 1, query: "camille LUNE" })).total, 1);
  // beaucoup de résultats : pages de 12
  const many = await listEntriesPage({ instance: inst, locale: "fr", page: 2, query: "article", perPage: PER_PAGE });
  assert.equal(many.total, 30);
  assert.equal(many.items.length, PER_PAGE);
  assert.equal(many.pages, 3);
  // aucun résultat : page vide, une page
  const none = await listEntriesPage({ instance: inst, locale: "fr", page: 1, query: "zzzz" });
  assert.deepEqual([none.items.length, none.total, none.pages], [0, 0, 1]);
});

test("recherche du serveur : les brouillons ne sont jamais trouvés", async () => {
  const c = await blog();
  await make(c.id, "Visible lune_douce");
  await createEntry(db.prisma, { instanceId: c.id, locale: "fr", title: "Secret lune_douce", status: "draft" });
  const inst = await getInstanceByKey(c.key);
  const r = await listEntriesPage({ instance: inst, locale: "fr", page: 1, query: "lune_douce" });
  assert.deepEqual(r.items.map((e) => e.title), ["Visible lune_douce"]);
});

const view = (over = {}) => ({ id: "1", instanceId: "i", instanceKey: "blog", basePath: "blog", slug: "un", locale: "fr", isFallback: false, title: "Un titre très long ".repeat(8), summary: "Un résumé", body: "", cover: null, icon: null, url: null, code: null, featured: false, tags: ["Détente"], expired: false, publishedAt: null, expiresAt: null, fields: {}, availableLocales: ["fr"], translations: [], ...over });
const coll = (display) => ({ display, clickAction: "detail" });
const props = (display, extra = {}) => ({ entries: [view(), view({ id: "2", slug: "deux", title: "Deux", summary: "" })], collection: coll(display), locale: "fr", defaultLocale: "fr", ...extra });

test("mode liste : une ligne-carte par entrée, un seul lien étendu à toute la ligne, texte coupé, pièces de skin", () => {
  const out = renderToStaticMarkup(React.createElement(EntryList, props("list")));
  assert.equal([...out.matchAll(/<li /g)].length, 2);
  assert.equal([...out.matchAll(/<a /g)].length, 2, "un seul lien par ligne");
  assert.equal([...out.matchAll(/data-skin-part="card"[^>]*data-kind="row"|data-kind="row"[^>]*data-skin-part="card"/g)].length, 2);
  assert.ok(out.includes("after:absolute after:inset-0"), "la ligne entière est cliquable");
  assert.ok(out.includes("truncate") && out.includes("line-clamp-2"), "coupé avec « … »");
  assert.ok(out.includes('title="Un résumé"'), "texte complet dans une info-bulle");
  assert.ok(out.includes("min-h-[6.25rem]"), "hauteur identique");
  assert.ok(out.includes("rounded-card") && out.includes("bg-surface") && out.includes("border-line"), "jetons de skin");
  for (const part of ["list", "heading", "link", "lead", "card-body"]) assert.ok(out.includes(`data-skin-part="${part}"`), part);
  // aucune couleur codée en dur : ni valeur hexadécimale / rgb dans une classe, ni couleur nommée de la palette
  assert.ok(!/\[(#|rgb|hsl|oklch)/.test(out) && !/(?:bg|text|border)-(?:red|blue|green|gray|slate|zinc|white|black)\b/.test(out));
  assert.ok(!out.includes("data-entry-search"), "sans recherche, pas de texte cherché en plus");
});

test("avec la recherche, chaque entrée porte son texte cherché dans tous les modes d'affichage", () => {
  for (const display of ["list", "cards", "links"]) {
    const out = renderToStaticMarkup(React.createElement(EntryList, props(display, { searchable: true })));
    assert.equal([...out.matchAll(/data-entry-search="/g)].length, 2, display);
    assert.ok(out.includes("detente"), display);
  }
});

const labels = { label: "Search this list", placeholder: "Search", clear: "Clear the search", count: "{n} results", countOne: "{n} result", none: "No result", tips: "Check the spelling.", busy: "Searching…" };
const search = (extra = {}) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: {} }, React.createElement(EntrySearch, { labels, action: "/blog", initialQuery: "", server: false, serverTotal: 2, hays: ["un", "deux"], ...extra }, React.createElement("ul", null, React.createElement("li", { "data-entry-search": "un" }, "Un")))));

test("champ de recherche : libellé relié, rôle search, annonce polie, pièces de skin, liste visible sans JavaScript", () => {
  const out = search();
  assert.match(out, /<label for="entry-search-input" class="sr-only">Search this list<\/label>/);
  assert.match(out, /<input[^>]*id="entry-search-input"[^>]*type="search"|<input[^>]*type="search"[^>]*id="entry-search-input"/);
  assert.match(out, /role="search"[^>]*data-skin-part="search"|data-skin-part="search"[^>]*role="search"/);
  assert.match(out, /data-variant="list"/);
  assert.match(out, /role="status" aria-live="polite"/);
  assert.ok(out.includes("<li data-entry-search=\"un\">Un</li>"), "la liste est dans la page (aucun filtre côté serveur sans recherche)");
  assert.ok(!out.includes("entry-search-none"), "pas de « Aucun résultat » sans recherche");
});

test("recherche déjà faite par le serveur : « Aucun résultat » avec « Effacer la recherche » et le nombre annoncé", () => {
  const none = search({ initialQuery: "zzz", server: true, serverTotal: 0, hays: [] });
  assert.ok(none.includes("No result") && none.includes("entry-search-none"));
  assert.ok(none.includes("Clear the search"));
  const some = search({ initialQuery: "un", server: true, serverTotal: 1, hays: ["un"] });
  assert.ok(some.includes(">1 result<"));
  const two = search({ initialQuery: "e", server: true, serverTotal: 2, hays: ["un", "deux"] });
  assert.ok(two.includes(">2 results<"));
});

test("textes : anglais et français à parité, courts, sans mot interdit, ton neutre", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => k.startsWith("site.list.search.") || k === "instances.search" || k === "instances.searchHelp");
  assert.ok(keys.length >= 8);
  for (const k of keys) {
    assert.ok(k in fr, `${k} manque en français`);
    assert.deepEqual(en[k].match(/\{\w+\}/g), fr[k].match(/\{\w+\}/g), `${k} : variables`);
    for (const [lang, text] of [["en", en[k]], ["fr", fr[k]]]) {
      assert.deepEqual(forbiddenWords(text), [], `${k} ${lang}`);
      assert.deepEqual(toneProblems(text, lang), [], `${k} ${lang}`);
    }
  }
  for (const text of [en["instances.search"], fr["instances.search"]]) assert.deepEqual(labelProblems(text), [], text);
  for (const text of [en["instances.searchHelp"], fr["instances.searchHelp"]]) assert.ok(text.length <= HELP_INLINE_MAX, text);
});
