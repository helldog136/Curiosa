import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const S = await import("@/core/updates/service");

beforeEach(async () => {
  await db.reset();
  for (const k of ["VITRINE_INSTALL", "VITRINE_UPDATE_REPO", "VITRINE_RESTART_COMMAND", "VITRINE_SUPERVISED"]) delete process.env[k];
});
after(() => db.close());

const ASSET = (tag) => `vitrine-${tag}-${process.platform}-${process.arch}.tar.gz`;
function app({ version = "1.0.0", release = true, repo = "owner/vitrine" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-svc-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "vitrine", version }));
  if (release) fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify({ version, repo }));
  return dir;
}
/** API GitHub simulée : `tags` = releases publiées (avec leur archive) ; `fail` = réseau en panne. */
const fakeApi = ({ tags = [], fail = false, extra = [] } = {}) => {
  const seen = [];
  const f = async (url) => {
    seen.push(url);
    if (fail) throw new Error("réseau");
    return [...tags.map((t) => ({ tag_name: t, draft: false, prerelease: false, assets: [{ name: ASSET(t) }] })), ...extra];
  };
  f.seen = seen;
  return f;
};
const TAGS = ["v1.0.0", "v1.0.1", "v1.1.0"];

test("installation : archive de release avec dépôt connu → mise à jour possible depuis l'admin", () => {
  const info = S.getInstallInfo(app({ version: "1.2.3" }));
  assert.deepEqual([info.mode, info.canUpdate, info.version, info.repo], ["release", true, "1.2.3", "owner/vitrine"]);
});

test("installation : clone git de développement ou archive sans dépôt → pas de mise à jour depuis l'admin, avec la raison", () => {
  const dev = S.getInstallInfo(app({ release: false }));
  assert.deepEqual([dev.mode, dev.canUpdate], ["manual", false]);
  const noRepo = S.getInstallInfo(app({ repo: "n'importe quoi" }));
  assert.deepEqual([noRepo.mode, noRepo.canUpdate, noRepo.repo], ["manual", false, null]);
});

test("installation : une image Docker se remplace, elle ne se met pas à jour en place", async () => {
  process.env.VITRINE_INSTALL = "docker";
  const info = S.getInstallInfo(app());
  assert.deepEqual([info.mode, info.canUpdate], ["docker", false]);
  assert.equal((await S.checkForUpdate({ appDir: app(), fetchJson: fakeApi({ tags: TAGS }) })).available, false);
});

test("installation : redémarrage — commande de l'exploitant, superviseur, ou manuel ; dépôt configurable mais validé", () => {
  const dir = app();
  assert.equal(S.getInstallInfo(dir).restart, "manual");
  process.env.VITRINE_SUPERVISED = "1";
  assert.equal(S.getInstallInfo(dir).restart, "supervised");
  process.env.VITRINE_RESTART_COMMAND = "systemctl restart site";
  assert.equal(S.getInstallInfo(dir).restart, "command");
  process.env.VITRINE_UPDATE_REPO = "autre/fork";
  assert.equal(S.getInstallInfo(dir).repo, "autre/fork");
  process.env.VITRINE_UPDATE_REPO = "../../etc/passwd";
  assert.equal(S.getInstallInfo(dir).repo, "owner/vitrine", "valeur dangereuse ignorée");
});

test("mise à jour automatique : DÉSACTIVÉE par défaut, activable puis désactivable", async () => {
  assert.equal(await S.isAutoUpdateEnabled(), false);
  await S.setAutoUpdate(true);
  assert.equal(await S.isAutoUpdateEnabled(), true);
  await S.setAutoUpdate(false);
  assert.equal(await S.isAutoUpdateEnabled(), false);
});

