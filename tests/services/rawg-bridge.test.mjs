// Cale de compatibilité RAWG (services/rawgBridge.ts) : le service de jaquettes est passé au module « game-covers » (service `game.cover`).
// Un module de substitution (publié dans un faux catalogue, aucun réseau, jamais le vrai RAWG) joue le rôle du module officiel.
// Ce que ces tests garantissent : (1) sans le module, rien ne change (ancien service, ancienne clé, anciennes corrections) ; (2) avec lui, les anciens modules sont relayés ;
// (3) un site qui utilisait RAWG voit le module installé et repris tout seul, UNE fois ; (4) la copie ne détruit rien (retour arrière) ; (5) la clé ne sort nulle part.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const R = await import("@/core/services/rawg");
const F = await import("@/core/services/rawgFixes");
const B = await import("@/core/services/rawgBridge");
const Reg = await import("@/core/modules/registry");
const I = await import("@/core/modules/installer");
const Rec = await import("@/core/modules/recognized");
const { setSetting, getSetting } = await import("@/core/settings");
const { makeApi } = await import("@/core/modules/api");
const { rawgToolProvider } = await import("@/core/rawgMcp");
const { parseManifest } = await import("@/core/modules/manifest");
const { callProvider } = await import("@/core/modules/dependencies");

const KEY = "cle-factice-0123456789abcdef";
const FIX_IMG = "/media/games/fix/hades-2.jpg";
const LEGACY_COVER = "https://media.rawg.io/media/games/abc/legacy.jpg";
let rawgCalls;

/** Le module de substitution : garde ce qu'on lui confie dans SON stockage, répond avec une image reconnaissable. */
const PROVIDER = `
const MEDIA = "https://media.rawg.io/media/games/mod/";
export default {
  services: { "game.cover": {
    status: async (ctx) => ({ ready: true, configured: (await ctx.api.store.count("held")) > 0 }),
    cover: async (ctx, a) => ({ status: "found", url: MEDIA + "x.jpg", name: "Du module : " + a.title, id: 7, ambiguous: false }),
    candidates: async () => ({ status: "found", candidates: [{ id: 1, name: "Jeu", year: 2020, platforms: ["PC"], url: MEDIA + "y.jpg" }] }),
    adopt: async (ctx, a) => {
      await ctx.api.store.add("adopted", { fixes: Object.keys(a.fixes ?? {}), todo: (a.todo ?? []).length });
      if (a.key) await ctx.api.store.add("held", { key: a.key });
      return { ok: true, keyHeld: !!a.key, keyAdopted: !!a.key, fixes: Object.keys(a.fixes ?? {}).length, todo: (a.todo ?? []).length, ready: true };
    },
  } },
  mcp: { rawg_covers_to_check: async (ctx, args) => ({ from: "module", args }), rawg_cover_set: async (ctx, args) => ({ from: "module", set: args }) },
};
`;
const MANIFEST = { name: "Jaquettes", offers: [{ service: "game.cover", version: 1 }], permissions: ["storage", "mcp"], mcp: [
  { name: "rawg_covers_to_check", readOnly: true, description: "d", input: { type: "object", properties: { title: { type: "string", maxLength: 120 } } } },
  { name: "rawg_cover_set", description: "d", input: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 120 }, none: { type: "boolean" } } } },
] };
const publish = (over = {}) => cat.add("game-covers", { manifest: { ...MANIFEST, ...over.manifest }, files: { "index.mjs": over.code ?? PROVIDER }, entry: { offers: [{ service: "game.cover", version: 1 }] } });

const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const legacyFixture = async ({ key = KEY, fixes = true } = {}) => {
  if (key) await R.saveRawgKey(key);
  if (fixes) await F.saveFix("Hades", { kind: "game", rawgId: 22, name: "Hades II", img: FIX_IMG });
};
const fakeInstance = { id: "inst-old", key: "oldmod", moduleId: "oldmod", basePath: null, nickname: null };
const consumerApi = async (permissions = ["storage", "rawg"]) => makeApi(fakeInstance, "fr", permissions);
const auditActions = async () => (await db.prisma.auditLog.findMany()).map((a) => `${a.actor}|${a.action}|${a.target}`);
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

