// RECHERCHE DANS LE SITE — de bout en bout (base jetable) : ce qui est cherché (publié seulement), la langue et son repli, le classement, la pagination, les bornes,
// la limite de débit, l'index en mémoire (réutilisé, refait quand le contenu change, plafonné), et la preuve que RIEN n'est écrit.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { searchSite, pageNumber } = await import("@/core/search/service");
const IDX = await import("@/core/search/index");
const LIM = await import("@/core/search/limit");
const { MAX_RESULTS } = await import("@/core/search/rank");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const manifest = (id) => FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
const visitor = (ip = "203.0.113.7") => ({ get: (n) => (String(n).toLowerCase() === "x-forwarded-for" ? ip : null) });

beforeEach(async () => {
  await db.reset();
  IDX.resetSearchIndex(); LIM.resetSearchLimit();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
});
after(() => db.close());

async function blog(nickname = "Blog", names = { fr: nickname, en: nickname }, extra = {}) {
  await db.fixture("blog");
  return createInstance(db.prisma, { manifest: manifest("blog"), nickname, names, ...extra });
}
let n = 0;
const publish = async (instanceId, title, o = {}) => {
  const { at = new Date(Date.now() - 1000 * (1000 - n++)), ...rest } = o;
  const e = await createEntry(db.prisma, { instanceId, locale: "fr", title, status: "published", ...rest });
  await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: at } });
  return e;
};
const find = (q, o = {}) => searchSite({ q, page: undefined, locale: "fr", source: visitor(), ...o });
const titles = (r) => r.items.map((i) => i.title.map((s) => s.text).join(""));

test("trouve par le titre, le résumé et le corps, sans tenir compte des accents ni de la casse ; le type est le nom de l'instance", async () => {
  const b = await blog("Journal", { fr: "Journal de bord", en: "Logbook" });
  await publish(b.id, "Été à Nîmes", { summary: "Un voyage", body: "Les arènes et le jardin de la Fontaine." });
  await publish(b.id, "Autre", { summary: "Sans rapport", body: "On y parle de la RIVIÈRE." });
  for (const q of ["ete nimes", "ÉTÉ NÎMES", "été", "nimes ete"]) assert.deepEqual(titles(await find(q)), ["Été à Nîmes"], q);
  assert.deepEqual(titles(await find("voyage")), ["Été à Nîmes"], "résumé");
  assert.deepEqual(titles(await find("riviere")), ["Autre"], "corps, accent ignoré");
  const hit = (await find("nimes")).items[0];
  assert.equal(hit.typeLabel, "Journal de bord");
  assert.match(hit.url, /^\/[a-z0-9-]+\/ete-a-nimes$/);
  assert.ok(hit.title.some((s) => s.hit && s.text === "Nîmes"), "terme mis en évidence avec ses accents d'origine");
  const body = (await find("fontaine")).items[0];
  assert.ok(body.excerpt.some((s) => s.hit && /fontaine/i.test(s.text)), "l'extrait vient du corps et met le terme en évidence");
  assert.equal((await find("introuvable")).items.length, 0);
});

test("jamais de brouillon, de publication programmée, d'entrée expirée, ni d'instance sans page publique", async () => {
  const b = await blog("Blog");
  await publish(b.id, "Visible kiwi");
  await createEntry(db.prisma, { instanceId: b.id, locale: "fr", title: "Brouillon kiwi", body: "kiwi" });
  await publish(b.id, "Programmé kiwi", { at: new Date(Date.now() + 86_400_000) });
  await publish(b.id, "Périmé kiwi", { expiresAt: new Date(Date.now() - 1000) });
  const hidden = await blog("Cachée", { fr: "Cachée", en: "Hidden" }, { basePath: null });
  await publish(hidden.id, "Sans page kiwi");
  assert.deepEqual(titles(await find("kiwi")), ["Visible kiwi"]);
});

test("langue : la langue demandée d'abord ; repli de langue seulement si l'instance l'autorise, et la page le dit (lang)", async () => {
  const b = await blog("Blog");
  const e = await publish(b.id, "Pomme", { summary: "fruit" });
  await db.prisma.entryTranslation.create({ data: { entryId: e.id, instanceId: b.id, locale: "en", slug: "apple", title: "Apple", summary: "fruit", body: "" } });
  await publish(b.id, "Seulement français", { summary: "fruit" });
  const en = await find("fruit", { locale: "en" });
  assert.deepEqual(titles(en).sort(), ["Apple", "Seulement français"], "repli sur le français pour l'entrée sans traduction anglaise");
  assert.equal(en.items.find((i) => i.lang === "fr").title.map((s) => s.text).join(""), "Seulement français");
  assert.equal(en.items.find((i) => i.lang === null).title.map((s) => s.text).join(""), "Apple");
  assert.deepEqual(titles(await find("apple", { locale: "fr" })), [], "l'anglais ne répond pas en français quand le français existe");
  await db.prisma.moduleInstance.update({ where: { id: b.id }, data: { fallbackToDefault: false } });
  IDX.resetSearchIndex();
  assert.deepEqual(titles(await find("fruit", { locale: "en" })), ["Apple"], "sans repli : seulement ce qui existe en anglais");
});

