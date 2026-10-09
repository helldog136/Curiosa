import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { foldText, matchesQuery, moduleSearchText, buildModuleGroups } from "../../src/core/modules/installedList.ts";
import { isCurrent } from "../../src/components/admin/navCurrent.ts";

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)/modules";
const ORDER = ["content", "social", "overlay", "widget"];
const mk = (id, type, name, extra = []) => ({ id, type, name, search: moduleSearchText([name, id, type === "social" ? "Réseaux sociaux" : type, ...extra]) });

test("recherche : sans accents ni majuscules, tous les mots, et vide = tout", () => {
  const s = moduleSearchText(["Chaîne YouTube", "youtube-channel", "Réseaux sociaux"]);
  assert.equal(foldText("Éléphant À"), "elephant a");
  assert.ok(matchesQuery(s, "CHAINE"));
  assert.ok(matchesQuery(s, "reseaux youtube"));
  assert.ok(matchesQuery(s, "  "));
  assert.ok(!matchesQuery(s, "twitch"));
});

test("recherche : retrouve un module par le surnom ou le nom d'une de ses instances", () => {
  const items = [mk("blog", "content", "Blog", ["Journal de bord", "blog-2"]), mk("links", "social", "Liens")];
  assert.deepEqual(buildModuleGroups(items, ORDER, "journal").map((g) => g.items.map((i) => i.id)), [["blog"]]);
  assert.deepEqual(buildModuleGroups(items, ORDER, "BLOG-2").flatMap((g) => g.items.map((i) => i.id)), ["blog"]);
});

test("recherche : aucun résultat donne une liste vide", () => {
  assert.deepEqual(buildModuleGroups([mk("blog", "content", "Blog")], ORDER, "zzz"), []);
});

test("liste : regroupée par catégorie dans l'ordre voulu, triée par nom, modules cassés en dernier, groupes vides cachés", () => {
  const items = [mk("w", "widget", "Météo"), mk("b", "broken", "b"), mk("c2", "content", "Pages"), mk("c1", "content", "Blog"), mk("x", "zzz", "Autre")];
  const groups = buildModuleGroups(items, ORDER);
  assert.deepEqual(groups.map((g) => g.type), ["content", "widget", "zzz", "broken"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["c1", "c2"]);
  assert.deepEqual(buildModuleGroups(items, ORDER, "reseaux"), []);
  assert.deepEqual(buildModuleGroups(items, ORDER, "content").map((g) => g.type), ["content"], "la catégorie est cherchable");
});

test("minipage : module inconnu = 404, actions et sidebar ramènent sur la bonne page", () => {
  const page = read(`${PANEL}/[id]/page.tsx`);
  assert.match(page, /if \(!row\) notFound\(\)/);
  assert.match(page, /ConfirmButton/);
  assert.ok(!/\bconfirm\(/.test(read("src/components/admin/ConfirmButton.tsx")), "jamais window.confirm");
  assert.match(read("src/components/admin/ConfirmButton.tsx"), /askConfirm/);
  const actions = read(`${PANEL}/actions.ts`);
  assert.match(actions, /const modulePage = \(id: string/);
  assert.ok(!/redirect\("\/admin\/modules\?error=(instances|modules)/.test(actions) && !actions.includes("`/admin/modules?error"), "les erreurs d'un module atterrissent sur sa page");
  assert.ok(isCurrent("/admin/modules", "/admin/modules/blog", "", { also: ["/admin/catalogue"] }), "« Modules » reste actif sur la minipage");
  const list = read(`${PANEL}/page.tsx`);
  assert.match(list, /CatalogueSearch/);
  assert.match(list, /peekModulesReport/, "pastille sans réseau");
  assert.ok(!list.includes("getModulesReport"), "pas de vérification réseau sur la liste");
});
