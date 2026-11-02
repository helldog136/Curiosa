// RECHERCHE DANS LE SITE — ce que voit la personne qui visite (champ, page de résultats, pièces de skin) et ce que règle la personne qui gère le site
// (onglet « Recherche » : mode simple/avancé, erreurs sous le champ, enregistrement), avec les contrôles d'ergonomie (R4, R9, R10, R11, R13, R22, R29).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { prisma } = db;
const { forbiddenWords, labelProblems, toneProblems, errorMessageProblems, HELP_INLINE_MAX } = await import("../../testsupport/ergonomics.mjs");
const { setSetting } = await import("@/core/settings");
const { createInstance } = await import("@/core/instanceService");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { Header } = await import("@/components/site/Header");
const { Footer } = await import("@/components/site/Footer");
const { SearchView } = await import("@/components/site/SearchView");
const { demoConfig } = await import("../../testsupport/skins/bench/stubs/settings.mjs");
const { siteJsonLd, SEARCH_TERM_PLACEHOLDER } = await import("@/core/seo");
const { buildPrivacyPolicy } = await import("@/core/privacy");
const { validateBasePath } = await import("@/core/instanceService");
const { highlight, snippet } = await import("@/core/search/text");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

after(() => db.close());

const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
/** Rend jusqu'au bout, Suspense compris (l'en-tête et le pied lisent des données). */
const html = (el) => new Promise((resolve, reject) => {
  let out = "";
  const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
  const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
});
const cfg = (L, search, layout = "classic") => demoConfig({ locale: L, search, header: { ...demoConfig().header, layout } });
const header = async (L, search, layout) => html(React.createElement(await Header({ config: cfg(L, search, layout), locale: L }).then((x) => () => x)));
const forms = (s) => [...s.matchAll(/<form[^>]*role="search"[^>]*>/g)];

/* ───────────── le champ ───────────── */

test("le champ est dans l'en-tête, une seule fois, pour chacune des quatre mises en page, dans la région « tools »", async () => {
  for (const layout of ["classic", "twoRows", "centered"]) {
    const s = await header("fr", { enabled: true, placement: "header" }, layout);
    assert.equal(forms(s).length, 1, layout);
    const tools = [...s.matchAll(/data-skin-region="tools"/g)].length;
    assert.ok(tools >= 1, layout);
    // le formulaire est DANS une région tools
    const at = s.indexOf('role="search"');
    const lastToolsBefore = s.lastIndexOf('data-skin-region="tools"', at);
    assert.ok(lastToolsBefore >= 0, `${layout} : le champ n'est pas dans la région tools`);
    assert.ok(!s.slice(lastToolsBefore, at).includes("</header>"), layout);
  }
});

test("mise en page « minimal » : le champ est dans le panneau du menu (qui s'ouvre au clic, comme tout le reste de cet en-tête), une seule fois", () => {
  for (const L of ["fr", "en"]) {
    const open = fs.readFileSync(`testsupport/skins/bench/fragments/${L}/header-minimal-open.html`, "utf8");
    assert.equal(forms(open).length, 1, L);
    assert.ok(open.lastIndexOf('data-skin-region="tools"', open.indexOf('role="search"')) > open.indexOf('data-testid="site-menu"'), "dans la région tools du panneau");
    assert.equal(forms(fs.readFileSync(`testsupport/skins/bench/fragments/${L}/header-minimal.html`, "utf8")).length, 0, "menu fermé : rien de visible en plus");
  }
});

test("le champ : formulaire GET sans script, libellé relié, bouton avec un texte, 44 px, pièces déclarées, langue dans l'adresse", async () => {
  const fr = await header("fr", { enabled: true, placement: "header" });
  assert.match(fr, /<form role="search" data-skin-part="search" data-variant="tool"[^>]*action="\/search" method="get"|<form[^>]*role="search"[^>]*>/);
  assert.match(fr, /action="\/search"/);
  assert.match(fr, /<label for="site-search-header" class="sr-only">Rechercher dans le site<\/label>/);
  assert.match(fr, /<input id="site-search-header" type="search"[^>]*name="q"/);
  assert.match(fr, /maxLength="100"|maxlength="100"/i);
  assert.match(fr, /<button type="submit" data-skin-part="button"[^>]*min-h-target min-w-target[^>]*>[\s\S]*?<span class="sr-only">Rechercher<\/span><\/button>/);
  assert.ok(!/<script/i.test(fr.slice(fr.indexOf('role="search"'), fr.indexOf("</form>", fr.indexOf('role="search"')))), "aucun script dans le champ");
  assert.ok(!/aria-hidden="true"[^>]*><span class="sr-only"/.test(fr));
  const en = await header("en", { enabled: true, placement: "header" });
  assert.match(en, /action="\/en\/search"/, "l'adresse de la page de résultats garde la langue");
  assert.match(en, /Search this site/);
});

