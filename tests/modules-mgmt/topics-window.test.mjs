import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { fakeCtx } from "../helpers/fakeCtx.mjs";

const db = await useTestDb();
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { buildContext } = await import("@/core/modules/context");
const Topics = await import("@/core/services/topics");
const W = await import("@/core/services/topicWindow");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest } = await import("@/core/modules/manifest");

beforeEach(() => db.reset());
after(() => db.close());

const base = (over) => ({ apiVersion: 2, version: "1.0.0", ...over });
const EVENT = [
  { key: "id", type: "string", required: true }, { key: "title", type: "string", required: true },
  { key: "start", type: "datetime", required: true }, { key: "end", type: "datetime" }, { key: "allDay", type: "boolean" },
  { key: "description", type: "string" }, { key: "location", type: "string" }, { key: "url", type: "url" },
  { key: "status", type: "string" }, { key: "color", type: "string" }, { key: "sourceLabel", type: "string" },
];

// Un fournisseur qui consigne ce qu'il a reçu, un qui ignore la plage, un qui renvoie des éléments invalides ou n'importe quoi.
const PROVIDERS = {
  echo: `export default { exports: { "calendar.event": (ctx, q) => [{ id: "e", title: "echo", start: "2026-10-14T20:00:00Z", description: JSON.stringify({ keys: Object.keys(q).sort(), from: q.from instanceof Date ? q.from.toISOString() : q.from ?? null, to: q.to instanceof Date ? q.to.toISOString() : q.to ?? null, fromIsDate: q.from instanceof Date, limit: q.limit }) }] } };`,
  deaf: `export default { exports: { "calendar.event": () => [{ id: "d", title: "sourd", start: "2020-01-01" }] } };`,
  messy: `export default { exports: { "calendar.event": () => [
    null, "texte", 42, [], { id: "ok1", title: "bon", start: "2026-02-28" },
    { id: "bad-date", title: "x", start: "demain" }, { id: "bad-day", title: "x", start: "2026-02-30" }, { id: "bad-time", title: "x", start: "2026-10-14T25:00:00Z" },
    { id: "no-start", title: "x" }, { id: "bad-end", title: "x", start: "2026-10-14", end: 12 }, { id: "bad-url", title: "x", start: "2026-10-14", url: "javascript:alert(1)" },
    { id: "ok2", title: "bon aussi", start: "2026-10-14T20:30", end: "2026-10-14T21:30:00+02:00", allDay: false, extra: 1 },
  ] } };`,
  notarray: `export default { exports: { "calendar.event": () => ({ oops: true }) } };`,
};
const provider = (id) => ({ "module.json": base({ id, name: id, provides: [{ topic: "calendar.event" }], main: "index.mjs" }), "index.mjs": PROVIDERS[id] });
const CONSUMER = { "module.json": base({ id: "plan", name: "Plan", consumes: [{ topic: "calendar.event", label: "Évènements", schema: EVENT }], main: "index.mjs" }), "index.mjs": "export default {};" };

async function setup(...providers) {
  for (const id of providers) { await installModule(makeRepo(provider(id)).url);await createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, names: { en: id } }); }
  await installModule(makeRepo(CONSUMER).url);
  await createInstance(db.prisma, { manifest: (await R.getModule("plan")).manifest, names: { en: "Plan" } });
  return (await R.getActiveInstances()).find((a) => a.mod.manifest.id === "plan");
}
const seen = (items) => JSON.parse(items.find((i) => i.id === "e").description ?? "{}");
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

test("datetime : ISO 8601 strict (date réelle, heure réelle, décalage facultatif), rien d'autre", () => {
  for (const ok of ["2026-10-14", "2026-10-14T20:30", "2026-10-14T20:30:15", "2026-10-14T20:30:15.123Z", "2026-10-14T20:30:00+02:00", "2026-10-14T20:30:00-0530", "2024-02-29", "2026-10-14 20:30"]) assert.equal(W.isIsoDatetime(ok), true, ok);
  for (const bad of ["", "demain", "2026-10-14T", "2026-13-01", "2026-02-30", "2025-02-29", "2026-10-14T24:00", "2026-10-14T20:60", "2026-10-14T20:30:61", "2026-10-14T20:30+25:00", "14/10/2026", "2026-10-14T20:30Zjunk", 20261014, null, new Date(), "2026-10-14".repeat(10)]) assert.equal(W.isIsoDatetime(bad), false, String(bad));
  // sans décalage, l'heure est lue en UTC (jamais l'heure locale du serveur)
  assert.equal(W.isoToMs("2026-10-14T20:30"), Date.UTC(2026, 9, 14, 20, 30));
  assert.equal(W.isoToMs("2026-10-14T20:30:00+02:00"), Date.UTC(2026, 9, 14, 18, 30));
});

