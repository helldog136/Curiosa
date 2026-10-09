import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { collectReport, updateSequentially, createReportCache } = await import("@/core/modules/bulkUpdate");
const { getModulesReport, peekModulesReport, updateModules } = await import("@/core/modules/updateStatus");
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");

beforeEach(() => db.reset());
after(() => db.close());

const tick = () => new Promise((r) => setTimeout(r, 5));
const ok = { ok: true };

test("rapport : seuls les modules en retard sont listés (version actuelle → nouvelle, nature) ; un module à jour n'y est pas", async () => {
  const mods = [{ id: "a", version: "1.0.0" }, { id: "b", version: "2.0.0" }, { id: "c", version: "1.0.0" }];
  const out = { a: { check: { available: true, target: "v1.0.1", level: "patch" }, failed: false }, b: { check: { available: false }, failed: false }, c: { check: { available: true, target: "v2.0.0", level: "major" }, failed: false } };
  const r = await collectReport(mods, async (id) => out[id], () => 42);
  assert.deepEqual(r, { checkedAt: 42, checked: 3, outdated: [{ id: "a", current: "1.0.0", target: "1.0.1", level: "patch" }, { id: "c", current: "1.0.0", target: "2.0.0", level: "major" }], unchecked: [] });
});

test("rapport : une vérification qui échoue (ou qui lève une erreur) est notée à part, sans arrêter ni faire échouer les autres", async () => {
  const mods = [{ id: "a", version: "1.0.0" }, { id: "b", version: "1.0.0" }, { id: "c", version: "1.0.0" }];
  const r = await collectReport(mods, async (id) => {
    if (id === "a") throw new Error("réseau");
    if (id === "b") return { check: { available: false }, failed: true };
    return { check: { available: true, target: "1.1.0", level: "minor" }, failed: false };
  });
  assert.deepEqual(r.unchecked, ["a", "b"]);
  assert.deepEqual(r.outdated.map((o) => o.id), ["c"]);
});

test("mise à jour en bloc : un module après l'autre, jamais deux en même temps, dans l'ordre", async () => {
  let running = 0, peak = 0; const order = [];
  const s = await updateSequentially(["a", "b", "c", "d"], async (id) => {
    running++; peak = Math.max(peak, running); order.push(id);
    await tick(); running--;
    return ok;
  });
  assert.equal(peak, 1);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
  assert.deepEqual(s, { updated: ["a", "b", "c", "d"], failed: [], skipped: [], stoppedOn: null });
});

test("mise à jour en bloc : l'échec d'un module n'empêche pas les suivants, et le bilan dit lequel et pourquoi", async () => {
  const s = await updateSequentially(["a", "b", "c", "d"], async (id) => {
    if (id === "b") return { ok: false, error: "modules.error.clone" };
    if (id === "c") throw new Error("boum");
    return ok;
  });
  assert.deepEqual(s.updated, ["a", "d"]);
  assert.deepEqual(s.failed, [{ id: "b", error: "modules.error.clone", migration: false }, { id: "c", error: "error.generic", migration: false }]);
  assert.equal(s.stoppedOn, null);
});

test("mise à jour en bloc : une erreur de migration s'arrête net, nomme le module et laisse les suivants intacts", async () => {
  const calls = [];
  const s = await updateSequentially(["a", "b", "c", "d"], async (id) => {
    calls.push(id);
    return id === "b" ? { ok: true, migrations: [{ status: "ok" }, { status: "failed" }] } : ok;
  });
  assert.deepEqual(calls, ["a", "b"], "c et d ne sont pas touchés");
  assert.deepEqual(s.updated, ["a"]);
  assert.deepEqual(s.failed, [{ id: "b", error: "modules.error.migration", migration: true }]);
  assert.equal(s.stoppedOn, "b");
  assert.deepEqual(s.skipped, ["c", "d"]);
  const newer = await updateSequentially(["x", "y"], async (id) => (id === "x" ? { ok: true, migrations: [{ status: "newer" }] } : ok));
  assert.equal(newer.stoppedOn, "x");
});

