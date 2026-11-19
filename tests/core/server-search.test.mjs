// Server search of a module table (`searchable: "server"`, core 0.38.0): the pure rules, `ctx.search`, the namespace on a place page, the markup of the field and of
// "No result", and a demo module that paginates and filters itself. The behaviour in a real browser (250 ms, focus kept, Back) is checked with Playwright.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const { serverSearchParams, serverSearchTarget, isEnhancedTable, SERVER_SEARCH_DELAY_MS } = await import("@/core/adminkit/table");
const { searchKit } = await import("@/core/modules/searchKit");
const { scopeBlocks } = await import("@/core/modules/placeScope");
const { TableView } = await import("@/components/admin/TableView");
const { AdminTable } = await import("@/components/admin/AdminTable");
const { tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { fakeCtx } = await import("../helpers/fakeCtx.mjs");
const fixture = (await import("../fixtures/server-search/index.mjs")).default;
const labels = tableLabels(makeTranslator("fr"));

test("serverSearchParams : seulement « server » ; paramètre validé (« q » par défaut), page remise à zéro par défaut", () => {
  assert.equal(serverSearchParams({ searchable: true }), null);
  assert.equal(serverSearchParams({}), null);
  assert.deepEqual(serverSearchParams({ searchable: "server" }), { param: "q", reset: ["page"] });
  assert.deepEqual(serverSearchParams({ searchable: "server", searchParam: "find", searchReset: ["p", "tab"] }), { param: "find", reset: ["p", "tab"] });
  assert.equal(serverSearchParams({ searchable: "server", searchParam: "a b&c=d" }).param, "q", "un nom de paramètre douteux est refusé");
  assert.deepEqual(serverSearchParams({ searchable: "server", searchReset: ["ok", "no&no", 3] }).reset, ["ok"]);
  assert.equal(SERVER_SEARCH_DELAY_MS, 250);
});

test("serverSearchTarget : remplace le paramètre, garde le reste, retire la page, efface quand le champ est vide", () => {
  assert.equal(serverSearchTarget("/admin/instances/abc?tab=use&page=3", "q", "  Éléonore ", ["page"]), "/admin/instances/abc?tab=use&q=%C3%89l%C3%A9onore");
  assert.equal(serverSearchTarget("/admin/instances/abc?q=old&page=2", "q", "", ["page"]), "/admin/instances/abc");
  assert.equal(serverSearchTarget("/admin/live/alerts?blog.q=x&other.q=y", "blog.q", "z"), "/admin/live/alerts?blog.q=z&other.q=y", "un autre module sur la même page garde sa recherche");
  assert.ok(serverSearchTarget("/admin/x", "q", "a".repeat(500)).length < 140, "texte borné");
});

test("ctx.search : casse et accents ignorés, tous les mots trouvés, une lettre filtre déjà, recherche vide laisse tout passer", async () => {
  const ctx = fakeCtx();
  assert.equal(typeof ctx.search.matches, "function");
  assert.equal(ctx.search.fold("Éléonore"), "eleonore");
  assert.equal(ctx.search.query("  hello  "), "hello");
  assert.equal(ctx.search.query(undefined), "");
  assert.equal(ctx.search.query(["x"]), "");
  assert.equal(searchKit.matches(["Éléonore Martin", "note"], "eleonore mar"), true);
  assert.equal(searchKit.matches(["Éléonore Martin"], "martin zzz"), false);
  assert.equal(searchKit.matches("Camille", "C"), true);
  assert.equal(searchKit.matches([null, undefined, false, "x"], ""), true);
  assert.equal(typeof fakeCtx({ search: null }).search, "undefined", "un cœur plus ancien n'a pas ctx.search");
});

test("place partagée : le paramètre de recherche et les paramètres remis à zéro passent dans l'espace du module", () => {
  const out = scopeBlocks([{ type: "table", columns: ["A"], rows: [], searchable: "server" }, { type: "table", columns: ["A"], rows: [], searchable: true }], "contacts");
  assert.equal(out[0].searchParam, "contacts.q");
  assert.deepEqual(out[0].searchReset, ["contacts.page"]);
  assert.equal(out[1].searchParam, undefined, "un tableau sans recherche serveur ne change pas");
  const custom = scopeBlocks([{ type: "table", columns: [], rows: [], searchable: "server", searchParam: "find", searchReset: ["p"] }], "blog-2");
  assert.equal(custom[0].searchParam, "blog-2.find"); assert.deepEqual(custom[0].searchReset, ["blog-2.p"]);
});

test("tableau « server » : enrichi, champ Rechercher, lignes non filtrées une seconde fois, valeur de l'adresse dans le champ", () => {
  const block = { type: "table", columns: ["Nom"], rows: [["Camille"], ["etoile_nord"]], searchable: "server", rowIds: ["a", "b"] };
  assert.equal(isEnhancedTable(block), true);
  const server = { param: "q", reset: ["page"], value: "xyz", current: "/admin/instances/i1?q=xyz", go() {} };
  const out = html(h(TableView, { block, instanceId: "i1", labels, server }));
  assert.match(out, /type="search"/);
  assert.match(out, /value="xyz"/, "la recherche de l'adresse est dans le champ");
  assert.match(out, />Camille</); assert.match(out, />etoile_nord</, "le module a déjà filtré : le cœur ne cache rien");
  assert.match(out, />Effacer la recherche</);
});

test("tableau « server » sans résultat : le champ reste, « Aucun résultat » et « Effacer la recherche » ; sans recherche, l'état vide du module", () => {
  const block = { type: "table", columns: ["Nom"], rows: [], searchable: "server", empty: "Aucune personne." };
  const searching = html(h(TableView, { block, instanceId: "i1", labels, server: { param: "q", reset: ["page"], value: "zzz", current: "/admin/x?q=zzz", go() {} } }));
  assert.match(searching, /type="search"/); assert.match(searching, /Aucun résultat/); assert.match(searching, />Effacer la recherche</);
  assert.doesNotMatch(searching, /Aucune personne\./);
  const idle = html(h(TableView, { block, instanceId: "i1", labels, server: { param: "q", reset: ["page"], value: "", current: "/admin/x", go() {} } }));
  assert.match(idle, /Aucune personne\./);
});

test("sans instance (site public) ou en liste ordinaire : aucun hook de navigation, le tableau d'avant", () => {
  const out = html(h(AdminTable, { block: { type: "table", columns: ["Nom"], rows: [["a"], ["b"]], searchable: true }, instanceId: "i1", labels }));
  assert.match(out, /type="search"/);
  const pub = html(h(TableView, { block: { type: "table", columns: ["Nom"], rows: [["a"]], searchable: "server" }, labels }));
  assert.match(pub, /type="search"/, "hors du panneau d'administration, un client filtre les lignes reçues");
});

test("module de démonstration : la recherche vient de l'adresse, le module filtre (accents, casse) et pagine lui-même", async () => {
  const people = Array.from({ length: 45 }, (_, i) => ({ name: `Personne ${i}`, note: i === 7 ? "Éléonore" : "" }));
  const ctx = fakeCtx({ rows: { people } });
  const all = (await fixture.adminPanel(ctx, { query: {} }))[0];
  assert.equal(all.searchable, "server"); assert.equal(all.rows.length, 20, "le module pagine : 20 lignes");
  const page3 = (await fixture.adminPanel(ctx, { query: { page: "3" } }))[0];
  assert.equal(page3.rows.length, 5);
  const found = (await fixture.adminPanel(ctx, { query: { q: "ELEONORE" } }))[0];
  assert.deepEqual(found.rows, [["Personne 7", "Éléonore"]], "casse et accents ignorés");
  const none = (await fixture.adminPanel(ctx, { query: { q: "zzzz" } }))[0];
  assert.equal(none.type, "table"); assert.deepEqual(none.rows, [], "le tableau est rendu même sans ligne : le champ reste");
});

test("câblage : le champ de la recherche serveur ne s'appuie que sur l'adresse (replace, sans défilement), jamais sur un bouton", () => {
  const src = fs.readFileSync("src/components/admin/AdminTable.tsx", "utf8");
  assert.match(src, /router\.replace\(target, \{ scroll: false \}\)/);
  const view = fs.readFileSync("src/components/admin/TableView.tsx", "utf8");
  assert.match(view, /SERVER_SEARCH_DELAY_MS/);
  assert.doesNotMatch(view, /type="submit"/);
});

test("choix vides pour la même cause (0.38.0) : la consigne « créez-en un dans … » n'apparaît qu'une fois par page, l'autre sélecteur dit seulement son état", async () => {
  const { ModuleSettings } = await import("@/components/admin/ModuleSettings");
  const { HelpTipProvider } = await import("@/components/admin/HelpTip");
  const tr = makeTranslator("fr");
  const field = (key, label) => ({ key, type: "choice", label: { fr: label, en: label }, source: { kind: "service", service: "x.list", list: "l", get: "g" } });
  const owner = { name: "Contacts", href: "/admin/community/contacts" };
  const view = (o) => ({ mode: "none", kind: "service", service: "x.list", owner: o, canCreate: false });
  const render = (choices) => html(h(HelpTipProvider, { label: "Aide : {name}" }, h(ModuleSettings, { t: tr, locale: "fr", defaultLocale: "fr", locales: ["fr"], fields: [field("a", "Personne A"), field("b", "Personne B")], allFields: [field("a", "Personne A"), field("b", "Personne B")], groups: [], stored: {}, siteByLocale: {}, theme: {}, missing: new Set(), choices })));
  const same = render({ a: view(owner), b: view(owner) });
  assert.equal((same.match(/Créez-en un dans/g) ?? []).length, 1, "la consigne une seule fois");
  assert.equal((same.match(/Aucun choix possible\./g) ?? []).length, 2, "chaque sélecteur dit son état");
  assert.doesNotMatch(same, /pour l(?:'|&#x27;)instant/);
  const other = render({ a: view(owner), b: view({ name: "Partenaires", href: "/admin/community/partners" }) });
  assert.equal((other.match(/Créez-en un dans/g) ?? []).length, 2, "deux causes différentes : deux consignes");
});