beforeEach(async () => {
  await db.reset(); await cat.clear(); delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  R.clearRawgCache(); B.resetBridge();
  rawgCalls = [];
  R.setRawgFetch(async (url) => { rawgCalls.push(url); return reply(200, { results: [{ id: 5, name: "Hades", background_image: LEGACY_COVER }] }); });
});
after(() => { R.setRawgFetch(); cat.close(); return db.close(); });

test("sans le module (cœur mis à jour seul) : l'ancien service répond comme avant, avec sa clé et ses corrections ; rien n'est installé quand le site n'utilisait pas RAWG", async () => {
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null }, "pas de clé, pas de module : comme avant");
  assert.equal(await B.ensureRawgHandover({ install: true }), "nothing");
  assert.equal(await Reg.getModule("game-covers"), null);
  await legacyFixture();
  await publish();
  await cat.down();   // catalogue injoignable : rien ne se passe, rien ne casse
  assert.equal(await quiet(() => B.ensureRawgHandover({ install: true })), "waiting");
  assert.equal(await api.rawg.configured(), true);
  const fixed = await api.rawg.cover("Hades");
  assert.deepEqual([fixed.status, fixed.id], ["found", 22], "la correction mémorisée est servie par l'ancien service");
  assert.equal((await api.rawg.cover("Autre jeu")).url, LEGACY_COVER);
  assert.equal(rawgCalls.length, 1);
  assert.equal(await B.delegate(), null);
});

test("un site qui utilisait RAWG : le module est installé tout seul (catalogue officiel), reçoit la clé et les corrections UNE fois ; les anciens modules sont relayés", async () => {
  await legacyFixture();
  await F.noteDoubtful({ title: "Doom", name: "DOOM (2016)", rawgId: 31, url: "https://media.rawg.io/media/games/031/doom.jpg", candidates: 3 });
  await publish();
  assert.equal(await B.ensureRawgHandover({ install: true }), "done");

  const row = await db.prisma.module.findUnique({ where: { id: "game-covers" } });
  assert.ok(row && row.enabled, "module installé");
  const inst = await db.prisma.moduleInstance.findMany({ where: { moduleId: "game-covers" } });
  assert.equal(inst.length, 1, "avec son instance");
  const adopted = await db.prisma.moduleRecord.findMany({ where: { instanceId: inst[0].id } });
  const byCollection = Object.fromEntries(adopted.map((r) => [r.collection, JSON.parse(r.data)]));
  assert.equal(byCollection.held.key, KEY, "le module tient la clé");
  assert.deepEqual(byCollection.adopted, { fixes: ["hades"], todo: 1 });

  const state = await B.handoverState();
  assert.ok(state.installedAt && state.doneAt); assert.deepEqual([state.key, state.fixes, state.todo], [true, 1, 1]);
  const audit = await auditActions();
  assert.ok(audit.includes("core|module.install.auto|game-covers") && audit.includes("core|rawg.handover|game-covers"), audit.join(" ; "));
  assert.ok(!JSON.stringify([audit, state]).includes(KEY), "ni la clé dans le journal, ni dans le repère");

  // COPIE, pas déplacement : l'ancien service garde sa clé et ses corrections (retour arrière possible).
  assert.equal(await R.getRawgKey(), KEY);
  assert.equal(Object.keys(await F.readFixes()).length, 1);

  // Les anciens modules passent par le module.
  B.forgetBridgeDecision();
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "found", url: "https://media.rawg.io/media/games/mod/x.jpg", name: "Du module : Hades", id: 7, ambiguous: false });
  assert.equal((await api.rawg.candidates("Hades")).candidates[0].id, 1);
  assert.equal(await api.rawg.configured(), true);
  assert.equal(rawgCalls.length, 0, "RAWG n'est plus interrogé par le cœur");
  assert.ok(!JSON.stringify(await api.rawg.cover("Hades")).includes(KEY));
  assert.deepEqual(Object.keys(api.rawg).sort(), ["candidates", "configured", "cover"]);
  assert.equal((await B.delegate()).adminPath, `/admin/instances/${inst[0].id}`);
});

