// Le test MULTI-LECTEURS du kit (testsupport/overlayElements.mjs) : il passe pour un flux à repères par lecteur, et il ÉCHOUE pour une file partagée que le premier lecteur vide.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir } from "../helpers/tmp.mjs";

const kit = await import(pathToFileURL(path.resolve("testsupport/index.mjs")).href);
const { assertMultiReaders, fakeCtx, loadModuleDir } = kit;
const demo = await loadModuleDir(path.resolve("examples/overlay-demo"));

test("module d'exemple : le fil est lu par plusieurs lecteurs sans qu'ils se disputent les événements (kit, faux contexte)", async () => {
  const ctx = fakeCtx({ moduleId: "overlay-demo", key: "demo", permissions: ["routes", "storage", "admin"] });
  const feed = async (after) => (await demo.definition.routes.feed(new Request(`http://x/feed?after=${encodeURIComponent(after)}`), ctx)).json();
  await assertMultiReaders({
    publish: async (text) => { await demo.definition.adminActions.push(ctx, { text }); },
    open: async () => { let cursor = (await feed("now")).cursor; return { read: async () => { const r = await feed(cursor); cursor = r.cursor; return r.events; } }; },
    readers: 5,
  });
});

test("une file PARTAGÉE (le premier lecteur la vide) est détectée", async () => {
  const queue = [];
  await assert.rejects(assertMultiReaders({ publish: async (e) => { queue.push(e); }, open: async () => ({ read: async () => queue.splice(0) }) }), /le flux est partagé et se vide à la lecture/);
});

test("un lecteur qui rejoue tout le flux à chaque lecture, ou qui perd des événements, est détecté", async () => {
  const log = [];
  await assert.rejects(assertMultiReaders({ publish: async (e) => { log.push(e); }, open: async () => ({ read: async () => log.slice() }) }));
  await assert.rejects(assertMultiReaders({ publish: async (e) => { log.push(e); }, open: async () => { let at = log.length; return { read: async () => { const out = log.slice(at, at + 1); at += 1; return out; } }; } }));
});

test("l'exigence « overlay.elements » du kit : réussie pour l'exemple, ÉCHEC pour un module qui déclare sans servir, sert sans déclarer ou répond une adresse externe", async (t) => {
  const { checkModule } = kit;
  const fs = await import("node:fs");
  const report = await checkModule(path.resolve("examples/overlay-demo"), { only: ["overlay.elements"] });
  assert.equal(report.results[0].status, "pass", JSON.stringify(report.results[0]));
  const copy = (mutate) => {
    const dir = makeTempDir("ovl-kit-", { t });
    const mod = path.join(dir, "overlay-demo");
    fs.cpSync(path.resolve("examples/overlay-demo"), mod, { recursive: true });
    mutate(mod);
    return mod;
  };
  const edit = (file, fn) => (mod) => { const p = path.join(mod, file); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); };
  const run = async (mutate) => (await checkModule(copy(mutate), { only: ["overlay.elements"] })).results[0];
  const noFn = await run(edit("index.mjs", (s) => s.replace("overlayElements: Object.fromEntries(Object.keys(PAGES)", "overlayElements: Object.fromEntries(Object.keys(PAGES).filter((k) => k !== 'feed')")));
  assert.equal(noFn.status, "fail"); assert.match(noFn.problems.join("\n"), /« feed » est déclaré dans module\.json mais le code n'a pas de fonction/);
  const external = await run(edit("index.mjs", (s) => s.replace("url: `/m/${ctx.instance.key}/element/${id}`", "url: 'https://evil.example/x'")));
  assert.equal(external.status, "fail"); assert.match(external.problems.join("\n"), /adresse que le cœur refuse/);
  const throws = await run(edit("index.mjs", (s) => s.replace("(ctx) => ({ url:", "(ctx, req) => { if (req.options.size > 100 || req.options.label) throw new Error('boom'); return { url:").replace("/element/${id}` })", "/element/${id}` }; }")));
  assert.equal(throws.status, "fail"); assert.match(throws.problems.join("\n"), /lève une erreur/);
  const undeclared = await run(edit("module.json", (s) => { const j = JSON.parse(s); j.overlayElements = j.overlayElements.filter((e) => e.id !== "scene"); return JSON.stringify(j); }));
  assert.equal(undeclared.status, "fail"); assert.match(undeclared.problems.join("\n"), /« scene » qui n'est pas déclaré/);
  const none = await checkModule(path.resolve("testsupport/template"), { only: ["overlay.elements"] });
  assert.equal(none.results[0].status, "na");
});