test("réglages : désactivée → rien ; instance écartée → pas cherchée ; nombre par page", async () => {
  const a = await blog("Actus"), c = await blog("Carnet");
  await publish(a.id, "Zèbre actus"); await publish(c.id, "Zèbre carnet");
  assert.equal((await find("zebre")).total, 2);
  await setSetting("search.exclude", [c.key]);
  assert.deepEqual(titles(await find("zebre")), ["Zèbre actus"]);
  await setSetting("search.enabled", false);
  assert.deepEqual(await find("zebre"), { kind: "disabled" });
  await setSetting("search.enabled", true); await setSetting("search.exclude", []);
  for (let i = 0; i < 12; i++) await publish(a.id, `Girafe ${i}`);
  assert.equal((await find("girafe")).perPage, 10, "10 par défaut");
  await setSetting("search.perPage", 5);
  const r = await find("girafe");
  assert.equal(r.perPage, 5); assert.equal(r.pages, 3); assert.equal(r.items.length, 5);
  await setSetting("search.perPage", "n'importe quoi");
  assert.equal((await find("girafe")).perPage, 10, "valeur illisible → valeur par défaut");
  await setSetting("search.perPage", 500);
  assert.equal((await find("girafe")).perPage, 10, "hors bornes → valeur par défaut");
});

test("pagination : bornée, page invalide ou trop grande ramenée dans les limites", async () => {
  const a = await blog("Actus");
  for (let i = 0; i < 25; i++) await publish(a.id, `Lama ${String(i).padStart(2, "0")}`);
  const p1 = await find("lama");
  assert.equal(p1.total, 25); assert.equal(p1.pages, 3); assert.equal(p1.page, 1); assert.equal(p1.items.length, 10);
  const p3 = await find("lama", { page: "3" });
  assert.equal(p3.page, 3); assert.equal(p3.items.length, 5);
  assert.equal((await find("lama", { page: "999999" })).page, 3, "au-delà de la dernière : la dernière");
  for (const bad of ["0", "-2", "abc", "2.5", "1e3", "", ["2", "3"], "9".repeat(40)]) {
    const r = await find("lama", { page: bad });
    assert.ok(r.page >= 1 && r.page <= 3, JSON.stringify(bad));
  }
  assert.equal(pageNumber("7"), 7); assert.equal(pageNumber(undefined), 1);
  const all = [...titles(p1), ...titles(await find("lama", { page: "2" })), ...titles(p3)];
  assert.equal(new Set(all).size, 25, "aucun doublon ni trou d'une page à l'autre");
});

test("classement dans le service : le titre avant le résumé avant le corps, puis le plus récent", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Corps", { body: "parle de la mangue", at: new Date("2026-04-01") });
  await publish(a.id, "Résumé", { summary: "une mangue", at: new Date("2026-03-01") });
  await publish(a.id, "Mangue ancienne", { at: new Date("2026-01-01") });
  await publish(a.id, "Mangue récente", { at: new Date("2026-02-01") });
  assert.deepEqual(titles(await find("mangue")), ["Mangue récente", "Mangue ancienne", "Résumé", "Corps"]);
});

test("requêtes extrêmes : vide, très longue, caractères spéciaux, balises : jamais d'erreur, jamais de HTML", async () => {
  const a = await blog("Actus");
  await publish(a.id, "Titre piégé <script>alert(1)</script> (a|b)+", { summary: "x" });
  assert.deepEqual(await find(""), { kind: "empty" });
  assert.deepEqual(await find(undefined), { kind: "empty" });
  assert.deepEqual(await find("   "), { kind: "empty" });
  const long = await find("mot ".repeat(5000));
  assert.equal(long.kind, "results"); assert.equal(long.trimmed, true); assert.ok(long.shown.length <= 100);
  for (const q of [".*", "(a|b)+", "[", "\\", "<script>", "'; DROP TABLE Entry;--", "%", "\u0000", "{n}"]) assert.doesNotReject(async () => find(q), q);
  const r = await find("(a|b)+ script");
  assert.equal(r.kind, "results");
  assert.equal(r.items.length, 1);
  assert.ok(r.items[0].title.every((s) => typeof s.text === "string" && typeof s.hit === "boolean"), "des segments de texte, pas du HTML");
});

