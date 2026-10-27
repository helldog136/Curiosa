// Reprise finale RAWG (services/rawgHandover.ts) et relais `ctx.api.rawg` (services/rawgRelay.ts), cœur 0.3.0 : le cœur n'a plus aucun service RAWG, le service de jaquettes est le module
// « game-covers » (service `game.cover`). Un module de substitution (publié dans un faux catalogue, aucun réseau, jamais le vrai RAWG) joue le rôle du module officiel.
// Ce que ces tests garantissent : (1) un site qui avait une clé ou des corrections dans les réglages du cœur les voit confiées au module, UNE fois, sans rien perdre, quel que soit l'état
// de départ (module absent, catalogue injoignable, repère absent) ; (2) les anciennes données du cœur ne sont JAMAIS modifiées ni effacées (retour arrière possible) ; (3) la clé ne sort
// nulle part ; (4) `ctx.api.rawg` n'est plus qu'un relais sûr (jamais d'exception, jamais de repli sur du code du cœur) ; (5) les deux outils de l'assistant gardent leur nom court.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb, settleBackground } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const db = await useTestDb();
const cat = createCatalogue();
const H = await import("@/core/services/rawgHandover");
const RL = await import("@/core/services/rawgRelay");
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
const NOW = "2026-01-01T00:00:00.000Z";
let fetched;
const realFetch = globalThis.fetch;

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
  { name: "rawg_covers_to_check", readOnly: true, description: "d1", input: { type: "object", properties: { title: { type: "string", maxLength: 120 } } } },
  { name: "rawg_cover_set", description: "d2", input: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 120 }, none: { type: "boolean" } } } },
] };
const publish = (over = {}) => cat.add("game-covers", { manifest: { ...MANIFEST, ...over.manifest }, files: { "index.mjs": over.code ?? PROVIDER }, entry: { offers: [{ service: "game.cover", version: 1 }] } });

/** Ce que le cœur 0.2.x garde : exactement les réglages que 0.2.13 et 0.2.14 écrivent. */
const legacyFixture = async ({ key = KEY, fixes = true, todo = true } = {}) => {
  if (key) await setSetting("rawg.key", key);
  if (fixes) await setSetting("rawg.fixes", { hades: { title: "Hades", kind: "game", rawgId: 22, name: "Hades II", img: FIX_IMG, at: NOW } });
  if (todo) await setSetting("rawg.toCheck", [{ key: "doom", title: "Doom", name: "DOOM (2016)", rawgId: 31, img: "/media/games/031/doom.jpg", candidates: 3, at: NOW }]);
};
const LEGACY_KEYS = ["rawg.key", "rawg.keyImported", "rawg.fixes", "rawg.toCheck"];
const legacySnapshot = async () => JSON.stringify((await db.prisma.setting.findMany({ where: { key: { in: LEGACY_KEYS } }, orderBy: [{ key: "asc" }, { locale: "asc" }] })).map((r) => [r.key, r.locale, r.value]));
const fakeInstance = { id: "inst-old", key: "oldmod", moduleId: "oldmod", basePath: null, nickname: null };
const consumerApi = async (permissions = ["storage", "rawg"]) => makeApi(fakeInstance, "fr", permissions);
const auditActions = async () => (await db.prisma.auditLog.findMany()).map((a) => `${a.actor}|${a.action}|${a.target}`);
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

beforeEach(async () => {
  await settleBackground();
  await db.reset(); await cat.clear(); delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  H.resetHandover(); RL.resetRelay();
  fetched = [];
  globalThis.fetch = (async (input, init) => { fetched.push(String(input?.url ?? input)); return realFetch(input, init); });
});
after(async () => { globalThis.fetch = realFetch; await settleBackground(); cat.close(); return db.close(); });

const noRawgTraffic = () => assert.deepEqual(fetched.filter((u) => /rawg\.io\/api/.test(u)), [], "le cœur ne parle plus à RAWG");

