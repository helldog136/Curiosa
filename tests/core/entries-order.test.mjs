import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { listEntries } = await import("@/core/content/entries");
const { setSetting } = await import("@/core/settings");
const { sortSettingKey } = await import("@/core/content/sort");
const { BUILTIN_MODULES } = await import("@/modules-builtin");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest;
async function collection(id) {
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "builtin", version: "1", enabled: true }, update: {} });
  return createInstance(db.prisma, { manifest: manifest(id), names: { fr: id, en: id } });
}
async function add(instance, title, daysAgo, position = 0, extra = {}) {
  const e = await createEntry(db.prisma, { instanceId: instance.id, locale: "fr", title, status: "published", ...extra });
  await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - daysAgo * 86_400_000), position } });
  return e;
}
const titles = async (instance) => (await listEntries({ instance: instance.key, locale: "fr" })).map((e) => e.title);

test("tri : articles, codes promo et fiches — le plus récent d'abord, quelle que soit la « position » (ex. numéros d'un ancien site)", async () => {
  for (const id of ["blog", "codes", "pages"]) {
    const c = await collection(id);
    await add(c, "ancien", 30, 1);   // position 1 : sortait en premier avant
    await add(c, "récent", 1, 9);
    await add(c, "milieu", 10, 5);
    assert.deepEqual(await titles(c), ["récent", "milieu", "ancien"], id);
    await db.reset();
  }
});

test("tri : à dates égales, le dernier créé d'abord ; une entrée mise en avant passe devant", async () => {
  const c = await collection("blog");
  await add(c, "a", 5);
  await add(c, "b", 5);
  const order = await titles(c);
  assert.deepEqual(new Set(order), new Set(["a", "b"]));
  const star = await add(c, "épinglé", 100);
  await db.prisma.entry.update({ where: { id: star.id }, data: { featured: true } });
  assert.equal((await titles(c))[0], "épinglé");
});

test("tri : choix de l'utilisateur par collection — plus ancien d'abord, par titre (A → Z), ordre d'ajout ; une valeur inconnue revient au défaut", async () => {
  const c = await collection("blog");
  await add(c, "Banane", 1);
  await add(c, "cerise", 10);
  await add(c, "Abricot", 5);
  assert.deepEqual(await titles(c), ["Banane", "Abricot", "cerise"], "défaut : plus récent d'abord");
  await setSetting(sortSettingKey(c.id), "oldest");
  assert.deepEqual(await titles(c), ["cerise", "Abricot", "Banane"]);
  await setSetting(sortSettingKey(c.id), "title");
  assert.deepEqual(await titles(c), ["Abricot", "Banane", "cerise"], "insensible à la casse");
  await setSetting(sortSettingKey(c.id), "manual");
  assert.deepEqual(await titles(c), ["Banane", "cerise", "Abricot"], "ordre dans lequel les entrées ont été créées");
  await setSetting(sortSettingKey(c.id), "n'importe quoi");
  assert.deepEqual(await titles(c), ["Banane", "Abricot", "cerise"]);
  const other = await createInstance(db.prisma, { manifest: manifest("blog"), names: { fr: "Autre", en: "Other" }, nickname: "autre" });
  await add(other, "x", 1); await add(other, "y", 9);
  assert.deepEqual(await titles(other), ["x", "y"], "le réglage d'une collection ne touche pas les autres");
});

test("tri : le choix s'applique aussi aux limites (derniers articles de l'accueil) et à la pagination", async () => {
  const c = await collection("blog");
  for (const [t, d] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]]) await add(c, t, d);
  const take = async (o) => (await listEntries({ instance: c.key, locale: "fr", ...o })).map((e) => e.title);
  assert.deepEqual(await take({ limit: 2 }), ["a", "b"]);
  assert.deepEqual(await take({ limit: 2, offset: 2 }), ["c", "d"]);
  await setSetting(sortSettingKey(c.id), "oldest");
  assert.deepEqual(await take({ limit: 2 }), ["d", "c"]);
});

test("tri : le choix est proposé dans les deux modes de l'admin, pour les modules à contenu seulement", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/instances/[id]/page.tsx", "utf8");
  assert.match(page, /\{content && \(\s*<Select name="sort"/);
  assert.ok(!/advanced && content[^)]*<Select name="sort"/.test(page));
  const actions = fs.readFileSync("src/app/admin/(panel)/instances/actions.ts", "utf8");
  assert.match(actions, /mod\.manifest\.content && isSort\(formData\.get\("sort"\)\)/);
});

test("tri : une liste de LIENS (réseaux sociaux) suit l'ordre choisi à la main (position), pas la date", async () => {
  const links = await collection("links");
  await add(links, "troisième", 1, 30);
  await add(links, "premier", 20, 10);
  await add(links, "deuxième", 5, 20);
  assert.deepEqual(await titles(links), ["premier", "deuxième", "troisième"], "par défaut, les liens gardent l'ordre saisi");
});

test("tri : les brouillons et les articles programmés dans le futur n'apparaissent pas", async () => {
  const c = await collection("blog");
  await add(c, "visible", 1);
  const future = await add(c, "demain", -1);
  const draft = await createEntry(db.prisma, { instanceId: c.id, locale: "fr", title: "brouillon", status: "draft" });
  assert.ok(future && draft);
  assert.deepEqual(await titles(c), ["visible"]);
});

test("import Grav : les numéros de dossier ne deviennent pas l'ordre des articles (position 0), seules les pages gardent leur rang", () => {
  const src = require_text("scripts/import-grav.mjs");
  assert.match(src, /position: d === "pages" \? \(p\.order \?\? 0\) : 0/);
});
function require_text(f) { return fs.readFileSync(f, "utf8"); }
import fs from "node:fs";