test("limite de débit : 30 recherches par minute et par visiteur ; un autre visiteur n'est pas gêné ; la minute suivante repart", async () => {
  const a = await blog("Actus"); await publish(a.id, "Zèbre");
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < LIM.LIMIT_PER_VISITOR; i++) assert.equal((await find("zebre", { now: t0 + i })).kind, "results", `recherche ${i + 1}`);
  const blocked = await find("zebre", { now: t0 + 100 });
  assert.equal(blocked.kind, "limited");
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  assert.equal((await find("zebre", { now: t0 + 100, source: visitor("198.51.100.9") })).kind, "results", "un autre visiteur");
  assert.equal((await find("", { now: t0 + 100 })).kind, "empty", "un champ vide ne compte pas et ne bloque pas");
  assert.equal((await find("zebre", { now: t0 + LIM.LIMIT_WINDOW_MS + 1 })).kind, "results", "la minute suivante");
});

test("limite de débit : la valeur gardée est une empreinte, jamais l'adresse ; la mémoire est bornée", async () => {
  const keys = [];
  const orig = Map.prototype.set;
  Map.prototype.set = function (k, v) { if (typeof k === "string" && v && typeof v === "object" && "count" in v && "start" in v) keys.push(k); return orig.call(this, k, v); };
  try {
    LIM.resetSearchLimit();
    LIM.countSearch("fp-test", 1000);
    for (let i = 0; i < LIM.LIMIT_MAX_KEYS + 50; i++) LIM.countSearch(`fp-${i}`, 2000 + i);
  } finally { Map.prototype.set = orig; }
  assert.ok(LIM.limitSize() <= LIM.LIMIT_MAX_KEYS, `${LIM.limitSize()} compteurs`);
  const { visitorFingerprint } = await import("@/core/modules/visitorFingerprint");
  const fp = visitorFingerprint("core.search", visitor("203.0.113.7"), "q");
  assert.ok(!fp.includes("203") && /^[A-Za-z0-9_-]{22}$/.test(fp), fp);
  assert.notEqual(fp, visitorFingerprint("autre.module", visitor("203.0.113.7"), "q"), "cloisonnée par module");
});

test("limite globale : tout le site confondu, un envoi massif ne fait pas travailler le serveur sans fin", () => {
  LIM.resetSearchLimit();
  const t0 = 1_800_000_000_000;
  let refused = 0;
  for (let i = 0; i < LIM.LIMIT_GLOBAL + 10; i++) if (!LIM.countSearch(`v${i}`, t0 + i).ok) refused++;
  assert.equal(refused, 10);
  assert.equal(LIM.countSearch("autre", t0 + LIM.LIMIT_WINDOW_MS + 5).ok, true);
});

test("index : réutilisé tant que rien ne change, refait dès qu'on crée, modifie ou supprime, et après sa durée de vie", async () => {
  const a = await blog("Actus");
  const e = await publish(a.id, "Premier");
  const one = await IDX.getSearchIndex("fr", []);
  assert.strictEqual(await IDX.getSearchIndex("fr", []), one, "même objet : pas de relecture");
  await publish(a.id, "Deuxième");
  const two = await IDX.getSearchIndex("fr", []);
  assert.notStrictEqual(two, one); assert.equal(two.docs.length, 2);
  await db.prisma.entryTranslation.updateMany({ where: { entryId: e.id }, data: { title: "Premier renommé" } });
  const three = await IDX.getSearchIndex("fr", []);
  assert.notStrictEqual(three, two); assert.ok(three.docs.some((d) => d.title === "Premier renommé"));
  await db.prisma.entry.delete({ where: { id: e.id } });
  assert.equal((await IDX.getSearchIndex("fr", [])).docs.length, 1);
  const base = await IDX.getSearchIndex("fr", []);
  assert.strictEqual(await IDX.getSearchIndex("fr", [], base.builtAt + IDX.INDEX_TTL_MS - 1), base, "encore dans sa durée de vie");
  assert.notStrictEqual(await IDX.getSearchIndex("fr", [], base.builtAt + IDX.INDEX_TTL_MS + 1), base, "durée de vie dépassée : refait");
});