test("cache : garde le rapport quelques minutes, « revérifier » force, une vérification à la fois, retrait des modules mis à jour", async () => {
  let t = 0, loads = 0;
  const cache = createReportCache(async () => { loads++; await tick(); return { checkedAt: t, checked: 1, outdated: [{ id: "a", current: "1", target: "2" }], unchecked: [] }; }, 1000, () => t);
  const [r1, r2] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(loads, 1, "deux demandes simultanées = une seule vérification");
  assert.equal(r1, r2);
  t = 999; await cache.get(); assert.equal(loads, 1, "encore récent");
  t = 1000; await cache.get(); assert.equal(loads, 2, "périmé : on revérifie");
  await cache.get(true); assert.equal(loads, 3, "forcé");
  cache.markUpdated(["a"]);
  assert.deepEqual((await cache.get()).outdated, []);
});

test("cache : peek ne bloque jamais (rien au début, vérification en arrière-plan) ; un échec de chargement ne plante rien", async () => {
  let loads = 0;
  const cache = createReportCache(async () => { loads++; await tick(); return { checkedAt: Date.now(), checked: 0, outdated: [], unchecked: [] }; });
  assert.equal(cache.peek(), null);
  await tick(); await tick();
  assert.ok(cache.peek(), "le rapport est arrivé");
  assert.equal(loads, 1);
  const broken = createReportCache(async () => { throw new Error("base illisible"); });
  assert.equal(broken.peek(), null);
  await tick();
  await assert.rejects(broken.get(true));
});

const manifest = (id, version) => ({ apiVersion: 2, id, name: id, version, main: "index.mjs" });
function moduleRepo(id, version = "1.0.0") {
  const repo = makeRepo({ "module.json": manifest(id, version), "index.mjs": "export default {};\n" });
  repo.g("tag", `v${version}`);
  repo.release = (v) => {
    fs.writeFileSync(`${repo.dir}/module.json`, JSON.stringify(manifest(id, v)));
    repo.g("commit", "-qam", `release ${v}`); repo.g("tag", `v${v}`);
  };
  return repo;
}

test("de bout en bout (dépôts locaux, sans réseau) : un module en retard est listé, mis à jour, puis retiré ; un dépôt disparu devient un simple message", async () => {
  const a = moduleRepo("alpha"); const b = moduleRepo("beta");
  for (const [repo] of [[a], [b]]) assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  await setModuleEnabled("alpha", true);
  a.release("1.0.1"); b.release("2.0.0");
  let report = await getModulesReport(true);
  assert.deepEqual(report.outdated.map((o) => [o.id, o.current, o.target, o.level]), [["alpha", "1.0.0", "1.0.1", "patch"], ["beta", "1.0.0", "2.0.0", "major"]]);
  assert.deepEqual(report.unchecked, []);

  fs.rmSync(b.dir, { recursive: true, force: true });   // le dépôt de beta n'est plus joignable
  report = await getModulesReport(true);
  assert.deepEqual(report.outdated.map((o) => o.id), ["alpha"]);
  assert.deepEqual(report.unchecked, ["beta"], "message discret, pas d'exception");

  const audited = [];
  const s = await updateModules(["alpha", "beta"], async (id) => { audited.push(id); });
  assert.deepEqual(s.updated, ["alpha"]);
  assert.equal(s.failed[0].id, "beta", "l'échec de beta n'a pas empêché alpha");
  assert.deepEqual(audited, ["alpha", "beta"]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.0.1");
  assert.deepEqual(peekModulesReport().outdated, [], "alpha n'est plus en retard sans nouvelle vérification réseau");
});

test("la page Mises à jour : section Modules, actions réservées au propriétaire et inscrites au journal, aucune boîte native", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/updates/page.tsx", "utf8");
  assert.match(page, /getModulesReport\(\)/);
  assert.match(page, /data-testid="modules-updates"/);
  assert.match(page, /highlightModules/);
  const actions = fs.readFileSync("src/app/admin/(panel)/updates/actions.ts", "utf8");
  for (const fn of ["recheckModules", "updateModulesAction"]) assert.match(actions, new RegExp(`export async function ${fn}[^]*?adminCtx\\("owner"\\)`));
  assert.match(actions, /audit\(user\.email, "module\.update", id\)/);
  const ui = fs.readFileSync("src/components/admin/ModulesUpdates.tsx", "utf8");
  assert.ok(!/window\.confirm|\bconfirm\(/.test(ui.replace(/confirm=|confirmAll|confirmMajor/g, "")));
  assert.match(ui, /AnimatedActionButton/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8"), /peekModulesReport/);
});