test("module absent ET catalogue injoignable : rien n'est perdu ni modifié, la reprise attend, les anciens modules reçoivent « no-key » sans exception, et elle reprend plus tard", async () => {
  await legacyFixture();
  await publish();
  await cat.down({ forget: true });
  const before = await legacySnapshot();
  const api = await consumerApi();
  assert.equal(await quiet(() => H.ensureRawgHandover({ install: true, force: true })), "waiting");
  assert.deepEqual(await quiet(() => api.rawg.cover("Hades")), { status: "no-key", url: null });
  assert.deepEqual(await quiet(() => api.rawg.candidates("Hades")), { status: "no-key", candidates: [] });
  assert.equal(await quiet(() => api.rawg.configured()), false);
  await settleBackground();
  assert.equal(await Reg.getModule("game-covers"), null);
  assert.equal(await legacySnapshot(), before, "les données du cœur sont strictement intactes");
  assert.equal((await H.handoverState()).doneAt, undefined);
  assert.equal(await H.handoverPending(), true);
  noRawgTraffic();
  // Le catalogue revient : le prochain événement (ici une demande explicite) termine la reprise.
  await cat.up();
  assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done");
  assert.equal(await H.handoverPending(), false);
  assert.equal(await legacySnapshot(), before, "même après la reprise, rien n'est effacé");
});

test("un site qui n'a jamais utilisé RAWG : rien n'est installé, aucun repère, aucune écriture", async () => {
  await publish();
  assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "nothing");
  assert.equal(await Reg.getModule("game-covers"), null);
  assert.equal(await getSetting("rawg.handover"), undefined);
  assert.equal(await H.handoverPending(), false);
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
  await settleBackground();
  assert.equal(await Reg.getModule("game-covers"), null);
});

test("un site qui utilisait RAWG (cas pire : reprise jamais faite) : le module est installé tout seul, reçoit la clé, les corrections et le journal UNE fois ; les données du cœur restent", async () => {
  await legacyFixture();
  await publish();
  const before = await legacySnapshot();
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");

  const row = await db.prisma.module.findUnique({ where: { id: "game-covers" } });
  assert.ok(row && row.enabled, "module installé");
  const inst = await db.prisma.moduleInstance.findMany({ where: { moduleId: "game-covers" } });
  assert.equal(inst.length, 1, "avec son instance");
  const adopted = await db.prisma.moduleRecord.findMany({ where: { instanceId: inst[0].id } });
  const byCollection = Object.fromEntries(adopted.map((r) => [r.collection, JSON.parse(r.data)]));
  assert.equal(byCollection.held.key, KEY, "le module tient la clé");
  assert.deepEqual(byCollection.adopted, { fixes: ["hades"], todo: 1 });

  const state = await H.handoverState();
  assert.ok(state.installedAt && state.doneAt); assert.deepEqual([state.key, state.fixes, state.todo], [true, 1, 1]);
  const audit = await auditActions();
  assert.ok(audit.includes("core|module.install.auto|game-covers") && audit.includes("core|rawg.handover|game-covers"), audit.join(" ; "));
  assert.ok(!JSON.stringify([audit, state]).includes(KEY), "ni la clé dans le journal, ni dans le repère");
  assert.equal(await legacySnapshot(), before, "COPIE, pas déplacement : clé, corrections et journal du cœur sont identiques à l'octet près");
  noRawgTraffic();

  // Les anciens modules passent par le module.
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "found", url: "https://media.rawg.io/media/games/mod/x.jpg", name: "Du module : Hades", id: 7, ambiguous: false });
  assert.equal((await api.rawg.candidates("Hades")).candidates[0].id, 1);
  assert.equal(await api.rawg.configured(), true);
  assert.ok(!JSON.stringify(await api.rawg.cover("Hades")).includes(KEY));
  assert.deepEqual(Object.keys(api.rawg).sort(), ["candidates", "configured", "cover"]);
  noRawgTraffic();
});

test("rejouée, la reprise ne fait rien de plus ; le repère survit ; un module retiré par la personne n'est pas remis ; les anciennes données restent", async () => {
  await legacyFixture();
  await publish();
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");
  const inst = await db.prisma.moduleInstance.findFirst({ where: { moduleId: "game-covers" } });
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id, collection: "adopted" } }), 1);
  assert.equal((await getSetting("rawg.handover")).doneAt.length > 10, true);
  const before = await legacySnapshot();

  // Retour arrière du module : désinstallé en gardant ses données → plus de jaquettes pour les anciens modules (jamais d'exception), les données du cœur restent.
  assert.equal((await I.uninstallModule("game-covers", { keepData: true })).ok, true);
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
  await settleBackground();
  assert.equal(await H.ensureRawgHandover({ install: true }), "done", "le repère dit que c'est fait : pas de réinstallation");
  assert.equal(await Reg.getModule("game-covers"), null);
  assert.equal(await legacySnapshot(), before);
  // Le réinstaller à la main retrouve ses données gardées.
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
});

