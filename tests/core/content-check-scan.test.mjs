// Contrôle du contenu — ce que le cœur trouve en lisant SA base directement : images sans texte, titres, résumés, traductions, menu, liens, fichiers, accueil.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { scanContent, LIMITS } = await import("@/core/maintenance/content/scan");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const { fixHref } = await import("@/core/maintenance/content/fix");

beforeEach(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr", "en"]);
  await setSetting("site.name", "Mon site", "fr");
});
after(() => db.close());

const manifest = (id) => FIXTURE_MODULES.find((m) => m.manifest.id === id).manifest;
async function blog(extra = {}) {
  await db.fixture("blog");
  const i = await createInstance(db.prisma, { manifest: manifest("blog"), names: { fr: "Blog", en: "Blog" } });
  if (extra.fallbackToDefault === false) await db.prisma.moduleInstance.update({ where: { id: i.id }, data: { fallbackToDefault: false } });
  return i;
}
async function pages() {
  await db.fixture("pages");
  return createInstance(db.prisma, { manifest: manifest("pages"), basePath: "", names: { fr: "Pages", en: "Pages" } });
}
const publish = async (instance, input) => {
  const e = await createEntry(db.prisma, { instanceId: instance.id, locale: "fr", status: "published", ...input });
  await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - 1000) } });
  return e;
};
const addTranslation = (instance, entry, locale, data) => db.prisma.entryTranslation.create({ data: { entryId: entry.id, instanceId: instance.id, locale, slug: data.slug ?? `${locale}-${entry.id}`, title: data.title, summary: data.summary ?? "", body: data.body ?? "" } });
const scan = (o = {}) => scanContent({ checkLinks: true, maxLinks: 200, cursor: 0, skipHosts: new Set(), ...o });
const group = (r, id, loc = null) => r.groups.find((g) => g.id === id && g.loc === loc);
const ids = (r) => r.groups.map((g) => g.id).sort();
const LONG = "Un texte assez long pour compter comme du vrai contenu à traduire.";

test("images : sans texte alternatif (Markdown vide, <img> sans alt) signalées ; un alt=\"\" écrit exprès est respecté ; code ignoré ; images d'ailleurs récoltées", async () => {
  const p = await pages();
  const body = ["![](https://img.example.org/a.png)", "![ma photo](https://img.example.org/b.png)", '<img src="https://img.example.org/c.png">', '<img src="https://img.example.org/d.png" alt="">', '<img src="https://img.example.org/e.png" alt="Un chat">', "`![](https://img.example.org/code.png)`"].join("\n\n");
  await publish(p, { title: "Galerie", summary: "Résumé", body });
  const r = await scan();
  const g = group(r, "alt", "fr");
  assert.equal(g.sev, "important");
  assert.equal(g.count, 1, "une page");
  assert.equal(g.total, 2, "deux images sans description : la vide et celle sans attribut alt");
  assert.deepEqual(g.items[0].d, ["imgs", 2]);
  const imgs = r.links.filter((l) => l.k === "image").map((l) => l.u).sort();
  assert.deepEqual(imgs, ["https://img.example.org/a.png", "https://img.example.org/b.png", "https://img.example.org/c.png", "https://img.example.org/d.png", "https://img.example.org/e.png"], "chaque image distante est à visiter ; pas celle du bloc de code");
  assert.equal(r.stats.images, 5);
});

test("titres : un titre vide est important ; deux pages au même titre (accents et casse ignorés) sont conseillées ; une rubrique ne se mélange pas avec une autre", async () => {
  const b = await blog(); const p = await pages();
  await publish(b, { title: "Mon voyage à Gand", summary: "r", body: LONG });
  await publish(b, { title: "mon voyage a gand", summary: "r", body: LONG });
  await publish(p, { title: "Mon voyage à Gand", summary: "r", body: LONG });
  await publish(p, { title: "   ", summary: "r", body: LONG });
  const r = await scan();
  const dup = group(r, "title_dup", "fr");
  assert.equal(dup.count, 2, "les deux du blog, pas celle des pages");
  assert.equal(dup.sev, "advised");
  const empty = group(r, "title_empty", "fr");
  assert.deepEqual([empty.sev, empty.count, empty.items[0].t], ["important", 1, ""]);
});

test("résumé (description pour les moteurs) : manquant pour une page à elle, jamais pour une liste de liens sortants", async () => {
  const b = await blog();
  await publish(b, { title: "Sans résumé", body: LONG });
  await publish(b, { title: "Avec résumé", summary: "Un résumé", body: LONG });
  await db.fixture("links");
  const l = await createInstance(db.prisma, { manifest: manifest("links"), names: { fr: "Liens", en: "Links" } });
  await publish(l, { title: "Mon Twitch", url: "https://twitch.example.org/moi" });
  const r = await scan();
  const g = group(r, "summary", "fr");
  assert.equal(g.count, 1);
  assert.equal(g.items[0].t, "Sans résumé");
  assert.ok(r.links.some((x) => x.u === "https://twitch.example.org/moi"), "l'adresse d'un lien sortant est à visiter");
});

