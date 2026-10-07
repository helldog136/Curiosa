import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity, settingsDefaults } from "../helpers/builtinChecks.mjs";

const hero = await import("@/modules-builtin/hero");
const feeds = await import("@/modules-builtin/feeds");

// ───────── hero ─────────
test("hero : manifeste valide, section « hero » déclarée et implémentée, onboarding sur l'accueil", async () => {
  const m = await assertValidManifest(hero.manifest);
  assertDefinitionMatchesManifest(m, hero.definition);
  assertSettingsSane(m);
  assert.deepEqual(m.sections.map((s) => s.id), ["hero"]);
  assert.deepEqual(m.onboarding, { always: true, home: { section: "hero" } });
  assert.ok(m.onboarding.home.section === m.sections[0].id, "l'onboarding pointe vers une section existante");
  assert.deepEqual(hero.locales, {});
  assertLocalesParity(hero.locales);
});

test("hero : réglages — title/text traduisibles, showLogo vrai par défaut", async () => {
  const m = await assertValidManifest(hero.manifest);
  const by = Object.fromEntries(m.settings.map((s) => [s.key, s]));
  assert.equal(by.title.translatable, true);
  assert.equal(by.text.translatable, true);
  assert.equal(by.showLogo.default, true);
  assert.deepEqual(Object.keys(settingsDefaults(m)), ["showLogo"]);
});

test("hero : sans réglages, retombe sur le nom, l'accroche et le logo du site", async () => {
  const ctx = fakeCtx({ settings: { showLogo: true }, site: { name: "Mon Site", tagline: "Une accroche", logo: "/uploads/logo.png" } });
  const [b] = await hero.definition.sections.hero(ctx);
  assert.deepEqual(b, { type: "hero", title: "Mon Site", text: "Une accroche", image: "/uploads/logo.png" });
});

test("hero : les réglages priment sur le site", async () => {
  const ctx = fakeCtx({ settings: { title: "Salut", text: "Bienvenue", showLogo: true }, site: { name: "S", tagline: "T", logo: "/l.png" } });
  const [b] = await hero.definition.sections.hero(ctx);
  assert.equal(b.title, "Salut");
  assert.equal(b.text, "Bienvenue");
});

test("hero : showLogo=false ou pas de logo → pas d'image ; pas d'accroche → texte indéfini", async () => {
  let [b] = await hero.definition.sections.hero(fakeCtx({ settings: { showLogo: false }, site: { name: "S", tagline: "", logo: "/l.png" } }));
  assert.equal(b.image, undefined);
  assert.equal(b.text, undefined);
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: { showLogo: true }, site: { name: "S", tagline: "x", logo: null } }));
  assert.equal(b.image, undefined);
  // réglage absent (undefined) : pas d'image tant que le défaut n'est pas appliqué par le cœur
  [b] = await hero.definition.sections.hero(fakeCtx({ settings: {}, site: { name: "S", tagline: "", logo: "/l.png" } }));
  assert.equal(b.image, undefined);
});

test("hero : la locale du contexte est transmise à api.site", async () => {
  const seen = [];
  const ctx = fakeCtx({ locale: "fr", settings: {} });
  const orig = ctx.api.site;
  ctx.api.site = async (l) => { seen.push(l); return orig(l); };
  await hero.definition.sections.hero(ctx);
  assert.deepEqual(seen, ["fr"]);
});

test("hero : le texte saisi est renvoyé tel quel comme donnée (jamais du HTML préfabriqué)", async () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const [b] = await hero.definition.sections.hero(fakeCtx({ settings: { title: evil, text: evil }, site: { name: "S", tagline: "", logo: null } }));
  assert.equal(b.type, "hero");
  assert.equal(b.title, evil, "le bloc est une donnée ; le rendu React échappe");
  assert.equal(Object.keys(b).some((k) => /html/i.test(k)), false);
});

// ───────── feeds ─────────
const col = (key, name, basePath = key) => ({ key, name, basePath });
const entry = (o = {}) => ({ title: "T", path: "/blog/a", summary: "S", publishedAt: new Date("2026-01-02T03:04:05Z"), ...o });

test("feeds : manifeste valide, instance unique, aucune section, permissions slots+routes", async () => {
  const m = await assertValidManifest(feeds.manifest);
  assertDefinitionMatchesManifest(m, feeds.definition);
  assertSettingsSane(m);
  assert.equal(m.instances, "single");
  assert.deepEqual(m.sections, []);
  assert.deepEqual([...m.permissions].sort(), ["routes", "slots"]);
  assert.deepEqual(Object.keys(feeds.definition.routes), ["rss"]);
  assert.deepEqual(Object.keys(feeds.definition.slots), ["layout.head"]);
  assert.equal(settingsDefaults(m).limit, 20);
  assert.equal(feeds.locales, undefined);
});

async function rss(url, opts = {}) {
  const ctx = fakeCtx({ key: "feeds", locale: "en", defaultLocale: "en", locales: ["en", "fr"], ...opts });
  return { ctx, res: await feeds.definition.routes.rss(new Request(url), ctx) };
}