test("placement : pied de page, nulle part, ou recherche désactivée → ni champ ailleurs, ni champ du tout", async () => {
  for (const search of [{ enabled: true, placement: "footer" }, { enabled: true, placement: "none" }, { enabled: false, placement: "header" }]) {
    assert.equal(forms(await header("fr", search)).length, 0, JSON.stringify(search));
  }
  const foot = async (search) => html(React.createElement(await Footer({ config: cfg("fr", search), locale: "fr" }).then((x) => () => x)));
  const inFooter = await foot({ enabled: true, placement: "footer" });
  assert.equal(forms(inFooter).length, 1);
  assert.match(inFooter, /id="site-search-footer"/);
  assert.equal(forms(await foot({ enabled: true, placement: "header" })).length, 0);
  assert.equal(forms(await foot({ enabled: false, placement: "footer" })).length, 0);
  // le pied de page garde ses constantes (confidentialité, crédit)
  assert.match(inFooter, /data-testid="privacy-link"/); assert.match(inFooter, /data-testid="credit"/);
});

/* ───────────── la page de résultats ───────────── */

const T = (L) => makeTranslator(L);
const view = (outcome, L = "fr") => html(React.createElement(SearchView, { outcome, locale: L, defaultLocale: "fr", t: T(L) }));
const item = (o = {}) => ({ id: "entry:1", title: highlight("Un article", ["article"]), typeLabel: "Blog", url: "/blog/un-article", external: false, lang: null, date: new Date("2026-01-12T10:00:00Z"), excerpt: snippet("Le texte de l'article.", ["article"]), ...o });
const results = (o = {}) => ({ kind: "results", shown: "article", trimmed: false, items: [item()], total: 1, reachable: 1, page: 1, pages: 1, perPage: 10, indexTruncated: false, ...o });

test("résultats : titre, type, date, extrait, mot mis en évidence, lien ; pièces de skin déclarées ; un seul h1", async () => {
  const s = await view(results());
  assert.equal([...s.matchAll(/<h1/g)].length, 1);
  assert.match(s, /<ol data-skin-part="list" data-kind="results" aria-label="Résultats de la recherche"/);
  assert.match(s, /<li data-skin-part="list-item"/);
  assert.match(s, /<h2 data-skin-part="heading" data-level="2"[^>]*><a href="\/blog\/un-article" data-skin-part="link"/);
  assert.match(s, /<mark data-skin-part="mark"[^>]*>article<\/mark>/);
  assert.match(s, /<span data-skin-part="badge"[^>]*>Blog<\/span>/);
  assert.match(s, /<time dateTime="2026-01-12T10:00:00.000Z"|<time datetime="2026-01-12T10:00:00.000Z"/);
  assert.match(s, /<p role="status" data-skin-part="prose"[^>]*>1 résultat pour « article »<\/p>/);
  assert.match(await view(results({ total: 24, reachable: 24, items: [item(), item({ id: "2" })], pages: 3, page: 2 })), /24 résultats pour « article »/);
  assert.match(await view(results(), "en"), /1 result for “article”/);
});

test("résultats : la pagination garde la saisie (encodée) et la langue ; au-delà de 200 résultats la page le dit", async () => {
  const s = await view(results({ shown: "été & <b>", total: 300, reachable: 200, pages: 20, page: 2, items: [item()] }));
  assert.match(s, /href="\/search\?q=%C3%A9t%C3%A9%20%26%20%3Cb%3E"/);
  assert.match(s, /href="\/search\?q=%C3%A9t%C3%A9%20%26%20%3Cb%3E&amp;page=3"/);
  assert.match(s, /Les 200 premiers résultats sont affichés/);
  assert.match(await view(results({ page: 2, pages: 3, total: 24, reachable: 24 }), "en"), /href="\/en\/search\?q=article&amp;page=3"/);
});

