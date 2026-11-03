// RECHERCHE DANS LE SITE — le texte (pur) : repli des accents et de la casse sans changer la longueur, lecture bornée de la saisie, mise en évidence,
// extrait, classement. Aucune base de données ici ; les cas d'usage complets sont dans search-service.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const T = await import("@/core/search/text");
const { rankDocs, isOwnAddress, MAX_RESULTS } = await import("@/core/search/rank");
const { docFromParts } = await import("@/core/search/index");
const { excerptFor } = await import("@/core/search/excerpt");
const { Marked } = await import("@/components/site/SearchForm");

test("le repli ne change JAMAIS la longueur : une position trouvée dans le texte plié est la bonne dans l'original", () => {
  for (const s of ["Été à Nîmes", "ŒUVRE", "Łódź ø đ ß ı", "İstanbul", "áb", "emoji 😀 é", "한국어 é", "l’été", "nbsp é", "", "ASCII only"]) {
    assert.equal(T.fold(s).length, s.length, JSON.stringify(s));
  }
});

test("insensible à la casse et aux accents, dans les deux sens", () => {
  assert.equal(T.fold("Été À Nîmes ÇA"), "ete a nimes ca");
  assert.equal(T.fold("ete a nimes ca"), "ete a nimes ca");
  assert.equal(T.fold("l’été"), "l'ete", "l'apostrophe typographique et l'apostrophe droite sont la même");
  assert.equal(T.fold("Łódź"), "lodz");
});

test("saisie : vide, espaces, signes seuls et valeurs étranges ne cherchent rien (et ne lèvent jamais)", () => {
  for (const raw of [undefined, null, "", "   ", "\t\n", "---", "!!! ???", 42, {}, [], [""], ["  "], "\u0000\u0007"]) assert.deepEqual(T.parseQuery(raw), { kind: "empty" }, JSON.stringify(raw));
});

test("saisie : un paramètre répété ne garde que le premier ; les caractères de contrôle et les guillemets séparent", () => {
  assert.deepEqual(T.parseQuery(["Été", "autre"]), { kind: "query", shown: "Été", words: ["ete"], trimmed: false });
  assert.deepEqual(T.parseQuery("un\u0000deux\u0007trois").words, ["un", "deux", "trois"]);
  assert.deepEqual(T.parseQuery('"deux mots" « trois »').words, ["deux", "mots", "trois"]);
});

test("saisie : bornée à 100 caractères, 6 mots, 40 caractères par mot, sans doublon ; la page est prévenue", () => {
  const long = T.parseQuery("a".repeat(5000));
  assert.equal(long.kind, "query");
  assert.ok(long.shown.length <= T.QUERY_MAX_CHARS && long.trimmed);
  assert.ok(long.words.every((w) => w.length <= T.WORD_MAX_CHARS));
  const many = T.parseQuery("un deux trois quatre cinq six sept huit");
  assert.equal(many.words.length, T.QUERY_MAX_WORDS);
  assert.equal(many.trimmed, true);
  assert.deepEqual(T.parseQuery("Chat chat CHAT chât").words, ["chat"], "mêmes mots après repli : un seul");
  assert.equal(T.parseQuery("court").trimmed, false);
});

test("saisie : les caractères spéciaux sont du texte ordinaire (jamais une expression régulière, jamais du HTML)", () => {
  for (const s of [".*", "(a|b)+", "[a-z", "\\", "a{2,", "<script>alert(1)</script>", "'; DROP TABLE Entry; --", "%00", "${x}", "{n}", "$&", "^$"]) {
    const q = T.parseQuery(s);
    if (q.kind === "empty") continue; // « .* » ne contient aucune lettre
    assert.doesNotThrow(() => T.highlight("Du texte avec <b>balises</b> et (a|b)+ et .* et {n}", q.words), s);
    assert.doesNotThrow(() => T.snippet("Du texte avec (a|b)+", q.words), s);
  }
});