test("manifeste : le type datetime est accepté dans un schéma de sujet, les types actuels sont inchangés, un type inconnu reste refusé", () => {
  const m = (type) => parseManifest(base({ id: "x1", name: "X", consumes: [{ topic: "a.b", label: "L", schema: [{ key: "k", type }] }] }));
  for (const t of ["string", "url", "number", "boolean", "string[]", "datetime"]) assert.ok(m(t).ok, t);
  assert.equal(m("date").ok, false);
});

test("plage : acceptée en Date ou en chaîne ISO, normalisée en Date ; absente = aucune borne", () => {
  assert.deepEqual(W.parseTopicWindow(undefined), {});
  assert.deepEqual(W.parseTopicWindow({}), {});
  assert.deepEqual(W.parseTopicWindow({ from: null, to: undefined }), {});
  const w = W.parseTopicWindow({ from: "2026-10-01", to: new Date("2026-10-31T23:59:59Z") });
  assert.ok(w.from instanceof Date && w.to instanceof Date);
  assert.equal(w.from.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.deepEqual(Object.keys(W.parseTopicWindow({ from: "2026-10-01" })), ["from"], "une seule borne : l'autre n'existe pas");
  assert.equal(W.parseTopicWindow({ from: "2026-10-14T20:00:00Z", to: "2026-10-14T20:00:00Z" }).from.getTime(), Date.parse("2026-10-14T20:00:00Z"), "from == to accepté");
});

test("plage : invalide refusée (illisible, Date invalide, hors 1970-2100, from > to, plus de 400 jours)", () => {
  const code = (input) => { try { W.parseTopicWindow(input); return "ok"; } catch (e) { assert.ok(e instanceof W.TopicWindowError); return e.reason; } };
  assert.equal(code({ from: "pas une date" }), "invalid");
  assert.equal(code({ to: "2026-02-30" }), "invalid");
  assert.equal(code({ from: new Date("x") }), "invalid");
  assert.equal(code({ from: 5 }), "invalid");
  assert.equal(code({ from: "1969-12-31" }), "invalid");
  assert.equal(code({ to: "2101-01-01" }), "invalid");
  assert.equal(code({ from: "2026-10-02", to: "2026-10-01" }), "order");
  assert.equal(code({ from: "2026-01-01", to: "2026-01-01" }), "ok");
  // bornes : 400 jours pile accepté, 400 jours + 1 ms refusé
  const from = new Date("2026-01-01T00:00:00Z");
  assert.equal(code({ from, to: new Date(from.getTime() + 400 * 86_400_000) }), "ok");
  assert.equal(code({ from, to: new Date(from.getTime() + 400 * 86_400_000 + 1) }), "span");
  assert.equal(W.MAX_WINDOW_DAYS, 400);
});

test("collecte : la plage est transmise aux fournisseurs en Date, avec locale, limit, tags ; sans plage, from et to n'existent pas", async () => {
  const consumer = await setup("echo");
  const withWindow = await Topics.collect(consumer, "calendar.event", { locale: "fr", limit: 10, from: "2026-10-01", to: new Date("2026-10-31T00:00:00Z") });
  assert.deepEqual(seen(withWindow), { keys: ["from", "limit", "locale", "tags", "to"], from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z", fromIsDate: true, limit: 10 });
  const without = await Topics.collect(consumer, "calendar.event", { locale: "fr" });
  assert.deepEqual(seen(without).keys, ["limit", "locale", "tags"], "contrat d'avant inchangé");
  const onlyFrom = await Topics.collect(consumer, "calendar.event", { locale: "fr", from: "2026-10-01T10:00:00+02:00" });
  assert.deepEqual([seen(onlyFrom).keys, seen(onlyFrom).from], [["from", "limit", "locale", "tags"], "2026-10-01T08:00:00.000Z"]);
});

test("collecte : une plage invalide LÈVE (rien n'est collecté, aucun fournisseur n'est appelé)", async () => {
  const consumer = await setup("echo");
  for (const bad of [{ from: "n'importe quoi" }, { from: "2026-10-02", to: "2026-10-01" }, { from: "2026-01-01", to: "2028-01-01" }]) {
    await assert.rejects(() => Topics.collect(consumer, "calendar.event", { locale: "en", ...bad }), W.TopicWindowError, JSON.stringify(bad));
  }
});

test("ctx.api.topics.collect : la plage traverse l'API du module ; une plage invalide lève chez le module appelant", async () => {
  const consumer = await setup("echo");
  const ctx = await buildContext(consumer.mod, consumer.instance, "en");
  assert.equal(seen(await ctx.api.topics.collect("calendar.event", { from: "2026-10-01", to: "2026-10-08", limit: 5 })).from, "2026-10-01T00:00:00.000Z");
  await assert.rejects(() => ctx.api.topics.collect("calendar.event", { from: "2026-10-09", to: "2026-10-08" }), /must not be after/);
  assert.equal((await ctx.api.topics.collect("calendar.event", {})).length, 1);
});

test("un fournisseur qui ignore la plage continue de marcher (ses éléments sont servis tels quels)", async () => {
  const consumer = await setup("deaf", "echo");
  const items = await Topics.collect(consumer, "calendar.event", { locale: "en", from: "2026-10-01", to: "2026-10-08" });
  assert.deepEqual(items.map((i) => i.id).sort(), ["d", "e"]);
  assert.equal(items.find((i) => i.id === "d").source.module, "deaf");
});

test("éléments invalides écartés un par un (pas toute la collecte), champs hors schéma retirés, retour non tableau = aucun élément", async () => {
  const consumer = await setup("messy", "notarray", "deaf");
  const items = await quiet(() => Topics.collect(consumer, "calendar.event", { locale: "en" }));
  assert.deepEqual(items.map((i) => i.id).sort(), ["d", "ok1", "ok2"], "null, texte, nombre, tableau, mauvaises dates, requis manquant, mauvais type, url dangereuse : écartés");
  assert.ok(!("extra" in items.find((i) => i.id === "ok2")));
  assert.equal(items.find((i) => i.id === "ok2").end, "2026-10-14T21:30:00+02:00");
});

test("sujets existants : schéma sans datetime, mêmes résultats ; conform tolère toujours null/absent", () => {
  const schema = [{ key: "t", type: "string", required: true }, { key: "n", type: "number" }];
  assert.deepEqual(Topics.conform({ t: "x", n: 2, z: 1 }, schema), { t: "x", n: 2 });
  assert.equal(Topics.conform({ n: 2 }, schema), null);
  assert.deepEqual(Topics.conform({ t: "x", when: null }, [...schema, { key: "when", type: "datetime" }]), { t: "x" });
  assert.equal(Topics.conform({ t: "x", when: "hier" }, [...schema, { key: "when", type: "datetime" }]), null);
});

test("fakeCtx : topics en fonction (plage), plage invalide qui lève, migration facultative (ni seedInstance ni clearSetting par défaut)", async () => {
  const ctx = fakeCtx({ topics: { "calendar.event": (o) => [{ id: "1", title: "t", start: o?.from ? String(o.from) : "-" }] } });
  assert.equal((await ctx.api.topics.collect("calendar.event", { from: "2026-10-01", to: "2026-10-02" }))[0].start, "2026-10-01");
  assert.deepEqual(ctx.calls.topics[0], ["calendar.event", { from: "2026-10-01", to: "2026-10-02" }]);
  await assert.rejects(() => ctx.api.topics.collect("calendar.event", { from: "2026-10-03", to: "2026-10-02" }), /invalid window/);
  assert.equal(ctx.seedInstance, undefined); assert.equal(ctx.clearSetting, undefined);
  assert.deepEqual((await fakeCtx({ topics: { a: [1, 2, 3] } }).api.topics.collect("a", { limit: 2 })), [1, 2], "comportement d'avant : tableau + limit");
  const m = fakeCtx({ migration: true, settings: { url: "x" } });
  assert.deepEqual(await m.seedInstance("cible", { nickname: "Mon Agenda", seedKey: "k", settings: {} }), { created: true, instanceKey: "mon-agenda" });
  await m.clearSetting("url");
  assert.equal(m.setting("url"), undefined);
  assert.deepEqual([m.calls.seeds.length, m.calls.cleared], [1, ["url"]]);
});
