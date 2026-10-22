import test from "node:test";
import assert from "node:assert/strict";

const M = await import("@/core/menu");
const T = await import("@/core/menuTree");
const I = await import("@/core/menuInput");
const R = await import("@/core/menuResolve.ts").catch(() => null);
const E = await import("@/core/modules/menuEligibility");

const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? JSON.stringify(vars) : ""}`;
const leaf = (id, extra = {}) => ({ uid: id, kind: "link", href: `/${id}`, label: { fr: id }, ...extra });
const uids = (tree) => tree.map((n) => (n.children ? `${n.uid}[${n.children.map((c) => c.uid).join(",")}]` : n.uid)).join(" ");

// ─── Lecture défensive du réglage ─────────────────────────────────────────────

test("lecture défensive : absent, mauvaise version ou mauvais type → null (le cœur retombe sur l'ancien état) ; jamais d'exception", () => {
  for (const bad of [undefined, null, "x", 3, [], {}, { version: 2, items: [] }, { version: 1 }, { version: 1, items: "x" }]) assert.equal(M.parseStoredMenu(bad), null);
  assert.deepEqual(M.parseStoredMenu({ version: 1, items: [] }), []);
});

test("lecture défensive : éléments inconnus ou incomplets écartés, libellés nettoyés, trois niveaux impossibles, sous-menu vide retiré", () => {
  const out = M.parseStoredMenu({
    version: 1,
    items: [
      { kind: "wat", ref: "x" },
      { kind: "instance" },
      { kind: "instance", ref: "bad ref!" },
      { kind: "link", href: "   " },
      { kind: "instance", ref: "i1", label: { fr: "  Mon blog  ", "pas une langue": "x", en: 5 } },
      { kind: "group", label: { fr: "Vide" } },
      { kind: "group", label: { fr: "Plus" }, children: [{ kind: "entry", ref: "e1", children: [{ kind: "entry", ref: "deep" }] }, { kind: "group", label: { fr: "g" }, children: [] }, { kind: "link", href: "/a" }] },
    ],
  });
  assert.deepEqual(out, [
    { kind: "instance", ref: "i1", label: { fr: "Mon blog" } },
    { kind: "group", label: { fr: "Plus" }, children: [{ kind: "entry", ref: "e1" }, { kind: "link", href: "/a" }] },
  ]);
});

test("lecture défensive : un réglage trafiqué ne dépasse jamais 40 éléments (parents compris) ; libellés coupés à 80 caractères", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ kind: "link", href: `/p${i}`, label: { fr: "x".repeat(200) } }));
  const out = M.parseStoredMenu({ version: 1, items });
  assert.equal(out.length, M.MENU_MAX_TOTAL);
  assert.equal(out[0].label.fr.length, M.MENU_LABEL_MAX);
  const nested = M.parseStoredMenu({ version: 1, items: [{ kind: "group", label: { fr: "g" }, children: Array.from({ length: 80 }, (_, i) => ({ kind: "link", href: `/c${i}` })) }] });
  assert.equal(M.countNodes(nested), M.MENU_MAX_TOTAL);
});

test("plafonds documentés : 40 au total, 8 par sous-menu, deux niveaux", () => {
  assert.equal(M.MENU_MAX_TOTAL, 40);
  assert.equal(M.MENU_MAX_CHILDREN, 8);
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ kind: "link", href: `/c${i}` }));
  assert.deepEqual(M.checkCaps([{ kind: "group", label: { fr: "g" }, children: kids(8) }]), []);
  const over = M.checkCaps([{ kind: "link", href: "/a" }, { kind: "group", label: { fr: "g" }, children: kids(9) }]);
  assert.equal(over.length, 1);
  assert.equal(over[0].code, "children");
  assert.equal(over[0].path, "items.1");
  assert.equal(M.checkCaps([...kids(30), { kind: "group", children: kids(8) }, { kind: "group", children: kids(8) }])[0].code, "total");
});

// ─── Références ───────────────────────────────────────────────────────────────

test("références : clé d'identité, présence à tous les niveaux, lien libre vers la même adresse = déjà au menu", () => {
  const menu = [{ kind: "instance", ref: "i1" }, { kind: "group", label: { fr: "g" }, children: [{ kind: "entry", ref: "e1" }, { kind: "link", href: "/contact/?x=1#a" }] }];
  assert.deepEqual([...M.menuRefKeys(menu)].sort(), ["entry:e1", "instance:i1"]);
  assert.equal(M.refKey({ kind: "link" }), null);
  assert.ok(M.alreadyInMenu({ kind: "instance", ref: "i1", path: "/blog" }, menu));
  assert.ok(M.alreadyInMenu({ kind: "entry", ref: "e1", path: "/x" }, menu));
  assert.ok(M.alreadyInMenu({ kind: "instance", ref: "zz", path: "/contact" }, menu), "un lien libre /contact compte");
  assert.ok(!M.alreadyInMenu({ kind: "instance", ref: "zz", path: "/autre" }, menu));
  assert.equal(M.internalPath("//evil.com"), null);
  assert.equal(M.internalPath("https://x.be"), null);
  assert.equal(M.internalPath("/"), "/");
});

// ─── Recherche ────────────────────────────────────────────────────────────────

test("recherche : accents et majuscules ignorés, tous les mots doivent se trouver, recherche vide = tout", () => {
  assert.ok(M.matchesQuery("ete", "Les recettes de l'Été"));
  assert.ok(M.matchesQuery("ÉTÉ recettes", "recettes d'été"));
  assert.ok(!M.matchesQuery("hiver", "recettes d'été"));
  assert.ok(M.matchesQuery("", "n'importe quoi"));
  assert.ok(M.matchesQuery("  ", null));
  assert.ok(M.matchesQuery("cafe", undefined, "/le-café"));
  assert.equal(M.foldText("  À  PROPOS \n"), "a propos");
});

test("recherche par paquets : s'arrête dès qu'il y a assez de résultats, reprend où elle s'est arrêtée, ne lit jamais plus que le plafond", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}`, title: i % 10 === 0 ? `cible ${i}` : `autre ${i}` }));
  let fetched = 0;
  const fetch = async (cursor) => { const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0; const batch = rows.slice(start, start + 100); fetched += batch.length; return batch; };
  const base = { fetch, cursorOf: (r) => r.id, match: (r) => M.matchesQuery("cible", r.title), limit: 5, maxScan: 300 };
  const a = await M.scanMatches(base);
  assert.deepEqual(a.rows.map((r) => r.title), ["cible 0", "cible 10", "cible 20", "cible 30", "cible 40"]);
  assert.equal(a.next, "r0040", "reprend juste après le dernier résultat");
  const b = await M.scanMatches({ ...base, cursor: a.next });
  assert.equal(b.rows[0].title, "cible 50");
  // Rien ne correspond : la lecture s'arrête au plafond, sans lire les 1000 lignes.
  fetched = 0;
  const none = await M.scanMatches({ ...base, match: () => false, maxScan: 250 });
  assert.equal(none.rows.length, 0);
  assert.ok(fetched <= 300, `lu ${fetched}`);
  assert.equal(none.next, "r0299", "il reste peut-être des résultats plus loin : on peut continuer");
  // Fin de source : plus de suite.
  const end = await M.scanMatches({ ...base, cursor: "r0990", limit: 50, maxScan: 1000 });
  assert.equal(end.next, null);
});