test("mise en évidence : les accents et la casse d'ORIGINE sont conservés, les occurrences qui se chevauchent sont fusionnées", () => {
  assert.deepEqual(T.highlight("Été à Nîmes", ["ete", "nimes"]), [{ text: "Été", hit: true }, { text: " à ", hit: false }, { text: "Nîmes", hit: true }]);
  assert.deepEqual(T.highlight("abcabc", ["abc", "bca"]), [{ text: "abcabc", hit: true }]);
  assert.deepEqual(T.highlight("rien", ["x"]), [{ text: "rien", hit: false }]);
  assert.deepEqual(T.highlight("", ["x"]), []);
  assert.equal(T.highlight("Du texte", ["texte"]).map((s) => s.text).join(""), "Du texte", "le texte recomposé est celui d'origine");
});

test("échappement : un titre piégé reste du TEXTE dans le HTML produit (React échappe, aucune balise ne sort)", () => {
  const evil = '<img src=x onerror=alert(1)> "quote" & <script>boom()</script>';
  const html = renderToStaticMarkup(React.createElement(Marked, { segments: T.highlight(evil, ["quote", "boom"]) }));
  assert.ok(!/<img|<script/i.test(html), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<mark data-skin-part="mark"[^>]*>quote<\/mark>/);
  assert.match(html, /&lt;script&gt;<mark[^>]*>boom<\/mark>\(\)&lt;\/script&gt;/);
});

test("extrait : autour du premier terme, coupé aux espaces, « … » aux coupes, jamais plus long que prévu", () => {
  const text = "Début du texte. ".repeat(30) + "Le mot rare se trouve ici. " + "Fin du texte. ".repeat(30);
  const seg = T.snippet(text, ["rare"]);
  const flat = seg.map((s) => s.text).join("");
  assert.ok(flat.startsWith("… ") && flat.endsWith(" …"), flat);
  assert.ok(seg.some((s) => s.hit && s.text === "rare"));
  assert.ok(flat.length <= T.SNIPPET_CHARS + 6, flat.length);
  assert.deepEqual(T.snippet("", ["x"]), []);
  const start = T.snippet("Un texte court", ["absent"]);
  assert.equal(start.map((s) => s.text).join(""), "Un texte court");
});

test("texte brut d'un contenu Markdown : sans symboles, images, code ni balises", () => {
  assert.equal(T.plainText("# Titre\n\nUn [lien](https://x.y) et **gras** `code` ![img](a.png) <b>html</b>\n\n```js\ncacher()\n```\n- item"), "Titre Un lien et gras code html item");
});

test("extrait d'un résultat : le résumé s'il contient le mot, sinon le passage du corps, sinon le début", () => {
  const flat = (s) => s.map((x) => x.text).join("");
  assert.equal(flat(excerptFor("Un résumé avec Kiwi.", "Corps sans rapport.", ["kiwi"])), "Un résumé avec Kiwi.");
  assert.match(flat(excerptFor("Un résumé.", "Le corps parle du kiwi.", ["kiwi"])), /kiwi/);
  assert.equal(flat(excerptFor("Un résumé.", "Le corps.", ["absent"])), "Un résumé.");
  assert.equal(flat(excerptFor("", "Le corps seul.", ["absent"])), "Le corps seul.");
});

const doc = (id, title, summary = "", body = "", date = null, extra = {}) =>
  docFromParts({ id, kind: "entry", typeKey: "blog", typeLabel: "Blog", title, summary, body, url: `/blog/${id}`, external: false, locale: "fr", publishedAt: date ? new Date(date) : null, ...extra });