test("index : un seul calcul à la fois (les demandes simultanées partagent le même résultat), au plus 4 langues en mémoire", async () => {
  const a = await blog("Actus"); await publish(a.id, "Un");
  IDX.resetSearchIndex();
  const all = await Promise.all(Array.from({ length: 8 }, () => IDX.getSearchIndex("fr", [])));
  assert.ok(all.every((x) => x === all[0]));
  for (const l of ["aa", "bb", "cc", "dd", "ee", "ff"]) await IDX.getSearchIndex(l, []);
  assert.ok(IDX.keptLocales().length <= IDX.MAX_LOCALES_KEPT, IDX.keptLocales().join());
});

test("PLAFOND : 4 300 entrées → 4 000 fiches (les plus récentes), le reste est dit, le coût reste borné", async () => {
  const a = await blog("Actus");
  const total = 4300, base = Date.now() - 10_000_000;
  const rows = Array.from({ length: total }, (_, i) => ({ id: `big${String(i).padStart(5, "0")}`, instanceId: a.id, status: "published", publishedAt: new Date(base + i * 1000), sourceLocale: "fr" }));
  await db.prisma.entry.createMany({ data: rows });
  await db.prisma.entryTranslation.createMany({ data: rows.map((r, i) => ({ entryId: r.id, instanceId: a.id, locale: "fr", slug: `big-${i}`, title: `Dossier ${i}`, summary: "résumé", body: `texte ${"long ".repeat(2000)}fin${i}` })) });
  const t0 = performance.now();
  const index = await IDX.getSearchIndex("fr", []);
  const ms = performance.now() - t0;
  assert.equal(index.docs.length, IDX.MAX_ENTRY_DOCS);
  assert.equal(index.truncated, true);
  assert.ok(index.docs.some((d) => d.title === `Dossier ${total - 1}`), "la plus récente est cherchée");
  assert.ok(!index.docs.some((d) => d.title === "Dossier 0"), "la plus ancienne ne l'est pas");
  assert.ok(index.docs.every((d) => d.fBody.length <= IDX.BODY_CHARS && d.fTitle.length <= IDX.TITLE_CHARS && d.fSummary.length <= IDX.SUMMARY_CHARS + 40), "textes plafonnés par fiche");
  const chars = index.docs.reduce((s, d) => s + d.fTitle.length + d.fSummary.length + d.fBody.length, 0);
  assert.ok(chars <= IDX.MAX_ENTRY_DOCS * (IDX.BODY_CHARS + IDX.TITLE_CHARS + IDX.SUMMARY_CHARS + 40), `${chars} caractères en mémoire`);
  assert.ok(ms < 20_000, `construction : ${Math.round(ms)} ms`);
  const t1 = performance.now();
  const r = await find("dossier");
  const searchMs = performance.now() - t1;
  assert.equal(r.kind, "results");
  assert.equal(r.reachable, MAX_RESULTS); assert.equal(r.total, IDX.MAX_ENTRY_DOCS);
  assert.equal(r.indexTruncated, true);
  assert.ok(searchMs < 2000, `recherche sur 4 000 fiches : ${Math.round(searchMs)} ms`);
  assert.equal((await find("dossier", { page: "99" })).page, Math.ceil(MAX_RESULTS / 10), "on ne parcourt jamais plus de 200 résultats");
});

const FEED_PROVIDER = {
  "module.json": { apiVersion: 2, version: "1.0.0", id: "agenda", name: "Agenda", provides: [{ topic: "feed.item" }], main: "index.mjs" },
  "index.mjs": `export default { exports: { "feed.item": () => [
    { id: "ev1", title: "Concert de printemps", url: "/agenda/concert", summary: "Ce soir à la salle", publishedAt: "2026-02-10T10:00:00Z" },
    { id: "ev2", title: "Concert à venir", url: "/agenda/futur", publishedAt: "2999-01-01T00:00:00Z" },
    { id: "ev3", title: "Concert dangereux", url: "javascript:alert(1)" },
  ] } };`,
};

test("éléments proposés par des modules (feed.item) : cherchés par titre et résumé ; futurs et adresses dangereuses écartés ; un module en panne ne gêne pas", async () => {
  await installModule(makeRepo(FEED_PROVIDER).url);
  const mod = await R.getModule("agenda");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { fr: "Agenda", en: "Agenda" } });
  const a = await blog("Actus"); await publish(a.id, "Compte rendu du concert");
  const r = await find("concert");
  assert.deepEqual(titles(r), ["Compte rendu du concert", "Concert de printemps"], "deux titres : le plus récent d'abord ; l'élément futur et l'adresse dangereuse sont écartés");
  const item = r.items.find((i) => i.url === "/agenda/concert");
  assert.equal(item.typeLabel, "Agenda");
  assert.deepEqual((await find("salle")).items.map((i) => i.url), ["/agenda/concert"], "résumé de l'élément");
  await setSetting("search.exclude", ["agenda"]);
  assert.deepEqual(titles(await find("concert")), ["Compte rendu du concert"], "un module écarté dans les réglages n'est pas cherché");
});

