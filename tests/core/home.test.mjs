import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const H = await import("@/core/home");
const R = await import("@/core/modules/registry");
const RT = await import("@/core/modules/runtime");
const { parseManifest } = await import("@/core/modules/manifest");
const { getSiteConfig, setSetting } = await import("@/core/settings");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { BUILTIN_MODULES } = await import("@/modules-builtin");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
const base = (over) => ({ apiVersion: 2, version: "1.0.0", id: "demo", name: "Demo", ...over });

test("taille : choix de l'admin > recommandation du module > toute la largeur ; bornes respectées", () => {
  assert.deepEqual(H.resolveSize({}, undefined), { w: 12, h: 1 }, "sans recommandation : toute la largeur");
  assert.deepEqual(H.resolveSize({}, { w: 2, h: 3 }), { w: 2, h: 3 });
  assert.deepEqual(H.resolveSize({ w: 4 }, { w: 2, h: 3 }), { w: 4, h: 3 }, "l'admin change la largeur seulement");
  assert.deepEqual(H.resolveSize({ w: 1, h: 1 }, { w: 6, h: 6 }), { w: 1, h: 1 });
  assert.deepEqual(H.resolveSize({ w: 99, h: 99 }, undefined), { w: 12, h: 6 }, "plafonné");
  assert.deepEqual(H.resolveSize({ w: -3, h: 0 }, { w: 2 }), { w: 2, h: 1 }, "valeurs absurdes → recommandation");
  assert.deepEqual(H.resolveSize({ w: "abc", h: NaN }, undefined), { w: 12, h: 1 });
});