// ─── Migration de l'ancien menu ───────────────────────────────────────────────

test("migration : instances « dans le menu » d'abord (ordre donné), puis l'ancien menu ; instances sans chemin ou masquées exclues", () => {
  const out = M.legacyMenu({
    instances: [
      { id: "a", basePath: "blog", showInNav: true },
      { id: "b", basePath: "cachee", showInNav: false },
      { id: "c", basePath: null, showInNav: true },
      { id: "d", basePath: "", showInNav: true },
      { id: "e", basePath: "liens", showInNav: true },
    ],
    custom: [
      { label: { fr: "Contact" }, href: "/contact" },
      { label: { fr: "Aide" }, href: "", children: [{ label: { fr: "FAQ" }, href: "/faq" }, { label: { fr: "Site" }, href: "https://monsite.be" }, { label: { fr: "vide" }, href: "" }] },
      { label: { fr: "Vide" }, href: "", children: [] },
      { label: {}, href: "https://autresite.be" },
    ],
    entryByHref: new Map([["/contact", "entry-contact"], ["/faq", "entry-faq"]]),
  });
  assert.deepEqual(out, [
    { kind: "instance", ref: "a" },
    { kind: "instance", ref: "e" },
    { kind: "entry", ref: "entry-contact", label: { fr: "Contact" } },
    { kind: "group", label: { fr: "Aide" }, children: [{ kind: "entry", ref: "entry-faq", label: { fr: "FAQ" } }, { kind: "link", href: "https://monsite.be", label: { fr: "Site" } }] },
    { kind: "link", href: "https://autresite.be" },
  ]);
});

// ─── Réorganisation (boutons) ─────────────────────────────────────────────────