const MIXED_PROVIDER = {
  "module.json": { apiVersion: 2, version: "1.0.0", id: "agenda", name: "Agenda", provides: [{ topic: "feed.item" }], main: "index.mjs" },
  "index.mjs": `export default { exports: { "feed.item": () => [
    { id: "y1", title: "Tesla vidéo 1", url: "https://www.youtube.com/watch?v=1", publishedAt: "2026-10-30T10:00:00Z" },
    { id: "y2", title: "Tesla vidéo 2", url: "https://www.youtube.com/watch?v=2", publishedAt: "2026-10-29T10:00:00Z" },
    { id: "y3", title: "Tesla vidéo 3", url: "https://autre.exemple.org/3", publishedAt: "2026-10-28T10:00:00Z" },
    { id: "i1", title: "Tesla à l'agenda", url: "/agenda/tesla", publishedAt: "2020-01-01T10:00:00Z" },
  ] } };`,
};

test("classement dans le service : le contenu du site (entrées, adresse relative) avant les externes plus récents ; pages, compteur et page 2 cohérents", async () => {
  await installModule(makeRepo(MIXED_PROVIDER).url);
  const mod = await R.getModule("agenda");
  await createInstance(db.prisma, { manifest: mod.manifest, names: { fr: "Agenda", en: "Agenda" } });
  const a = await blog("Actus");
  await publish(a.id, "Autre", { summary: "parle de Tesla", at: new Date("2025-01-01") });
  await publish(a.id, "Mes partenariats", { body: "Tesla : des réductions", at: new Date("2024-01-01") });
  const r = await find("tesla");
  assert.deepEqual(titles(r), ["Tesla à l'agenda", "Autre", "Mes partenariats", "Tesla vidéo 1", "Tesla vidéo 2", "Tesla vidéo 3"], "site : titre, résumé, texte ; puis externes");
  assert.equal(r.total, 6);
  assert.deepEqual(r.items.map((i) => i.external), [false, false, false, true, true, true]);
  assert.equal(r.items[3].typeLabel, "Agenda", "le type reste affiché");
  await setSetting("search.perPage", 5);
  const p1 = await find("tesla"), p2 = await find("tesla", { page: "2" });
  assert.deepEqual([...titles(p1), ...titles(p2)], titles(r), "la page 2 prolonge la page 1 dans le même ordre");
  assert.equal(p2.total, 6);
  assert.deepEqual(titles(await find("vidéo")), ["Tesla vidéo 1", "Tesla vidéo 2", "Tesla vidéo 3"], "externes seuls : classement habituel");
  assert.equal((await find("introuvable")).items.length, 0);
});

test("RIEN n'est écrit : ni ligne en base (réglages, journal, visites…), ni cookie ; le code de la recherche ne contient aucune écriture", async () => {
  const a = await blog("Actus"); await publish(a.id, "Zèbre");
  const tables = (await db.prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, Number((await db.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM "${t}"`))[0].n)])));
  await find("zebre");
  const before = await snapshot();
  for (let i = 0; i < 5; i++) await find("zebre");
  await find("introuvable"); await find("");
  assert.deepEqual(await snapshot(), before);
  const fs = await import("node:fs"), path = await import("node:path");
  const files = fs.readdirSync("src/core/search").map((f) => path.join("src/core/search", f)).concat(["src/app/(site)/search/page.tsx", "src/components/site/SearchView.tsx", "src/components/site/SearchForm.tsx"]);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /\b(cookies|document\.cookie|localStorage|sessionStorage|set-cookie|Set-Cookie)\b/, `${f} : aucun cookie ni stockage du navigateur`);
    assert.doesNotMatch(src, /prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|writeFile|appendFile|setSetting|deleteSetting|console\.(log|info)|audit\(/, `${f} : aucune écriture ni journal`);
    assert.doesNotMatch(src, /\bfetch\(|https?:\/\/(?!schema\.org)/, `${f} : aucun service tiers`);
    assert.doesNotMatch(src, /\b(setInterval|setTimeout)\(/, `${f} : aucun minuteur`);
  }
});
