import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const S = await import("@/core/stats");
const V = await import("@/core/visit");
const { setSetting } = await import("@/core/settings");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { FIXTURE_MODULES: BUILTIN_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const UA = "Mozilla/5.0 (X11; Linux) Firefox/130.0";
const hit = (over = {}) => ({ path: "/blog", referrer: "", ip: "1.2.3.4", userAgent: UA, ownHost: "site.test", ...over });
const NOW = new Date(2026, 9, 8, 12, 0, 0);

test("stats : chemins normalisés ; admin, API, fichiers et formes douteuses ne sont pas comptés", () => {
  assert.equal(S.normalizePath("/blog/?a=1#x"), "/blog");
  assert.equal(S.normalizePath("/"), "/");
  for (const bad of ["/admin", "/admin/users", "/api/hit", "/m/x/y", "//evil.com", "blog", "/a b", "/" + "a".repeat(300), 5, null]) assert.equal(S.normalizePath(bad), null, String(bad));
});

test("stats : provenance = nom d'hôte seul, sans www ; le site lui-même et le n'importe quoi sont ignorés", () => {
  assert.equal(S.refHost("https://www.Example.org/page?q=1", "site.test"), "example.org");
  assert.equal(S.refHost("https://site.test/autre", "site.test"), null);
  for (const bad of ["", "javascript:alert(1)", "pas une adresse", undefined, 7]) assert.equal(S.refHost(bad, "site.test"), null);
});

test("stats : un visiteur est compté une fois par jour, ses pages vues s'additionnent", async () => {
  await S.recordVisit(hit(), NOW);
  await S.recordVisit(hit({ path: "/blog" }), NOW);
  await S.recordVisit(hit({ path: "/contact" }), NOW);
  await S.recordVisit(hit({ ip: "9.9.9.9" }), NOW);
  const s = await S.statsSummary({ now: NOW });
  assert.deepEqual(s.totals.today, { visitors: 2, views: 4 });
  assert.deepEqual(s.topPages[0], { path: "/blog", views: 3 });
  assert.equal(s.days.length, 30);
  assert.equal(s.totals.last30.visitors, 2);
});

test("stats : provenances comptées ; robots, « Do Not Track » et user-agent absent ne le sont pas", async () => {
  await S.recordVisit(hit({ referrer: "https://www.mastodon.example/@x" }), NOW);
  assert.deepEqual((await S.statsSummary({ now: NOW })).topSources, [{ host: "mastodon.example", views: 1 }]);
  for (const over of [{ userAgent: "Googlebot/2.1" }, { userAgent: "curl/8" }, { userAgent: "" }, { doNotTrack: true }, { path: "/admin" }])
    assert.equal(await S.recordVisit(hit(over), NOW), "ignored", JSON.stringify(over));
  assert.equal((await S.statsSummary({ now: NOW })).totals.today.views, 1);
});

test("stats : désactivées dans les réglages → rien n'est enregistré", async () => {
  await setSetting("stats.enabled", false);
  assert.equal(await S.recordVisit(hit(), NOW), "disabled");
  assert.equal(await db.prisma.visitDaily.count(), 0);
});

test("stats : anonymat — aucune IP ni navigateur en base, le sel change chaque jour, les empreintes de la veille sont détruites", async () => {
  await S.recordVisit(hit(), NOW);
  const dump = JSON.stringify([await db.prisma.visitDaily.findMany(), await db.prisma.visitSeen.findMany(), await db.prisma.setting.findMany()]);
  assert.ok(!dump.includes("1.2.3.4") && !dump.includes("Firefox"));
  const salt1 = (await db.prisma.setting.findMany()).find((r) => r.key === "stats.salt").value;
  const tomorrow = new Date(NOW.getTime() + 86_400_000);
  await S.recordVisit(hit(), tomorrow);
  assert.equal(await db.prisma.visitSeen.count({ where: { day: S.dayOf(NOW) } }), 0, "empreintes de la veille supprimées");
  assert.notEqual((await db.prisma.setting.findMany()).find((r) => r.key === "stats.salt").value, salt1);
  // Même personne, deux jours : visiteur compté dans chaque jour (impossible de la reconnaître).
  assert.equal((await S.statsSummary({ now: tomorrow })).totals.last7.visitors, 2);
});

test("stats : plafond de pages par jour (un robot ne remplit pas la base) mais le total du site continue", async () => {
  for (let i = 0; i < S.MAX_PAGES_PER_DAY + 20; i++) await S.recordVisit(hit({ ip: "7.7.7." + (i % 250), path: "/p" + i }), NOW);
  assert.equal(await db.prisma.visitDaily.count({ where: { kind: "page" } }), S.MAX_PAGES_PER_DAY);
  assert.ok((await S.statsSummary({ now: NOW })).totals.today.views >= S.MAX_PAGES_PER_DAY + 20);
});

test("stats : remise à zéro", async () => {
  await S.recordVisit(hit(), NOW);
  await S.resetStats();
  assert.equal((await S.statsSummary({ now: NOW })).totals.last30.views, 0);
});

test("dernière visite : cookies absents ou invalides = 1er janvier 1970 ; futur refusé", () => {
  const now = Date.UTC(2026, 9, 8);
  for (const bad of [undefined, "", "abc", "-5", "99999999999999999", String(now + 10 * 86_400_000)]) assert.equal(V.parseVisitDate(bad, now).getTime(), 0, String(bad));
  assert.equal(V.parseVisitDate("1700000000000", now).getTime(), 1700000000000);
});

test("dernière visite : la date de session est figée pendant la visite ; sinon elle vient du cookie de longue durée ; 1970 au premier passage", () => {
  const now = 1_800_000_000_000;
  const first = V.planVisit({}, now);
  assert.equal(first.since.getTime(), 0);
  assert.equal(first.setSince, "0", "figée à 1970 pour toute la visite");
  assert.equal(first.setSeen, String(now));
  const back = V.planVisit({ seen: String(now - 5 * 86_400_000) }, now);
  assert.equal(back.since.getTime(), now - 5 * 86_400_000);
  assert.equal(back.setSince, String(now - 5 * 86_400_000));
  const sameVisit = V.planVisit({ seen: String(now - 1000), since: String(now - 5 * 86_400_000) }, now);
  assert.equal(sameVisit.since.getTime(), now - 5 * 86_400_000, "le cookie de session prime");
  assert.equal(sameVisit.setSince, undefined);
});

test("nouveautés : règle du cœur — entrées publiées depuis la dernière visite ; jamais à la première visite ; brouillons et expirées ignorés", async () => {
  const manifest = BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest;
  await db.fixture("blog");
  const inst = await createInstance(db.prisma, { manifest, names: { fr: "Blog", en: "Blog" } });
  const make = async (title, status, days, extra = {}) => {
    const e = await createEntry(db.prisma, { instanceId: inst.id, locale: "fr", title, status });
    await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - days * 86_400_000), ...extra } });
  };
  const since = new Date(Date.now() - 3 * 86_400_000);
  await make("ancien", "published", 10);
  await make("brouillon", "draft", 1);
  await make("expiré", "published", 1, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await V.hasNewEntries(inst.id, since), false);
  assert.equal(await V.hasNewEntries(inst.id, new Date(0)), false, "première visite : aucune pastille");
  await make("récent", "published", 1);
  assert.equal(await V.hasNewEntries(inst.id, since), true);
});

