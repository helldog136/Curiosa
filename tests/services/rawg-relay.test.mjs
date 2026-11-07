// Relais `ctx.api.rawg` (services/rawgRelay.ts) et alias des outils de l'assistant (rawgMcp.ts), cœur 0.3.0 : le cœur n'a plus aucun service RAWG, le service de jaquettes est le module
// « game-covers » (service `game.cover`). Un module de substitution (publié dans un faux catalogue, aucun réseau, jamais le vrai RAWG) joue le rôle du module officiel.
// Ce que ces tests garantissent : (1) `ctx.api.rawg` n'est plus qu'un relais sûr (jamais d'exception, jamais de repli sur du code du cœur) ; (2) les deux outils de l'assistant gardent
// leur nom court ; (3) la reprise finale (retirée avec le plancher 0.6.18) ne revient pas : le cœur n'installe rien tout seul et ne touche jamais aux anciens réglages `rawg.*`.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const cat = createCatalogue();
const Reg = await import("@/core/modules/registry");
const I = await import("@/core/modules/installer");
const Rec = await import("@/core/modules/recognized");
const { setSetting } = await import("@/core/settings");
const { makeApi } = await import("@/core/modules/api");
const { rawgToolProvider } = await import("@/core/rawgMcp");
const { parseManifest } = await import("@/core/modules/manifest");
const { callProvider } = await import("@/core/modules/dependencies");
const RL = await import("@/core/services/rawgRelay");
const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");

const KEY = "cle-factice-0123456789abcdef";
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
const fakeInstance = { id: "inst-old", key: "oldmod", moduleId: "oldmod", basePath: null, nickname: null };
const consumerApi = async (permissions = ["storage", "rawg"]) => makeApi(fakeInstance, "fr", permissions);
const auditActions = async () => (await db.prisma.auditLog.findMany()).map((a) => `${a.actor}|${a.action}|${a.target}`);
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const OLD_SETTINGS = ["rawg.key", "rawg.keyImported", "rawg.fixes", "rawg.toCheck", "rawg.handover"];
const oldSnapshot = async () => JSON.stringify((await db.prisma.setting.findMany({ where: { key: { in: OLD_SETTINGS } }, orderBy: [{ key: "asc" }, { locale: "asc" }] })).map((r) => [r.key, r.locale, r.value]));
const installCovers = async () => { assert.equal((await I.installFromCatalogue("game-covers")).ok, true); await ensureDefaultInstance("game-covers"); };

beforeEach(async () => {
  await db.reset(); await cat.clear(); delete process.env.MODULES_INDEX_URL; Rec.clearRecognizedCache();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  fetched = [];
  globalThis.fetch = (async (input, init) => { fetched.push(String(input?.url ?? input)); return realFetch(input, init); });
});
after(async () => { globalThis.fetch = realFetch; cat.close(); return db.close(); });

const noRawgTraffic = () => assert.deepEqual(fetched.filter((u) => /rawg\.io\/api/.test(u)), [], "le cœur ne parle plus à RAWG");

test("module absent : « no-key » sans exception, rien n'est installé tout seul, les anciens réglages du cœur restent strictement intacts", async () => {
  await setSetting("rawg.key", KEY);
  await setSetting("rawg.fixes", { hades: { title: "Hades", kind: "game", rawgId: 22, name: "Hades II", img: "/media/games/fix/hades-2.jpg", at: "2026-01-01T00:00:00.000Z" } });
  await publish();
  const before = await oldSnapshot();
  const api = await consumerApi();
  assert.deepEqual(await quiet(() => api.rawg.cover("Hades")), { status: "no-key", url: null });
  assert.deepEqual(await quiet(() => api.rawg.candidates("Hades")), { status: "no-key", candidates: [] });
  assert.equal(await quiet(() => api.rawg.configured()), false);
  assert.equal(await Reg.getModule("game-covers"), null, "le cœur n'installe plus le module de lui-même (reprise finale retirée)");
  assert.equal(await oldSnapshot(), before, "les anciens réglages rawg.* ne sont ni lus pour être déplacés, ni modifiés, ni effacés");
  noRawgTraffic();
});

test("module installé à la main : la première demande d'un ancien module est servie par le module, sans attente ni repère", async () => {
  await publish();
  await installCovers();
  const api = await consumerApi();
  const r = await api.rawg.cover("Hades");
  assert.equal(r.name, "Du module : Hades");
  assert.equal(await db.prisma.setting.count({ where: { key: "rawg.handover" } }), 0, "aucun repère de reprise n'est écrit");
});