test("repère absent alors que le module tient déjà les données (reprise faite sans repère) : rien n'est doublé ni remplacé, le repère est posé", async () => {
  await legacyFixture();
  await publish();
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("game-covers");
  const adopt = () => callProvider("game.cover", "adopt", { key: KEY, fixes: { hades: { title: "Hades" } }, todo: [] }, { moduleId: "game-covers" });
  assert.equal((await adopt()).ok, true);
  assert.equal(await getSetting("rawg.handover"), undefined);
  assert.equal(await H.ensureRawgHandover({ install: false }), "done");
  assert.ok((await getSetting("rawg.handover")).doneAt);
});

test("la clé n'est reprise que si le module confirme la tenir ; sinon rien n'est marqué et la reprise recommence", async () => {
  await legacyFixture();
  await publish({ code: `export default { services: { "game.cover": { adopt: async () => ({ ok: true, keyHeld: false }), cover: async () => ({ status: "none", url: null }) } } };` });
  assert.equal(await quiet(() => H.ensureRawgHandover({ install: true })), "failed");
  assert.equal((await H.handoverState()).doneAt, undefined);
  assert.equal(await H.handoverPending(), true);
});

test("catalogue qui n'a pas encore le module : les tentatives ordinaires sont espacées, mais un démarrage ou une mise à jour de module (« force ») réessaie tout de suite", async () => {
  await legacyFixture();
  assert.equal(await quiet(() => H.ensureRawgHandover({ install: true })), "waiting", "le catalogue n'a pas encore le module");
  await publish();
  assert.equal(await H.ensureRawgHandover({ install: true }), "waiting", "tentative ordinaire : espacée de 10 minutes");
  assert.equal(await Reg.getModule("game-covers"), null);
  assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done", "événement explicite : on réessaie, le module est installé et repris");
  assert.ok((await H.handoverState()).installedAt);
});

test("module installé SANS instance (sauvegarde d'avant la reprise restaurée) alors que le site utilise RAWG : il reçoit son instance et la reprise se fait ; une reprise déjà faite ne recrée rien", async () => {
  await legacyFixture();
  await publish();
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 0);
  assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 1);
  await db.prisma.moduleInstance.deleteMany({ where: { moduleId: "game-covers" } });
  assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "game-covers" } }), 0);
});