test("traductions : manquante, identique à l'origine, avec les VRAIES langues de chaque entrée ; une vraie traduction est tranquille ; sans repli, la page disparaît", async () => {
  const b = await blog();
  const missing = await publish(b, { title: "Seulement en français", summary: "r", body: LONG });
  const same = await publish(b, { title: "Identique", summary: "r", body: LONG });
  await addTranslation(b, same, "en", { title: "Identique", summary: "r", body: LONG });
  const done = await publish(b, { title: "Traduite", summary: "r", body: LONG });
  await addTranslation(b, done, "en", { title: "Translated", summary: "s", body: "A long enough translated text for the test." });
  await publish(b, { title: "Court", summary: "", body: "ok" }); // trop court pour qu'une traduction compte
  const r = await scan();
  const m = group(r, "translation_missing", "en");
  assert.equal(m.count, 1);
  assert.deepEqual(m.items[0].d, ["fallback", "fr"], "les visiteurs anglais voient le texte d'origine ; langues réelles : fr");
  assert.equal(m.items[0].t, "Seulement en français");
  const s = group(r, "translation_same", "en");
  assert.equal(s.count, 1);
  assert.deepEqual(s.items[0].d, ["same", "fr, en"]);
  assert.equal(r.notes.multi, true);
  void missing;
  // Sans repli de langue : la page n'existe pas du tout en anglais.
  await db.prisma.moduleInstance.update({ where: { id: b.id }, data: { fallbackToDefault: false } });
  assert.equal(group(await scan(), "translation_missing", "en").items[0].d[0], "hidden");
  // Un site à une seule langue ne signale jamais de traduction.
  await setSetting("i18n.enabled", ["fr"]);
  const mono = await scan();
  assert.ok(!mono.groups.some((x) => x.id.startsWith("translation")));
  assert.equal(mono.notes.multi, false);
});

