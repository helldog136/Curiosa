import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const M = await import("@/core/dashboard/modules");
const { DASHBOARD_LIMITS } = await import("@/core/dashboard/spec");
const { rightsCatalogue, systemRights } = await import("@/core/auth/rights");
const { parseManifest } = await import("@/core/modules/manifest");

beforeEach(() => M.resetDashboardMemo());
const quiet = (fn) => async () => { const e = console.error; console.error = () => {}; try { await fn(); } finally { console.error = e; } };

const words = (fr, en = fr) => ({ fr, en });
function manifest(id, dashboard, extra = {}) {
  const r = parseManifest({ apiVersion: 2, id, name: words(id), version: "1.0.0", icon: "🧪", permissions: [], rights: [{ id: "moderate", label: words("Modérer", "Moderate") }], dashboard, ...extra });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.manifest;
}
function active(id, dashboardDecl, def, { key = id, name = id, extra } = {}) {
  return { instance: { id: `i-${key}`, key, moduleId: id, names: { fr: name }, descriptions: {} }, mod: { manifest: manifest(id, dashboardDecl, extra), def: { dashboard: def }, locales: {}, row: {} } };
}
// Un utilisateur : le palier donne ses droits par défaut (sur tous les modules d'essai) ; `extra` ajoute des droits.
const IDS = ["reviews", "polls", "good", "boom", "asyncboom", "junk", "neg", "slow", "fast", "flaky", "multi", "aa", "bb", "cc", "streams", "xx", ...Array.from({ length: 80 }, (_, i) => `mod${i}`), ...Array.from({ length: 80 }, (_, i) => `m${i}`), ...Array.from({ length: 10 }, (_, i) => `b${i}`), ...Array.from({ length: 10 }, (_, i) => `ok${i}`)];
const CATALOGUE = rightsCatalogue(IDS.map((id) => ({ moduleId: id, name: words(id), rights: [{ id: "moderate", label: words("M") }] })));
function user(level, extra = []) {
  return { id: "u1", email: "a@b.c", name: "A", level, roles: [level], rights: new Set([...systemRights(level, CATALOGUE), ...extra]), locale: null, advanced: false, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false };
}
const env = (viewer, list, over = {}) => ({ viewer, locale: "fr", defaultLocale: "fr", active: async () => list, contextFor: async () => ({ fake: true }), ...over });
const T = (id, right) => ({ id, label: words("{n} avis à valider", "{n} reviews to approve"), href: "?tab=pending", ...(right ? { right } : {}) });

test("tâches : seul le nombre > 0 est montré, avec le libellé rempli et le lien de l'instance", async () => {
  const a = active("reviews", { tasks: [T("pending"), T("flagged")] }, { tasks: { pending: async () => 3, flagged: () => 0 } });
  const tasks = await M.moduleTasks(env(user("admin"), [a]));
  assert.equal(tasks.length, 1);
  assert.deepEqual([tasks[0].label, tasks[0].n, tasks[0].href, tasks[0].moduleId, tasks[0].icon], ["3 avis à valider", 3, "/admin/instances/i-reviews?tab=pending", "reviews", "🧪"]);
});

test("tâches : la langue de la personne, puis celle du site", async () => {
  const a = active("reviews", { tasks: [T("pending")] }, { tasks: { pending: () => 2 } });
  assert.equal((await M.moduleTasks(env(user("admin"), [a], { locale: "en" })))[0].label, "2 reviews to approve");
  assert.equal((await M.moduleTasks(env(user("admin"), [a], { locale: "de" })))[0].label, "2 avis à valider");
});

test("droits : sans le droit, rien n'est montré ET le code du module n'est pas appelé", async () => {
  let called = 0;
  const a = active("reviews", { tasks: [T("pending", "moderate")] }, { tasks: { pending: () => { called++; return 4; } } });
  const editor = user("editor");
  assert.equal(editor.rights.has("reviews:moderate"), false);
  assert.deepEqual(await M.moduleTasks(env(editor, [a])), []);
  assert.equal(called, 0);
  const withRight = user("editor", ["reviews:moderate", "reviews:open"]);
  assert.equal((await M.moduleTasks(env(withRight, [a]))).length, 1);
  assert.equal(called, 1);
  // Le droit par défaut est « ouvrir » : une rédaction ne l'a pas.
  const open = active("polls", { tasks: [T("p")] }, { tasks: { p: () => 1 } });
  assert.deepEqual(await M.moduleTasks(env(user("editor"), [open])), []);
  assert.equal((await M.moduleTasks(env(user("admin"), [open]))).length, 1);
});

test("droits : un compte sans droits (mot de passe temporaire, double vérification exigée) ne voit rien", async () => {
  const a = active("reviews", { tasks: [T("pending")] }, { tasks: { pending: () => 4 } });
  assert.deepEqual(await M.moduleTasks(env({ ...user("admin"), mustChangePassword: true }, [a])), []);
  assert.deepEqual(await M.moduleTasks(env({ ...user("admin"), needsTwoFactor: true }, [a])), []);
});

