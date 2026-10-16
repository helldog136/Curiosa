import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Délai de section réduit pour les tests (la valeur normale est 8 s : variable d'environnement facultative des développeurs).
// 400 ms de délai -> « lent » dès 150 ms, appel interne (service, sujet) 300 ms, pause entre deux essais 800 ms.
process.env.CURIOSA_SECTION_TIMEOUT_MS = "400";
const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const RT = await import("@/core/modules/runtime");
const { buildContext } = await import("@/core/modules/context");
const Topics = await import("@/core/services/topics");
const { createInstance } = await import("@/core/instanceService");
const { resetStallState } = await import("@/core/modules/budget");

const F = (globalThis.__f = {});
const reset = () => Object.assign(F, { hang: false, slowMs: 0, svcHang: new Set(), svcDelay: 0, topicHang: new Set(), footerHang: "", pageHang: false, filterHang: false });
let lines;
const realErr = console.error, realWarn = console.warn;
beforeEach(async () => { await db.reset(); reset(); resetStallState(); lines = []; console.error = (...a) => lines.push(["error", a.map(String).join(" ")]); console.warn = (...a) => lines.push(["warn", a.map(String).join(" ")]); });
after(() => { console.error = realErr; console.warn = realWarn; return db.close(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timed = async (fn) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
const text = (blocks) => blocks.map((b) => b.text).join("|");
const stallLines = () => lines.filter(([, l]) => l.includes("n'a pas répondu")).map(([, l]) => l);

const base = (over) => ({ apiVersion: 2, version: "1.0.0", ...over });
const label = (fr) => ({ fr, en: fr });
const MODULE_A = {
  "module.json": base({
    id: "pa", name: "Module A", instances: "multiple", page: true, basePath: "pa", main: "index.mjs", requires: [{ service: "svc.demo" }], provides: [{ topic: "demo.item" }],
    consumes: [{ topic: "demo.item", label: "Items", schema: [{ key: "id", type: "string", required: true }, { key: "title", type: "string", required: true }] }],
    sections: [{ id: "fast", label: label("Rapide") }, { id: "hang", label: label("Bloquée") }, { id: "slow", label: label("Lente") }, { id: "boom", label: label("Casse") }, { id: "stuck", label: label("Coincée") },
      { id: "viasvc", label: label("Via service") }, { id: "viaall", label: label("Via tous") }, { id: "viatopic", label: label("Via sujet") }],
  }),
  "index.mjs": `const md = (t) => [{ type: "markdown", text: t }];
let shared;   // état gardé en mémoire par le module (comme une demande « en cours » partagée)
export default {
  sections: {
    fast: () => md("fast"),
    hang: () => (globalThis.__f.hang ? new Promise(() => {}) : md("hang-ok")),
    slow: async () => { await new Promise((r) => setTimeout(r, globalThis.__f.slowMs)); return md("slow-ok"); },
    boom: () => { throw new Error("section cassée"); },
    stuck: () => (shared ??= globalThis.__f.hang ? new Promise(() => {}) : Promise.resolve(md("stuck-ok"))),
    viasvc: async (ctx) => { const r = await ctx.api.services.call("svc.demo", "ping", {}); return md(r.ok ? "svc-ok" : "svc-repli:" + r.reason); },
    viaall: async (ctx) => { const r = await ctx.api.services.callAll("svc.demo", "ping", {}); return md(r.map((x) => x.instance + ":" + (x.ok ? "ok" : x.error)).join(",")); },
    viatopic: async (ctx) => { const t = await ctx.api.topics.collect("demo.item", {}); return md("topic:" + t.map((i) => i.title).join(",")); },
  },
  slots: { "layout.footer": (ctx) => (globalThis.__f.footerHang === ctx.instance.key ? new Promise(() => {}) : md("footer-" + ctx.instance.key)) },
  exports: { "demo.item": (ctx) => (globalThis.__f.topicHang.has(ctx.instance.key) ? new Promise(() => {}) : [{ id: "1", title: "t-" + ctx.instance.key }]) },
  filters: { entryBody: (body) => (globalThis.__f.filterHang ? new Promise(() => {}) : body + "!") },
  page: () => (globalThis.__f.pageHang ? new Promise(() => {}) : { blocks: md("page-ok") }),
};`,
};
const MODULE_B = {
  "module.json": base({ id: "pb", name: "Module B", instances: "multiple", main: "index.mjs", offers: [{ service: "svc.demo", each: true, readOnly: ["ping"] }] }),
  "index.mjs": `export default { services: { "svc.demo": { ping: async (ctx) => {
    if (globalThis.__f.svcHang.has(ctx.instance.key)) return new Promise(() => {});
    if (globalThis.__f.svcDelay) await new Promise((r) => setTimeout(r, globalThis.__f.svcDelay));
    return { pong: ctx.instance.key };
  } } } };`,
};

async function setup() {
  await installModule(makeRepo(MODULE_B).url);
  await installModule(makeRepo(MODULE_A).url);
  const mk = async (id, nickname) => { const mod = await R.getModule(id); return createInstance(db.prisma, { manifest: mod.manifest, nickname, names: { en: nickname } }); };
  // L'installation de A a déjà posé une instance de B (« pb », le fournisseur dont A dépend) ; on en ajoute une seconde. « pb » est la plus ancienne : c'est elle que `call` interroge.
  await mk("pb", "b2");
  await mk("pa", "alpha"); await mk("pa", "beta");
}
const active = async (key) => (await R.getActiveInstances()).find((a) => a.instance.key === key);

test("section qui ne répond jamais : omise au bout du délai, les autres s'affichent, UNE seule ligne nomme le fautif pour plusieurs visites", async () => {
  await setup();
  F.hang = true;
  const first = await timed(() => Promise.all([RT.runSection("alpha", "hang", {}, "fr"), RT.runSection("alpha", "fast", {}, "fr")]));
  assert.deepEqual(first.value[0], [], "la section bloquée est omise");
  assert.equal(text(first.value[1]), "fast", "une autre section du même module s'affiche");
  assert.ok(first.ms >= 350 && first.ms < 1500, `la page se termine au délai (~400 ms), pas avant ni sans fin : ${first.ms} ms`);
  // Visites suivantes pendant le blocage : aucune attente de plus, aucune ligne de plus.
  for (let i = 0; i < 5; i++) assert.deepEqual(await RT.runSection("alpha", "hang", {}, "fr"), []);
  assert.deepEqual(stallLines(), ["[modules] La section « Bloquée » du module pa (instance alpha) n'a pas répondu en 0,4 s ; elle est ignorée pour cette page."]);
  assert.ok(!lines.some(([, l]) => l.includes("failed on section")), "ce n'est pas une exception : l'autre journal reste muet");
  // Le module voisin (autre instance) n'est pas touché.
  assert.equal(text(await RT.runSection("beta", "fast", {}, "fr")), "fast");
});

test("plusieurs visites en même temps pendant un blocage : toutes se terminent au délai (pas l'une après l'autre) et la ligne n'est écrite qu'une fois", async () => {
  await setup();
  F.hang = true;
  const run = await timed(() => Promise.all(Array.from({ length: 8 }, () => RT.runSection("alpha", "hang", {}, "fr"))));
  assert.ok(run.value.every((v) => v.length === 0));
  assert.ok(run.ms < 1500, `${run.ms} ms`);
  assert.equal(stallLines().length, 1);
});

test("le module répond de nouveau : la section revient, une ligne « répond de nouveau », et le rythme normal reprend", async () => {
  await setup();
  F.hang = true;
  assert.deepEqual(await RT.runSection("alpha", "hang", {}, "fr"), []);
  F.hang = false;
  assert.deepEqual(await RT.runSection("alpha", "hang", {}, "fr"), [], "pendant la courte pause, l'élément reste omis sans attendre");
  await sleep(850);
  const back = await timed(() => RT.runSection("alpha", "hang", {}, "fr"));
  assert.equal(text(back.value), "hang-ok");
  assert.ok(back.ms < 1000);
  assert.equal(lines.filter(([, l]) => l.includes("répond de nouveau")).length, 1);
  assert.equal(text(await RT.runSection("alpha", "hang", {}, "fr")), "hang-ok");
  assert.equal(stallLines().length, 1);
  assert.equal(lines.filter(([, l]) => l.includes("répond de nouveau")).length, 1);
});

test("section lente (entre le seuil et le délai) : affichée normalement, signalée UNE fois comme « lente »", async () => {
  await setup();
  F.slowMs = 250;
  for (let i = 0; i < 3; i++) assert.equal(text(await RT.runSection("alpha", "slow", {}, "fr")), "slow-ok");
  const slow = lines.filter(([, l]) => l.includes("est lente"));
  assert.equal(slow.length, 1);
  assert.match(slow[0][1], /^\[modules\] La section « Lente » du module pa \(instance alpha\) est lente : 0,[2-4] s pour répondre \(seuil : 0,2 s\) ; passé 0,4 s, elle est ignorée pour cette page\.$/);
  assert.equal(stallLines().length, 0);
  // Une section rapide ne dit rien.
  F.slowMs = 0;
  assert.equal(text(await RT.runSection("alpha", "slow", {}, "fr")), "slow-ok");
  assert.equal(lines.filter(([, l]) => l.includes("est lente")).length, 1);
});

test("une vraie exception d'un module reste journalisée comme avant (pas masquée par la borne de temps)", async () => {
  await setup();
  assert.deepEqual(await RT.runSection("alpha", "boom", {}, "fr"), []);
  assert.deepEqual(await RT.runSection("alpha", "boom", {}, "fr"), []);
  assert.equal(lines.filter(([lvl, l]) => lvl === "error" && l.includes("alpha failed on section boom")).length, 2, "chaque exception est journalisée, comme aujourd'hui");
  assert.equal(stallLines().length, 0);
});

test("emplacements : un module qui ne répond pas est omis, les autres s'affichent, tous interrogés en même temps", async () => {
  await setup();
  F.footerHang = "alpha";
  const run = await timed(() => RT.runSlot("layout.footer", "fr"));
  assert.equal(text(run.value), "footer-beta");
  assert.ok(run.ms >= 350 && run.ms < 1500, `${run.ms} ms`);
  await RT.runSlot("layout.footer", "fr");
  assert.deepEqual(stallLines(), ["[modules] L'emplacement « layout.footer » du module pa (instance alpha) n'a pas répondu en 0,4 s ; il est ignoré pour cette page."]);
});

test("page de module et filtre de texte qui ne répondent pas : la page se termine (404 sobre / texte inchangé)", async () => {
  await setup();
  F.pageHang = true; F.filterHang = true;
  const page = await timed(() => RT.runPage("alpha", [], "fr"));
  assert.deepEqual(page.value, { notFound: true, blocks: [] });
  assert.ok(page.ms < 1500);
  const body = await timed(() => RT.filterEntryBody("texte", "fr", {}));
  assert.equal(body.value, "texte");
  assert.ok(body.ms < 1500);
  F.pageHang = false; F.filterHang = false;
  await sleep(850);
  assert.equal(text((await RT.runPage("alpha", [], "fr")).blocks), "page-ok");
  assert.equal(await RT.filterEntryBody("texte", "fr", {}), "texte!!", "les deux instances filtrent à nouveau");
});

test("service qui ne répond pas : le consommateur reçoit un échec avant la fin de sa section et affiche son repli ; le journal nomme le FOURNISSEUR", async () => {
  await setup();
  F.svcHang = new Set(["pb"]);
  const run = await timed(() => RT.runSection("alpha", "viasvc", {}, "fr"));
  assert.equal(text(run.value), "svc-repli:failed", "la section est rendue avec son repli, pas omise");
  assert.ok(run.ms >= 250 && run.ms < 1500, `${run.ms} ms`);   // le repli est rendu (la section n'est pas omise) : l'appel interne a fini AVANT la section
  await RT.runSection("alpha", "viasvc", {}, "fr");
  assert.deepEqual(stallLines(), ["[modules] Le service « svc.demo.ping » du module pb (instance pb) n'a pas répondu en 0,3 s ; l'appel est ignoré pour cette page."]);
  assert.ok(!lines.some(([, l]) => l.includes("service svc.demo.ping failed")), "pas de seconde ligne d'erreur");
});

test("callAll : une instance qui ne répond pas ne retient pas les autres", async () => {
  await setup();
  F.svcHang = new Set(["pb"]);
  const run = await timed(() => RT.runSection("alpha", "viaall", {}, "fr"));
  assert.equal(text(run.value), "pb:failed,b2:ok");
  assert.ok(run.ms < 1500, `${run.ms} ms`);
  assert.equal(stallLines().length, 1);
});

test("sujet : un fournisseur qui ne répond pas est ignoré, les autres fournisseurs sont collectés", async () => {
  await setup();
  F.topicHang = new Set(["alpha"]);
  const run = await timed(() => RT.runSection("beta", "viatopic", {}, "fr"));
  assert.equal(text(run.value), "topic:t-beta");
  assert.ok(run.ms < 1500, `${run.ms} ms`);
  assert.deepEqual(stallLines(), ["[modules] Le sujet « demo.item » fourni par le module pa (instance alpha) n'a pas répondu en 0,3 s ; ses éléments sont ignorés pour cette page."]);
});

test("collecte pour une page du cœur (en-tête, flux) : le fournisseur bloqué est ignoré au délai complet", async () => {
  await setup();
  F.topicHang = new Set(["alpha"]);
  const schema = [{ key: "id", type: "string", required: true }, { key: "title", type: "string", required: true }];
  const run = await timed(() => Topics.collectForCore("demo.item", schema, { locale: "fr" }));
  assert.deepEqual(run.value.map((i) => i.title), ["t-beta"]);
  assert.ok(run.ms >= 350 && run.ms < 1500, `${run.ms} ms`);
  assert.equal(stallLines().length, 1);
});

test("hors d'une page publique (administration, tâches, routes de module) : aucune limite — un service lent mais honnête répond", async () => {
  await setup();
  F.svcDelay = 700;   // plus long que le délai de section (400 ms)
  const a = await active("alpha");
  const ctx = await buildContext(a.mod, a.instance, "fr");
  const run = await timed(() => ctx.api.services.call("svc.demo", "ping", {}));
  assert.equal(run.value.ok, true);
  assert.ok(run.ms >= 650);
  const all = await ctx.api.services.callAll("svc.demo", "ping", {});
  assert.deepEqual(all.map((r) => r.ok), [true, true]);
  assert.equal(lines.length, 0, "rien n'est journalisé");
  // Collecte d'un consommateur hors page : pas de limite non plus.
  F.topicHang = new Set();
  assert.equal((await ctx.api.topics.collect("demo.item", {})).length, 2);
});

test("module coincé (état gardé en mémoire qui ne se termine jamais) : après 3 épisodes de suite il est réinitialisé tout seul, une seule fois, et la page redevient normale", async () => {
  await setup();
  F.hang = true;
  assert.deepEqual(await RT.runSection("alpha", "stuck", {}, "fr"), [], "épisode 1");
  F.hang = false;   // la cause a disparu, mais la promesse partagée reste coincée dans le module
  for (let episode = 2; episode <= 3; episode++) {
    await sleep(850);
    assert.deepEqual(await RT.runSection("alpha", "stuck", {}, "fr"), [], `épisode ${episode} : toujours coincé`);
  }
  assert.equal(lines.filter(([, l]) => l.includes("est réinitialisé")).length, 1);
  assert.match(lines.find(([, l]) => l.includes("est réinitialisé"))[1], /^\[modules\] Le module pa est resté sans réponse 3 fois de suite : il est réinitialisé \(son code est rechargé ; ses données et ses réglages ne sont pas touchés\)\.$/);
  // Code rechargé : l'ancienne promesse coincée n'existe plus dans la nouvelle copie du module, la prochaine visite répond tout de suite.
  const back = await timed(() => RT.runSection("alpha", "stuck", {}, "fr"));
  assert.equal(text(back.value), "stuck-ok");
  assert.ok(back.ms < 1000, `${back.ms} ms`);
  assert.equal(lines.filter(([, l]) => l.includes("répond de nouveau")).length, 1);
  // Les instances, leurs données et les autres sections sont intactes.
  assert.equal((await R.getActiveInstances()).filter((x) => x.mod.manifest.id === "pa").length, 2);
  assert.equal(text(await RT.runSection("beta", "fast", {}, "fr")), "fast");
});