test("module installé à la main AVANT la reprise : la première demande d'un ancien module la fait (jamais avant d'avoir fini)", async () => {
  await legacyFixture();
  await publish();
  assert.equal((await I.installFromCatalogue("game-covers")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("game-covers");
  const api = await consumerApi();
  const r = await api.rawg.cover("Hades");
  assert.equal(r.name, "Du module : Hades");
  assert.ok((await H.handoverState()).doneAt);
  assert.equal((await H.handoverState()).installedAt, undefined, "installé par la personne : pas de marque « installé par le cœur »");
});

test("clé gardée autrefois dans les réglages d'un ancien module : reprise en lecture seule (rien n'est recopié dans le cœur) ; une clé retirée exprès n'est pas ressuscitée", async () => {
  await publish();
  const oldInstance = async () => (await db.prisma.moduleInstance.create({ data: { moduleId: "game-suggestions", key: "suggestions" + Math.random().toString(36).slice(2, 6) } }));
  const inst = await oldInstance();
  await setSetting(`instance.${inst.id}.rawgApiKey`, KEY);
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");
  const held = await db.prisma.moduleRecord.findFirst({ where: { collection: "held" } });
  assert.equal(JSON.parse(held.data).key, KEY);
  assert.equal(await getSetting("rawg.key"), undefined, "le cœur n'a rien écrit");
  // Retirée exprès : le repère d'import dit « ne reprenez plus ».
  await db.reset(); await setSetting("rawg.keyImported", true);
  const inst2 = await oldInstance();
  await setSetting(`instance.${inst2.id}.rawgApiKey`, KEY);
  assert.equal(await H.ensureRawgHandover({ install: true }), "nothing");
});

test("un module qui répond n'importe quoi ne donne jamais autre chose qu'une réponse valable ; un module qui lève une exception donne « unreachable »", async () => {
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
  assert.deepEqual(RL.coverOf(null), { status: "unreachable", url: null });
  assert.deepEqual(RL.candidatesOf("x"), { status: "unreachable", candidates: [] });

  await publish({ manifest: { version: "1.0.1" }, code: `export default { services: { "game.cover": { cover: async () => { throw new Error("boum " + "SECRET-123"); }, candidates: async () => { throw new Error("boum"); }, status: async () => { throw new Error("boum"); } } } };` });
  assert.equal((await I.updateModule("game-covers")).ok, true);
  await settleBackground();
  RL.resetRelay();
  assert.deepEqual(await quiet(() => api.rawg.cover("Hades")), { status: "unreachable", url: null });
  assert.deepEqual(await quiet(() => api.rawg.candidates("Hades")), { status: "unreachable", candidates: [] });
  assert.equal(await quiet(() => api.rawg.configured()), false);
});

test("outils de l'assistant : les noms courts d'avant restent (alias lus dans le manifeste du module, arguments validés, réponse du module) ; module absent : aucun alias", async () => {
  await legacyFixture();
  assert.deepEqual(await rawgToolProvider.list(), [], "sans le module, pas d'alias");
  await publish();
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");
  const tool = async (name) => (await rawgToolProvider.list()).find((t) => t.name === name);
  const actor = { name: "essai", tokenId: "t" };
  assert.deepEqual((await rawgToolProvider.list()).map((t) => t.name), ["rawg_covers_to_check", "rawg_cover_set"]);
  const t = await tool("rawg_covers_to_check");
  assert.deepEqual(await t.call({ title: "Hades" }, actor), { from: "module", args: { title: "Hades" } });
  assert.deepEqual(await (await tool("rawg_cover_set")).call({ title: "Hades", none: true }, actor), { from: "module", set: { title: "Hades", none: true } });
  assert.equal(t.description, "d1");
  assert.equal(t.readOnly, true); assert.equal((await tool("rawg_cover_set")).default, false, "l'écriture n'est toujours pas accordée d'office");
  assert.ok(t.instanceId, "l'alias suit l'interrupteur MCP de l'instance du module");
  await assert.rejects(t.call({ inconnu: 1 }, actor), "les arguments sont toujours validés avant le module");
  // Le module part entre la liste et l'appel : erreur claire, pas de plantage.
  assert.equal((await I.uninstallModule("game-covers", { keepData: true })).ok, true);
  await assert.rejects(t.call({ title: "Hades" }, actor), /not installed/);
  assert.deepEqual(await rawgToolProvider.list(), []);
});

test("la clé n'est confiée qu'au module officiel : un autre fournisseur de game.cover reçoit les titres, jamais la clé", async () => {
  await legacyFixture();
  await cat.add("autre-fournisseur", { manifest: { offers: [{ service: "game.cover" }] }, files: { "index.mjs": `export default { services: { "game.cover": { adopt: async () => ({ ok: true, keyHeld: true }), cover: async () => ({ status: "none", url: null }) } } };` }, entry: { offers: [{ service: "game.cover", version: 1 }] } });
  assert.equal((await I.installFromCatalogue("autre-fournisseur")).ok, true);
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  await ensureDefaultInstance("autre-fournisseur");
  assert.deepEqual(await callProvider("game.cover", "adopt", { key: KEY }, { moduleId: "game-covers" }), { ok: false, reason: "unavailable" });
  // Le faux « officiel » n'existe pas : rien n'est repris.
  assert.equal(await H.ensureRawgHandover({ install: false }), "waiting");
  assert.deepEqual(await rawgToolProvider.list(), []);
});

test("sans la permission « rawg » : comme sans clé, même avec le module", async () => {
  await legacyFixture();
  await publish();
  assert.equal(await H.ensureRawgHandover({ install: true }), "done");
  for (const api of [await consumerApi(["storage"]), await consumerApi([])]) {
    assert.equal(await api.rawg.configured(), false);
    assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
    assert.deepEqual(await api.rawg.candidates("Hades"), { status: "no-key", candidates: [] });
  }
});

test("catalogue : une entrée « extra » ou incompatible n'est jamais installée d'office ; le manifeste du module de substitution est valide", async () => {
  await legacyFixture();
  assert.ok(parseManifest({ apiVersion: 2, id: "game-covers", name: "x", version: "1.0.0", main: "index.mjs", ...MANIFEST }).ok);
  await publish();
  await cat.setIndex({ id: "game-covers", name: "x", description: "d", repo: cat.https, subdir: "modules/game-covers", ref: "game-covers-v1.0.0", version: "1.0.0", apiVersion: 99, offers: [{ service: "game.cover", version: 1 }] });
  assert.equal(await quiet(() => H.ensureRawgHandover({ install: true })), "waiting");
  assert.equal(await Reg.getModule("game-covers"), null);
});