test("classement : titre, puis résumé, puis texte ; à égalité le plus récent ; ordre toujours le même", () => {
  const docs = [
    doc("corps", "Autre sujet", "Rien", "On parle de la mangue dans le texte", "2026-03-01"),
    doc("resume", "Encore autre", "Une mangue au résumé", "", "2026-02-01"),
    doc("titre-vieux", "Mangue d'hiver", "", "", "2026-01-01"),
    doc("titre-recent", "La MANGUE", "", "", "2026-04-01"),
    doc("sans-date", "Mangue sans date", "", "", null),
    doc("absent", "Banane", "Pas de fruit rouge", "", "2026-05-01"),
  ];
  const r = rankDocs(docs, ["mangue"]);
  assert.deepEqual(r.hits.map((h) => h.doc.id), ["titre-recent", "titre-vieux", "sans-date", "resume", "corps"]);
  assert.deepEqual(r.hits.map((h) => h.rank), [0, 0, 0, 1, 2]);
  assert.equal(r.total, 5);
  assert.deepEqual(rankDocs([...docs].reverse(), ["mangue"]).hits.map((h) => h.doc.id), r.hits.map((h) => h.doc.id), "même résultat quel que soit l'ordre d'arrivée");
});

test("classement : chaque mot doit être trouvé quelque part (titre, résumé, étiquettes ou texte), sans accents ni casse", () => {
  const docs = [doc("a", "Voyage à Nîmes", "Un été chaud", "Arènes et jardins"), doc("b", "Voyage à Lyon", "Un été doux", ""), doc("c", "Nîmes", "", "voyage")];
  assert.deepEqual(rankDocs(docs, ["voyage", "nimes"]).hits.map((h) => h.doc.id).sort(), ["a", "c"]);
  assert.deepEqual(rankDocs(docs, ["ETE"].map(T.fold)).hits.map((h) => h.doc.id).sort(), ["a", "b"]);
  assert.deepEqual(rankDocs(docs, []).hits, []);
  const tagged = docFromParts({ id: "t", kind: "entry", typeKey: "b", typeLabel: "B", title: "Sans lien", summary: "", tags: ["Cuisine"], url: "/t", external: false, locale: "fr", publishedAt: null });
  assert.equal(rankDocs([tagged], ["cuisine"]).hits[0].rank, 1, "une étiquette compte comme le résumé");
});

// Le contenu du site d'abord, puis ce qui mène ailleurs (YouTube, réseaux…) : voir rank.ts.
const SITE = "https://helldog136.be";
const item = (id, title, url, date, extra = {}) =>
  docFromParts({ id: `item:${id}`, kind: "item", typeKey: "yt", typeLabel: "YouTube", title, summary: "", url, external: !isOwnAddress(url, SITE), own: isOwnAddress(url, SITE), locale: "fr", publishedAt: date ? new Date(date) : null, ...extra });
const ids = (r) => r.hits.map((h) => h.doc.id);

test("adresse du site : relative ou même domaine (www ignoré) ; tout autre domaine, sous-domaines compris, est ailleurs", () => {
  for (const u of ["/fr/blog/x", "/", "https://helldog136.be/a", "http://helldog136.be/a", "https://www.helldog136.be/a", "https://HELLDOG136.be:8443/a"]) assert.equal(isOwnAddress(u, SITE), true, u);
  for (const u of ["https://www.youtube.com/watch?v=1", "https://autre.helldog136.be/x", "https://helldog136.be.evil.example/x", "//helldog136.be/x", "mailto:a@helldog136.be", "javascript:alert(1)", "n'importe quoi", ""]) assert.equal(isOwnAddress(u, SITE), false, u);
  assert.equal(isOwnAddress("https://helldog136.be/a", "pas une adresse"), false, "site mal configuré : rien n'est dit « du site » à tort");
  assert.equal(isOwnAddress("https://helldog136.be/a", "https://www.helldog136.be"), true, "le site peut être configuré avec www");
});

test("classement : le contenu du site passe avant les externes, même plus récents et mieux placés (titre contre corps)", () => {
  const docs = [
    item("v1", "Tesla : la vidéo", "https://www.youtube.com/watch?v=1", "2026-10-30"),
    item("v2", "Tesla en test", "https://www.youtube.com/watch?v=2", "2026-10-29"),
    item("v3", "Tesla, suite", "https://www.youtube.com/watch?v=3", "2026-10-28"),
    doc("page", "Mes partenariats", "", "Tesla : recevez des réductions", "2026-01-01"),
    doc("article", "Autre", "Parle de Tesla", "", "2025-06-01"),
  ];
  const r = rankDocs(docs, ["tesla"]);
  assert.deepEqual(ids(r), ["article", "page", "item:v1", "item:v2", "item:v3"], "site (résumé, puis texte), puis externes (titre, plus récent d'abord)");
  assert.equal(r.total, 5);
  assert.deepEqual(ids(rankDocs([...docs].reverse(), ["tesla"])), ids(r), "même ordre quel que soit l'ordre d'arrivée");
});