test("vérification : mémorise la plus haute version stable et sa nature ; la dernière date de vérification", async () => {
  const dir = app({ version: "1.0.0" });
  const r = await S.checkForUpdate({ appDir: dir, fetchJson: fakeApi({ tags: TAGS }), now: () => 1234 });
  assert.deepEqual([r.latest, r.level, r.available, r.checkedAt, r.error], ["v1.1.0", "minor", true, 1234, null]);
  assert.deepEqual(await S.getUpdateCheck(dir), r, "relue sans interroger le dépôt");
  const same = await S.checkForUpdate({ appDir: app({ version: "1.1.0" }), fetchJson: fakeApi({ tags: TAGS }) });
  assert.deepEqual([same.available, same.level], [false, null]);
});

test("vérification : n'interroge que la liste des releases du dépôt (rien n'est téléchargé)", async () => {
  const api = fakeApi({ tags: TAGS });
  await S.checkForUpdate({ appDir: app(), fetchJson: api });
  assert.deepEqual(api.seen, ["https://api.github.com/repos/owner/vitrine/releases?per_page=30"]);
});

test("vérification : dépôt injoignable → erreur signalée, dernière version connue conservée", async () => {
  const dir = app();
  await S.checkForUpdate({ appDir: dir, fetchJson: fakeApi({ tags: TAGS }) });
  const r = await S.checkForUpdate({ appDir: dir, fetchJson: fakeApi({ fail: true }) });
  assert.equal(r.error, "unreachable");
  assert.equal(r.latest, "v1.1.0");
  assert.ok((await S.checkForUpdate({ appDir: dir, fetchJson: fakeApi({ tags: TAGS }) })).error === null, "l'erreur disparaît au prochain succès");
});

test("vérification : pré-versions, brouillons et releases sans archive → rien à proposer", async () => {
  const extra = [{ tag_name: "v2.0.0-beta.1", prerelease: true, assets: [] }, { tag_name: "v2.0.0", draft: true, assets: [{ name: ASSET("v2.0.0") }] }, { tag_name: "v3.0.0", assets: [] }];
  const r = await S.checkForUpdate({ appDir: app(), fetchJson: fakeApi({ extra }) });
  assert.deepEqual([r.latest, r.available], [null, false]);
});

test("politique automatique : seulement si activée, applicable, sans mise à jour en cours — et jamais pour une version majeure", () => {
  const base = { auto: true, level: "minor", running: false, canUpdate: true };
  assert.equal(S.shouldAutoApply(base), true);
  assert.equal(S.shouldAutoApply({ ...base, level: "patch" }), true);
  assert.equal(S.shouldAutoApply({ ...base, level: "major" }), false, "changement majeur : jamais d'office");
  assert.equal(S.shouldAutoApply({ ...base, auto: false }), false);
  assert.equal(S.shouldAutoApply({ ...base, running: true }), false);
  assert.equal(S.shouldAutoApply({ ...base, canUpdate: false }), false);
  assert.equal(S.shouldAutoApply({ ...base, level: null }), false);
});

test("lancement : version invalide, non plus récente, installation non mise à jour, opération déjà en cours → refusés sans rien lancer", async () => {
  const dir = app({ version: "1.1.0" });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-data-"));
  const started = [];
  const o = { appDir: dir, spawner: (t) => started.push(t), dataDir };
  assert.equal((await S.startUpdate("main", "x", o)).error, "invalid-tag");
  assert.equal((await S.startUpdate("v1.0.0", "x", o)).error, "not-newer");
  assert.equal((await S.startUpdate("v1.1.0", "x", o)).error, "not-newer");
  assert.equal((await S.startUpdate("v1.2.0", "x", { ...o, appDir: app({ release: false }) })).error, "unsupported");
  fs.mkdirSync(path.join(dataDir, "update"));
  fs.writeFileSync(path.join(dataDir, "update", "state.json"), JSON.stringify({ status: "running", startedAt: Date.now() }));
  assert.equal((await S.startUpdate("v1.2.0", "x", o)).error, "running");
  assert.deepEqual(started, []);
});

