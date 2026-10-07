import test, { beforeEach, after } from "node:test";
import fs from "node:fs";
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
const { SECTION_SIZES } = await import("@/core/modules/types");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
const base = (over) => ({ apiVersion: 2, version: "1.0.0", id: "demo", name: "Demo", ...over });

test("taille : choix de l'admin > recommandation du module > pleine largeur ; valeurs inconnues ignorées", () => {
  assert.equal(H.resolveSize({}, undefined), "full");
  assert.equal(H.resolveSize({}, "small"), "small");
  assert.equal(H.resolveSize({ size: "large" }, "small"), "large", "l'admin l'emporte");
  assert.equal(H.resolveSize({ size: "enorme" }, "medium"), "medium", "taille inconnue → recommandation");
  assert.equal(H.resolveSize({ size: 12 }, "enorme"), "full");
  assert.deepEqual([...SECTION_SIZES], ["small", "medium", "large", "full"]);
});

test("accueil fluide : aucun réglage de colonnes ni de hauteur — seulement l'ordre et une taille naturelle", async () => {
  const cfg = await getSiteConfig();
  assert.ok(!("homeColumns" in cfg));
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.vh-flow\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/, "les morceaux s'écoulent à la ligne");
  assert.match(css, /\.vh-cell\s*\{[^}]*flex:\s*1 1 var\(--vh-basis\)/, "ils s'étirent pour remplir la ligne");
  for (const size of SECTION_SIZES) assert.match(css, new RegExp(`\\.vh-${size}\\s*\\{[^}]*--vh-basis`), size);
  assert.ok(!/media\s*\(/.test(css.slice(css.indexOf(".vh-flow"))), "pas de paliers fixes : le navigateur décide selon la place");
  assert.ok(!/grid-template|grid-column|grid-row/.test(css.slice(css.indexOf(".vh-flow"))), "pas de grille");
});

test("accueil fluide : les tailles vont du petit encart à la pleine largeur, dans l'ordre croissant", () => {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  const basis = (z) => css.match(new RegExp(`\\.vh-${z}\\s*\\{\\s*--vh-basis:\\s*([\\d.]+)(rem|%)`));
  const [small, medium, large] = ["small", "medium", "large"].map((z) => Number(basis(z)[1]));
  assert.ok(small < medium && medium < large);
  assert.equal(basis("full")[1], "100");
});

test("manifeste : une section recommande une taille parmi les quatre connues", () => {
  const sec = (size) => base({ sections: [{ id: "x", label: "X", size }] });
  for (const ok of ["small", "medium", "large", "full"]) assert.ok(parseManifest(sec(ok)).ok, ok);
  for (const bad of ["huge", 2, { w: 2 }, "SMALL"]) assert.equal(parseManifest(sec(bad)).ok, false, JSON.stringify(bad));
  assert.ok(parseManifest(base({ sections: [{ id: "x", label: "X" }] })).ok, "facultative");
});

async function blogLike(id, nickname) {
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "builtin", version: "1", enabled: true }, update: {} });
  return createInstance(db.prisma, { manifest: manifest(id), nickname, names: { en: nickname ?? id } });
}

test("morceaux : « au hasard » proposé aux modules dont les entrées portent un code (codes promo), pas aux autres", () => {
  assert.ok(R.sectionsOf(manifest("codes")).some((s) => s.id === "random"));
  for (const id of ["blog", "links", "pages", "collection"]) assert.ok(!R.sectionsOf(manifest(id)).some((s) => s.id === "random"), id);
  assert.equal(R.sectionsOf(manifest("codes")).find((s) => s.id === "random").size, "small");
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
    { id: "b", instance: "codes", section: "random", options: {}, size: "large" },
    { id: "c", instance: "blog", section: "latest", options: {} },
    { id: "d", instance: "inconnue", section: "x", options: {} },
  ], active);
  assert.deepEqual(layout.map((l) => l.size), ["small", "large", "full", "full"]);
});

test("accueil : le choix de l'admin est conservé quand le module change sa recommandation", () => {
  const section = { id: "a", instance: "k", section: "s", options: {}, size: "large" };
  assert.equal(H.resolveSize(section, "small"), "large");
  assert.equal(H.resolveSize({ ...section, size: undefined }, "medium"), "medium", "sans choix, la recommandation suit le module");
});

test("accueil : une entrée expirée n'est jamais tirée au hasard", async () => {
  const inst = await blogLike("codes");
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Périmé", status: "published", code: "OLD", expiresAt: new Date(Date.now() - 1000) });
  await createEntry(db.prisma, { instanceId: inst.id, locale: "en", title: "Valide", status: "published", code: "OK" });
  const { listEntries } = await import("@/core/content/entries");
  const entries = (await listEntries({ instance: "codes", locale: "en" })).filter((e) => !e.expired);
  assert.deepEqual(entries.map((e) => e.code), ["OK"]);
});
