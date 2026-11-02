import test from "node:test";
import assert from "node:assert/strict";

const S = await import("@/core/dashboard/spec");
const { parseManifest } = await import("@/core/modules/manifest");

const base = { apiVersion: 2, id: "reviews", name: { fr: "Avis", en: "Reviews" }, version: "1.0.0", permissions: [], rights: [{ id: "moderate", label: { fr: "Modérer", en: "Moderate" } }] };
const ok = (dashboard) => parseManifest({ ...base, dashboard });
const bad = (dashboard) => { const r = ok(dashboard); assert.equal(r.ok, false, JSON.stringify(dashboard)); return r.error; };
const task = { id: "pending", label: { fr: "{n} avis à valider", en: "{n} reviews to approve" }, href: "?tab=pending", right: "moderate" };

test("manifeste : une déclaration complète est acceptée, et la clé est facultative", () => {
  assert.equal(parseManifest(base).ok, true);
  const r = ok({ tasks: [task], quickActions: [{ id: "new", label: { fr: "Ajouter un avis", en: "Add a review" }, href: "/admin/entries/new?c={key}" }], cards: [{ id: "last", type: "list", title: { fr: "Derniers avis", en: "Latest reviews" }, href: "?tab=all", empty: { fr: "Aucun avis pour le moment.", en: "No reviews yet." } }] });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
});

test("manifeste : tout est strict (clé inconnue, type inconnu, trop d'éléments)", () => {
  assert.match(bad({ tasks: [], extra: 1 }), /dashboard/);
  assert.match(bad({ tasks: [{ ...task, color: "red" }] }), /dashboard/);
  assert.match(bad({ cards: [{ id: "x", type: "html", title: { fr: "a", en: "a" } }] }), /dashboard/);
  assert.match(bad({ tasks: Array.from({ length: S.DASHBOARD_LIMITS.tasks + 1 }, (_, i) => ({ ...task, id: `t${i}` })) }), /dashboard/);
  assert.match(bad({ quickActions: Array.from({ length: S.DASHBOARD_LIMITS.quickActions + 1 }, (_, i) => ({ id: `a${i}`, label: { fr: "a", en: "a" }, href: "?" })) }), /dashboard/);
  assert.match(bad({ cards: Array.from({ length: S.DASHBOARD_LIMITS.cards + 1 }, (_, i) => ({ id: `c${i}`, type: "counter", title: { fr: "a", en: "a" } })) }), /dashboard/);
  assert.match(bad({ tasks: [{ ...task, label: { fr: "x".repeat(S.DASHBOARD_LIMITS.labelChars + 1), en: "x" } }] }), /dashboard/);
});

test("manifeste : français ET anglais, mêmes {variables}, seul {n} permis dans une tâche", () => {
  assert.match(bad({ tasks: [{ ...task, label: { fr: "{n} avis" } }] }), /both fr and en/);
  assert.match(bad({ tasks: [{ ...task, label: { fr: "{n} avis", en: "reviews" } }] }), /same \{variables\}/);
  assert.match(bad({ tasks: [{ ...task, label: { fr: "{nom} avis", en: "{nom} reviews" } }] }), /\{nom\}/);
  assert.match(bad({ quickActions: [{ id: "a", label: { fr: "Ajouter {n}", en: "Add {n}" }, href: "?" }] }), /\{n\}/);
});