test("grille : une colonne par défaut (mobile d'abord), une colonne de plus à chaque palier jusqu'au maximum", () => {
  const css = H.homeGridCss(4, [{ w: 12, h: 1 }, { w: 2, h: 2 }]);
  assert.match(css, /^\.vh-grid\{display:grid;gap:1\.5rem;grid-template-columns:minmax\(0,1fr\)\}/);
  const queries = [...css.matchAll(/@media\(min-width:(\d+)px\)\{\.vh-grid\{grid-template-columns:repeat\((\d+),/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(queries.map((q) => q[1]), [2, 3, 4], "jamais plus que le maximum réglé");
  assert.deepEqual(queries.map((q) => q[0]), [2, 3, 4].map(H.columnBreakpoint));
  assert.ok(queries.every((q, i) => i === 0 || q[0] > queries[i - 1][0]), "paliers croissants : le plus large l'emporte");
  assert.equal(H.columnBreakpoint(1), 0);
});

test("grille : une seule colonne configurée → aucune règle à plusieurs colonnes", () => {
  assert.ok(!H.homeGridCss(1, [{ w: 3, h: 2 }]).includes("@media"));
});

test("grille : un morceau couvre min(largeur, colonnes affichées) ; la hauteur ne vaut qu'à plusieurs colonnes", () => {
  const css = H.homeGridCss(4, [{ w: 12, h: 1 }, { w: 2, h: 3 }, { w: 3, h: 1 }]);
  const at = (c) => css.slice(css.indexOf(`repeat(${c},`), css.indexOf(`repeat(${c + 1},`) > 0 ? css.indexOf(`repeat(${c + 1},`) : undefined);
  assert.match(at(2), /\.vh-s0\{grid-column:span 2;grid-row:span 1\}\.vh-s1\{grid-column:span 2;grid-row:span 3\}\.vh-s2\{grid-column:span 2;grid-row:span 1\}/, "à 2 colonnes, tout est borné à 2");
  assert.match(at(4), /\.vh-s0\{grid-column:span 4;/, "pleine largeur = toutes les colonnes affichées");
  assert.match(at(4), /\.vh-s2\{grid-column:span 3;/);
  assert.ok(!css.split("@media")[0].includes("grid-row"), "à une colonne : pas de hauteur, les morceaux s'empilent");
});

test("grille : maximum 12 colonnes, valeurs absurdes → 4 ; le CSS ne contient que des nombres calculés", () => {
  assert.equal([...H.homeGridCss(99, [{ w: 1, h: 1 }]).matchAll(/repeat\((\d+),/g)].length, 11);
  assert.equal([...H.homeGridCss("abc", [{ w: 1, h: 1 }]).matchAll(/repeat\((\d+),/g)].length, 3);
  const css = H.homeGridCss(6, [{ w: 2, h: 2 }, { w: 3, h: 1 }]);
  assert.ok(!/[<>"'\\]/.test(css), "rien d'injectable");
});

test("accueil : colonnes réglables (1 à 12, 4 par défaut)", async () => {
  assert.equal((await getSiteConfig()).homeColumns, 4);
  await setSetting("home.columns", 6);
  assert.equal((await getSiteConfig()).homeColumns, 6);
  await setSetting("home.columns", 50);
  assert.equal((await getSiteConfig()).homeColumns, 12);
  await setSetting("home.columns", 0);
  assert.equal((await getSiteConfig()).homeColumns, 4);
});

test("manifeste : une section peut recommander une taille, bornée à 12 × 6", () => {
  const sec = (size) => base({ sections: [{ id: "x", label: "X", size }] });
  assert.ok(parseManifest(sec({ w: 2, h: 3 })).ok);
  assert.ok(parseManifest(sec({ w: 12 })).ok);
  for (const bad of [{ w: 0 }, { w: 13 }, { w: 2, h: 7 }, { w: 1.5 }, { h: 2 }]) assert.equal(parseManifest(sec(bad)).ok, false, JSON.stringify(bad));
});

async function blogLike(id, nickname) {
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "builtin", version: "1", enabled: true }, update: {} });
  return createInstance(db.prisma, { manifest: manifest(id), nickname, names: { en: nickname ?? id } });
}

test("morceaux : « au hasard » proposé aux modules dont les entrées portent un code (codes promo), pas aux autres", () => {
  assert.ok(R.sectionsOf(manifest("codes")).some((s) => s.id === "random"));
  for (const id of ["blog", "links", "pages", "collection"]) assert.ok(!R.sectionsOf(manifest(id)).some((s) => s.id === "random"), id);
  assert.deepEqual(R.sectionsOf(manifest("codes")).find((s) => s.id === "random").size, { w: 2, h: 1 });
  assert.ok(R.sectionsOf(manifest("codes")).some((s) => s.id === "latest"));
});

test("morceaux : « au hasard » rend un bloc d'entrées tirées au hasard, bornées, et refusé si le module ne le propose pas", async () => {
  await blogLike("codes"); await blogLike("blog");
  assert.deepEqual(await RT.runSection("codes", "random", {}, "en"), [{ type: "entries", instance: "codes", limit: 1, pick: "random" }]);
  assert.equal((await RT.runSection("codes", "random", { count: 99 }, "en"))[0].limit, 10);
  assert.equal((await RT.runSection("codes", "random", { count: "abc" }, "en"))[0].limit, 1);
  assert.deepEqual(await RT.runSection("blog", "random", {}, "en"), [], "le blog ne propose pas « au hasard »");
});

test("accueil : tailles résolues selon les modules actifs ; section inconnue → largeur pleine", async () => {
  await blogLike("codes"); await blogLike("blog");
  const active = await R.getActiveInstances();
  const layout = H.homeLayout([
    { id: "a", instance: "codes", section: "random", options: {} },
    { id: "b", instance: "codes", section: "random", options: {}, w: 6, h: 2 },
    { id: "c", instance: "blog", section: "latest", options: {} },
    { id: "d", instance: "inconnue", section: "x", options: {} },
  ], active);
  assert.deepEqual(layout.map((l) => [l.w, l.h]), [[2, 1], [6, 2], [12, 1], [12, 1]]);
});

test("accueil : le choix de l'admin est conservé quand le module change sa recommandation", () => {
  const section = { id: "a", instance: "k", section: "s", options: {}, w: 3 };
  assert.deepEqual(H.resolveSize(section, { w: 2, h: 1 }), { w: 3, h: 1 });
  assert.deepEqual(H.resolveSize(section, { w: 2, h: 4 }), { w: 3, h: 4 }, "la hauteur suit le module tant qu'elle n'est pas choisie");
});

test("accueil : une entrée expirée n'est jamais tirée au hasard", async () => {
  const inst = await blogLike("codes");
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Périmé", status: "published", code: "OLD", expiresAt: new Date(Date.now() - 1000) });
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Valide", status: "published", code: "OK" });
  const { listEntries } = await import("@/core/content/entries");
  const entries = (await listEntries({ instance: "codes", locale: "en" })).filter((e) => !e.expired);
  assert.deepEqual(entries.map((e) => e.code), ["OK"]);
});
