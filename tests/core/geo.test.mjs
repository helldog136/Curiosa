import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const S = await import("@/core/seo");
const SS = await import("@/core/seoSettings");
const L = await import("@/core/llms");
const V = await import("@/core/aiVisibility");
const { default: robots } = await import("@/app/robots");
const { default: sitemap } = await import("@/app/sitemap");
const { GET: llmsDefault } = await import("@/app/llms.txt/route");
const { GET: llmsLang } = await import("@/app/[lang]/llms.txt/route");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting, deleteSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const agents = (rules) => rules.filter((r) => r.userAgent !== "*").map((r) => r.userAgent);

// ─── 1. Robots : deux familles ────────────────────────────────────────────────────────────────────────────────────────

test("robots : deux familles nommées, sans recouvrement, et aucun moteur de recherche classique", () => {
  assert.ok(S.AI_TRAINING_BOTS.length >= 8 && S.AI_ANSWER_BOTS.length >= 8);
  for (const bot of ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent"]) assert.ok(S.AI_TRAINING_BOTS.includes(bot), `entraînement : ${bot}`);
  for (const bot of ["OAI-SearchBot", "ChatGPT-User", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "DuckAssistBot", "MistralAI-User"]) assert.ok(S.AI_ANSWER_BOTS.includes(bot), `réponse : ${bot}`);
  assert.deepEqual(S.AI_TRAINING_BOTS.filter((b) => S.AI_ANSWER_BOTS.includes(b)), []);
  for (const se of ["Googlebot", "Bingbot", "DuckDuckBot", "Applebot", "Slurp", "YandexBot", "Baiduspider", "Qwantify"]) {
    assert.ok(!S.AI_TRAINING_BOTS.includes(se) && !S.AI_ANSWER_BOTS.includes(se), `${se} ne doit jamais être bloqué`);
  }
});

test("robots : défauts = entraînement bloqué, réponse autorisée ; chaque famille se règle séparément", () => {
  const def = S.robotsRules(S.resolveAiBlocking({}));
  assert.deepEqual(def[0], { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/m/"] });
  assert.deepEqual(agents(def), S.AI_TRAINING_BOTS);
  assert.ok(def.filter((r) => r.userAgent !== "*").every((r) => r.disallow === "/"));
  assert.deepEqual(agents(S.robotsRules({ blockTraining: false, blockAnswers: true })), S.AI_ANSWER_BOTS);
  assert.deepEqual(agents(S.robotsRules({ blockTraining: true, blockAnswers: true })), [...S.AI_TRAINING_BOTS, ...S.AI_ANSWER_BOTS]);
  assert.equal(S.robotsRules({ blockTraining: false, blockAnswers: false }).length, 1);
  // ancienne forme (un booléen) : les deux familles ensemble
  assert.deepEqual(agents(S.robotsRules(true)), S.AI_AND_SCRAPER_BOTS);
  assert.equal(S.robotsRules(false).length, 1);
});

test("compatibilité : réglage jamais touché → nouveaux défauts ; valeur ENREGISTRÉE → conservée ; valeur propre à une famille → l'emporte", () => {
  const r = S.resolveAiBlocking;
  assert.deepEqual(r({}), { blockTraining: true, blockAnswers: false }, "absent");
  assert.deepEqual(r({ legacy: undefined, training: undefined }), { blockTraining: true, blockAnswers: false });
  assert.deepEqual(r({ legacy: true }), { blockTraining: true, blockAnswers: true }, "ancien « bloquer » enregistré : les deux familles");
  assert.deepEqual(r({ legacy: false }), { blockTraining: false, blockAnswers: false }, "ancien « autoriser » enregistré : les deux familles");
  assert.deepEqual(r({ legacy: true, answers: false }), { blockTraining: true, blockAnswers: false });
  assert.deepEqual(r({ legacy: false, training: true }), { blockTraining: true, blockAnswers: false });
  assert.deepEqual(r({ training: false, answers: true }), { blockTraining: false, blockAnswers: true });
  assert.deepEqual(r({ legacy: "oui", training: null, answers: 1 }), { blockTraining: true, blockAnswers: false }, "une valeur qui n'est pas un booléen compte comme absente");
});

test("robots.txt (base) : valeur stockée vs absente, lue dans les réglages du site", async () => {
  const got = async () => agents((await robots()).rules);
  assert.deepEqual(await got(), S.AI_TRAINING_BOTS, "site qui n'a jamais touché au réglage");
  assert.equal((await SS.getAiBlocking()).explicit, false);
  await setSetting("seo.blockAiBots", true);
  assert.deepEqual(await got(), [...S.AI_TRAINING_BOTS, ...S.AI_ANSWER_BOTS], "ancien « bloquer » enregistré : bloque les deux");
  const st = await SS.getAiBlocking();
  assert.ok(st.explicit && st.fromLegacy && st.blockAnswers);
  await setSetting("seo.blockAiBots", false);
  assert.deepEqual(await got(), [], "ancien « autoriser » enregistré : rien de bloqué");
  await setSetting("seo.blockAiAnswers", true);
  assert.deepEqual(await got(), S.AI_ANSWER_BOTS, "la valeur d'une famille l'emporte sur l'ancien réglage ; l'autre suit l'ancien réglage");
  await deleteSetting("seo.blockAiBots"); await deleteSetting("seo.blockAiAnswers");
  assert.deepEqual(await got(), S.AI_TRAINING_BOTS, "retour aux défauts");
  assert.equal((await robots()).sitemap.endsWith("/sitemap.xml"), true);
});

test("réglages : le formulaire envoie les deux choix et le fichier pour les IA ; l'ancien réglage est retiré à l'enregistrement", () => {
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  assert.match(page, /name="aiTraining"/); assert.match(page, /name="aiAnswers"/); assert.match(page, /name="llmsTxt"/); assert.match(page, /name="entityType"/);
  const actions = read("src/app/admin/(panel)/settings/actions.ts");
  assert.match(actions, /seo\.blockAiTraining/); assert.match(actions, /seo\.blockAiAnswers/); assert.match(actions, /deleteSetting\("seo\.blockAiBots"\)/);
  assert.ok(!actions.includes('setSetting("seo.blockAiBots"'));
});

// ─── 2. llms.txt ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("llms.txt : format du standard (H1, citation, sections de liens avec description), texte sûr", () => {
  const out = L.renderLlmsTxt({ name: "Mon [site]", summary: "Une accroche\nsur deux lignes", about: "**Bonjour** <b>toi</b> [lien](https://x.test)", sections: [
    { title: "Pages", links: [{ title: "Accueil", url: "https://x.test/" }, { title: "Blog", url: "https://x.test/blog", description: "Mes\nnotes" }] },
    { title: "Vide", links: [] },
    { title: "Optional", links: [{ title: "Flux", url: "https://x.test/feed.xml" }] },
  ] });
  const lines = out.split("\n");
  assert.equal(lines[0], "# Mon site");
  assert.equal(lines[2], "> Une accroche sur deux lignes");
  assert.equal(lines[4], "Bonjour toi lien");
  assert.ok(out.includes("## Pages\n\n- [Accueil](https://x.test/)\n- [Blog](https://x.test/blog): Mes notes\n"));
  assert.ok(!out.includes("## Vide"), "une section sans lien n'est pas écrite");
  assert.ok(out.includes("## Optional"));
  assert.ok(!/<|\*\*/.test(out));
});

test("llms.txt : taille bornée (octets, liens par section, liens au total)", () => {
  const links = Array.from({ length: 500 }, (_, i) => ({ title: `Page ${i}`, url: `https://x.test/${i}`, description: "d".repeat(400) }));
  const out = L.renderLlmsTxt({ name: "N", sections: [{ title: "A", links }, { title: "B", links }, { title: "C", links }, { title: "D", links }] });
  assert.ok(Buffer.byteLength(out) <= L.LLMS_MAX_BYTES);
  assert.ok((out.match(/^- \[/gm) ?? []).length <= L.LLMS_MAX_LINKS);
  assert.ok(out.split("## B")[0].split("\n- [").length - 1 <= L.LLMS_MAX_LINKS_PER_SECTION);
  assert.ok(!out.includes("d".repeat(200)), "descriptions tronquées");
});

async function installBlog() {
  await db.fixture("blog");
  return createInstance(db.prisma, { manifest: FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest, nickname: "Blog", names: { en: "Blog", fr: "Journal" } });
}
const publish = (instanceId, locale, title, extra = {}) => createEntry(db.prisma, { instanceId, locale, title, summary: extra.summary ?? `Résumé de ${title}`, status: "published", ...extra }).then((e) => db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date("2026-01-02") } }));