test("liens internes : cassés (entrée, rubrique, raccourci éteint) ; valides (entrée, langue, raccourci actif) ; page expirée liée ; liens vers des fichiers envoyés", async () => {
  const b = await blog(); const p = await pages();
  const live = await publish(b, { title: "Existe", summary: "r", body: LONG });
  const old = await publish(b, { title: "Offre finie", summary: "r", body: LONG });
  await db.prisma.entry.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
  const draft = await createEntry(db.prisma, { instanceId: b.id, locale: "fr", title: "Brouillon", status: "draft" });
  await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.example.org/moi", active: true } });
  await db.prisma.redirect.create({ data: { path: "ancien", targetUrl: "https://example.org/", active: false } });
  const slug = (await db.prisma.entryTranslation.findFirst({ where: { entryId: live.id } })).slug;
  const oldSlug = (await db.prisma.entryTranslation.findFirst({ where: { entryId: old.id } })).slug;
  const draftSlug = (await db.prisma.entryTranslation.findFirst({ where: { entryId: draft.id } })).slug;
  fs.mkdirSync(path.join(db.dir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(db.dir, "uploads", "11111111-1111-1111-1111-111111111111.png"), "x");
  const body = [
    `[ok](/blog/${slug})`, `[en anglais](/en/blog/${slug})`, "[liste](/blog)", "[cassé](/blog/disparu)", `[brouillon](/blog/${draftSlug})`, `[offre](/blog/${oldSlug})`,
    "[raccourci](/twitch)", "[éteint](/ancien)", "[inconnu](/nimporte-quoi)", "[admin](/admin/login)", "[ancre](#haut)", "[mail](mailto:a@example.org)",
    "![présent](/uploads/11111111-1111-1111-1111-111111111111.png)", "![absent](/uploads/22222222-2222-2222-2222-222222222222.png)", "[pdf](/uploads/33333333-3333-3333-3333-333333333333.png)",
  ].join(" ");
  await publish(p, { title: "Page des liens", summary: "r", body });
  const r = await scan();
  const broken = group(r, "internal", "fr");
  assert.deepEqual(broken.items.map((i) => i.d[1]).sort(), ["/ancien", "/blog/" + draftSlug, "/blog/disparu", "/nimporte-quoi"].sort(), "cassés : disparu, brouillon, raccourci éteint, inconnu — pas les valides");
  assert.equal(broken.sev, "important");
  const expired = group(r, "expired_linked", "fr");
  assert.deepEqual([expired.sev, expired.count, expired.items[0].d[1]], ["advised", 1, `/blog/${oldSlug}`]);
  const up = group(r, "upload_missing", "fr");
  assert.deepEqual(up.items.map((i) => i.d[1]).sort(), ["22222222-2222-2222-2222-222222222222.png", "33333333-3333-3333-3333-333333333333.png"]);
});

test("image de couverture : fichier envoyé absent signalé, image distante à visiter, couverture sans aucun texte signalée pour info", async () => {
  const b = await blog();
  await publish(b, { title: "Belle couverture", summary: "r", body: LONG, cover: "/uploads/44444444-4444-4444-4444-444444444444.jpg" });
  await publish(b, { title: "Couverture distante", summary: "r", body: LONG, cover: "https://img.example.org/cover.jpg" });
  const lonely = await publish(b, { title: "x", summary: "", body: "", cover: "https://img.example.org/seule.jpg" });
  await db.prisma.entryTranslation.update({ where: { entryId_locale: { entryId: lonely.id, locale: "fr" } }, data: { title: "" } });
  const r = await scan();
  assert.equal(group(r, "upload_missing", "fr").count, 1);
  assert.ok(r.links.some((l) => l.u === "https://img.example.org/cover.jpg" && l.k === "image"));
  const alone = group(r, "cover_alone", "fr");
  assert.deepEqual([alone.sev, alone.count], ["info", 1]);
});

test("menu : éléments vers une page disparue, adresse externe visitée, menu vide ; une rubrique du menu automatique compte", async () => {
  const b = await blog(); const p = await pages();
  const about = await publish(p, { title: "À propos", slug: "a-propos", summary: "r", body: LONG });
  void about;
  await setSetting("nav.custom", [
    { label: { fr: "À propos" }, href: "/a-propos" },
    { label: { fr: "Disparue" }, href: "/page-disparue" },
    { label: { fr: "Groupe" }, href: "", children: [{ label: { fr: "Dedans" }, href: "/blog" }, { label: { fr: "Dehors" }, href: "/blog/nexiste-pas" }, { label: { fr: "Ailleurs" }, href: "https://ailleurs.example.org/" }] },
  ]);
  await setSetting("header.buttonLabel", "Contact", "fr");
  await setSetting("header.buttonHref", "/contact-disparu");
  const r = await scan();
  const g = group(r, "menu_broken");
  assert.equal(g.sev, "important");
  assert.deepEqual(g.items.map((i) => i.d[1]).sort(), ["/blog/nexiste-pas", "/contact-disparu", "/page-disparue"]);
  assert.deepEqual(g.items.find((i) => i.d[1] === "/page-disparue").f, ["n"]);
  assert.deepEqual(g.items.find((i) => i.d[1] === "/contact-disparu").f, ["s", "appearance"]);
  assert.ok(r.links.some((l) => l.u === "https://ailleurs.example.org/"), "un lien externe du menu est visité");
  assert.ok(!group(r, "menu_empty"));
  // Menu vide : ni rubrique affichée dans le menu, ni élément libre.
  await setSetting("nav.custom", []);
  await db.prisma.moduleInstance.update({ where: { id: b.id }, data: { showInNav: false } });
  await db.prisma.moduleInstance.update({ where: { id: p.id }, data: { showInNav: false } });
  assert.equal(group(await scan(), "menu_empty").sev, "advised");
});

test("accueil sans accroche, pas d'adresse de contact, site sans page publiée (et un site en local n'est pas signalé « http »)", async () => {
  const r = await scan();
  assert.equal(group(r, "home").sev, "advised");
  assert.equal(group(r, "contact").sev, "info");
  assert.equal(group(r, "empty").sev, "info");
  await setSetting("site.tagline", "Une jolie accroche", "fr");
  await setSetting("site.contactEmail", "emma@example.org");
  const ok = await scan();
  assert.ok(!group(ok, "home") && !group(ok, "contact"));
  assert.ok(!group(ok, "site_http"), "http://localhost n'est pas une erreur");
});

test("redirections et liens sortants : les cibles externes des raccourcis actifs sont visitées, pas celles d'un raccourci éteint", async () => {
  await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.example.org/moi", active: true } });
  await db.prisma.redirect.create({ data: { path: "off", targetUrl: "https://eteint.example.org/", active: false } });
  const r = await scan();
  const links = r.links.map((l) => l.u);
  assert.ok(links.includes("https://twitch.example.org/moi"));
  assert.ok(!links.includes("https://eteint.example.org/"));
  assert.deepEqual(r.links.find((l) => l.u === "https://twitch.example.org/moi").s[0].f, ["r"]);
});

test("liens à visiter : 200 au plus par vérification, 25 par site, jamais deux de suite sur le même site, reprise là où on s'était arrêté", async () => {
  const p = await pages();
  const many = Array.from({ length: 250 }, (_, i) => `[l](https://site${i}.example.net/p)`).join(" ");
  await publish(p, { title: "Beaucoup", summary: "r", body: many });
  const first = await scan();
  assert.equal(first.links.length, 200);
  assert.deepEqual(first.linkTotals, { found: 250, from: 0, count: 200, window: true });
  const second = await scan({ cursor: 200 });
  assert.equal(second.links.length, 200);
  assert.equal(second.linkTotals.from, 200);
  const seen = new Set([...first.links, ...second.links].map((l) => l.u));
  assert.equal(seen.size, 250, "deux vérifications couvrent tous les liens");
  // 25 par site, et les liens d'un même site sont séparés par les autres.
  const same = Array.from({ length: 40 }, (_, i) => `[a](https://a.example.net/${i}) [b](https://b.example.net/${i})`).join(" ");
  await db.prisma.entryTranslation.updateMany({ data: { body: same } });
  const r = await scan();
  const live = r.links.filter((l) => !l.r);
  assert.equal(live.filter((l) => l.u.includes("a.example.net")).length, 25);
  assert.equal(r.links.filter((l) => l.r?.why === "perhost").length, 30, "les 30 autres sont notés, pas visités");
  for (let i = 1; i < live.length; i++) assert.notEqual(new URL(live[i].u).hostname, new URL(live[i - 1].u).hostname, "jamais deux visites de suite sur le même site");
  const skipped = await scan({ skipHosts: new Set(["a.example.net"]) });
  assert.equal(skipped.links.filter((l) => l.r?.why === "ignored").length, 40);
  assert.equal(skipped.notes.skipped.ignored, 40);
  assert.deepEqual((await scan({ checkLinks: false })).links, []);
});

test("bornes : le rapport garde 40 lignes au plus par remarque, mais compte tout ; lecture par paquets de 200", async () => {
  const p = await pages();
  for (let i = 0; i < 45; i++) await publish(p, { title: `Page ${i}`, summary: "", body: LONG });
  const r = await scan();
  const g = group(r, "summary", "fr");
  assert.equal(g.count, 45);
  assert.equal(g.items.length, LIMITS.items);
  assert.equal(r.stats.pages, 45);
});

test("« Corriger » : chaque forme mène à un écran d'administration qui existe dans le dépôt, et rien d'autre (aucune redirection ouverte)", async () => {
  const forms = [["e", "abc123", "en", "blog"], ["e", "abc123", "fr", "blog"], ["l", "blog"], ["i", "xyz"], ["n"], ["r"], ["x"], ["s", "site"], ["s", "appearance"]];
  const dirs = new Set(fs.readdirSync("src/app/admin/(panel)"));
  for (const f of forms) {
    const href = fixHref(f, "fr");
    assert.match(href, /^\/admin\/[a-z/]/, JSON.stringify(f));
    const [, , section, id] = href.split(/[?#]/)[0].split("/");
    assert.ok(dirs.has(section), `${href} : l'écran ${section} existe`);
    if (section === "entries" && id) assert.ok(fs.existsSync("src/app/admin/(panel)/entries/[id]/page.tsx"));
    if (section === "instances") assert.ok(fs.existsSync("src/app/admin/(panel)/instances/[id]/page.tsx"));
    assert.ok(fs.existsSync(`src/app/admin/(panel)/${section}/page.tsx`) || section === "instances", `${href} : page.tsx`);
  }
  assert.equal(fixHref(["e", "abc", "en", "blog"], "fr"), "/admin/entries/abc?c=blog&locale=en");
  assert.equal(fixHref(["e", "abc", "fr", "blog"], "fr"), "/admin/entries/abc?c=blog");
  // Un rapport trafiqué ne peut pas faire sortir de l'administration.
  for (const bad of [["e", "../../x", "fr", "blog"], ["e", "a", "fr", "//evil.example"], ["l", "a/b"], ["i", "https://evil.example"], ["z"], "https://evil.example", null, ["s", "http://x"]]) {
    const href = fixHref(bad, "fr");
    assert.ok(href === null || (href.startsWith("/admin/") && !href.includes("//") && !href.includes("..")), JSON.stringify(bad));
  }
  assert.equal(fixHref(["e", "../../x", "fr", "blog"]), null);
  assert.equal(fixHref(["i", "https://evil.example"]), null);
});

test("le nom de fichier envoyé reconnu par le contrôle est celui du service des envois (copie gardée identique)", async () => {
  const { UPLOAD_NAME } = await import("@/core/maintenance/content/scan");
  const { UPLOAD_NAME_RE } = await import("@/core/services/uploads");
  assert.equal(UPLOAD_NAME.source, UPLOAD_NAME_RE.source);
});