test("feeds : flux RSS valide pour une collection publique", async () => {
  const { res, ctx } = await rss("https://x.test/m/feeds/rss?c=blog", {
    instances: [col("blog", "Mon blog")], entries: [entry(), entry({ title: "B", path: "/blog/b" })], settings: { limit: 5 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/rss+xml; charset=utf-8");
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><rss version="2.0"><channel>/);
  assert.match(xml, /<title>Mon blog<\/title>/);
  assert.match(xml, /<language>en<\/language>/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 2);
  assert.match(xml, /<link>https:\/\/example.test\/blog\/a<\/link><guid>https:\/\/example.test\/blog\/a<\/guid>/);
  assert.match(xml, /<pubDate>Fri, 02 Jan 2026 03:04:05 GMT<\/pubDate>/);
  assert.deepEqual(ctx.calls.entries[0], { instance: "blog", locale: "en", limit: 5 });
});

test("feeds : collection inconnue, sans c, ou sans page publique → 404", async () => {
  for (const q of ["?c=nope", "", "?c="]) {
    const { res } = await rss(`https://x.test/m/feeds/rss${q}`, { instances: [col("blog", "B")] });
    assert.equal(res.status, 404, q);
  }
  const { res } = await rss("https://x.test/m/feeds/rss?c=priv", { instances: [{ key: "priv", name: "P", basePath: null }] });
  assert.equal(res.status, 404);
});

test("feeds : réglage « instances » restreint les flux publiés (espaces tolérés)", async () => {
  const instances = [col("blog", "B"), col("codes", "C")];
  let r = await rss("https://x.test/rss?c=codes", { instances, settings: { instances: " blog , other " } });
  assert.equal(r.res.status, 404);
  r = await rss("https://x.test/rss?c=blog", { instances, settings: { instances: " blog , other " } });
  assert.equal(r.res.status, 200);
  r = await rss("https://x.test/rss?c=codes", { instances, settings: { instances: "" } });
  assert.equal(r.res.status, 200);
});

test("feeds : limite bornée 1..100, 20 si absente ou invalide", async () => {
  const limitFor = async (v) => (await rss("https://x.test/rss?c=blog", { instances: [col("blog", "B")], settings: { limit: v } })).ctx.calls.entries[0].limit;
  assert.equal(await limitFor(undefined), 20);
  assert.equal(await limitFor("abc"), 20);
  assert.equal(await limitFor(0), 20);
  assert.equal(await limitFor(-5), 1);
  assert.equal(await limitFor(5000), 100);
  assert.equal(await limitFor("7"), 7);
});

test("feeds : langue — valeur autorisée respectée, inconnue → langue par défaut", async () => {
  let r = await rss("https://x.test/rss?c=blog&lang=fr", { instances: [col("blog", "B")] });
  assert.match(await r.res.text(), /<language>fr<\/language>/);
  assert.equal(r.ctx.calls.entries[0].locale, "fr");
  r = await rss(`https://x.test/rss?c=blog&lang=${encodeURIComponent('"><script>')}`, { instances: [col("blog", "B")] });
  const xml = await r.res.text();
  assert.match(xml, /<language>en<\/language>/);
  assert.doesNotMatch(xml, /<script/);
});

test("feeds : XML — titres, résumés, chemins et nom de collection échappés (pas de balise injectée)", async () => {
  const evil = `<script>alert("x")</script> & ]]>`;
  const { res } = await rss("https://x.test/rss?c=blog", {
    instances: [col("blog", evil)], entries: [entry({ title: evil, summary: evil, path: `/a?x=1&y="2"<z>` })],
  });
  const xml = await res.text();
  assert.doesNotMatch(xml, /<script>/);
  assert.doesNotMatch(xml, /<z>/);
  assert.match(xml, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; \]\]&gt;/);
  assert.match(xml, /x=1&amp;y=&quot;2&quot;&lt;z&gt;/);
});

test("feeds : entrée sans date de publication → pas de pubDate ; aucune entrée → canal vide valide", async () => {
  let r = await rss("https://x.test/rss?c=blog", { instances: [col("blog", "B")], entries: [entry({ publishedAt: null })] });
  assert.doesNotMatch(await r.res.text(), /pubDate/);
  r = await rss("https://x.test/rss?c=blog", { instances: [col("blog", "B")], entries: [] });
  const xml = await r.res.text();
  assert.doesNotMatch(xml, /<item>/);
  assert.match(xml, /<\/channel><\/rss>$/);
});

test("feeds : layout.head annonce les flux publics avec URL encodée et langue du contexte", async () => {
  const ctx = fakeCtx({ key: "feeds", locale: "fr", instances: [col("blog", "Mon blog"), { key: "priv", name: "P", basePath: null }, col("a b&c", "Codes")] });
  const [blk] = await feeds.definition.slots["layout.head"](ctx);
  assert.equal(blk.type, "head");
  assert.deepEqual(blk.tags.map((t) => t.href), ["/m/feeds/rss?c=blog&lang=fr", "/m/feeds/rss?c=a%20b%26c&lang=fr"]);
  for (const t of blk.tags) {
    assert.equal(t.tag, "link"); assert.equal(t.rel, "alternate"); assert.equal(t.type, "application/rss+xml");
  }
});

test("feeds : layout.head respecte la liste d'instances et reste vide sans collection", async () => {
  let ctx = fakeCtx({ key: "feeds", settings: { instances: "codes" }, instances: [col("blog", "B"), col("codes", "C")] });
  let [blk] = await feeds.definition.slots["layout.head"](ctx);
  assert.deepEqual(blk.tags.map((t) => t.title), ["C"]);
  ctx = fakeCtx({ key: "feeds", instances: [] });
  [blk] = await feeds.definition.slots["layout.head"](ctx);
  assert.deepEqual(blk.tags, []);
});