test("isolation : un module qui échoue ou répond mal disparaît, les autres s'affichent", quiet(async () => {
  const good = active("good", { tasks: [T("t")] }, { tasks: { t: () => 2 } });
  const boom = active("boom", { tasks: [T("t")] }, { tasks: { t: () => { throw new Error("secret interne"); } } });
  const async = active("asyncboom", { tasks: [T("t")] }, { tasks: { t: async () => { throw new Error("x"); } } });
  const junk = active("junk", { tasks: [T("t")] }, { tasks: { t: () => "beaucoup" } });
  const neg = active("neg", { tasks: [T("t")] }, { tasks: { t: () => -4 } });
  const tasks = await M.moduleTasks(env(user("admin"), [boom, async, junk, neg, good]));
  assert.deepEqual(tasks.map((t) => t.moduleId), ["good"]);
}));

test("délai : un module lent est écarté après le délai, sans retenir les autres", quiet(async () => {
  const slow = active("slow", { tasks: [T("t")] }, { tasks: { t: () => new Promise((r) => setTimeout(() => r(9), 400)) } });
  const fast = active("fast", { tasks: [T("t")] }, { tasks: { t: () => 1 } });
  const started = Date.now();
  const tasks = await M.moduleTasks(env(user("admin"), [slow, fast], { timeoutMs: 60 }));
  assert.deepEqual(tasks.map((t) => t.moduleId), ["fast"]);
  assert.ok(Date.now() - started < 300, "le tableau de bord n'attend pas le module lent");
}));

test("délai : la borne par défaut est de 1,5 seconde", () => assert.equal(DASHBOARD_LIMITS.timeoutMs, 1500));

test("mémoire courte : une réponse est gardée, un échec n'est pas réessayé aussitôt, puis on réessaie", quiet(async () => {
  let calls = 0, now = 1_000_000;
  const a = active("reviews", { tasks: [T("t")] }, { tasks: { t: () => ++calls } });
  const e = () => env(user("admin"), [a], { now: () => now });
  assert.equal((await M.moduleTasks(e()))[0].n, 1);
  assert.equal((await M.moduleTasks(e()))[0].n, 1, "même réponse, aucun nouvel appel");
  assert.equal(calls, 1);
  now += DASHBOARD_LIMITS.cacheMs + 1;
  assert.equal((await M.moduleTasks(e()))[0].n, 2);
  // Échec : pas de nouvel appel avant le délai d'attente, puis un nouvel essai.
  M.resetDashboardMemo();
  let fails = 0;
  const f = active("flaky", { tasks: [T("t")] }, { tasks: { t: () => { fails++; if (fails === 1) throw new Error("x"); return 5; } } });
  const ef = () => env(user("admin"), [f], { now: () => now });
  assert.deepEqual(await M.moduleTasks(ef()), []);
  assert.deepEqual(await M.moduleTasks(ef()), []);
  assert.equal(fails, 1, "pas réinterrogé aussitôt");
  now += DASHBOARD_LIMITS.failMs + 1;
  assert.equal((await M.moduleTasks(ef()))[0].n, 5);
}));

test("mémoire courte : une entrée par instance et par langue, et la mémoire reste bornée", async () => {
  let calls = 0;
  const a = active("reviews", { tasks: [T("t")] }, { tasks: { t: () => ++calls } });
  await M.moduleTasks(env(user("admin"), [a], { locale: "fr" }));
  await M.moduleTasks(env(user("admin"), [a], { locale: "en" }));
  assert.equal(calls, 2);
  const many = Array.from({ length: 30 }, (_, i) => active("m" + i, { tasks: [T("t")] }, { tasks: { t: () => 1 } }));
  for (let r = 0; r < 20; r++) await M.moduleTasks(env(user("admin"), many.map((x, i) => ({ ...x, instance: { ...x.instance, id: `r${r}-${i}` } })), { locale: "fr" }));
  assert.ok(globalThis.curiosaDashboardMemo.size <= DASHBOARD_LIMITS.cacheEntries);
});

test("bornes : 5 instances par module au plus, 40 appels au plus, 12 tâches montrées, les plus nombreuses d'abord", async () => {
  let calls = 0;
  const one = (k, n = 1) => active("multi", { tasks: [T("t")] }, { tasks: { t: () => { calls++; return n; } } }, { key: `k${k}`, name: `Nom ${k}` });
  const tasks = await M.moduleTasks(env(user("admin"), Array.from({ length: 9 }, (_, k) => one(k, k + 1))));
  assert.equal(calls, DASHBOARD_LIMITS.instances);
  assert.equal(tasks.length, DASHBOARD_LIMITS.instances);
  assert.deepEqual(tasks.map((t) => t.n), [5, 4, 3, 2, 1]);
  assert.match(tasks[0].label, /\(Nom 4\)$/, "plusieurs instances : le nom précise la ligne");
  calls = 0;
  M.resetDashboardMemo();
  const mods = Array.from({ length: 60 }, (_, k) => active(`mod${k}`, { tasks: [T("t")] }, { tasks: { t: () => { calls++; return 1; } } }));
  const shown = await M.moduleTasks(env(user("admin"), mods));
  assert.equal(calls, DASHBOARD_LIMITS.calls);
  assert.equal(shown.length, DASHBOARD_LIMITS.shownTasks);
});