test("un module qui répond n'importe quoi ne donne jamais autre chose qu'une réponse valable ; un module qui lève une exception donne « unreachable »", async () => {
  await publish({ code: `export default { services: { "game.cover": {
    status: async () => ({ configured: true }),
    cover: async () => ({ status: "found", url: "http://pas-https.example/x.jpg", name: "x".repeat(900), id: -3, ambiguous: "oui" }),
    candidates: async () => ({ status: "found", candidates: [{ id: "x", name: "A", url: "https://media.rawg.io/a.jpg" }, { id: 2, name: "B", year: "2020", platforms: ["a","b","c","d"], url: "javascript:1" }, { id: 3, name: "C", year: 2001, platforms: ["PC","b","c","d"], url: "https://media.rawg.io/c.jpg" }] }),
  } }, mcp: {} };` });
  await installCovers();
  const api = await consumerApi();
  assert.deepEqual(await api.rawg.cover("Hades"), { status: "none", url: null }, "adresse non https : pas de jaquette");
  const c = await api.rawg.candidates("Hades");
  assert.deepEqual(c.candidates, [{ id: 3, name: "C", year: 2001, platforms: ["PC", "b", "c"], url: "https://media.rawg.io/c.jpg" }]);
  assert.equal(await api.rawg.configured(), true);
  assert.deepEqual(RL.coverOf(null), { status: "unreachable", url: null });
  assert.deepEqual(RL.candidatesOf("x"), { status: "unreachable", candidates: [] });

  await publish({ manifest: { version: "1.0.1" }, code: `export default { services: { "game.cover": { cover: async () => { throw new Error("boum " + "SECRET-123"); }, candidates: async () => { throw new Error("boum"); }, status: async () => { throw new Error("boum"); } } } };` });
  assert.equal((await I.updateModule("game-covers")).ok, true);
  assert.deepEqual(await quiet(() => api.rawg.cover("Hades")), { status: "unreachable", url: null });
  assert.deepEqual(await quiet(() => api.rawg.candidates("Hades")), { status: "unreachable", candidates: [] });
  assert.equal(await quiet(() => api.rawg.configured()), false);
});

test("outils de l'assistant : les noms courts d'avant restent (alias lus dans le manifeste du module, arguments validés, réponse du module) ; module absent : aucun alias", async () => {
  assert.deepEqual(await rawgToolProvider.list(), [], "sans le module, pas d'alias");
  await publish();
  await installCovers();
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

test("un autre fournisseur de game.cover reçoit des titres, jamais une adresse de module officiel : les appels visant « game-covers » ne lui sont pas adressés", async () => {
  await cat.add("autre-fournisseur", { manifest: { offers: [{ service: "game.cover" }] }, files: { "index.mjs": `export default { services: { "game.cover": { adopt: async () => ({ ok: true, keyHeld: true }), cover: async () => ({ status: "none", url: null }) } } };` } });
  assert.equal((await I.installFromCatalogue("autre-fournisseur")).ok, true);
  await ensureDefaultInstance("autre-fournisseur");
  assert.deepEqual(await callProvider("game.cover", "adopt", { key: KEY }, { moduleId: "game-covers" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await rawgToolProvider.list(), [], "pas d'alias sans le module officiel");
});

test("sans la permission « rawg » : comme sans clé, même avec le module", async () => {
  await publish();
  await installCovers();
  for (const api of [await consumerApi(["storage"]), await consumerApi([])]) {
    assert.equal(await api.rawg.configured(), false);
    assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
    assert.deepEqual(await api.rawg.candidates("Hades"), { status: "no-key", candidates: [] });
  }
  assert.ok(parseManifest({ apiVersion: 2, id: "game-covers", name: "x", version: "1.0.0", main: "index.mjs", ...MANIFEST }).ok, "le manifeste du module de substitution est valide");
});

test("la reprise finale est bien retirée : ni fichier, ni crochet de démarrage, ni crochet après installation ou restauration", () => {
  assert.equal(fs.existsSync("src/core/services/rawgHandover.ts"), false);
  assert.equal(fs.existsSync("src/core/services/rawgNote.ts"), false);
  for (const f of ["src/instrumentation.ts", "src/core/modules/installer.ts", "src/core/backup/restore.ts", "src/core/services/rawgRelay.ts"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /ensureRawgHandover|noteRawgModulesChanged|trackRawgJob|rawgHandover/, f);
});

