import test, { beforeEach, after } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { getInstanceLabeler } = await import("@/core/modules/labels");
const { getAdminNav } = await import("@/core/modules/adminNav");
const { listInstances } = await import("@/core/instances");
const { createInstance } = await import("@/core/instanceService");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id) => FIXTURE_MODULES.find((b) => b.manifest.id === id).manifest;
const rename = (instanceId, name) => db.prisma.instanceTranslation.update({ where: { instanceId_locale: { instanceId, locale: "en" } }, data: { name } });
const navNames = async () => (await getAdminNav("en", "en")).flatMap((g) => g.items.map((i) => i.name));

test("renommer l'instance seule d'un module : le menu de gauche, les libellés d'admin et la liste d'instances montrent le nouveau nom", async () => {
  await db.fixture("hero");
  const hero = await createInstance(db.prisma, { manifest: manifest("hero"), names: { en: "Hero" } });
  assert.deepEqual(await navNames(), ["Hero"]);
  await rename(hero.id, "Hero2");
  assert.deepEqual(await navNames(), ["Hero2"], "le menu suit le nom enregistré (pas le nom du module)");
  const labeler = await getInstanceLabeler("en", "en");
  assert.equal(labeler.label((await listInstances()).find((i) => i.id === hero.id)), "Hero2");
});

test("plusieurs instances : le surnom prime ; le changer se voit tout de suite dans le menu", async () => {
  await db.fixture("blog");
  const a = await createInstance(db.prisma, { manifest: manifest("blog"), nickname: "Actus", names: { en: "Actus" } });
  await createInstance(db.prisma, { manifest: manifest("blog"), nickname: "Chaîne 2", names: { en: "Chaîne 2" } });
  assert.deepEqual((await navNames()).sort(), ["Actus", "Chaîne 2"]);
  await db.prisma.moduleInstance.update({ where: { id: a.id }, data: { nickname: "Nouvelles" } });
  assert.deepEqual((await navNames()).sort(), ["Chaîne 2", "Nouvelles"]);
});

test("non-régression : toute action qui change un nom ou un surnom invalide le cache de tout le site (menu admin, menu public, listes)", () => {
  const src = (p) => fs.readFileSync(p, "utf8");
  const body = (code, name) => code.slice(code.indexOf(`export async function ${name}`)).split(/\nexport async function /)[0];
  const instances = src("src/app/admin/(panel)/instances/actions.ts");
  const modules = src("src/app/admin/(panel)/modules/actions.ts");
  for (const [code, name] of [[instances, "saveInstance"], [modules, "addInstance"], [instances, "deleteInstanceAction"]]) {
    assert.match(body(code, name), /revalidatePath\("\/", "layout"\)/, `${name} doit revalider tout le site`);
  }
  // Le libellé d'admin d'une instance seule est son nom public : sans cela, le renommage n'apparaîtrait jamais dans le menu.
  assert.match(src("src/core/instanceLabel.ts"), /if \(!needsNickname\(siblings\)\) return i\.publicName\?\.trim\(\) \|\| moduleName;/);
});
