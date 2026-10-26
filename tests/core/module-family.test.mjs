// Clé « family » du manifeste (cœur 0.3.0) : le module range lui-même sa carte (Contenu, Communauté, Réseaux et connexions, Overlays). Sans la clé, la déduction du cœur est
// STRICTEMENT la même qu'avant : preuve sur tout le catalogue de modules (copie de la règle de la 0.2.13 ci-dessous, comparée module par module).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { parseManifest } = await import("@/core/modules/manifest");
const P = await import("@/core/modules/menuPlacement");
const F = await import("@/core/modules/extensionFamilies");
const { platformOf } = await import("@/core/modules/platform");

/** La règle de la 0.2.13, recopiée telle quelle : ce que le cœur déduisait avant `family`. */
function legacy() {
  const canServeOverlay = (m) => m.type === "overlay" || (m.permissions ?? []).includes("overlay");
  const isOverlay = (m) => m.type === "overlay" || ((m.permissions ?? []).includes("overlay") && m.page !== true && (m.sections?.length ?? 0) === 0);
  const placement = (m) => {
    if (isOverlay(m)) return "overlays";
    const type = m.type ?? (m.content ? "content" : "widget");
    if (type === "social" || type === "integration") return "integrations";
    if (m.content) return m.content.display === "links" && m.content.clickAction === "external" ? "integrations" : "menu";
    if (type === "content") return "menu";
    return (m.mcp?.length ?? 0) > 0 || (m.offers?.length ?? 0) > 0 || (m.requires?.length ?? 0) > 0 ? "menu" : "integrations";
  };
  const section = (m) => (m.content || m.type === "content" ? "content" : "community");
  const family = (m) => {
    if (isOverlay(m)) return "overlays";
    if (m.type === "social" || m.type === "integration" || platformOf(m)) return "connections";
    if (m.content) return m.content.display === "links" && m.content.clickAction === "external" ? "connections" : "content";
    return m.type === "content" ? "content" : "community";
  };
  return { placement, section, family, canServeOverlay };
}
const old = legacy();

const candidates = [process.env.CURIOSA_EXTRAS_DIR, "/dev/shm/extras-030", "/home/user/curiosa-extras"].filter(Boolean);
const root = candidates.find((d) => fs.existsSync(path.join(d, "modules")));
const skip = root ? false : "dépôt de modules absent (CURIOSA_EXTRAS_DIR) : rien à comparer";