test("lancement : version plus récente → tâche détachée lancée avec CETTE version, action consignée dans l'audit", async () => {
  const started = [];
  const r = await S.startUpdate("v1.2.0", "owner@example.org", { appDir: app({ version: "1.1.0" }), spawner: (t) => started.push(t), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "d-")) });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(started, ["v1.2.0"]);
  const row = await db.prisma.auditLog.findFirst({ where: { action: "update.start" } });
  assert.deepEqual([row.actor, row.target], ["owner@example.org", "v1.2.0"]);
});

test("vérification périodique : l'automatique étant désactivé par défaut, une mise à jour disponible n'est JAMAIS lancée seule", async () => {
  const started = [];
  const r = await S.runScheduledCheck({ appDir: app({ version: "1.0.0" }), fetchJson: fakeApi({ tags: TAGS }), spawner: (t) => started.push(t), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "d-")) });
  assert.equal(r, "disabled");
  assert.deepEqual(started, []);
  assert.equal((await S.getUpdateCheck(app({ version: "1.0.0" }))).latest, "v1.1.0", "mais la disponibilité est connue et affichée dans l'admin");
});

test("vérification périodique : automatique activé → correctifs et nouveautés installés ; changement majeur seulement signalé", async () => {
  await S.setAutoUpdate(true);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "d-"));
  const started = [];
  const o = (version, tags) => ({ appDir: app({ version }), fetchJson: fakeApi({ tags }), spawner: (t) => started.push(t), dataDir });
  assert.equal(await S.runScheduledCheck(o("1.0.0", TAGS)), "started");
  assert.deepEqual(started, ["v1.1.0"]);
  started.length = 0;
  assert.equal(await S.runScheduledCheck(o("1.1.0", ["v2.0.0"])), "available", "majeure : jamais d'office");
  assert.deepEqual(started, []);
  assert.equal(await S.runScheduledCheck(o("1.1.0", ["v1.1.0"])), "none");
});

test("vérification périodique : pas de seconde mise à jour pendant qu'une autre tourne", async () => {
  await S.setAutoUpdate(true);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "d-"));
  fs.mkdirSync(path.join(dataDir, "update"));
  fs.writeFileSync(path.join(dataDir, "update", "state.json"), JSON.stringify({ status: "running", startedAt: Date.now() }));
  const started = [];
  assert.equal(await S.runScheduledCheck({ appDir: app({ version: "1.0.0" }), fetchJson: fakeApi({ tags: TAGS }), spawner: (t) => started.push(t), dataDir }), "available");
  assert.deepEqual(started, []);
});

test("état et journal : lisibles, vides par défaut, journal tronqué à la fin", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "d-"));
  assert.deepEqual(S.readUpdateState(dataDir), { status: "idle" });
  assert.equal(S.readUpdateLog(10, dataDir), "");
  fs.mkdirSync(path.join(dataDir, "update"));
  fs.writeFileSync(path.join(dataDir, "update", "update.log"), Array.from({ length: 100 }, (_, i) => `ligne ${i}`).join("\n"));
  assert.equal(S.readUpdateLog(3, dataDir), "ligne 97\nligne 98\nligne 99");
  fs.writeFileSync(path.join(dataDir, "update", "state.json"), "{pas du json");
  assert.deepEqual(S.readUpdateState(dataDir), { status: "idle" }, "état corrompu → inactif");
});

test("fichiers : le planificateur et l'enregistrement de démarrage existent, et la vérification toutes les 6 h ne fait que vérifier", () => {
  assert.match(fs.readFileSync("src/instrumentation.ts", "utf8"), /startUpdateScheduler/);
  const sched = fs.readFileSync("src/core/updates/scheduler.ts", "utf8");
  assert.match(sched, /6 \* 60 \* 60_000/);
  assert.ok(sched.includes("runScheduledCheck") && sched.includes("unref"));
});