test("une seule instance : le libellé reste tel quel", async () => {
  const a = active("reviews", { tasks: [T("t")] }, { tasks: { t: () => 2 } }, { name: "Mes avis" });
  assert.equal((await M.moduleTasks(env(user("admin"), [a])))[0].label, "2 avis à valider");
});

test("déclaré sans code, ou code sans déclaration : rien n'est appelé ni montré", async () => {
  const noCode = active("aa", { tasks: [T("t")] }, {});
  const noDecl = active("bb", undefined, { tasks: { t: () => 5 } });
  const noDashboard = { ...active("cc", { tasks: [T("t")] }, undefined) };
  assert.deepEqual(await M.moduleTasks(env(user("admin"), [noCode, noDecl, noDashboard])), []);
});

test("actions rapides : filtrées par droits, liens résolus, aucun code de module appelé", async () => {
  const mk = (right) => active("streams", { quickActions: [{ id: "plan", label: words("Programmer un stream", "Schedule a stream"), href: "?tab=new", ...(right ? { right } : {}) }] }, {});
  const acts = await M.moduleActions(env(user("admin"), [mk()]));
  assert.deepEqual(acts.map((a) => [a.label, a.href, a.icon]), [["Programmer un stream", "/admin/instances/i-streams?tab=new", "🧪"]]);
  assert.deepEqual(await M.moduleActions(env(user("editor"), [mk()])), [], "droit « ouvrir » absent");
  assert.deepEqual(await M.moduleActions(env(user("admin"), [mk("moderate")])), [{ ...acts[0] }].filter(() => true), "droit déclaré, détenu par l'administration");
  const own = active("streams", { quickActions: [{ id: "plan", label: words("Programmer", "Plan"), href: "?", icon: "📅" }] }, {});
  assert.equal((await M.moduleActions(env(user("admin"), [own])))[0].icon, "📅");
});

test("cartes : chiffre et liste, titre dans la langue, lien résolu, carte vide qui dit pourquoi", async () => {
  const cards = [
    { id: "count", type: "counter", title: words("Followers", "Followers"), href: "?tab=stats" },
    { id: "next", type: "list", title: words("Prochains streams", "Next streams"), empty: words("Aucun stream prévu.", "No stream planned.") },
  ];
  const def = { cards: { count: () => ({ value: 1250, detail: "+12 cette semaine" }), next: () => ({ rows: [] }) } };
  const quiet = active("polls", { cards: [{ id: "q", type: "list", title: words("Silencieuse", "Quiet") }] }, { cards: { q: () => ({ rows: [] }) } });
  const out = await M.moduleCards(env(user("admin"), [active("streams", { cards }, def), quiet]));
  assert.equal(out.length, 2, "une liste vide sans message disparaît");
  assert.deepEqual([out[0].title, out[0].href, out[0].data], ["Followers", "/admin/instances/i-streams?tab=stats", { type: "counter", value: 1250, detail: "+12 cette semaine" }]);
  assert.equal(out[1].empty, "Aucun stream prévu.");
});

test("cartes : une réponse hors format est écartée, jamais montrée de travers ; 4 cartes au plus", quiet(async () => {
  const d = (type) => ({ id: "c", type, title: words("C") });
  const bads = [
    active("b1", { cards: [d("counter")] }, { cards: { c: () => ({ value: 1, html: "<b>x</b>" }) } }),
    active("b2", { cards: [d("list")] }, { cards: { c: () => ({ rows: Array.from({ length: 6 }, () => ({ title: "x" })) }) } }),
    active("b3", { cards: [d("list")] }, { cards: { c: () => ({ rows: [{ title: "x", href: "https://evil.test" }] }) } }),
    active("b4", { cards: [d("counter")] }, { cards: { c: () => "<script>alert(1)</script>" } }),
  ];
  assert.deepEqual(await M.moduleCards(env(user("admin"), bads)), []);
  const many = Array.from({ length: 8 }, (_, k) => active(`ok${k}`, { cards: [d("counter")] }, { cards: { c: () => ({ value: k }) } }));
  assert.equal((await M.moduleCards(env(user("admin"), many))).length, DASHBOARD_LIMITS.shownCards);
}));

test("cartes : le texte d'un module reste du texte (jamais du HTML interprété par le cœur)", async () => {
  const a = active("xx", { cards: [{ id: "c", type: "list", title: words("T") }] }, { cards: { c: () => ({ rows: [{ title: "<img src=x onerror=alert(1)>", detail: "<script>1</script>" }] }) } });
  const [card] = await M.moduleCards(env(user("admin"), [a]));
  assert.equal(card.data.rows[0].title, "<img src=x onerror=alert(1)>");
  assert.equal(typeof card.data.rows[0].title, "string");
});