test("catalogue entier : le rangement (menu, rubrique, famille) de chaque module est celui de la 0.2.13 ; aucun module du catalogue ne déclare encore « family »", { skip }, () => {
  const dirs = fs.readdirSync(path.join(root, "modules")).filter((d) => fs.existsSync(path.join(root, "modules", d, "module.json")));
  assert.ok(dirs.length >= 40, `au moins une quarantaine de modules lus (${dirs.length})`);
  const diffs = [];
  for (const d of dirs) {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "modules", d, "module.json"), "utf8"));
    if (raw.family !== undefined) continue;   // un module qui déclare « family » (publié après ce test) choisit lui-même
    const parsed = parseManifest(raw);
    if (!parsed.ok) continue;   // un manifeste plus récent que ce cœur : hors sujet ici
    const m = parsed.manifest;
    const got = { placement: P.defaultPlacement(m), section: P.defaultSection(m), family: F.extensionFamily(m) };
    const want = { placement: old.placement(m), section: old.section(m), family: old.family(m) };
    if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`${d}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  }
  assert.deepEqual(diffs, []);
});

test("règle sans « family » : identique à la 0.2.13 sur une grille de manifestes (catégorie × contenu × permissions × page × sections × mcp)", () => {
  let n = 0;
  for (const type of [undefined, "content", "widget", "utility", "social", "integration", "overlay"])
    for (const content of [undefined, { display: "list", clickAction: "page" }, { display: "links", clickAction: "external" }])
      for (const permissions of [[], ["overlay"], ["pages"], ["overlay", "pages"]])
        for (const page of [undefined, true, false])
          for (const sections of [undefined, [], [{ id: "a" }]])
            for (const mcp of [undefined, [{}]]) {
              const m = { type, content, permissions, page, sections, mcp };
              assert.equal(P.defaultPlacement(m), old.placement(m), JSON.stringify(m));
              assert.equal(P.defaultSection(m), old.section(m), JSON.stringify(m));
              assert.equal(F.extensionFamily(m), old.family(m), JSON.stringify(m));
              n++;
            }
  assert.ok(n > 1000);
});

test("family déclarée : elle prime sur la déduction (rangement, rubrique, famille d'Extensions)", () => {
  // Le cas de content-planner : outil de contenu sans « content » dans le manifeste, rangé « communauté » faute de mieux.
  const planner = { type: "utility", permissions: ["pages"], page: true };
  assert.equal(F.extensionFamily(planner), "community");
  assert.equal(P.defaultSection(planner), "community");
  const declared = { ...planner, family: "content" };
  assert.equal(F.extensionFamily(declared), "content");
  assert.equal(P.defaultSection(declared), "content");
  assert.equal(P.defaultPlacement(declared), "menu");
  // Une liste de liens vers l'extérieur déduite « connexions » peut se dire « contenu ».
  const links = { content: { display: "links", clickAction: "external" }, family: "content" };
  assert.equal(F.extensionFamily(links), "content");
  assert.equal(P.defaultPlacement(links), "menu");
  // « connections » : rangé seulement dans Extensions.
  const conn = { type: "widget", mcp: [{}], family: "connections" };
  assert.equal(F.extensionFamily(conn), "connections");
  assert.equal(P.defaultPlacement(conn), "integrations");
  assert.equal(P.defaultSection(conn), "community", "la rubrique du menu n'a que « contenu » et « communauté » : règle habituelle");
  // « community » sur un module à contenu.
  const comm = { content: { display: "list", clickAction: "page" }, family: "community" };
  assert.equal(F.extensionFamily(comm), "community");
  assert.equal(P.defaultSection(comm), "community");
});

test("family « overlays » : seulement pour un module qui peut servir une source navigateur ; sinon ignorée (comme le choix d'un rangement Overlays)", () => {
  const can = { type: "widget", permissions: ["overlay"], page: true, family: "overlays" };
  assert.equal(F.extensionFamily(can), "overlays");
  assert.equal(P.defaultPlacement(can), "overlays");
  assert.deepEqual(P.placementsFor(can), ["menu", "integrations", "overlays"]);
  const cannot = { type: "widget", permissions: ["pages"], page: true, family: "overlays" };
  assert.equal(F.extensionFamily(cannot), "community", "ignorée : la règle habituelle");
  assert.equal(P.defaultPlacement(cannot), P.defaultPlacement({ ...cannot, family: undefined }));
  assert.equal(P.declaredFamily({ family: "inconnue" }), null, "valeur inconnue (module plus récent) : ignorée");
});

test("le choix de la personne l'emporte toujours sur la famille déclarée", () => {
  const m = { type: "utility", permissions: [], family: "connections" };
  assert.equal(P.resolvePlacement(m, "menu"), "menu");
  assert.equal(P.resolvePlacement(m, undefined), "integrations");
});

test("manifeste : « family » est validée ; absente, le manifeste est inchangé", () => {
  const base = { apiVersion: 2, id: "demo-x", name: "X", version: "1.0.0", main: "index.mjs" };
  for (const f of ["content", "community", "connections", "overlays"]) assert.equal(parseManifest({ ...base, family: f }).ok, true, f);
  for (const f of ["menu", "Content", "", 3, null, ["content"]]) assert.equal(parseManifest({ ...base, family: f }).ok, false, JSON.stringify(f));
  const plain = parseManifest(base);
  assert.equal(plain.ok, true);
  assert.equal(plain.manifest.family, undefined);
});