test("manifeste : identifiants uniques, droits déclarés, liens d'administration seulement", () => {
  assert.match(bad({ tasks: [task, task] }), /duplicate task/);
  assert.match(bad({ tasks: [{ ...task, right: "ghost" }] }), /not declared in rights/);
  assert.equal(ok({ tasks: [{ ...task, right: "open" }, { ...task, id: "h", right: "history" }] }).ok, true);
  for (const href of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/blog", "/admin/../etc", "/admin//x", "?a={other}", "?x=<b>", "/adminx", "data:text/html,x"]) assert.match(bad({ tasks: [{ ...task, href }] }), /dashboard|link/, href);
  for (const href of ["?", "?tab=x", "/admin/updates", "/admin/entries?c={key}", "/admin/instances/{id}?tab=a", "/admin"]) assert.equal(ok({ tasks: [{ ...task, href }] }).ok, true, href);
});

test("adresses : résolues pour l'instance, jamais en dehors de l'administration", () => {
  const i = { id: "abc", key: "reviews-1" };
  assert.equal(S.resolveHref("?tab=pending", i), "/admin/instances/abc?tab=pending");
  assert.equal(S.resolveHref("?", i), "/admin/instances/abc");
  assert.equal(S.resolveHref("/admin/entries/new?c={key}", i), "/admin/entries/new?c=reviews-1");
  assert.equal(S.resolveHref("/admin/instances/{id}", { id: "a b", key: "k" }), "/admin/instances/a%20b");
  for (const bad of ["https://x.test", "//x", "/blog", "javascript:1", 5, null, undefined]) assert.equal(S.resolveHref(bad, i), null, String(bad));
});

test("tâche : un nombre entier de 0 à 99999, rien d'autre", () => {
  assert.equal(S.parseTaskCount(3), 3);
  assert.equal(S.parseTaskCount(3.9), 3);
  assert.equal(S.parseTaskCount("12"), 12);
  assert.equal(S.parseTaskCount(10 ** 9), S.DASHBOARD_LIMITS.maxCount);
  for (const raw of [-1, NaN, Infinity, "abc", "1e3", null, undefined, {}, [], true]) assert.equal(S.parseTaskCount(raw), null, String(raw));
});

test("carte « chiffre » : une valeur et une précision, du texte propre, une forme stricte", () => {
  const i = { id: "i", key: "k" };
  assert.deepEqual(S.parseCard("counter", { value: 7, detail: "cette semaine" }, i), { type: "counter", value: 7, detail: "cette semaine" });
  assert.deepEqual(S.parseCard("counter", { value: "Ven. 20:00" }, i), { type: "counter", value: "Ven. 20:00" });
  assert.deepEqual(S.parseCard("counter", { value: 4.8 }, i), { type: "counter", value: 4 });
  assert.equal(S.parseCard("counter", { value: 1, html: "<b>x</b>" }, i), null, "clé inconnue");
  assert.equal(S.parseCard("counter", { value: -1 }, i), null);
  assert.equal(S.parseCard("counter", { value: "x".repeat(S.DASHBOARD_LIMITS.valueChars + 40) }, i)?.value.length <= S.DASHBOARD_LIMITS.valueChars, true);
  assert.equal(S.parseCard("counter", { rows: [] }, i), null, "mauvais type de carte");
  assert.equal(S.parseCard("counter", "7", i), null);
  assert.equal(S.parseCard("counter", null, i), null);
});

test("carte « liste » : 5 lignes au plus, texte nettoyé, liens d'administration seulement", () => {
  const i = { id: "i", key: "k" };
  const rows = (n) => ({ rows: Array.from({ length: n }, (_, k) => ({ title: `Ligne ${k}`, detail: "d", href: "?open=" + k })) });
  const r = S.parseCard("list", rows(5), i);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[2].href, "/admin/instances/i?open=2");
  assert.equal(S.parseCard("list", rows(6), i), null, "plus de 5 lignes : écartée, pas tronquée en silence");
  assert.deepEqual(S.parseCard("list", { rows: [] }, i), { type: "list", rows: [] });
  assert.equal(S.parseCard("list", { rows: [{ title: "a", href: "https://evil.test" }] }, i), null);
  assert.equal(S.parseCard("list", { rows: [{ title: "a", style: "x" }] }, i), null);
  assert.equal(S.parseCard("list", { rows: [{ title: "" }] }, i), null);
  const clean = S.parseCard("list", { rows: [{ title: "  A\u0000\n  B  ", detail: "x".repeat(500) }] }, i);
  assert.equal(clean.rows[0].title, "A B");
  assert.ok(clean.rows[0].detail.length <= S.DASHBOARD_LIMITS.detailChars);
});

test("carte : le texte reste du texte (balises gardées telles quelles pour que l'écran les ÉCHAPPE), un secret est écarté", () => {
  const i = { id: "i", key: "k" };
  const r = S.parseCard("list", { rows: [{ title: "<img src=x onerror=alert(1)>" }] }, i);
  assert.equal(r.rows[0].title, "<img src=x onerror=alert(1)>");
  assert.equal(S.parseCard("list", { rows: [{ title: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" }] }, i), null, "un secret ne s'affiche pas");
});

test("droit d'un élément : <module>:open par défaut, préfixe imposé par le cœur", () => {
  assert.equal(S.itemRight("reviews", undefined), "reviews:open");
  assert.equal(S.itemRight("reviews", "moderate"), "reviews:moderate");
  assert.equal(S.itemRight("reviews", "a:b"), null);
  assert.equal(S.itemRight("reviews", "Bad"), null);
});

test("texte du manifeste : sa langue, puis celle du site, puis l'anglais", () => {
  const w = { fr: "Avis", en: "Reviews", de: "Bewertungen" };
  assert.equal(S.pickWords(w, "de", "fr"), "Bewertungen");
  assert.equal(S.pickWords(w, "es", "fr"), "Avis");
  assert.equal(S.pickWords({ en: "Reviews" }, "es", "fr"), "Reviews");
  assert.equal(S.pickWords(undefined, "fr", "fr"), "");
  assert.equal(S.fillCount("{n} avis", 3), "3 avis");
});
