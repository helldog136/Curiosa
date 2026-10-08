import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { migrateBlocksModule } = await import("@/core/migrations/blocksToCore");
const H = await import("@/core/homeBlocks");

beforeEach(() => db.reset());
after(() => db.close());

const IMG = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png";
const set = (key, value, locale = "") => db.prisma.setting.create({ data: { key, locale, value: JSON.stringify(value) } });

async function legacy(key, settings, entries = []) {
  await db.prisma.module.upsert({ where: { id: "blocks" }, create: { id: "blocks", source: "builtin", version: "1.0.0", enabled: true }, update: {} });
  const inst = await db.prisma.moduleInstance.create({ data: { moduleId: "blocks", key, basePath: null, display: "links" } });
  for (const [k, v, l] of settings) await set(`instance.${inst.id}.${k}`, v, l ?? "");
  for (const [i, e] of entries.entries()) {
    const entry = await db.prisma.entry.create({ data: { instanceId: inst.id, status: "published", sourceLocale: "fr", position: i, cover: e.cover ?? null } });
    for (const [locale, tr] of Object.entries(e.tr)) await db.prisma.entryTranslation.create({ data: { entryId: entry.id, instanceId: inst.id, locale, slug: `${key}-${i}-${locale}`, title: tr.title, summary: tr.summary ?? "", body: tr.body ?? "" } });
  }
  return inst;
}

test("migration : un bloc d'onglets de l'ancien module devient un bloc du cœur, à la même place de l'accueil, avec textes, images et onglets ; l'ancien module disparaît", async () => {
  await set("i18n.enabled", ["fr", "en"]); await set("i18n.default", "fr");
  const inst = await legacy("blocks-avantages", [
    ["kind", "tabs"], ["title", "Profitez des avantages", "fr"], ["title", "Enjoy the benefits", "en"], ["eyebrow", "Pourquoi ?", "fr"], ["text", "Un **texte**", "fr"],
    ["buttonLabel", "Adhérer", "fr"], ["buttonUrl", "/adhesion"], ["image1", IMG], ["tone", "surface"], ["bgImage", IMG], ["bgSize", "contain"], ["bgPosition", "top-right"], ["bgVeil", "dark"],
  ], [
    { tr: { fr: { title: "Événements", summary: "Mémorables", body: "Le texte" }, en: { title: "Events", summary: "Memorable", body: "The text" } }, cover: IMG },
    { tr: { fr: { title: "Rabais" } } },
  ]);
  await set("home.sections", [
    { id: "a", instance: "autre", section: "latest", options: {} },
    { id: "b", instance: "blocks-avantages", section: "block", options: {}, size: "large", isolated: true },
  ]);
  assert.equal(await migrateBlocksModule(), 1);
  const home = JSON.parse((await db.prisma.setting.findUnique({ where: { key_locale: { key: "home.sections", locale: "" } } })).value);
  assert.equal(home.length, 2);
  assert.deepEqual(home[0], { id: "a", instance: "autre", section: "latest", options: {} }, "les autres lignes ne bougent pas");
  assert.equal(home[1].instance, "core");
  assert.equal(home[1].section, "block");
  assert.equal(home[1].size, "large", "même taille");
  assert.equal(home[1].isolated, true);
  const b = home[1].options.block;
  assert.equal(b.kind, "tabs");
  assert.deepEqual(b.title, { fr: "Profitez des avantages", en: "Enjoy the benefits" });
  assert.deepEqual(b.eyebrow, { fr: "Pourquoi ?" }, "texte non traduit en anglais : pas inventé");
  assert.equal(b.buttonUrl, "/adhesion");
  assert.deepEqual(b.images, [IMG]);
  assert.equal(b.tone, "surface");
  assert.deepEqual(b.bg, { src: IMG, size: "contain", position: "top-right", veil: "dark" });
  assert.equal(b.items.length, 2);
  assert.deepEqual(b.items[0].title, { fr: "Événements", en: "Events" });
  assert.deepEqual(b.items[0].heading, { fr: "Mémorables", en: "Memorable" });
  assert.equal(b.items[0].image, IMG);
  assert.deepEqual(b.items[1].title.fr, "Rabais");
  assert.deepEqual(H.normalizeBlockDef(b, ["fr", "en"]), b, "le résultat est déjà une définition valide");
  // Nettoyage : instance, entrées, réglages et module disparus.
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "blocks" } }), 0);
  assert.equal(await db.prisma.entry.count({ where: { instanceId: inst.id } }), 0);
  assert.equal(await db.prisma.setting.count({ where: { key: { startsWith: `instance.${inst.id}.` } } }), 0);
  assert.equal(await db.prisma.module.count({ where: { id: "blocks" } }), 0);
  assert.ok(H.blockToBlocks(b, "en", "fr")[0].items.length === 2);
});

test("migration : idempotente (rien à faire la deuxième fois), plusieurs blocs, et une ligne de module orpheline est nettoyée", async () => {
  await set("i18n.default", "fr");
  await legacy("blocks-un", [["kind", "cta"], ["title", "Rejoignez-nous", "fr"]]);
  await legacy("blocks-deux", [["kind", "stats"]], [{ tr: { fr: { title: "12 000+", summary: "membres" } } }]);
  await set("home.sections", [{ id: "1", instance: "blocks-un", section: "block", options: {} }, { id: "2", instance: "blocks-deux", section: "block", options: {} }]);
  assert.equal(await migrateBlocksModule(), 2);
  const home = JSON.parse((await db.prisma.setting.findUnique({ where: { key_locale: { key: "home.sections", locale: "" } } })).value);
  assert.deepEqual(home.map((s) => s.instance), ["core", "core"]);
  assert.equal(home[1].options.block.items[0].title.fr, "12 000+");
  assert.equal(await migrateBlocksModule(), 0);
  await db.prisma.module.create({ data: { id: "blocks", source: "builtin", version: "1.0.0", enabled: true } });
  assert.equal(await migrateBlocksModule(), 0);
  assert.equal(await db.prisma.module.count({ where: { id: "blocks" } }), 0, "ligne de module sans instance : supprimée");
});