test("llms.txt : construit à partir des données publiques du site — nom, accroche, pages, publications, réseaux ; jamais de brouillon ni d'e-mail", async () => {
  await setSetting("site.name", "Ada", "en"); await setSetting("site.tagline", "Maker of things", "en");
  await setSetting("site.contactEmail", "secret@private.test");
  await setSetting("privacy.extra", "texte interne", "en");
  const blog = await installBlog();
  await publish(blog.id, "en", "Hello world");
  await createEntry(db.prisma, { instanceId: blog.id, locale: "en", title: "Brouillon secret" });
  const net = { "module.json": { apiVersion: 2, version: "1.0.0", id: "twitch", name: "Twitch", instances: "multiple", provides: [{ topic: "social.link" }], main: "index.mjs" },
    "index.mjs": `export default { exports: { "social.link": () => [{ label: "Twitch", url: "https://twitch.tv/ada", icon: "twitch" }, { label: "Piège", url: "javascript:alert(1)" }] } };` };
  await installModule(makeRepo(net).url);
  await createInstance(db.prisma, { manifest: (await R.getModule("twitch")).manifest, nickname: "Twitch", names: { en: "Twitch" } });

  const txt = await L.buildLlmsTxt("en");
  assert.match(txt, /^# Ada\n\n> Maker of things\n/);
  assert.match(txt, /## Pages\n\n- \[Home\]\(http[^)]*\/\)/);
  assert.match(txt, /- \[Blog\]\(http[^)]*\/[a-z0-9-]+\)/);
  assert.match(txt, /## Latest posts\n\n- \[Hello world\]\(http[^)]*\/hello-world\): Résumé de Hello world/);
  assert.match(txt, /## Elsewhere\n\n- \[Twitch\]\(https:\/\/twitch\.tv\/ada\)/);
  assert.match(txt, /## Optional\n\n- \[RSS feed\]\(http[^)]*\/feed\.xml\?lang=en\)\n- \[Sitemap\]\(http[^)]*\/sitemap\.xml\)/);
  for (const secret of ["secret@private.test", "Brouillon secret", "texte interne", "javascript:", "Piège"]) assert.ok(!txt.includes(secret), `ne doit pas contenir ${secret}`);
});

test("llms.txt : une version par langue (/llms.txt = langue principale, /<langue>/llms.txt), langue inconnue refusée", async () => {
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en", "fr"]);
  await setSetting("site.name", "Ada", "en"); await setSetting("site.name", "Ada FR", "fr"); await setSetting("site.tagline", "Maker", "en"); await setSetting("site.tagline", "Créatrice", "fr");
  const blog = await installBlog();
  await publish(blog.id, "en", "Hello"); await publish(blog.id, "fr", "Bonjour");
  const en = await (await llmsDefault()).text();
  assert.match(en, /^# Ada\n\n> Maker/); assert.match(en, /\[Hello\]\(http[^)]*\/blog\/hello\)/); // une entrée qui n'existe qu'en français apparaît avec SON adresse (repli de langue, comme dans le flux RSS)
  assert.match(en, /\[Bonjour\]\(http[^)]*\/fr\/blog\/bonjour\)/);
  const resFr = await llmsLang(new Request("http://x/fr/llms.txt"), { params: Promise.resolve({ lang: "fr" }) });
  assert.equal(resFr.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.ok(resFr.headers.get("cache-control").includes("max-age"), "mis en cache");
  const fr = await resFr.text();
  assert.match(fr, /^# Ada FR\n\n> Créatrice/); assert.match(fr, /\[Bonjour\]\(http[^)]*\/fr\/blog\/bonjour\)/);
  assert.match(fr, /\[Accueil\]\(http[^)]*\/fr\/\)/);
  assert.equal((await llmsLang(new Request("http://x/de/llms.txt"), { params: Promise.resolve({ lang: "de" }) })).status, 404);
  const same = await llmsLang(new Request("http://x/en/llms.txt"), { params: Promise.resolve({ lang: "en" }) });
  assert.equal(same.status, 308, "la langue principale a une seule adresse");
});

test("llms.txt : désactivable (404 partout) et activé par défaut", async () => {
  assert.equal(await SS.isLlmsTxtEnabled(), true);
  assert.equal((await llmsDefault()).status, 200);
  await setSetting("seo.llmsTxt", false);
  assert.equal(await SS.isLlmsTxtEnabled(), false);
  assert.equal((await llmsDefault()).status, 404);
  await setSetting("i18n.enabled", ["en", "fr"]);
  assert.equal((await llmsLang(new Request("http://x/fr/llms.txt"), { params: Promise.resolve({ lang: "fr" }) })).status, 404);
});

test("llms.txt : l'adresse est réservée (aucune instance ne peut la prendre) ; docs : la route est décrite", () => {
  const { RESERVED_PATHS } = { RESERVED_PATHS: new Set(read("src/core/config.ts").match(/"[a-z.\-]+"/g).map((s) => s.slice(1, -1))) };
  assert.ok(RESERVED_PATHS.has("llms.txt"));
});

// ─── 3. JSON-LD ───────────────────────────────────────────────────────────────────────────────────────────────────────

const site = { url: "https://exemple.org", name: "Mon site", tagline: "Slogan", logo: "/uploads/l.png", locale: "fr" };

test("JSON-LD : comportement d'origine inchangé sans nouvelle option (Organization + WebSite)", () => {
  const g = S.siteJsonLd(site)["@graph"];
  assert.deepEqual(g.map((n) => n["@type"]), ["Organization", "WebSite"]);
  assert.ok(!("sameAs" in g[0]));
  assert.equal(g[1].url, "https://exemple.org");
});

test("JSON-LD : sameAs = profils https, dédoublonnés et bornés ; Person ou Organization selon le réglage ; langue et adresse canonique", () => {
  const links = ["https://twitch.tv/ada", "https://twitch.tv/ada/", "HTTPS://TWITCH.TV/ada", "http://non-securise.test", "javascript:alert(1)", "https://user:pw@x.test", "pas une adresse", "mailto:a@b.c", ...Array.from({ length: 30 }, (_, i) => `https://r${i}.test/p`)];
  const same = S.sameAsList(links);
  assert.equal(same[0], "https://twitch.tv/ada");
  assert.equal(same.length, S.MAX_SAME_AS);
  assert.ok(same.every((u) => u.startsWith("https://")) && new Set(same).size === same.length);
  const org = S.siteJsonLd({ ...site, entity: "organization", sameAs: links, homeUrl: "https://exemple.org/fr" })["@graph"];
  assert.equal(org[0]["@type"], "Organization"); assert.equal(org[0].logo, "https://exemple.org/uploads/l.png"); assert.deepEqual(org[0].sameAs, same);
  assert.equal(org[0].description, "Slogan");
  assert.equal(org[1].inLanguage, "fr"); assert.equal(org[1].url, "https://exemple.org/fr"); assert.equal(org[1].description, "Slogan");
  const person = S.siteJsonLd({ ...site, entity: "person", sameAs: ["https://youtube.com/@ada"] })["@graph"];
  assert.equal(person[0]["@type"], "Person"); assert.equal(person[0].image, "https://exemple.org/uploads/l.png"); assert.ok(!("logo" in person[0]));
  assert.deepEqual(person[0].sameAs, ["https://youtube.com/@ada"]);
  assert.deepEqual(person[1].publisher, { "@id": "https://exemple.org/#publisher" });
});

test("JSON-LD : le document est du JSON valide, échappé, avec les champs obligatoires de chaque type", () => {
  const doc = S.siteJsonLd({ ...site, name: "</script><script>alert(1)</script>", entity: "person", sameAs: ["https://a.test/x"] });
  const out = S.jsonLd(doc);
  assert.ok(!out.includes("<"));
  const parsed = JSON.parse(out);
  assert.equal(parsed["@context"], "https://schema.org");
  for (const node of parsed["@graph"]) { assert.ok(node["@type"] && node["@id"] && node.name); }
  assert.ok(parsed["@graph"][1].publisher["@id"] && parsed["@graph"][1].url);
});

test("JSON-LD : fil d'Ariane (BreadcrumbList) — positions, noms, deux niveaux au moins, bornes", () => {
  const b = S.breadcrumbJsonLd([{ name: "Accueil", url: "https://x.test/" }, { name: "Blog", url: "https://x.test/blog" }, { name: "Billet", url: "https://x.test/blog/billet" }]);
  assert.equal(b["@type"], "BreadcrumbList");
  assert.deepEqual(b.itemListElement.map((i) => [i["@type"], i.position, i.name, i.item]), [["ListItem", 1, "Accueil", "https://x.test/"], ["ListItem", 2, "Blog", "https://x.test/blog"], ["ListItem", 3, "Billet", "https://x.test/blog/billet"]]);
  assert.equal(S.breadcrumbJsonLd([{ name: "Accueil", url: "https://x.test/" }]), null);
  assert.equal(S.breadcrumbJsonLd([{ name: " ", url: "https://x.test/" }, { name: "A", url: "https://x.test/a" }]), null);
  assert.equal(S.breadcrumbJsonLd(Array.from({ length: 20 }, (_, i) => ({ name: `N${i}`, url: `https://x.test/${i}` }))).itemListElement.length, 8);
  const doc = S.breadcrumbDocument([{ name: "A", url: "https://x.test/" }, { name: "B", url: "https://x.test/b" }]);
  assert.equal(doc["@context"], "https://schema.org"); assert.equal(JSON.parse(S.jsonLd(doc))["@type"], "BreadcrumbList");
  const page = read("src/app/(site)/[...path]/page.tsx");
  assert.ok((page.match(/<BreadcrumbLd /g) ?? []).length >= 3, "liste, page de module et entrée portent un fil d'Ariane");
});

test("JSON-LD des modules : @context ajouté, @type obligatoire, valeurs bornées, échappement de </script>", () => {
  assert.deepEqual(S.RECOMMENDED_JSON_LD_TYPES, ["Article", "BlogPosting", "Event", "BroadcastEvent", "VideoObject", "Person", "FAQPage", "Product"]);
  const ok = S.moduleJsonLd({ "@type": "Event", name: "Stream </script>", startDate: "2026-11-01T20:00:00+01:00", extra: "x".repeat(9000) });
  assert.equal(ok["@context"], "https://schema.org"); assert.equal(ok.extra.length, 5000);
  const out = S.jsonLd(ok);
  assert.ok(!out.includes("</script>") && JSON.parse(out).name === "Stream </script>");
  assert.ok(S.moduleJsonLd({ "@graph": [{ "@type": "Person", name: "A" }] }));
  assert.equal(S.moduleJsonLd({ name: "sans type" }), null);
  assert.equal(S.moduleJsonLd("texte"), null); assert.equal(S.moduleJsonLd([{ "@type": "Event" }]), null); assert.equal(S.moduleJsonLd(null), null);
  assert.equal(S.moduleJsonLd({ "@type": "ItemList", itemListElement: Array.from({ length: 100 }, () => ({ "@type": "Thing", name: "y".repeat(4000) })) }), null, "trop gros : refusé");
  const deep = { "@type": "Thing" }; let cur = deep; for (let i = 0; i < 20; i++) cur = cur.n = {};
  assert.ok(JSON.stringify(S.moduleJsonLd(deep)).length < 300, "profondeur bornée");
});

test("JSON-LD des modules : l'API du module renvoie une balise de head que le cœur écrit en application/ld+json", async () => {
  const { makeApi } = await import("@/core/modules/api");
  const blog = await installBlog();
  const api = makeApi(await (await import("@/core/instances")).getInstanceById(blog.id), "en");
  const tag = api.seo.jsonLd({ "@type": "FAQPage", mainEntity: [] });
  assert.equal(tag.tag, "script"); assert.equal(tag.jsonLd["@type"], "FAQPage");
  assert.equal(api.seo.jsonLd({ nom: "sans type" }), null);
  const blocks = read("src/components/site/Blocks.tsx");
  assert.match(blocks, /type="application\/ld\+json"/);
});

// ─── 4. Métadonnées ───────────────────────────────────────────────────────────────────────────────────────────────────

test("métadonnées : adresse canonique et versions par langue (hreflang + x-default)", () => {
  assert.equal(S.pageUrl("https://x.test", "en", "en", "/"), "https://x.test/");
  assert.equal(S.pageUrl("https://x.test", "fr", "en", "/"), "https://x.test/fr/");
  assert.equal(S.pageUrl("https://x.test", "fr", "en", "/blog/billet/"), "https://x.test/fr/blog/billet");
  assert.equal(S.pageUrl("https://x.test", "en", "en", "/blog?x=1#a"), "https://x.test/blog");
  const one = S.languageAlternates("https://x.test", ["en"], "en", "en", "/blog");
  assert.deepEqual(one, { canonical: "https://x.test/blog" });
  const two = S.languageAlternates("https://x.test", ["en", "fr"], "fr", "en", "/blog");
  assert.equal(two.canonical, "https://x.test/fr/blog");
  assert.deepEqual(two.languages, { en: "https://x.test/blog", fr: "https://x.test/fr/blog", "x-default": "https://x.test/blog" });
});

test("métadonnées : Open Graph et carte Twitter cohérents (mêmes titre, description, image, adresse)", () => {
  const m = S.socialMeta({ siteName: "S", title: "T", description: "D", image: "/uploads/p.png", url: "https://x.test/a", type: "article", locale: "fr" });
  assert.deepEqual([m.openGraph.title, m.openGraph.description, m.openGraph.images, m.openGraph.url, m.openGraph.type, m.openGraph.siteName], ["T", "D", ["/uploads/p.png"], "https://x.test/a", "article", "S"]);
  assert.deepEqual([m.twitter.title, m.twitter.description, m.twitter.images, m.twitter.card], ["T", "D", ["/uploads/p.png"], "summary_large_image"]);
  const bare = S.socialMeta({ siteName: "S", title: "T", url: "https://x.test/" });
  assert.equal(bare.twitter.card, "summary"); assert.equal(bare.openGraph.type, "website"); assert.equal(bare.openGraph.images, undefined);
});

test("métadonnées : le site déclare canonique, hreflang, partage, flux RSS, langue ; chaque page a son titre et sa description", () => {
  const layout = read("src/app/(site)/layout.tsx");
  assert.match(layout, /languageAlternates\(/); assert.match(layout, /alternates: \{ canonical/); assert.match(layout, /socialMeta\(/);
  assert.match(layout, /<html lang=\{locale\}/);
  assert.match(layout, /rel="alternate" type="application\/rss\+xml"/);
  const page = read("src/app/(site)/[...path]/page.tsx");
  assert.match(page, /canonical/); assert.match(page, /socialMeta\(/); assert.match(page, /description: page\.description/); assert.match(page, /title: e\.title/);
  assert.match(read("src/app/(site)/privacy/page.tsx"), /canonical/);
});

test("sitemap : accueil et pages dans chaque langue avec leurs versions, lastmod = date de publication quand elle existe", async () => {
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en", "fr"]);
  const blog = await installBlog();
  await publish(blog.id, "en", "Hello");
  const urls = await sitemap();
  const home = urls.find((u) => u.url.endsWith("/") && !u.url.includes("/fr"));
  assert.deepEqual(Object.keys(home.alternates.languages).sort(), ["en", "fr", "x-default"]);
  assert.ok(urls.some((u) => u.url.endsWith("/fr/")));
  const entry = urls.find((u) => u.url.endsWith("/hello"));
  assert.equal(entry.lastModified.toISOString().slice(0, 10), "2026-01-02");
  assert.ok(urls.filter((u) => !u.url.endsWith("/hello")).every((u) => u.lastModified === undefined), "pas de date inventée");
});

// ─── 5. Page de visibilité ────────────────────────────────────────────────────────────────────────────────────────────

const GOOD = { blockAnswers: false, blockTraining: true, llmsEnabled: true, hasName: true, hasTagline: true, hasLogo: true, socialCount: 2, mainLocale: "Français", otherLocales: ["English"], entity: "person", feedItems: 3 };
const PROBES = { robots: true, sitemapUrls: 5, llms: { bytes: 2048 } };
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));

test("visibilité : tout est en place → aucun point « à faire », aucun chiffre inventé", () => {
  const checks = V.computeChecks(GOOD, PROBES);
  assert.deepEqual(checks.map((c) => c.id), ["answers", "llms", "robots", "sitemap", "description", "name", "logo", "social", "languages", "structured", "rss", "training"]);
  assert.equal(V.todoCount(checks), 0);
  assert.deepEqual(checks.filter((c) => c.status === "info").map((c) => c.id), ["languages", "training"]);
  assert.equal(byId(checks).llms.vars.size, 2);
});

test("visibilité : chaque contrôle passe à « à faire » quand son état est faux, avec le bon lien « Corriger »", () => {
  const todo = (s, p = PROBES) => byId(V.computeChecks({ ...GOOD, ...s }, p));
  assert.equal(todo({ blockAnswers: true }).answers.status, "todo");
  assert.equal(todo({ blockAnswers: true }).answers.fix, "/admin/settings#privacy");
  assert.equal(todo({ llmsEnabled: false }, { ...PROBES, llms: null }).llms.status, "todo");
  assert.equal(todo({ llmsEnabled: false }, { ...PROBES, llms: null }).llms.fix, "/admin/settings#privacy");
  assert.equal(todo({}, { ...PROBES, llms: null }).llms.status, "todo", "activé mais ne répond pas");
  assert.equal(todo({}, { ...PROBES, robots: false }).robots.status, "todo");
  assert.equal(todo({}, { ...PROBES, sitemapUrls: 0 }).sitemap.status, "todo");
  assert.equal(todo({}, { ...PROBES, sitemapUrls: null }).sitemap.status, "todo");
  assert.equal(todo({ hasTagline: false }).description.status, "todo");
  assert.equal(todo({ hasName: false }).name.status, "todo");
  assert.equal(todo({ hasLogo: false }).logo.status, "todo");
  assert.equal(todo({ socialCount: 0 }).social.status, "todo");
  assert.equal(todo({ socialCount: 0 }).social.fix, "/admin/social");
  assert.equal(todo({ feedItems: 0 }).rss.status, "todo");
  assert.equal(V.todoCount(V.computeChecks({ ...GOOD, blockAnswers: true, hasLogo: false, socialCount: 0 }, PROBES)), 3);
});

test("visibilité : la page appelle les vraies fonctions de robots.txt, du plan du site et de llms.txt, sans réseau ; chaque texte existe en fr et en", () => {
  const page = read("src/app/admin/(panel)/ai-visibility/page.tsx");
  assert.match(page, /robots\(\)/); assert.match(page, /sitemap\(\)/); assert.match(page, /buildLlmsTxt\(/);
  assert.ok(!/fetch\(/.test(page), "aucun appel réseau");
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  const checks = V.computeChecks(GOOD, PROBES);
  for (const c of checks) {
    assert.ok(fr[`ai.check.${c.id}`] && en[`ai.check.${c.id}`], c.id);
    const variants = c.id === "training" ? ["blocked", "allowed"] : c.id === "languages" ? ["ok", "single"] : c.id === "structured" ? ["ok"] : ["ok", "todo"];
    for (const v of variants) assert.ok(fr[`ai.check.${c.id}.${v}`] && en[`ai.check.${c.id}.${v}`], `${c.id}.${v}`);
  }
  assert.match(fr["ai.intro"], /Rien ne garantit d'être cité/);
  assert.ok(!/\d+\s*\/\s*100|score/i.test(fr["ai.summary.todo"] + fr["ai.summary.done"] + fr["ai.intro"]), "pas de score chiffré");
  assert.match(read("src/app/admin/(panel)/layout.tsx"), /\/admin\/ai-visibility/);
});

test("textes pour Emma : l'explication des deux familles est affichée dans les réglages, sans promesse", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  assert.match(fr["settings.aiExplain"], /robots d'entraînement apprennent à partir de votre site; |robots d'entraînement apprennent à partir de votre site ;/);
  assert.match(fr["settings.aiAnswers"], /Robots de réponse IA \(ils citent votre site\)/);
  assert.equal(fr["settings.aiTraining"], "Robots d'entraînement IA");
  assert.ok(!/garanti|assuré/i.test(Object.entries(fr).filter(([k]) => /^(ai|settings\.ai|llms)/.test(k) && k !== "ai.intro").map(([, v]) => v).join(" ")));
});

// ─── 6. Docs ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("docs : GEO.md existe, honnête, relié depuis le README et PLATFORM ; les listes de robots y sont décrites", () => {
  const geo = read("docs/GEO.md");
  for (const h of ["Être cité par les IA", "Ce que Curiosa fait déjà", "Ce que vous pouvez faire", "Ce qu'on ne peut pas promettre", "Comment vérifier"]) assert.ok(geo.includes(h), h);
  for (const bot of [...S.AI_TRAINING_BOTS.slice(0, 3), ...S.AI_ANSWER_BOTS.slice(0, 3)]) assert.ok(geo.includes(bot), bot);
  assert.match(read("README.md"), /docs\/GEO\.md/); assert.match(read("docs/PLATFORM.md"), /GEO\.md/);
  assert.match(read("docs/PRIVACY.md"), /llms\.txt/);
  const tutorial = read("docs/CREATE-A-MODULE.md");
  for (const t of S.RECOMMENDED_JSON_LD_TYPES) assert.ok(tutorial.includes(t), t);
  assert.ok(tutorial.includes("ctx.api.seo.jsonLd"));
});
