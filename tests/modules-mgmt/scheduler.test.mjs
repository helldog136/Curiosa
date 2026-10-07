import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const T = await import("@/core/services/scheduler");
const { createInstance } = await import("@/core/instanceService");

beforeEach(() => { globalThis.__log = []; return db.reset(); });
after(() => db.close());

const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };
const CODE = `
const log = (m) => globalThis.__log.push(m);
export default { tasks: {
  quick: { everyMinutes: 1, run: async (ctx) => { log("quick:" + ctx.instance.key); await ctx.api.store.add("runs", { n: 1 }); } },
  hourly: { everyMinutes: 60, run: () => log("hourly") },
  broken: { everyMinutes: 1, run: () => { throw new Error("boom"); } },
  slow: { everyMinutes: 1, run: () => new Promise((r) => { log("slow-start"); setTimeout(r, 200); }) },
  "Bad Name": { everyMinutes: 1, run: () => log("bad-name") },
  nope: { everyMinutes: 0, run: () => log("nope") },
} };`;
async function setup() {
  const repo = makeRepo({ "module.json": { apiVersion: 2, id: "carnet", name: "Carnet", version: "1.0.0", main: "index.mjs" }, "index.mjs": CODE });
  assert.equal((await installModule(repo.url)).ok, true);
  await setModuleEnabled("carnet", true);
  return createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
}
const NOW = Date.now();
const statuses = (o) => Object.fromEntries(o.map((x) => [x.task, x.status]));

test("tâches dues : exécutées au premier passage, pas avant la fin de leur intervalle, plus tard à nouveau", async () => {
  await setup();
  const first = await quiet(() => T.runDueTasks({ now: NOW }));
  assert.deepEqual(statuses(first), { quick: "ok", hourly: "ok", broken: "failed", slow: "ok" });
  const again = await quiet(() => T.runDueTasks({ now: NOW + 30_000 }));
  assert.deepEqual(again.filter((x) => x.status !== "skipped"), [], "rien n'est dû 30 s plus tard");
  const later = await quiet(() => T.runDueTasks({ now: NOW + 2 * 60_000 }));
  assert.ok(later.some((x) => x.task === "quick" && x.status === "ok"));
  assert.ok(!later.some((x) => x.task === "hourly"), "l'horaire n'est pas encore due (la dernière exécution date d'à l'instant)");
});

test("une tâche en échec est isolée des autres et son erreur est mémorisée", async () => {
  const inst = await setup();
  const out = await quiet(() => T.runDueTasks({ now: NOW, instanceId: inst.id }));
  assert.equal(statuses(out).broken, "failed");
  assert.equal(statuses(out).quick, "ok", "les autres tâches tournent quand même");
  const state = await T.taskStateOf(inst.id, "broken");
  assert.deepEqual([state.status, state.error], ["failed", "boom"]);
  assert.equal((await T.taskStateOf(inst.id, "quick")).status, "ok");
  assert.equal((await db.prisma.moduleRecord.count({ where: { instanceId: inst.id, collection: "runs" } })), 1, "la tâche a bien accès à ctx.api");
});

test("jamais deux fois en même temps : une tâche encore en cours est ignorée", async () => {
  await setup();
  const first = quiet(() => T.runDueTasks({ now: NOW }));
  await new Promise((r) => setTimeout(r, 50));                       // « slow » est en cours (200 ms)
  const second = await quiet(() => T.runDueTasks({ now: NOW + 3_600_000 * 2, force: true }));
  assert.equal(statuses(second).slow, "skipped");
  await first;
  assert.equal(globalThis.__log.filter((m) => m === "slow-start").length, 1);
});

test("noms invalides et intervalles < 1 minute ignorés ; instance désactivée = pas de tâches", async () => {
  const inst = await setup();
  await quiet(() => T.runDueTasks({ now: NOW }));
  assert.ok(!globalThis.__log.includes("bad-name") && !globalThis.__log.includes("nope"));
  await db.prisma.moduleInstance.update({ where: { id: inst.id }, data: { enabled: false } });
  R.resetModuleRegistry?.();
  globalThis.__log = [];
  const out = await quiet(() => T.runDueTasks({ now: NOW + 7_200_000 }));
  assert.deepEqual(out, []);
  assert.deepEqual(globalThis.__log, []);
});