test("classement : un élément à adresse relative est du site ; un sous-domaine est ailleurs ; un élément du même domaine est du site", () => {
  const docs = [
    item("ext", "Tesla externe", "https://autre.helldog136.be/t", "2026-10-30"),
    item("rel", "Tesla interne", "/agenda/tesla", "2020-01-01"),
    item("dom", "Tesla même domaine", "https://helldog136.be/t", "2021-01-01"),
  ];
  assert.deepEqual(ids(rankDocs(docs, ["tesla"])), ["item:dom", "item:rel", "item:ext"]);
  assert.deepEqual(docs.map((d) => d.own), [false, true, true]);
});

test("classement : une entrée du cœur est du site même si son lien mène ailleurs (instance de liens)", () => {
  const lien = doc("lien", "Tesla (lien)", "", "", "2020-01-01", { url: "https://www.youtube.com/x", external: true });
  assert.equal(lien.own, true);
  assert.deepEqual(ids(rankDocs([item("v", "Tesla vidéo", "https://www.youtube.com/y", "2026-10-30"), lien], ["tesla"])), ["lien", "item:v"]);
});

test("classement : égalité complète à l'intérieur d'un groupe → titre puis identifiant ; groupe unique inchangé ; aucun résultat", () => {
  const same = [item("b", "Tesla", "https://youtu.be/b", "2026-01-01"), item("a", "Tesla", "https://youtu.be/a", "2026-01-01")];
  assert.deepEqual(ids(rankDocs(same, ["tesla"])), ["item:a", "item:b"]);
  const only = [item("old", "Tesla A", "https://youtu.be/o", "2025-01-01"), item("new", "Tesla B", "https://youtu.be/n", "2026-01-01")];
  assert.deepEqual(ids(rankDocs(only, ["tesla"])), ["item:new", "item:old"], "des externes seuls gardent le classement habituel");
  assert.deepEqual(rankDocs(same, ["absent"]), { hits: [], total: 0 });
});

test("classement : le plafond coupe les externes d'abord, jamais le contenu du site", () => {
  const docs = [...Array.from({ length: 150 }, (_, i) => item(`v${i}`, `Mot ${i}`, `https://youtu.be/${i}`, "2026-10-01")), ...Array.from({ length: 150 }, (_, i) => doc(`p${String(i).padStart(3, "0")}`, `Mot ${i}`, "", "", "2020-01-01"))];
  const r = rankDocs(docs, ["mot"]);
  assert.equal(r.hits.length, MAX_RESULTS); assert.equal(r.total, 300);
  assert.equal(r.hits.filter((h) => h.doc.own).length, 150, "les 150 du site sont tous gardés");
});

test("classement : plafonné à MAX_RESULTS résultats parcourables, le total reste exact", () => {
  const docs = Array.from({ length: 1000 }, (_, i) => doc(`d${String(i).padStart(4, "0")}`, `Mot ${i}`, "", "", "2026-01-01"));
  const r = rankDocs(docs, ["mot"]);
  assert.equal(r.hits.length, MAX_RESULTS);
  assert.equal(r.total, 1000);
});

test("une fiche plafonne ses textes : titre 200, résumé 600, corps 3 000 caractères", () => {
  const d = doc("x", "t".repeat(900), "s".repeat(5000), "c".repeat(100000));
  assert.equal(d.title.length, 200);
  assert.equal(d.summary.length, 600);
  assert.equal(d.fBody.length, 3000);
  assert.equal(d.fTitle.length, d.title.length, "le texte plié a la longueur de l'original");
});