test("branchements : balise de visite, route, cookies du proxy, hook `news`, pastille du menu, carte du tableau de bord", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/app/(site)/layout.tsx"), /config\.statsEnabled && <VisitBeacon \/>/);
  assert.match(read("src/components/site/VisitBeacon.tsx"), /doNotTrack/);
  assert.match(read("src/app/api/hit/route.ts"), /authjs\\\.session-token/, "l'équipe connectée n'est pas comptée");
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /headers\.delete\(SINCE_HEADER\)/, "jamais de confiance dans l'en-tête venant du client");
  assert.match(proxy, /planVisit/);
  assert.match(read("src/core/modules/types.ts"), /news\?: \(ctx: ModuleContext\) => boolean/);
  assert.match(read("src/core/modules/types.ts"), /visit: \{ lastVisit: Date \}/);
  assert.match(read("src/components/site/Header.tsx"), /data-testid="news-dot"/);
  assert.match(read("src/app/admin/(panel)/page.tsx"), /data-testid="visits"/);
});

test("pastilles d'admin : hook adminBadge → menu et carte « À traiter » ; mises à jour pour le propriétaire ; module Contacts compte les fiches à vérifier", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/core/modules/types.ts"), /adminBadge\?: \(ctx: ModuleContext\) => number/);
  assert.match(read("src/core/modules/adminNav.ts"), /Math\.min\(Math\.floor\(n\), 999\)/, "borné, une erreur = 0");
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /user\.role === "owner" && \(await getUpdateCheck/);
  assert.match(layout, /href="\/admin\/updates" badge=/);
  assert.match(read("src/app/admin/(panel)/page.tsx"), /data-testid="todo"/);
});

test("vie privée : la dernière visite n'est retenue que si le visiteur l'a demandé (bouton), sans bandeau ; les cookies d'avant sont effacés", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /request\.cookies\.get\(NEWS_COOKIE\)\?\.value === "1"/);
  assert.match(proxy, /if \(!optedIn\) \{[\s\S]*maxAge: 0[\s\S]*return res;/, "sans choix : rien n'est déposé, les anciens cookies sont effacés");
  assert.match(proxy, /optedIn \? String\(visit\.since\.getTime\(\)\) : "0"/, "sans choix : 1970, donc aucune pastille");
  const toggle = read("src/components/site/NewsToggle.tsx");
  assert.match(toggle, /curiosa_news=1/);
  assert.match(toggle, /for \(const name of \["curiosa_news", "curiosa_seen", "curiosa_since"\]\)[\s\S]*max-age=0/, "le second clic efface tout");
  assert.match(read("src/components/site/Header.tsx"), /config\.newsToggle && <NewsToggle/);
  assert.match(read("src/core/settings.ts"), /newsToggle: \(await getSetting<boolean>\("news\.toggle"\)\) === true/, "désactivé par défaut");
  const privacy = read("docs/PRIVACY.md");
  for (const c of ["curiosa_locale", "curiosa_news", "curiosa_seen", "curiosa_since"]) assert.ok(privacy.includes(c), `docs/PRIVACY.md doit décrire ${c}`);
});