test("rejouée, la reprise ne fait rien de plus (une seule copie) ; le repère survit ; un module retiré par la personne n'est pas remis", async () => {
  await legacyFixture();
  await publish();
  assert.equal(await B.ensureRawgHandover({ install: true }), "done");
  assert.equal(await B.ensureRawgHandover({ install: true }), "done");
  const inst = await db.prisma.moduleInstance.findFirst({ where: { moduleId: "game-covers" } });
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id, collection: "adopted" } }), 1);
  assert.equal((await getSetting("rawg.handover")).doneAt.length > 10, true);

  // Retour arrière : le module est désinstallé → l'ancien service reprend, avec la clé et les corrections d'origine.
  assert.equal((await I.uninstallModule("game-covers", { keepData: true })).ok, true);
  B.forgetBridgeDecision();
  assert.equal(await B.delegate(), null);
  const api = await consumerApi();
  assert.equal((await api.rawg.cover("Hades")).id, 22);
  assert.equal((await api.rawg.cover("Autre")).url, LEGACY_COVER);
  assert.equal(await B.ensureRawgHandover({ install: true }), "done", "le repère dit que c'est fait : pas de réinstallation");
  assert.equal(await Reg.getModule("game-covers"), null);
  // Le réinstaller à la main retrouve ses données gardées.
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
});

test("catalogue qui n'a pas encore le module : les tentatives ordinaires sont espacées, mais un démarrage ou une mise à jour de module (« force ») réessaie tout de suite", async () => {
  await legacyFixture();
  assert.equal(await quiet(() => B.ensureRawgHandover({ install: true })), "waiting", "le catalogue n'a pas encore le module");
  await publish();
  assert.equal(await B.ensureRawgHandover({ install: true }), "waiting", "tentative ordinaire : espacée de 10 minutes");
  assert.equal(await Reg.getModule("game-covers"), null);
  assert.equal(await B.ensureRawgHandover({ install: true, force: true }), "done", "événement explicite : on réessaie, le module est installé et repris");
  assert.ok((await B.handoverState()).installedAt);
});

test("module installé SANS instance (sauvegarde d'avant la reprise restaurée) alors que le site utilise RAWG : il reçoit son instance et la reprise se fait ; une reprise déjà faite ne recrée rien", async () => {
  await legacyFixture();
  await publish();
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 0);
  assert.equal(await B.ensureRawgHandover({ install: true, force: true }), "done");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 1);
  // La personne retire ensuite l'instance : la reprise est faite, rien n'est recréé.
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "game-covers" } });
  assert.equal(await B.ensureRawgHandover({ install: true, force: true }), "done");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 0);
});

test("module installé à la main AVANT la reprise : la première demande d'un ancien module la fait (jamais avant d'avoir fini)", async () => {
  await legacyFixture();
  await publish();
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("game-covers");
  B.forgetBridgeDecision();
  const api = await consumerApi();
  const r = await api.rawg.cover("Hades");
  assert.equal(r.name, "Du module : Hades");
  assert.ok((await B.handoverState()).doneAt);
  assert.equal((await B.handoverState()).installedAt, undefined, "installé par la personne : pas de marque « installé par le cœur »");
});

test("un site sans RAWG mais avec le module : relayé tout de suite (rien à reprendre) ; un module qui répond n'importe quoi ne donne jamais autre chose qu'une réponse valable", async () => {
  await publish({ code: `export default { services: { "game.cover": {
    status: async () => ({ configured: true }),
    cover: async () => ({ status: "found", url: "http://pas-https.example/x.jpg", name: "x".repeat(900), id: -3, ambiguous: "oui" }),
    candidates: async () => ({ status: "found", candidates: [{ id: "x", name: "A", url: "https://media.rawg.io/a.jpg" }, { id: 2, name: "B", year: "2020", platforms: ["a","b","c","d"], url: "javascript:1" }, { id: 3, name: "C", year: 2001, platforms: ["PC","b","c","d"], url: "https://media.rawg.io/c.jpg" }] }),
  } }, mcp: {} };` });
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("game-covers");
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "none", url: null }, "adresse non https : pas de jaquette");
  const c = await api.rawg.candidates("Hades");
  assert.deepEqual(c.candidates, [{ id: 3, name: "C", year: 2001, platforms: ["PC", "b", "c"], url: "https://media.rawg.io/c.jpg" }]);
  assert.equal(await api.rawg.configured(), true);
});

