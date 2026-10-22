// Rangement dans Extensions (0.2.6) : la permission « overlay » ne fait plus d'un module à page ou à sections un simple overlay ; les sites existants ne bougent pas.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/menuPlacement");
const F = await import("@/core/modules/extensionFamilies");
const { installModule } = await import("@/core/modules/installer");
const { getModule } = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { getSetting, setSetting } = await import("@/core/settings");
const { freezeOverlayPlacements, PLACEMENT_FREEZE_MARKER } = await import("@/core/modules/placementFreeze");

beforeEach(() => db.reset());
after(() => db.close());

test("règle : permission « overlay » seule = simple overlay ; avec page ou sections = module ordinaire (sa catégorie décide)", () => {
  assert.equal(P.defaultPlacement({ permissions: ["routes", "overlay"] }), "overlays");
  assert.equal(P.defaultPlacement({ type: "overlay", page: true }), "overlays", "la catégorie « overlay » déclarée reste un overlay");
  assert.equal(P.defaultPlacement({ type: "utility", permissions: ["overlay"], mcp: [{}] }), "overlays");
  assert.equal(P.defaultPlacement({ type: "widget", permissions: ["overlay", "pages"], page: true }), "integrations");
  assert.equal(P.defaultPlacement({ type: "widget", permissions: ["overlay", "sections"], sections: [{ id: "s" }] }), "integrations");
  assert.equal(P.defaultPlacement({ type: "widget", permissions: ["overlay", "pages"], page: true, mcp: [{}] }), "menu", "des données à gérer : au menu");
  assert.equal(P.defaultPlacement({ type: "content", permissions: ["overlay"], page: true }), "menu");
  assert.equal(P.defaultPlacement({ type: "widget", permissions: ["overlay"], page: false, sections: [] }), "overlays");
});

test("choix possibles : un simple overlay (menu, overlays) ; un module à page qui sert aussi un overlay (menu, integrations, overlays) ; un choix « overlays » reste valable", () => {
  assert.deepEqual(P.placementsFor({ permissions: ["overlay"] }), ["menu", "overlays"]);
  assert.deepEqual(P.placementsFor({ permissions: ["overlay"], page: true }), ["menu", "integrations", "overlays"]);
  assert.deepEqual(P.placementsFor({ permissions: ["pages"], page: true }), ["menu", "integrations"]);
  const m = { type: "widget", permissions: ["overlay"], page: true };
  assert.equal(P.resolvePlacement(m, "overlays"), "overlays", "choix déjà enregistré : respecté");
  assert.equal(P.resolvePlacement(m, undefined), "integrations");
  assert.equal(P.resolvePlacement({ type: "widget", permissions: ["pages"], page: true }, "overlays"), "integrations", "sans capacité overlay : ignoré");
  assert.equal(P.unpinnedPlacementFor(m), "integrations");
  assert.equal(P.unpinnedPlacementFor({ permissions: ["overlay"] }), "overlays");
});

test("famille dans Extensions : suit la même règle", () => {
  assert.equal(F.extensionFamily({ permissions: ["overlay"] }), "overlays");
  assert.equal(F.extensionFamily({ type: "widget", permissions: ["overlay"], page: true }), "community");
  assert.equal(F.extensionFamily({ type: "content", permissions: ["overlay"], sections: [{ id: "a" }] }), "content");
});

const manifest = (id, extra) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", type: "widget", permissions: ["overlay", "pages"], ...extra });
async function withInstance(id, extra) {
  const repo = makeRepo({ "module.json": manifest(id, extra), "index.mjs": "export default {};" });
  assert.equal((await installModule(repo.url, { dependencies: false })).ok, true);
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: id } });
  return createInstance(db.prisma, { manifest: (await getModule(id)).manifest, nickname: id, names: { fr: id } });
}

test("sites existants : une instance qui était rangée dans Overlays le reste (une fois), sans écraser un choix ni toucher un simple overlay ; les nouvelles suivent la règle", async () => {
  const withPage = await withInstance("paged", { page: true });
  const chosen = await withInstance("choosy", { page: true });
  const simple = await withInstance("plain", {});
  await setSetting(P.placementSettingKey(chosen.id), "menu");
  assert.equal(await freezeOverlayPlacements(), 2 - 1, "une seule instance figée (celle sans choix)");
  assert.equal(await getSetting(P.placementSettingKey(withPage.id)), "overlays");
  assert.equal(await getSetting(P.placementSettingKey(chosen.id)), "menu", "le choix de la personne reste");
  assert.equal(await getSetting(P.placementSettingKey(simple.id)), undefined, "un simple overlay garde sa règle par défaut");
  assert.ok(await getSetting(PLACEMENT_FREEZE_MARKER));
  // Une instance créée APRÈS suit la nouvelle règle ; un second passage ne touche à rien.
  const later = await withInstance("later", { page: true });
  assert.equal(await freezeOverlayPlacements(), 0);
  assert.equal(await getSetting(P.placementSettingKey(later.id)), undefined);
  const mod = (await getModule("later")).manifest;
  assert.equal(P.resolvePlacement(mod, await getSetting(P.placementSettingKey(later.id))), "integrations");
  assert.equal(P.resolvePlacement((await getModule("paged")).manifest, await getSetting(P.placementSettingKey(withPage.id))), "overlays", "l'ancienne instance n'a pas bougé");
});
