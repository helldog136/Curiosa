// TABLEAU DE BORD : les extensions, de bout en bout avec le vrai registre (module chargé depuis le disque, instance en base, réglages, contexte réel).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const M = await import("@/core/dashboard/modules");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest } = await import("@/core/modules/manifest");
const { setSetting } = await import("@/core/settings");
const { getActiveInstances } = await import("@/core/modules/registry");
const Rt = await import("@/core/auth/rights");

beforeEach(async () => { await db.reset(); M.resetDashboardMemo(); });
after(() => db.close());

const manifest = JSON.parse(fs.readFileSync("tests/fixtures/extras/modules/demo-dashboard/module.json", "utf8"));
async function setup(names = ["Tri"]) {
  await db.fixture("demo-dashboard");
  const parsed = parseManifest(manifest);
  assert.ok(parsed.ok, parsed.error);
  const out = [];
  for (const n of names) out.push(await createInstance(prisma, { manifest: parsed.manifest, names: { en: n, fr: n }, nickname: n }));
  return out;
}
const cat = Rt.rightsCatalogue([{ moduleId: "demo-dashboard", name: { fr: "d", en: "d" }, rights: manifest.rights }]);
const user = (level) => ({ id: "u", email: "a@b.c", name: "A", level, roles: [level], rights: Rt.systemRights(level, cat), locale: null, advanced: false, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false });
const env = (level, locale = "fr") => ({ viewer: user(level), locale, defaultLocale: "en" });
const quiet = async (f) => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };

test("de bout en bout : la tâche, avec le réglage de l'instance, le libellé de la langue et le lien de l'instance", async () => {
  const [inst] = await setup();
  await setSetting(`instance.${inst.id}.pending`, 7);
  const tasks = await M.moduleTasks(env("admin"));
  assert.equal(tasks.length, 1);
  assert.deepEqual([tasks[0].label, tasks[0].n, tasks[0].href, tasks[0].icon, tasks[0].moduleName], ["7 éléments à trier", 7, `/admin/instances/${inst.id}?tab=use`, "📊", "Démo du tableau de bord"]);
  assert.equal((await M.moduleTasks(env("admin", "en")))[0].label, "7 items to triage");
});

test("de bout en bout : la rédaction a le droit déclaré (editor: true) et voit la tâche et l'action ; sans droit, rien", async () => {
  await setup();
  assert.equal((await M.moduleTasks(env("editor"))).length, 1);
  assert.equal((await M.moduleActions(env("editor"))).length, 1);
  assert.deepEqual(await M.moduleTasks({ ...env("editor"), viewer: { ...user("editor"), rights: new Set() } }), []);
  assert.deepEqual(await M.moduleTasks(env("none")), []);
});

test("de bout en bout : une carte qui échoue disparaît seule, l'autre s'affiche", async () => {
  await setup();
  const cards = await quiet(() => M.moduleCards(env("admin")));
  assert.deepEqual(cards.map((c) => [c.id, c.data.value, c.data.detail]), [["count", 7, "Tri"]]);
});

test("de bout en bout : plusieurs instances, le nom précise chaque ligne ; une instance mise de côté n'est pas interrogée", async () => {
  const [a, b] = await setup(["Alpha", "Beta"]);
  await setSetting(`instance.${a.id}.pending`, 2);
  await setSetting(`instance.${b.id}.pending`, 9);
  const tasks = await M.moduleTasks(env("admin"));
  assert.deepEqual(tasks.map((t) => t.label), ["9 éléments à trier (Beta)", "2 éléments à trier (Alpha)"]);
  M.resetDashboardMemo();
  await setSetting(`instance.${b.id}.__dataStatus`, { status: "failed" });
  globalThis.curiosaModuleCache?.clear?.();
  const aside = (await getActiveInstances()).filter((x) => x.mod.manifest.id === "demo-dashboard").length;
  assert.equal(aside, 1, "l'instance en échec de migration ne tourne pas");
  assert.deepEqual((await M.moduleTasks(env("admin"))).map((t) => t.n), [2]);
});

test("de bout en bout : la réponse est gardée 20 secondes (changer le réglage ne change rien tout de suite)", async () => {
  const [inst] = await setup();
  await setSetting(`instance.${inst.id}.pending`, 1);
  assert.equal((await M.moduleTasks(env("admin")))[0].n, 1);
  await setSetting(`instance.${inst.id}.pending`, 5);
  assert.equal((await M.moduleTasks(env("admin")))[0].n, 1, "mémoire courte");
  M.resetDashboardMemo();
  assert.equal((await M.moduleTasks(env("admin")))[0].n, 5);
});

test("de bout en bout : un site sans aucune extension à tableau de bord ne montre rien (et ne lève pas)", async () => {
  assert.deepEqual(await M.moduleTasks(env("owner")), []);
  assert.deepEqual(await M.moduleActions(env("owner")), []);
  assert.deepEqual(await M.moduleCards(env("owner")), []);
});

test("le code de l'extension est aussi vérifié par le kit (dashboard.valid)", async () => {
  const { checkModule } = await import("../../testsupport/index.mjs");
  const report = await checkModule("tests/fixtures/extras/modules/demo-dashboard", { siblings: [] });
  const r = report.results.find((x) => x.id === "dashboard.valid");
  assert.equal(r.status, "fail", "la carte « boom » échoue volontairement");
  assert.match(r.problems.join("\n"), /boom/);
});