test("réorganisation : monter / descendre à chaque niveau, sans sortir de sa liste", () => {
  let tree = [leaf("a"), leaf("b"), leaf("c", { children: [leaf("c1"), leaf("c2")] })];
  assert.equal(uids(T.moveNode(tree, "b", -1)), "b a c[c1,c2]");
  assert.equal(uids(T.moveNode(tree, "a", -1)), "a b c[c1,c2]", "au début : rien ne bouge");
  assert.equal(uids(T.moveNode(tree, "c", 1)), "a b c[c1,c2]", "à la fin : rien ne bouge");
  tree = T.moveNode(tree, "c2", -1);
  assert.equal(uids(tree), "a b c[c2,c1]");
  assert.equal(uids(T.moveNode(tree, "c1", 1)), "a b c[c2,c1]");
});

test("réorganisation : mettre dans le sous-menu du dessus / en sortir, au clavier comme au toucher (mêmes fonctions)", () => {
  const tree = [leaf("a"), leaf("b"), leaf("c")];
  const m = T.movesFor(tree, "a");
  assert.deepEqual(m.into, { ok: false, why: "first" });
  assert.deepEqual(T.movesFor(tree, "b").into, { ok: true, target: "a" });
  const in1 = T.indentNode(tree, "b");
  assert.equal(uids(in1), "a[b] c");
  const in2 = T.indentNode(in1, "c");
  assert.equal(uids(in2), "a[b,c]", "c se met dans a (son voisin du dessus au niveau principal)");
  assert.deepEqual(T.movesFor(in2, "b").out, { ok: true });
  assert.equal(uids(T.outdentNode(in2, "b")), "a[c] b", "sort juste après son parent");
  assert.equal(uids(T.outdentNode(T.outdentNode(in2, "c"), "b")), "a b c", "les deux sortis : retour à la liste plate");
  assert.deepEqual(T.movesFor(tree, "b").out, { ok: false, why: "top" });
  assert.equal(uids(T.indentNode(tree, "a")), "a b c", "premier élément : refusé, arbre inchangé");
});

test("réorganisation : jamais trois niveaux, jamais un sous-menu dans un sous-menu, jamais plus de 8 par sous-menu", () => {
  const withKids = [leaf("a"), leaf("b", { children: [leaf("b1")] })];
  assert.deepEqual(T.movesFor(withKids, "b").into, { ok: false, why: "hasChildren" });
  assert.equal(uids(T.indentNode(withKids, "b")), "a b[b1]");
  assert.deepEqual(T.movesFor([leaf("a"), { uid: "g", kind: "group", label: { fr: "g" } }], "g").into, { ok: false, why: "group" });
  const full = [{ ...leaf("a"), children: Array.from({ length: 8 }, (_, i) => leaf(`k${i}`)) }, leaf("z")];
  assert.deepEqual(T.movesFor(full, "z").into, { ok: false, why: "full" });
  assert.equal(uids(T.indentNode(full, "z")), uids(full), "sous-menu plein : refusé");
  assert.deepEqual(T.movesFor(full, "k0").into, { ok: false, why: "child" });
});

test("réorganisation : retirer, ajouter (plafond de 40), modifier ; l'argument n'est jamais modifié", () => {
  const tree = [leaf("a"), { ...leaf("b"), children: [leaf("b1")] }];
  const frozen = JSON.stringify(tree);
  assert.equal(uids(T.removeNode(tree, "b1")), "a b", "dernier enfant retiré : le parent n'a plus de sous-menu");
  assert.equal(uids(T.removeNode(tree, "a")), "b[b1]");
  assert.equal(uids(T.appendNode(tree, leaf("z"))), "a b[b1] z");
  const big = Array.from({ length: 40 }, (_, i) => leaf(`x${i}`));
  assert.equal(T.appendNode(big, leaf("one-more")).length, 40);
  assert.equal(T.patchNode(tree, "b1", { href: "/nouveau" })[1].children[0].href, "/nouveau");
  assert.equal(JSON.stringify(tree), frozen);
});

// ─── Contrôle de l'envoi de l'éditeur ─────────────────────────────────────────

const exists = new Set(["instance:i1", "entry:e1", "system:home", "redirect:r1", "instance:i2"]);
const validate = (raw, locales = ["fr", "en"]) => I.validateMenuInput(raw, { exists: (k, r) => exists.has(`${k}:${r}`), locales, t });