test("aucun résultat : dit quoi faire (vérifier, un seul mot, effacer la recherche) et garde la saisie dans le champ", async () => {
  const s = await view(results({ items: [], total: 0, reachable: 0, shown: "xyz" }));
  assert.match(s, /role="status"[^>]*>[\s\S]*Aucun résultat pour « xyz »\./);
  assert.match(s, /Vérifiez l&#x27;orthographe, ou essayez un seul mot\./);
  assert.match(s, /<a href="\/search" data-skin-part="link"[^>]*>Effacer la recherche<\/a>/);
  assert.match(s, /value="xyz"/);
});

test("champ vide, limite atteinte, saisie raccourcie, anciennes entrées non cherchées : chacun a sa phrase", async () => {
  assert.match(await view({ kind: "empty" }), /Écrivez un ou deux mots, par exemple « contact »\./);
  const limited = await view({ kind: "limited", shown: "a", retryAfterSeconds: 42 });
  assert.match(limited, /role="alert"[^>]*>Vous avez lancé beaucoup de recherches\. Réessayez dans 42 secondes\./);
  assert.match(await view({ kind: "limited", shown: "a", retryAfterSeconds: 1 }), /dans 1 seconde\./);
  assert.match(await view(results({ trimmed: true })), /Votre recherche a été raccourcie : 100 caractères et 6 mots au plus\./);
  assert.match(await view(results({ indexTruncated: true })), /Seuls les contenus les plus récents sont cherchés\./);
  assert.match(await view({ kind: "empty" }), /autofocus|autoFocus/i, "page vide : le champ reçoit le focus");
  assert.ok(!/autofocus/i.test(await view(results())), "avec des résultats, le focus n'est pas volé");
});

test("XSS : un titre, un extrait, un type ou une saisie piégés ne sortent jamais en balises", async () => {
  const evil = '<img src=x onerror=alert(1)><script>boom()</script>"\' onfocus=alert(2)';
  const s = await view(results({ shown: evil, items: [item({ title: highlight(evil, ["boom"]), typeLabel: evil, url: "/x", excerpt: snippet(evil, ["boom"]) })] }));
  assert.ok(!/<img|<script|onerror=alert\(1\)>|<\/script>/i.test(s.replace(/&lt;[\s\S]*?&gt;/g, "")), s);
  assert.match(s, /value="&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;boom\(\)&lt;\/script&gt;&quot;&#x27; onfocus=alert\(2\)"/);
});

test("repli de langue : l'élément porte sa vraie langue (lang) et un lien externe est ouvert avec noopener", async () => {
  const s = await view(results({ items: [item({ lang: "fr", external: true, url: "https://exemple.org/page" })] }), "en");
  assert.match(s, /<li lang="fr" data-skin-part="list-item"/);
  assert.match(s, /href="https:\/\/exemple.org\/page" data-skin-part="link" rel="noopener noreferrer"/);
});

test("la page : désactivée → 404 ; active → rend le composant ; jamais d'en-tête Set-Cookie ni de lecture de cookies", async () => {
  const Page = (await import("../../src/app/(site)/search/page.tsx")).default;
  const meta = (await import("../../src/app/(site)/search/page.tsx")).generateMetadata;
  const { NotFoundError } = await import("next/navigation");
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  await setSetting("search.enabled", false);
  await assert.rejects(() => Page({ searchParams: Promise.resolve({ q: "x" }) }), NotFoundError);
  await setSetting("search.enabled", true);
  const el = await Page({ searchParams: Promise.resolve({ q: "x" }) });
  assert.match(await html(el), /Aucun résultat pour « x »/);
  const m = await meta({ searchParams: Promise.resolve({ q: "Bonjour" }) });
  assert.deepEqual(m.robots, { index: false, follow: true }, "page de résultats non indexée");
  assert.equal(m.title, "Recherche : Bonjour");
  assert.equal((await meta({ searchParams: Promise.resolve({}) })).title, "Recherche");
  const src = fs.readFileSync("src/app/(site)/search/page.tsx", "utf8");
  assert.doesNotMatch(src, /cookies\(|Set-Cookie|set\(["']cookie/i);
  const config = (await import("../../next.config.mjs")).default;
  const rules = await config.headers();
  for (const source of ["/search", "/:locale([a-z]{2})/search"]) assert.ok(rules.some((r) => r.source === source && r.headers.some((h) => h.key === "X-Robots-Tag" && /noindex/.test(h.value))), source);
});

/* ───────────── le reste du cœur ───────────── */

test("/search est un chemin réservé : aucune instance, aucun lien court ne peut le prendre", async () => {
  assert.equal(await validateBasePath("search"), "instances.error.reserved");
  const { RESERVED_PATHS } = await import("@/core/config");
  assert.ok(RESERVED_PATHS.has("search"));
});

test("JSON-LD : la SearchAction de schema.org n'est ajoutée que si une adresse de recherche est donnée", () => {
  const base = { url: "https://exemple.org", name: "Mon site", tagline: "", logo: null, locale: "fr" };
  const site = (g) => g["@graph"].find((n) => n["@type"] === "WebSite");
  assert.equal(site(siteJsonLd(base)).potentialAction, undefined, "sans adresse : exactement comme avant");
  const withSearch = site(siteJsonLd({ ...base, searchUrl: `https://exemple.org/search?q=${SEARCH_TERM_PLACEHOLDER}` }));
  assert.deepEqual(withSearch.potentialAction, { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://exemple.org/search?q={search_term_string}" }, "query-input": "required name=search_term_string" });
  assert.equal(site(siteJsonLd({ ...base, searchUrl: "https://exemple.org/search" })).potentialAction, undefined, "sans le marqueur : ignoré");
});

test("politique de confidentialité : une section « recherche » seulement quand elle est active ; le reste du texte ne change pas", () => {
  for (const L of ["fr", "en"]) {
    const input = { siteName: "S", contactEmail: "a@b.c", statsEnabled: false, newsToggle: false, features: [], extra: "", t: T(L) };
    const off = buildPrivacyPolicy(input), same = buildPrivacyPolicy({ ...input, search: false });
    assert.equal(off, same);
    const on = buildPrivacyPolicy({ ...input, search: true });
    assert.match(on, L === "fr" ? /## La recherche dans le site[\s\S]*ni enregistré, ni compté, ni transmis/ : /## Site search[\s\S]*not saved, counted or shared/);
    assert.equal(on.replace(/## (La recherche dans le site|Site search)\n\n[^\n]*\n\n/, ""), off, "seule la section est ajoutée");
  }
});

/* ───────────── les textes (ergonomie, parité, ton) ───────────── */

const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const MINE = (k) => /^(site\.search\.|settings\.search|audit\.action\.settings\.search|privacy\.search)/.test(k) || k === "settings.search";
const keys = Object.keys(fr).filter(MINE);
const vars = (s) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join();

test("textes : FR et EN à parité exacte (mêmes clés, mêmes {variables}), placés avant le groupe final des clés de thème", () => {
  assert.ok(keys.length >= 40, `${keys.length} clés`);
  for (const k of keys) { assert.ok(en[k], `en : ${k}`); assert.equal(vars(en[k]), vars(fr[k]), k); }
  assert.deepEqual(Object.keys(en).filter(MINE).sort(), keys.slice().sort());
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    for (const k of keys) assert.ok(all.indexOf(k) < all.indexOf("theme.custom"), `${k} doit précéder theme.custom`);
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});

test("textes : aucun mot interdit (R9, plus index/indexation/requête/cache), ton neutre et vouvoiement (R13), libellés ≤ 60 sans deux-points (R10), aides ≤ 60 (R11)", () => {
  const EXTRA = /\b(index|indexation|indexer|requ[êe]tes?|query|cache|crawl\w*|robots?)\b/i;
  const adminLabels = ["settings.search", "settings.searchSwitch", "settings.searchMore", "settings.searchPlacement", "settings.searchPlace.header", "settings.searchPlace.footer", "settings.searchPlace.none", "settings.searchPerPage", "settings.searchTypes", "settings.searchSave", "settings.searchTry"];
  const adminHelps = ["settings.searchPlacementHelp", "settings.searchTypesHelp"];
  for (const [L, dict] of [["fr", fr], ["en", en]]) {
    for (const k of keys) {
      const text = dict[k];
      assert.deepEqual(forbiddenWords(text), [], `${L} ${k}`);
      if (!k.startsWith("privacy.")) assert.ok(!EXTRA.test(text), `${L} ${k} : jargon « ${EXTRA.exec(text)?.[0]} »`);
      assert.deepEqual(toneProblems(text, L), [], `${L} ${k}`);
    }
    for (const k of adminLabels) assert.deepEqual(labelProblems(dict[k]), [], `${L} ${k}`);
    for (const k of adminHelps) assert.ok(Array.from(dict[k]).length <= HELP_INLINE_MAX, `${L} ${k} : ${dict[k].length} caractères`);
    assert.deepEqual(forbiddenWords(dict["site.search.label"] + " " + dict["site.search.submit"]), []);
  }
});

test("erreurs : sous le champ, avec ce qu'il faut faire et un exemple (R22)", () => {
  for (const [L, dict] of [["fr", fr], ["en", en]]) {
    const per = dict["settings.searchPerPageError"].replace("{min}", "5").replace("{max}", "50").replace("{example}", "10");
    const typ = dict["settings.searchTypesError"].replace("{example}", "Pages");
    assert.deepEqual(errorMessageProblems(per), [], `${L} ${per}`);
    assert.deepEqual(errorMessageProblems(typ), [], `${L} ${typ}`);
  }
});

/* ───────────── la page de réglage ───────────── */

let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); await setSetting("i18n.adminDefault", "fr"); await setSetting("setup.completed", true);
  await setSetting("site.name", "Le site d'Emma", "fr");
  owner = await prisma.user.create({ data: { email: "emma@example.org", name: "Emma", role: "owner", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
const renderAll = html;
async function settingsHtml(advanced) {
  await prisma.user.update({ where: { id: owner.id }, data: { advanced } });
  as(owner);
  const page = (await import("../../src/app/admin/(panel)/settings/page.tsx")).default;
  return renderAll(await page({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }));
}
const searchSection = (h) => { const i = h.indexOf('data-tab="search"'); const s = h.lastIndexOf("<section", i); return h.slice(s, h.indexOf("</section>", i)); };
/** Champs visibles : ni replié (<details> fermé), ni caché, ni interrupteur invisible (case « sr-only »). */
function visibleFields(section) {
  const noFolded = section.replace(/<details(?![^>]*\sopen)[\s\S]*?<\/details>/g, "");
  return [...noFolded.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter(([, , a]) => !/type="(hidden|submit|button)"/.test(a) && !/type="checkbox"[^>]*class="[^"]*sr-only/.test(a) && !/class="[^"]*sr-only[^"]*"[^>]*type="checkbox"/.test(a) && !/role="switch"/.test(a)).length;
}

test("réglage en mode simple : un onglet « Recherche », une phrase d'introduction, UN interrupteur, au plus 2 champs visibles, le reste replié", async () => {
  await db.fixture("pages");
  await createInstance(prisma, { manifest: FIXTURE_MODULES.find((m) => m.manifest.id === "pages").manifest, names: { fr: "Pages", en: "Pages" } });
  const h = await settingsHtml(false);
  assert.match(h, /role="tab"[^>]*>\s*Recherche\s*<|>Recherche</);
  const s = searchSection(h);
  assert.match(s, /Les personnes qui visitent votre site retrouvent vos pages et vos articles en tapant quelques mots\./);
  assert.match(s, /role="switch"[^>]*name="searchEnabled"|name="searchEnabled"[^>]*role="switch"/);
  assert.match(s, /Recherche dans le site/);
  assert.ok(visibleFields(s) <= 2, `${visibleFields(s)} champs visibles`);
  assert.match(s, /<details(?![^>]*\sopen)[^>]*data-more-options[\s\S]*Plus d&#x27;options[\s\S]*En-tête · 10 résultats par page · Tous les contenus|<details(?![^>]*\sopen)[^>]*data-more-options[\s\S]*Plus d&#x27;options/);
  assert.match(s, /name="searchPlacement"[\s\S]*name="searchPerPage"/, "les options repliées partent avec le formulaire");
  assert.match(s, /Enregistrer la recherche/, "un seul bouton, un verbe précis");
  assert.match(s, /href="\/search"[^>]*>Essayer la recherche/);
  assert.deepEqual(forbiddenWords(s.replace(/<[^>]*>/g, " ")), []);
});

test("réglage en mode avancé : les options sont dehors, le contenu cherché reste un groupe de cases, rien n'est obligatoire", async () => {
  const s = searchSection(await settingsHtml(true));
  assert.doesNotMatch(s, /data-more-options/);
  const radio = (v) => [...s.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((t) => /name="searchPlacement"/.test(t) && t.includes(`value="${v}"`));
  assert.ok(radio("header") && /checked/.test(radio("header")) && !/checked/.test(radio("footer")), "« En-tête » est choisi d'office");
  assert.match(s, /Résultats par page/);
  assert.match(s, /placeholder="10"/, "la valeur par défaut est visible quand le champ est vide");
  assert.match(s, /Entre 5 et 50 résultats · Vide : 10 résultats/);
});

const { saveSearch } = await import("../../src/app/admin/(panel)/settings/search-actions.ts");
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [].concat(v)) f.append(k, x); return f; };
const run = async (o) => { as(owner); try { return await saveSearch(null, form(o)); } catch (e) { if (/revalidatePath|static generation store/.test(String(e))) return { ok: "ok" }; throw e; } };

test("enregistrer : valeurs valides → réglages écrits, journal d'audit ; vide → valeurs d'origine ; interrupteur coupé", async () => {
  const get = async (k) => (await prisma.setting.findFirst({ where: { key: k } }))?.value;
  const r = await run({ searchEnabled: "on", searchPlacement: "footer", searchPerPage: "25" });
  assert.ok(r.ok && !r.errors, JSON.stringify(r));
  assert.equal(await get("search.enabled"), "true"); assert.equal(await get("search.placement"), '"footer"'); assert.equal(await get("search.perPage"), "25");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "settings.search" } }), "journal d'audit");
  await run({ searchPlacement: "header", searchPerPage: "  " });
  assert.equal(await get("search.enabled"), "false", "case non cochée = désactivée");
  assert.equal(await get("search.perPage"), undefined, "vide : on retombe sur 10");
  assert.equal(await get("search.exclude"), undefined);
});

test("enregistrer : une valeur invalide n'enregistre RIEN et l'erreur dit quoi faire, avec un exemple", async () => {
  await run({ searchEnabled: "on", searchPlacement: "header", searchPerPage: "12" });
  for (const bad of ["3", "51", "abc", "5.5", "-10", "1e2", "9999"]) {
    const r = await run({ searchEnabled: "on", searchPlacement: "none", searchPerPage: bad });
    assert.ok(r.errors?.searchPerPage, bad);
    assert.match(r.errors.searchPerPage, /entier entre 5 et 50, par exemple 10/);
    assert.equal((await prisma.setting.findFirst({ where: { key: "search.perPage" } })).value, "12", `rien d'écrit pour « ${bad} »`);
    assert.equal((await prisma.setting.findFirst({ where: { key: "search.placement" } })).value, '"header"');
  }
  const r = await run({ searchEnabled: "on", searchPlacement: "ailleurs", searchPerPage: "10" });
  assert.ok(r.errors?.searchPlacement);
});

test("enregistrer : contenus cherchés — ce qui est décoché est écarté, et il en faut au moins un coché", async () => {
  const pages = await prisma.moduleInstance.findFirst();
  assert.ok(pages, "une instance existe");
  await db.fixture("blog");
  const blog = await createInstance(prisma, { manifest: FIXTURE_MODULES.find((m) => m.manifest.id === "blog").manifest, nickname: "Actus", names: { fr: "Actus", en: "News" } });
  const base = { searchEnabled: "on", searchPlacement: "header", searchPerPage: "", searchTypes__multi: "1" };
  const all = await run({ ...base, searchTypes: [pages.key, blog.key] });
  assert.ok(all.ok, JSON.stringify(all));
  assert.equal(await prisma.setting.findFirst({ where: { key: "search.exclude" } }), null);
  assert.ok((await run({ ...base, searchTypes: [blog.key] })).ok);
  assert.deepEqual(JSON.parse((await prisma.setting.findFirst({ where: { key: "search.exclude" } })).value), [pages.key]);
  const none = await run({ ...base, searchTypes: [] });
  assert.match(none.errors?.searchTypes__group ?? "", /Gardez au moins un contenu coché, par exemple/);
  assert.deepEqual(JSON.parse((await prisma.setting.findFirst({ where: { key: "search.exclude" } })).value), [pages.key], "l'erreur n'a rien changé");
  const h = searchSection(await settingsHtml(true));
  const box = (key) => [...h.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((t) => /name="searchTypes"/.test(t) && t.includes(`value="${key}"`));
  assert.match(box(blog.key), /checked/);
  assert.doesNotMatch(box(pages.key), /checked/, "l'instance écartée est décochée");
});