test("outils de l'assistant : mêmes noms ; relayés vers le module quand il est là, sinon l'ancien code répond", async () => {
  await legacyFixture();
  const tool = async (name) => (await rawgToolProvider.list()).find((t) => t.name === name);
  const actor = { name: "essai", tokenId: "t" };
  assert.deepEqual((await rawgToolProvider.list()).map((t) => t.name), ["rawg_covers_to_check", "rawg_cover_set"]);
  const before = await (await tool("rawg_covers_to_check")).call({}, actor);
  assert.ok(Array.isArray(before.items), "ancien code");
  await publish();
  assert.equal(await B.ensureRawgHandover({ install: true }), "done");
  B.forgetBridgeDecision();
  const t = await tool("rawg_covers_to_check");
  assert.deepEqual(await t.call({ title: "Hades" }, actor), { from: "module", args: { title: "Hades" } });
  assert.deepEqual(await (await tool("rawg_cover_set")).call({ title: "Hades", none: true }, actor), { from: "module", set: { title: "Hades", none: true } });
  assert.match(t.description, /Game covers module/);
  assert.equal(t.readOnly, true); assert.equal((await tool("rawg_cover_set")).default, false, "l'écriture n'est toujours pas accordée d'office");
  await assert.rejects(t.call({ inconnu: 1 }, actor), "les arguments sont toujours validés avant le relais");
});

test("la clé n'est confiée qu'au module officiel : un autre fournisseur de game.cover reçoit les titres, jamais la clé", async () => {
  await legacyFixture();
  await cat.add("autre-fournisseur", { manifest: { offers: [{ service: "game.cover" }] }, files: { "index.mjs": `export default { services: { "game.cover": { adopt: async () => ({ ok: true, keyHeld: true }), cover: async () => ({ status: "none", url: null }) } } };` }, entry: { offers: [{ service: "game.cover", version: 1 }] } });
  assert.equal((await I.installFromCatalogue("autre-fournisseur")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("autre-fournisseur");
  assert.deepEqual(await callProvider("game.cover", "adopt", { key: KEY }, { moduleId: "game-covers" }), { ok: false, reason: "unavailable" });
  // Le faux « officiel » n'existe pas : rien n'est repris, rien n'est relayé (l'ancien service garde la main).
  assert.equal(await B.ensureRawgHandover({ install: false }), "waiting");
  B.forgetBridgeDecision();
  assert.equal(await B.delegate(), null);
});

test("sans la permission « rawg » : comme sans clé, même avec le module", async () => {
  await legacyFixture();
  await publish();
  assert.equal(await B.ensureRawgHandover({ install: true }), "done");
  B.forgetBridgeDecision();
  for (const api of [await consumerApi(["storage"]), await consumerApi([])]) {
    assert.equal(await api.rawg.configured(), false);
    assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
  }
});

test("catalogue : une entrée « extra » ou incompatible n'est jamais installée d'office ; le manifeste du module de substitution est valide", async () => {
  await legacyFixture();
  assert.ok(parseManifest({ apiVersion: 2, id: "game-covers", name: "x", version: "1.0.0", main: "index.mjs", ...MANIFEST }).ok);
  await publish();
  await cat.setIndex({ id: "game-covers", name: "x", description: "d", repo: cat.https, subdir: "modules/game-covers", ref: "game-covers-v1.0.0", version: "1.0.0", apiVersion: 99, offers: [{ service: "game.cover", version: 1 }] });
  assert.equal(await quiet(() => B.ensureRawgHandover({ install: true })), "waiting");
  assert.equal(await Reg.getModule("game-covers"), null);
});