test("envoi : références vérifiées, doublons et éléments disparus ignorés, noms choisis gardés", () => {
  const r = validate([
    { k: "instance", ref: "i1", label: { fr: "Mon blog", en: " " } },
    { k: "instance", ref: "i1" },
    { k: "entry", ref: "gone" },
    { k: "system", ref: "home" },
    { k: "wat", ref: "x" },
    { k: "link", href: "", label: {} },
  ]);
  assert.deepEqual(r, { ok: true, items: [{ kind: "instance", ref: "i1", label: { fr: "Mon blog" } }, { kind: "system", ref: "home" }] });
});

test("envoi : lien libre indulgent puis strict, erreur sous le bon champ avec le bon chemin", () => {
  assert.deepEqual(validate([{ k: "link", href: "www.monsite.be/contact", label: { fr: "Contact" } }]).items, [{ kind: "link", href: "https://www.monsite.be/contact", label: { fr: "Contact" } }]);
  assert.deepEqual(validate([{ k: "link", href: "/contact", label: { fr: "C" } }]).items[0].href, "/contact");
  assert.deepEqual(validate([{ k: "link", href: "javascript:alert(1)", label: { fr: "x" } }]).errors, { "items.0.href": "error.badLink" });
  assert.equal(validate([{ k: "link", href: "//evil.com", label: { fr: "x" } }]).items[0].href, "https://evil.com", "un « //domaine » devient une adresse complète explicite, jamais un chemin interne");
  assert.deepEqual(validate([{ k: "link", href: "//localhost", label: { fr: "x" } }]).errors, { "items.0.href": "error.badLink" }, "pas de lien « protocole relatif » laissé tel quel");
  assert.deepEqual(validate([{ k: "system", ref: "home" }, { k: "link", href: "/a" }]).errors, { "items.1.label": "navigation.error.label" });
  assert.deepEqual(validate([{ k: "group", label: { fr: "G" }, items: [{ k: "link", href: "nimporte quoi", label: { fr: "x" } }] }]).errors, { "items.0.items.0.href": "error.badLink" });
  assert.deepEqual(validate([{ k: "group", items: [{ k: "system", ref: "home" }] }]).errors, { "items.0.label": "navigation.error.label" }, "un sous-menu doit avoir un nom");
});

test("envoi : n'importe quel élément peut avoir un sous-menu ; un sous-menu vide est ignoré ; un sous-menu dans un sous-menu aussi", () => {
  const r = validate([
    { k: "instance", ref: "i1", items: [{ k: "entry", ref: "e1" }, { k: "group", label: { fr: "non" }, items: [{ k: "system", ref: "home" }] }] },
    { k: "group", label: { fr: "Vide" }, items: [] },
    { k: "group", label: { fr: "Aide" }, items: [{ k: "redirect", ref: "r1" }] },
  ]);
  assert.deepEqual(r.items, [
    { kind: "instance", ref: "i1", children: [{ kind: "entry", ref: "e1" }] },
    { kind: "group", label: { fr: "Aide" }, children: [{ kind: "redirect", ref: "r1" }] },
  ]);
});

test("envoi : si le parent a disparu, ses sous-éléments remontent d'un niveau au lieu de disparaître", () => {
  const r = validate([{ k: "entry", ref: "gone", items: [{ k: "instance", ref: "i2" }] }]);
  assert.deepEqual(r.items, [{ kind: "instance", ref: "i2" }]);
});

test("envoi : plafonds appliqués côté serveur — 9 éléments dans un sous-menu : erreur SOUS l'élément ; 41 au total : erreur générale", () => {
  const link = (i) => ({ k: "link", href: `/p${i}`, label: { fr: `P${i}` } });
  const r = validate([link(0), { k: "group", label: { fr: "G" }, items: Array.from({ length: 9 }, (_, i) => link(i + 1)) }]);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors), ["items.1"]);
  assert.match(r.errors["items.1"], /^navigation\.error\.children/);
  const tooMany = validate(Array.from({ length: 41 }, (_, i) => link(i)));
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /^navigation\.error\.total/);
  assert.equal(validate(Array.from({ length: 40 }, (_, i) => link(i))).ok, true);
  assert.equal(validate("pas une liste").ok, false);
  assert.equal(validate(Array.from({ length: 200 }, (_, i) => link(i))).ok, false, "un envoi énorme est refusé sans être parcouru");
});

test("envoi : les références citées sont relevées pour être vérifiées en une fois (bornées)", () => {
  const cited = I.citedRefs([{ k: "instance", ref: "a", items: [{ k: "entry", ref: "b" }] }, { k: "link", href: "/x" }, { k: "group", label: {}, items: [{ k: "system", ref: "home" }] }, "x", null]);
  assert.deepEqual(cited, [{ kind: "instance", ref: "a" }, { kind: "entry", ref: "b" }, { kind: "system", ref: "home" }]);
  assert.deepEqual(I.citedRefs("x"), []);
});

