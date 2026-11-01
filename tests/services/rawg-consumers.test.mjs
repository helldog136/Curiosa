// Les consommateurs PUBLIÉS de jaquettes (game-suggestions 1.4.0, planning 2.4.0, stream-story 2.4.0, tels qu'ils sont dans le dépôt des modules) ont un repli sur `ctx.api.rawg`.
// Preuve qu'ils fonctionnent sur le cœur 0.3.0, VRAI code de ces modules et VRAI module « game-covers » (aucun réseau : les corrections se servent sans appeler RAWG) :
// avec le module et la reprise faite, avec le module sans clé, sans le module, avec un module en panne, et avec `ctx.api.rawg` absent ou sans permission (« no-key »).
// S'ignore proprement (skip + raison) quand le dépôt des modules est absent (intégration continue du cœur seul).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { useTestDb, settleBackground } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { findExtrasDir } from "../helpers/extras.mjs";

const extras = findExtrasDir();
const NEEDED = ["game-covers", "game-suggestions", "planning", "stream-story"];
const present = extras && NEEDED.every((id) => fs.existsSync(path.join(extras, "modules", id, "module.json")));
if (!present) test("consommateurs de jaquettes sur le cœur 0.3.0", { skip: "dépôt des modules (curiosa-extras) absent : CURIOSA_EXTRAS_DIR" }, () => {});
else {
  const db = await useTestDb();
  const cat = createCatalogue();
  const H = await import("@/core/services/rawgHandover");
  const RL = await import("@/core/services/rawgRelay");
  const I = await import("@/core/modules/installer");
  const Rec = await import("@/core/modules/recognized");
  const { setSetting } = await import("@/core/settings");
  const { getActiveInstances } = await import("@/core/modules/registry");
  const { buildContext } = await import("@/core/modules/context");
  const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
  const code = {
    gs: await import(pathToFileURL(path.join(extras, "modules/game-suggestions/index.mjs")).href),
    pl: await import(pathToFileURL(path.join(extras, "modules/planning/index.mjs")).href),
    ss: await import(pathToFileURL(path.join(extras, "modules/stream-story/sources.mjs")).href),
  };
  const KEY = "cle-factice-0123456789abcdef";
  const NOW = "2026-01-01T00:00:00.000Z";
  const FIXED = "https://media.rawg.io/media/games/022/jeu-22.jpg";
  const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

  const readTree = (dir, base = dir, out = {}) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) readTree(p, base, out); else if (e.name !== "module.json") out[path.relative(base, p)] = fs.readFileSync(p, "utf8");
    }
    return out;
  };
  /** Publie le module TEL QU'IL EST dans le dépôt des modules (manifeste et fichiers). */
  const publishReal = async (id) => {
    const dir = path.join(extras, "modules", id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
    await cat.add(id, { manifest, files: readTree(dir), entry: { offers: manifest.offers?.map((o) => ({ service: o.service, version: o.version ?? 1 })) } });
  };
  const install = async (id) => {
    const r = await I.installFromCatalogue(id);
    assert.equal(r.ok, true, `${id} : ${r.error}`);
    await ensureDefaultInstance(id);
  };
  /** Le contexte réel d'une instance du module `id` ; `rawg` : "keep" (le vrai), "absent" (ctx.api.rawg n'existe plus). */
  const ctxOf = async (id, rawg = "keep") => {
    const a = (await getActiveInstances()).find((x) => x.mod.manifest.id === id);
    assert.ok(a, `${id} actif`);
    const ctx = await buildContext(a.mod, a.instance);
    if (rawg === "absent") ctx.api = { ...ctx.api, rawg: undefined };
    return ctx;
  };

  beforeEach(async () => {
    await settleBackground();
    await db.reset(); await cat.clear(); Rec.clearRecognizedCache();
    await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
    H.resetHandover(); RL.resetRelay();
  });
  after(async () => { await settleBackground(); cat.close(); return db.close(); });

  /** Les trois consommateurs sur un même titre : [game-suggestions, planning, stream-story]. */
  const asks = async (rawg, title = "Hades") => {
    const [gs, pl, ss] = [await ctxOf("game-suggestions", rawg), await ctxOf("planning", rawg), await ctxOf("stream-story", rawg)];
    return {
      has: [await code.gs.hasKey(gs), await code.pl.hasKey(pl), await code.ss.hasKey(ss)],
      cover: [await code.gs.coverFor(gs, title), await code.pl.coverFor(pl, title), (await code.ss.coverOf(ss, title))],
    };
  };
  const legacy = async () => {
    await setSetting("rawg.key", KEY);
    await setSetting("rawg.fixes", { hades: { title: "Hades", kind: "game", rawgId: 22, name: "Hades II", img: "/media/games/022/jeu-22.jpg", at: NOW } });
  };

  test("sur le cœur 0.3.0, avec le module et la reprise faite : les trois consommateurs reçoivent la jaquette corrigée (service direct), avec ou sans ctx.api.rawg", async () => {
    for (const id of NEEDED) await publishReal(id);
    await legacy();
    for (const id of ["game-suggestions", "planning", "stream-story"]) await install(id);
    assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done", "la reprise installe game-covers du catalogue et lui confie clé et corrections");
    for (const rawg of ["keep", "absent"]) {
      const r = await asks(rawg);
      assert.deepEqual(r.has, [true, true, true], rawg);
      assert.deepEqual(r.cover[0], { status: "found", url: FIXED }, `game-suggestions (${rawg})`);
      assert.deepEqual(r.cover[1], { status: "found", url: FIXED }, `planning (${rawg})`);
      assert.equal(r.cover[2].cover, FIXED, `stream-story (${rawg})`);
      assert.equal(r.cover[2].coverState, "");
    }
    assert.equal(JSON.stringify(await asks("keep")).includes(KEY), false, "la clé n'apparaît nulle part");
  });

  test("module installé mais sans clé (site qui n'utilisait pas RAWG) : « no-key » du module, le repli ctx.api.rawg répond « no-key » aussi, rien ne lève", async () => {
    for (const id of NEEDED) await publishReal(id);
    for (const id of ["game-covers", "game-suggestions", "planning", "stream-story"]) await install(id);
    for (const rawg of ["keep", "absent"]) {
      const r = await asks(rawg);
      assert.deepEqual(r.has, [false, false, false], rawg);
      assert.deepEqual(r.cover[0], { status: "no_key", url: null });
      assert.deepEqual(r.cover[1], { status: "no_key", url: null });
      assert.equal(r.cover[2].cover, ""); assert.equal(r.cover[2].coverState, "no_key");
    }
  });

  test("module « Jaquettes de jeux » absent et catalogue injoignable (données du cœur gardées, reprise en attente) : « no-key » partout, sans exception ; la reprise se fait quand le catalogue revient", async () => {
    for (const id of NEEDED.filter((x) => x !== "game-covers")) await publishReal(id);   // le catalogue n'a (encore) pas le module : les consommateurs s'installent sans lui
    await legacy();
    for (const id of ["game-suggestions", "planning", "stream-story"]) await install(id);
    await settleBackground();
    await publishReal("game-covers");
    await cat.down({ forget: true });
    for (const rawg of ["keep", "absent"]) {
      const r = await quiet(() => asks(rawg));
      assert.deepEqual(r.has, [false, false, false], rawg);
      assert.deepEqual(r.cover[0], { status: "no_key", url: null });
      assert.deepEqual(r.cover[1], { status: "no_key", url: null });
      assert.equal(r.cover[2].coverState, "no_key");
    }
    await settleBackground();
    await cat.up();
    assert.equal(await H.ensureRawgHandover({ install: true, force: true }), "done");
    RL.resetRelay();
    const r = await asks("keep");
    assert.deepEqual(r.cover[0], { status: "found", url: FIXED });
  });

  test("module en panne (il lève une exception) : les consommateurs disent « down », jamais d'exception", async () => {
    for (const id of NEEDED.filter((x) => x !== "game-covers")) await publishReal(id);
    await cat.add("game-covers", { manifest: { name: "x", offers: [{ service: "game.cover", version: 1 }], permissions: ["storage"] }, files: { "index.mjs": `export default { services: { "game.cover": { status: async () => { throw new Error("boum"); }, cover: async () => { throw new Error("boum"); }, candidates: async () => { throw new Error("boum"); } } } };` }, entry: { offers: [{ service: "game.cover", version: 1 }] } });
    for (const id of NEEDED) await install(id);
    const r = await quiet(() => asks("keep"));
    assert.deepEqual(r.has, [false, false, false]);
    assert.equal(r.cover[0].status, "down"); assert.equal(r.cover[1].status, "down");
  });
}