// ─── Rendu public (pur) ───────────────────────────────────────────────────────

test("rendu : nom choisi dans la langue du visiteur, sinon nom d'origine dans sa langue, puis langue du site", () => {
  const { pickLabel } = R;
  assert.equal(pickLabel({ fr: "Mon blog" }, { fr: "Blog", en: "Blog" }, "fr", "fr"), "Mon blog");
  assert.equal(pickLabel({ fr: "Mon blog" }, { fr: "Blog", en: "Journal" }, "en", "fr"), "Journal", "pas de nom choisi en anglais : le nom d'origine anglais");
  assert.equal(pickLabel({ fr: "Mon blog" }, {}, "nl", "fr"), "Mon blog");
  assert.equal(pickLabel(undefined, { en: "Home" }, "fr", "fr"), "Home");
  assert.equal(pickLabel(undefined, {}, "fr", "fr"), "");
});

test("rendu : sous-menus à deux niveaux, éléments introuvables ignorés, enfants du parent disparu remontés, sous-menu sans rien dedans absent", () => {
  const known = {
    "instance:i1": { labels: { fr: "Blog" }, href: "/blog", news: true },
    "entry:e1": { labels: { fr: "Recette" }, href: "/blog/recette" },
    "system:home": { labels: { fr: "Accueil" }, href: "/" },
  };
  const resolve = (n) => (n.kind === "link" ? { labels: {}, href: n.href } : known[`${n.kind}:${n.ref}`] ?? null);
  const out = R.buildPublicItems([
    { kind: "system", ref: "home" },
    { kind: "instance", ref: "i1", children: [{ kind: "entry", ref: "e1" }, { kind: "entry", ref: "disparue" }] },
    { kind: "entry", ref: "disparue", children: [{ kind: "link", href: "/orphelin", label: { fr: "Orphelin" } }] },
    { kind: "group", label: { fr: "Aide" }, children: [{ kind: "entry", ref: "disparue" }] },
    { kind: "group", label: { fr: "Plus" }, children: [{ kind: "link", href: "https://monsite.be", label: { fr: "Site" } }] },
  ], resolve, "fr", "fr");
  assert.deepEqual(out, [
    { label: "Accueil", href: "/", news: false },
    { label: "Blog", href: "/blog", news: true, children: [{ label: "Recette", href: "/blog/recette", news: false }] },
    { label: "Orphelin", href: "/orphelin", news: false },
    { label: "Plus", href: "", news: false, children: [{ label: "Site", href: "https://monsite.be", news: false }] },
  ]);
});

// ─── Règle unique : qui peut entrer au menu, qui est suggéré ─────────────────

test("règle du cœur : une instance entre au menu si elle a une page et n'est pas une source OBS ; la suggestion d'un module n'impose jamais rien", () => {
  const content = { display: "list", clickAction: "detail", features: [] };
  assert.equal(E.menuEligible({ content, permissions: [] }), true);
  assert.equal(E.menuEligible({ content, type: "overlay", permissions: [] }), false, "overlay : pas de page publique");
  assert.equal(E.menuEligible({ page: true, type: "overlay", permissions: [] }), false);
  // 0.2.6 : la permission « overlay » seule ne fait plus d'un module avec page une source OBS (le type « overlay », lui, reste sans page publique).
  assert.equal(E.menuEligible({ page: true, permissions: ["overlay"] }), true, "page + permission overlay : un module comme les autres");
  assert.equal(E.menuEligible({ content, permissions: ["overlay"] }), false, "permission overlay sans page ni section : simple source OBS");
  assert.equal(E.menuEligible({ permissions: [] }), false, "ni page ni contenu");
  assert.equal(E.menuEligible({ page: false, content, permissions: [] }), false);
  // Suggestion : suggestInMenu, sinon content.showInNav, sinon non.
  assert.equal(E.suggestsMenu({ content: { ...content, showInNav: true }, permissions: [] }), true);
  assert.equal(E.suggestsMenu({ content: { ...content, showInNav: true }, suggestInMenu: false, permissions: [] }), false);
  assert.equal(E.suggestsMenu({ page: true, suggestInMenu: true, permissions: [] }), true);
  assert.equal(E.suggestsMenu({ content, permissions: [] }), false, "rien de déclaré : pas suggérée");
  assert.equal(E.suggestsMenu({ content: { ...content, showInNav: true }, type: "overlay", permissions: [] }), false, "pas de suggestion pour ce qui ne peut pas entrer");
});
