import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { setSetting } = await import("@/core/settings");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const I = await import("@/core/maintenance/inspect");
const R = await import("@/core/maintenance/redact");
const N = await import("@/core/maintenance/summary");
const { maintenanceToolProvider, MAINTENANCE_TOOLS } = await import("@/core/maintenance/tools");
const mail = await import("@/core/services/mail");
const U = await import("@/core/updates/service");

// Une « application » jetable : package.json + release.json = une installation par archive (mise à jour possible).
const app = makeTempDir("curiosa-app-");
const setVersion = (v) => fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: v }));
fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ repo: "owner/repo" }));
setVersion("0.1.14");

const calls = { core: [], update: [], reinstall: [], uninstall: [], uninstallOpts: [], retry: [], recheck: 0, mails: [] };
let latest = { tag: "v0.1.15", notes: "Corrections." };
let report = { checkedAt: Date.now(), checked: 0, outdated: [], unchecked: [] };
let moduleCheck = { check: { available: false }, failed: false };
let summary = { updated: [], failed: [], skipped: [], stoppedOn: null };
let reinstallResult = { ok: true, id: "x", changed: true, before: { version: "1.0.0", hash: "a", commit: null }, after: { version: "1.0.1", hash: "b", commit: null }, migrations: [], restartAdvised: false };
let uninstallResult = { ok: true, id: "x" };
let retryResult = { key: "k", from: 1, to: 2, status: "ok" };

beforeEach(async () => {
  await db.reset();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  mail.setMailTransportFactory();
  setVersion("0.1.14");
  fs.rmSync(path.join(db.dir, "update"), { recursive: true, force: true });
  fs.rmSync(path.join(db.dir, "backups"), { recursive: true, force: true });
  for (const k of Object.keys(calls)) calls[k] = Array.isArray(calls[k]) ? [] : 0;
  latest = { tag: "v0.1.15", notes: "Corrections." };
  report = { checkedAt: Date.now(), checked: 0, outdated: [], unchecked: [] };
  moduleCheck = { check: { available: false }, failed: false };
  summary = { updated: [], failed: [], skipped: [], stoppedOn: null };
  D.setMaintenanceDeps({
    appDir: app,
    disk: () => ({ freeBytes: 50 * 2 ** 30, totalBytes: 100 * 2 ** 30 }),
    latestStable: async () => latest,
    recheckCore: async () => { calls.recheck++; },
    modulesReport: async () => report,
    checkModule: async () => moduleCheck,
    updateModules: async (ids) => { calls.update.push(ids); return { ...summary, updated: summary.updated.length ? summary.updated : ids }; },
    reinstall: async (id) => { calls.reinstall.push(id); return reinstallResult; },
    uninstall: async (id, opts) => { calls.uninstall.push(id); calls.uninstallOpts.push(opts); return uninstallResult; },
    retryInstance: async (id) => { calls.retry.push(id); return retryResult; },
    startCoreUpdate: async (tag, actor) => { calls.core.push({ tag, actor }); return { ok: true }; },
    mail: async (subject, text) => { calls.mails.push({ subject, text }); return { ok: true }; },
  });
});
after(() => { fs.rmSync(app, { recursive: true, force: true }); return db.close(); });

const LIST = async () => maintenanceToolProvider.list();
const rpc = (token, name, args = {}, id = 1) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) }), LIST);
const listed = async (token) => (await (await handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), LIST)).json()).result.tools.map((t) => t.name);
/** Appelle un outil ; renvoie { error, value } (value = JSON décodé du texte, ou le texte). */
async function call(token, name, args) {
  const body = await (await rpc(token, name, args)).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
/** Un jeton « maintenance » (profil) avec, en plus, les outils demandés. */
async function maintenanceToken(grant = [], name = "Ma maintenance") {
  const token = await T.createToken(name, "write", "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
const owner = { email: "owner@example.org", owner: true };
const auditRows = (action) => db.prisma.auditLog.findMany({ where: { action: { startsWith: action } }, orderBy: { createdAt: "asc" } });

// ── Catalogue et défauts ────────────────────────────────────────────────────────────────────────────────────────────────────

test("catalogue : les 29 outils (niveaux 1, 2 et 3) avec les bonnes annotations ; aucun n'est actif par défaut ; un destructeur n'est jamais actif d'office", async () => {
  const tools = await LIST();
  assert.deepEqual(tools.map((t) => t.name), [
    "maintenance_status", "maintenance_health", "maintenance_modules", "maintenance_updates", "maintenance_diagnose", "maintenance_audit", "maintenance_request_status", "maintenance_legacy", "maintenance_catalog_list", "maintenance_catalog_get", "maintenance_skin_status", "maintenance_skin_list", "maintenance_content_check",
    "maintenance_check_updates", "maintenance_backup_run", "maintenance_module_reinstall", "maintenance_module_restart", "maintenance_content_check_run",
    "maintenance_module_settings", "maintenance_module_configure", "maintenance_module_configure_advanced",
    "maintenance_module_install", "maintenance_skin_install", "maintenance_skin_activate", "maintenance_skin_remove", "maintenance_module_update", "maintenance_modules_update_all", "maintenance_core_update", "maintenance_module_uninstall",
  ]);
  for (const t of tools) {
    const level = MAINTENANCE_TOOLS.find((m) => m.name === t.name).level;
    assert.equal(t.default, false, `${t.name} : jamais actif pour un jeton ordinaire`);
    // Les réglages d'une instance se LISENT sans rien changer (lecture seule) mais leurs valeurs ne sont lisibles que si le propriétaire l'a accordé (niveau 2).
    assert.equal(t.readOnly, level === 1 || t.name === "maintenance_module_settings");
    assert.equal(t.destructive, level === 3);
    assert.equal(t.profileDefault === true, level === 1, `${t.name} : seul le niveau 1 est actif pour le profil maintenance`);
    if (t.destructive) assert.ok(!t.default && !t.profileDefault, `${t.name} : destructeur, donc jamais actif par défaut`);
    assert.equal(t.source, "maintenance");
  }
});

test("accès : un jeton ordinaire ne voit AUCUN outil de maintenance ; le profil maintenance voit le niveau 1 seulement", async () => {
  const plain = await T.createToken("Brouillons", "write", "o");
  assert.deepEqual((await listed(plain)).filter((n) => n.startsWith("maintenance_")), []);
  const { token } = await maintenanceToken();
  assert.deepEqual(await listed(token), ["maintenance_status", "maintenance_health", "maintenance_modules", "maintenance_updates", "maintenance_diagnose", "maintenance_audit", "maintenance_request_status", "maintenance_legacy", "maintenance_catalog_list", "maintenance_catalog_get", "maintenance_skin_status", "maintenance_skin_list", "maintenance_content_check"]);
});

test("accès : le niveau 2 et le niveau 3 s'accordent un à un ; un jeton en lecture seule n'en reçoit aucun, même accordé", async () => {
  const { token } = await maintenanceToken(["backup_run", "core_update"]);
  const names = await listed(token);
  assert.ok(names.includes("maintenance_backup_run") && names.includes("maintenance_core_update"));
  assert.ok(!names.includes("maintenance_module_update"));
  const readOnly = await T.createToken("Lecture", "read", "o", { grants: { [A.MAINTENANCE_PROFILE]: true, maintenance_backup_run: true, maintenance_core_update: true } });
  assert.deepEqual((await listed(readOnly)).filter((n) => /backup_run|core_update/.test(n)), [], "plafond lecture seule");
});

test("accès : un outil non accordé répond comme un outil inconnu (rien ne se devine)", async () => {
  const { token } = await maintenanceToken();
  const refused = await call(token, "maintenance_backup_run");
  const unknown = await call(token, "maintenance_nope");
  assert.match(refused.error, /Unknown tool/);
  assert.equal(refused.error.replace("maintenance_backup_run", "X"), unknown.error.replace("maintenance_nope", "X"));
  assert.equal(calls.core.length + calls.update.length, 0);
});

test("accès : « remettre les défauts » d'un jeton maintenance garde le niveau 1 et rien d'autre ; accorder puis retirer revient au défaut du profil", () => {
  const tools = [{ name: "maintenance_status", readOnly: true, default: false, profileDefault: true }, { name: "maintenance_core_update", readOnly: false, default: false, profileDefault: false }, { name: "blog__publish", readOnly: false, default: true }];
  const g = { [A.MAINTENANCE_PROFILE]: true };
  assert.deepEqual(tools.map((t) => A.isGranted(t, g)), [true, false, false], "un jeton maintenance n'a QUE la maintenance, même si un module active une action d'office");
  assert.deepEqual(tools.map((t) => A.isGranted(t, {})), [false, false, true]);
  let next = A.setGrant(g, tools[1], true);
  assert.equal(A.isGranted(tools[1], next), true);
  next = A.setGrant(next, tools[1], false);
  assert.deepEqual(next, g, "retirer ramène au défaut du profil (pas de surcharge qui traîne)");
  next = A.setGrant(g, tools[2], true);
  assert.equal(A.isGranted(tools[2], next), true, "une action de module peut être accordée à la main");
});

// ── Niveau 1 : lecture et diagnostic ────────────────────────────────────────────────────────────────────────────────────────

test("status : version, canal, Node, uptime, modules, mise à jour en cours", async () => {
  await db.prisma.module.create({ data: { id: "m1", source: "git", repoUrl: "https://example.org/m1.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "m2", source: "git", repoUrl: "https://example.org/m2.git", ref: "v1.0.0", version: "1.0.0", enabled: false } });
  fs.mkdirSync(path.join(db.dir, "update"), { recursive: true });
  fs.writeFileSync(path.join(db.dir, "update", "state.json"), JSON.stringify({ status: "running", target: "v0.1.15", step: "download", startedAt: Date.now() }));
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_status");
  assert.equal(value.core.version, "0.1.14");
  assert.equal(value.core.channel, "stable");
  assert.equal(value.runtime.node, process.version);
  assert.ok(value.runtime.uptimeSeconds >= 0);
  assert.deepEqual(value.modules, { installed: 2 }, "plus d'état éteint : seulement le nombre de modules installés");
  assert.deepEqual([value.update.state, value.update.target, value.update.step], ["running", "v0.1.15", "download"]);
  assert.equal(JSON.stringify(value).includes(db.dir), false, "aucun chemin du serveur");
});

test("health : disque, base saine, dernière sauvegarde (récente ou non), erreurs récentes bornées et SANS secret", async () => {
  fs.mkdirSync(path.join(db.dir, "update"), { recursive: true });
  const secret = "vit_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  fs.writeFileSync(path.join(db.dir, "update", "update.log"), [
    `error: download failed for https://user:hunter2@example.org/a.tgz?token=abcd1234 with ${secret}`,
    "password=hunter2 error while extracting",
    "ligne normale sans rien",
    ...Array.from({ length: 80 }, (_, i) => `error ${i} ${"x".repeat(900)}`),
  ].join("\n"));
  fs.writeFileSync(path.join(db.dir, "update", "state.json"), JSON.stringify({ status: "failed", target: "v0.1.15", step: "extract", error: "step-failed:extract", rolledBack: true }));
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_health");
  assert.deepEqual([value.disk.freeBytes, value.disk.totalBytes, value.disk.freePercent, value.disk.level], [50 * 2 ** 30, 100 * 2 ** 30, 50, "ok"]);
  assert.equal(value.database.ok, true);
  assert.deepEqual(value.lastBackup, { at: null, recent: false, by: null });
  const text = JSON.stringify(value);
  for (const leak of [secret, "hunter2", "abcd1234", "user:"]) assert.ok(!text.includes(leak), `fuite : ${leak}`);
  assert.ok(value.recentErrors.length <= 25 && value.recentErrors.every((e) => e.message.length <= 300), "bornées en nombre et en taille");
  assert.ok(value.recentErrors.some((e) => e.source === "update" && /failed/.test(e.message)));
});

test("health : une sauvegarde faite par la maintenance, ou téléchargée par le propriétaire, est « récente » ; une vieille ne l'est plus", async () => {
  const old = new Date(Date.now() - 30 * 86400_000);
  await db.prisma.auditLog.create({ data: { actor: "owner@example.org", action: "backup.create", target: "", createdAt: old } });
  assert.equal((await I.lastBackup()).recent, false);
  await db.prisma.auditLog.create({ data: { actor: "mcp:IA", action: "mcp.maintenance.backup_run", target: "failed — nope" } });
  assert.equal((await I.lastBackup()).recent, false, "une copie ratée ne compte pas");
  await db.prisma.auditLog.create({ data: { actor: "mcp:IA", action: "mcp.maintenance.backup_run", target: "ok — copie" } });
  assert.deepEqual([(await I.lastBackup()).recent, (await I.lastBackup()).by], [true, "ai"]);
});

test("modules : version, source (sans identifiants), instances en erreur, mise à jour disponible", async () => {
  await db.prisma.module.create({ data: { id: "alpha", source: "git", repoUrl: "https://bob:s3cr3t@example.org/alpha.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.moduleInstance.create({ data: { moduleId: "alpha", key: "alpha-1" } });
  const inst = await db.prisma.moduleInstance.findUnique({ where: { key: "alpha-1" } });
  await setSetting(`instance.${inst.id}.__dataStatus`, { status: "failed", error: "boom password=hunter2" });
  report = { checkedAt: Date.now(), checked: 1, unchecked: [], outdated: [{ id: "alpha", current: "1.0.0", target: "1.1.0", level: "minor" }] };
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_modules");
  const m = value.modules[0];
  assert.deepEqual([m.id, m.version, m.source, m.update.available, m.update.target, m.update.followsStableTag], ["alpha", "1.0.0", "git", true, "1.1.0", true]);
  assert.equal(m.loadable, false, "dossier absent : module non chargeable, signalé");
  assert.match(m.instances[0].error, /failed/);
  const text = JSON.stringify(value);
  assert.ok(!text.includes("s3cr3t") && !text.includes("hunter2"), "ni mot de passe d'adresse ni secret d'erreur");
});

test("updates : cœur ET modules ; stable seulement ; niveau ; notes courtes ; un module sur une branche n'est pas mettable à jour par une IA", async () => {
  latest = { tag: "v0.2.0", notes: "# Notes\n\n- une chose\n".repeat(200) };
  await db.prisma.module.create({ data: { id: "tagged", source: "git", repoUrl: "https://example.org/t.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "branchy", source: "git", repoUrl: "https://example.org/b.git", ref: "main", version: "1.0.0", enabled: true } });
  report = { checkedAt: Date.now(), checked: 2, unchecked: ["lost"], outdated: [
    { id: "tagged", current: "1.0.0", target: "1.0.1", level: "patch" }, { id: "branchy", current: "1.0.0", target: "abc1234" }, { id: "needy", current: "1.0.0", target: "2.0.0", level: "major", needsCore: "0.3.0" },
  ] };
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_updates");
  assert.deepEqual([value.core.current, value.core.latestStable, value.core.level, value.core.available], ["0.1.14", "0.2.0", "minor", true]);
  assert.ok(value.core.notes.length <= 600);
  const by = Object.fromEntries(value.modules.map((m) => [m.id, m]));
  assert.equal(by.tagged.aiCanUpdate, true);
  assert.equal(by.branchy.aiCanUpdate, false);
  assert.match(by.branchy.reason, /branch or a fixed commit/);
  assert.equal(by.needy.aiCanUpdate, false);
  assert.match(by.needy.reason, /core 0\.3\.0/);
  assert.deepEqual(value.unchecked, ["lost"]);
});

test("updates : jamais de candidate — le site est sur le canal RC, le cœur proposé reste la plus haute STABLE (findLatestStable)", async () => {
  await setSetting("updates.channel", "rc");
  const asset = (tag) => ({ name: `curiosa-${tag}-${process.platform}-${process.arch}.tar.gz` });
  const releases = [
    { tag_name: "v0.3.0-rc.2", prerelease: true, assets: [asset("v0.3.0-rc.2")] },
    { tag_name: "dev-20261012", prerelease: true, assets: [asset("dev-20261012")] },
    { tag_name: "v0.2.0", assets: [asset("v0.2.0")], body: "Stable." },
    { tag_name: "v0.1.15", assets: [asset("v0.1.15")] },
  ];
  const found = await U.findLatestStable({ appDir: app, fetchJson: async () => releases });
  assert.deepEqual(found, { tag: "v0.2.0", notes: "Stable." });
  // Le canal du site, lui, voit la candidate : c'est le choix de l'administrateur, pas celui de l'IA.
  const check = await U.checkForUpdate({ appDir: app, fetchJson: async () => releases });
  assert.equal(check.latest, "v0.3.0-rc.2");
  assert.deepEqual(await U.startUpdate("v0.3.0-rc.2", "mcp:IA", { appDir: app, dataDir: db.dir, stableOnly: true, spawner: () => calls.core.push("SPAWNED") }), { ok: false, error: "invalid-tag" });
  assert.deepEqual(await U.startUpdate("dev-20261012", "mcp:IA", { appDir: app, dataDir: db.dir, stableOnly: true, spawner: () => calls.core.push("SPAWNED") }), { ok: false, error: "invalid-tag" });
  assert.equal(calls.core.length, 0, "rien n'est lancé");
  assert.deepEqual(await U.startUpdate("v0.3.0-rc.2", "owner", { appDir: app, dataDir: db.dir, spawner: () => calls.core.push("HUMAN") }), { ok: true }, "l'administrateur, lui, peut (canal rc)");
});

test("diagnose : un rapport par problème avec la cause probable, l'action proposée et l'outil qui la fait", async () => {
  await db.prisma.module.create({ data: { id: "broken", source: "git", repoUrl: "https://example.org/b.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  report = { checkedAt: Date.now(), checked: 1, unchecked: [], outdated: [{ id: "broken", current: "1.0.0", target: "1.0.1", level: "patch" }] };
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_diagnose");
  assert.ok(["needs attention now", "needs attention soon"].includes(value.verdict));
  const tools = Object.fromEntries(value.problems.map((p) => [p.tool, p]));
  assert.ok(tools.maintenance_backup_run, "aucune sauvegarde → en faire une");
  assert.ok(tools.maintenance_module_reinstall, "module non chargeable → réinstaller");
  assert.ok(tools.maintenance_core_update, "mise à jour du cœur disponible");
  assert.ok(tools.maintenance_module_update, "une mise à jour de module");
  for (const p of value.problems) assert.ok(p.problem && p.probableCause && p.proposedAction && "needsHuman" in p);
  assert.ok(value.problems[0].severity === "critical", "le plus grave d'abord");
});

test("diagnose : un site sain, sauvegardé et à jour → aucun problème", async () => {
  latest = { tag: "v0.1.14", notes: "" };
  await db.prisma.auditLog.create({ data: { actor: "owner@example.org", action: "backup.create", target: "" } });
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_diagnose");
  assert.equal(value.verdict, "healthy");
  assert.deepEqual(value.problems, []);
});

test("diagnose : disque presque plein → problème critique à signaler au propriétaire (l'IA ne supprime aucun fichier)", async () => {
  D.setMaintenanceDeps({ disk: () => ({ freeBytes: 10 * 2 ** 20, totalBytes: 100 * 2 ** 30 }) });
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_diagnose");
  const p = value.problems.find((x) => /Disk space/.test(x.problem));
  assert.equal(p.severity, "critical");
  assert.equal(p.needsHuman, true);
  assert.equal(p.tool, null);
  const backup = await maintenanceToken(["backup_run"], "B");
  assert.match((await call(backup.token, "maintenance_backup_run")).value.message, /Not enough free disk space/);
  assert.equal(fs.existsSync(path.join(db.dir, "backups")), false, "aucune copie quand il n'y a pas de place");
});

test("audit : les actions de maintenance de l'IA et des humains, bornées ; jamais d'adresse e-mail ni de secret", async () => {
  await db.prisma.auditLog.createMany({ data: [
    { actor: "alice@example.org", action: "update.start", target: "v0.1.14" },
    { actor: "mcp:Maint", action: "mcp.maintenance.backup_run", target: "ok — copie password=hunter2" },
    { actor: "alice@example.org", action: "settings.update", target: "pas de la maintenance" },
    { actor: "auto-update", action: "update.start", target: "v0.1.15" },
  ] });
  for (let i = 0; i < 60; i++) await db.prisma.auditLog.create({ data: { actor: "bob@example.org", action: "module.update", target: `m${i}` } });
  const { token } = await maintenanceToken();
  const small = (await call(token, "maintenance_audit", { limit: 5 })).value;
  assert.equal(small.length, 5);
  const all = (await call(token, "maintenance_audit", { limit: 50 })).value;
  assert.equal(all.length, 50, "borné à 50");
  const text = JSON.stringify(all);
  assert.ok(!text.includes("@example.org") && !text.includes("hunter2") && !text.includes("settings.update"));
  assert.ok(all.every((r) => ["human", "scheduler"].includes(r.by) || r.by.startsWith("ai:")));
  assert.equal((await call(token, "maintenance_audit", { limit: 500 })).error.includes("at most 50"), true);
});

test("masquage : jetons vit_, clés, mots de passe, adresses avec jeton, en-têtes ; bornes de taille ; texte ordinaire intact", () => {
  const cases = [
    "vit_ABCDEFGH12345678abcdefgh", "Authorization: Bearer abcdef0123456789ZZ", "https://u:pw@host.example/x", "https://host/x?token=SECRETVALUE&a=1", "https://host/x?api_key=SECRETVALUE",
    'password: "hunter2"', "SMTP_PASS=hunter2", '{"secret":"hunter2"}', "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "sk-abcdefghijklmnopqrstuvwxyz", "AKIAABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123", "0123456789abcdef0123456789abcdef0123", "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----",
  ];
  for (const c of cases) {
    const out = R.redactSecrets(c);
    assert.ok(/\[masked\]/.test(out), `non masqué : ${c} → ${out}`);
    assert.ok(!/hunter2|SECRETVALUE|abcdefghijklmnopqrstuvwxyz|ABCDEFGH12345678|u:pw/.test(out), `fuite : ${out}`);
  }
  assert.equal(R.redactSecrets("Le module blog 1.2.3 est à jour."), "Le module blog 1.2.3 est à jour.");
  assert.equal(R.redactSecrets("mot ".repeat(500), 100).length, 100);
  assert.equal(R.redactSecrets("a".repeat(2000), 100), "[masked]", "une longue suite opaque est masquée");
  assert.deepEqual(R.redactDeep({ a: ["password=zzz", { b: "vit_ABCDEFGH12345678" }] }), { a: ["password=[masked]", { b: "vit_[masked]" }] });
  assert.equal(R.tailLines("a\nb\nc\nd", { lines: 2 }).join(), "c,d");
});

// ── Niveau 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("check_updates : revérifie le cœur et les modules (vide les caches) ; audité", async () => {
  report = { checkedAt: Date.now(), checked: 1, unchecked: [], outdated: [{ id: "a", current: "1", target: "2" }] };
  const { token } = await maintenanceToken(["check_updates"]);
  const { value } = await call(token, "maintenance_check_updates");
  assert.equal(value.ok, true);
  assert.equal(calls.recheck, 1);
  assert.equal(value.details.moduleUpdates, 1);
  const rows = await auditRows("mcp.maintenance.check_updates");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "mcp:Ma maintenance");
});

test("backup_run : copie la base sur le serveur, sans jamais montrer le chemin ni le contenu ; la sauvegarde devient « récente »", async () => {
  const { token } = await maintenanceToken(["backup_run"]);
  const { value } = await call(token, "maintenance_backup_run");
  assert.equal(value.ok, true);
  assert.ok(value.details.sizeBytes > 0);
  assert.ok(!JSON.stringify(value).includes(db.dir), "pas de chemin");
  const files = fs.readdirSync(path.join(db.dir, "backups")).filter((f) => f.startsWith("maintenance-"));
  assert.equal(files.length, 1);
  assert.equal((await I.lastBackup()).recent, true);
  const health = (await call((await maintenanceToken()).token, "maintenance_health")).value;
  assert.equal(health.lastBackup.recent, true);
});

test("module_reinstall et module_restart : appellent les fonctions du cœur, valident les arguments, rendent un résultat clair", async () => {
  const { token } = await maintenanceToken(["module_reinstall", "module_restart"]);
  const r = await call(token, "maintenance_module_reinstall", { module: "alpha" });
  assert.equal(r.value.ok, true);
  assert.match(r.value.message, /renewed/);
  assert.deepEqual(calls.reinstall, ["alpha"]);
  assert.match((await call(token, "maintenance_module_reinstall", { module: "../etc/passwd" })).error, /module identifier/);
  assert.match((await call(token, "maintenance_module_reinstall", {})).error, /missing required/);
  reinstallResult = { ok: false, id: "alpha", error: "modules.error.reinstallNoSource", rolledBack: false };
  assert.match((await call(token, "maintenance_module_reinstall", { module: "alpha" })).value.message, /installed by hand/);

  assert.match((await call(token, "maintenance_module_restart", { instance: "ghost" })).value.message, /Unknown instance/);
  await db.prisma.moduleInstance.create({ data: { moduleId: "alpha", key: "alpha-1" } });
  assert.match((await call(token, "maintenance_module_restart", { instance: "alpha-1" })).value.message, /running again/);
  assert.equal(calls.retry.length, 1);
  retryResult = { key: "alpha-1", from: 1, to: 2, status: "failed" };
  assert.equal((await call(token, "maintenance_module_restart", { instance: "alpha-1" })).value.ok, false);
});

test("verrou : une seule opération de niveau 2/3 à la fois ; la seconde est refusée sans rien faire", async () => {
  const { token } = await maintenanceToken(["module_reinstall", "check_updates"]);
  let release;
  D.setMaintenanceDeps({ reinstall: () => new Promise((resolve) => { release = () => resolve(reinstallResult); }) });
  const first = call(token, "maintenance_module_reinstall", { module: "alpha" });
  await new Promise((r) => setTimeout(r, 30));
  const second = await call(token, "maintenance_check_updates");
  assert.match(second.value.message, /Another maintenance operation is running/);
  assert.equal(second.value.busy, true);
  assert.equal(calls.recheck, 0);
  release(); await first;
  assert.equal((await call(token, "maintenance_check_updates")).value.ok, true, "verrou rendu");
});

test("cadence : au plus 12 actions de niveau 2/3 par heure et par jeton ; un autre jeton n'est pas gêné", async () => {
  const a = await maintenanceToken(["check_updates"], "A");
  const b = await maintenanceToken(["check_updates"], "B");
  for (let i = 0; i < M.MAX_ACTIONS_PER_HOUR; i++) assert.equal((await call(a.token, "maintenance_check_updates")).value.ok, true);
  assert.match((await call(a.token, "maintenance_check_updates")).error, /Too many maintenance actions/);
  assert.equal((await call(b.token, "maintenance_check_updates")).value.ok, true);
});

// ── Niveau 3 : validation humaine ───────────────────────────────────────────────────────────────────────────────────────────

test("validation humaine (défaut) : core_update ne fait que créer une demande {pending_approval, requestId} — rien n'est lancé", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const { value } = await call(token, "maintenance_core_update");
  assert.equal(value.status, "pending_approval");
  assert.match(value.requestId, /^req_/);
  assert.deepEqual(value.plan, { from: "0.1.14", to: "0.1.15", level: "patch" });
  assert.equal(calls.core.length, 0, "RIEN d'exécuté");
  assert.equal(await Q.pendingCount(), 1);
  const req = await Q.getRequest(value.requestId);
  assert.ok(req.expiresAt - req.createdAt === 24 * 3600_000);
  assert.equal((await auditRows("mcp.maintenance.request")).length, 1);
  assert.equal((await auditRows("mcp.maintenance.core_update")).length, 0, "aucune exécution inscrite");
  // Le même appel répété ne remplit pas la file.
  assert.equal((await call(token, "maintenance_core_update")).value.requestId, value.requestId);
  assert.equal(await Q.pendingCount(), 1);
});

test("approbation : le propriétaire approuve → exécuté UNE seule fois ; la seconde approbation ne fait rien ; request_status relit le résultat", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const { value } = await call(token, "maintenance_core_update");
  const result = await M.approveRequest(value.requestId, owner);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.core, [{ tag: "v0.1.15", actor: "mcp:Ma maintenance" }]);
  const again = await M.approveRequest(value.requestId, owner);
  assert.deepEqual([again.ok, again.reason], [false, "not-pending"]);
  assert.equal(calls.core.length, 1, "pas deux fois");
  const status = (await call(token, "maintenance_request_status", { requestId: value.requestId })).value;
  assert.equal(status.status, "done");
  assert.match(status.result.message, /started in the background/);
  const rows = await auditRows("mcp.maintenance.core_update");
  assert.equal(rows.length, 1);
  assert.match(rows[0].target, /^ok \(approved\)/);
  assert.equal((await auditRows("mcp.maintenance.approve")).length, 1);
});

test("refus : une demande refusée ne s'exécute jamais, même si on tente ensuite de l'approuver", async () => {
  const { token } = await maintenanceToken(["module_uninstall"]);
  await db.prisma.module.create({ data: { id: "alpha", source: "git", repoUrl: "https://example.org/a.git", ref: "v1.0.0", version: "1.0.0", enabled: false } });
  const { value } = await call(token, "maintenance_module_uninstall", { module: "alpha" });
  assert.equal(value.status, "pending_approval");
  assert.equal((await M.denyRequestBy(value.requestId, owner)).ok, true);
  const late = await M.approveRequest(value.requestId, owner);
  assert.deepEqual([late.ok, late.reason], [false, "not-pending"]);
  assert.equal(calls.uninstall.length, 0);
  assert.equal((await call(token, "maintenance_request_status", { requestId: value.requestId })).value.status, "denied");
});

test("expiration : après 24 h la demande est « expired » et ne s'exécute jamais", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const { value } = await call(token, "maintenance_core_update");
  const later = Date.now() + 25 * 3600_000;
  D.setMaintenanceDeps({ now: () => later });
  assert.equal((await Q.getRequest(value.requestId, later)).status, "expired");
  const r = await M.approveRequest(value.requestId, owner);
  assert.deepEqual([r.ok, r.reason], [false, "expired"]);
  assert.equal(calls.core.length, 0);
  assert.equal((await call(token, "maintenance_request_status", { requestId: value.requestId })).value.status, "expired");
});

test("réservé au propriétaire : un administrateur ou un éditeur ne peut ni approuver ni refuser", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const { value } = await call(token, "maintenance_core_update");
  for (const owner of [false, undefined, "true", 1]) {
    assert.equal((await M.approveRequest(value.requestId, { email: "x@example.org", owner })).reason, "forbidden");
    assert.equal((await M.denyRequestBy(value.requestId, { email: "x@example.org", owner })).reason, "forbidden");
  }
  assert.equal(calls.core.length, 0);
  assert.equal((await Q.getRequest(value.requestId)).status, "pending");
});

test("revérification à l'exécution : si la version stable a changé, ou si une mise à jour tourne déjà, la demande approuvée n'est PAS exécutée", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const a = (await call(token, "maintenance_core_update")).value;
  latest = { tag: "v0.1.16", notes: "" };
  const changed = await M.approveRequest(a.requestId, owner);
  assert.equal(changed.ok, false);
  assert.match(changed.message, /changed since the request/);
  assert.equal(calls.core.length, 0);
  assert.equal((await Q.getRequest(a.requestId)).status, "failed", "approuvée une fois, donc consommée");

  latest = { tag: "v0.1.16", notes: "" };
  const b = (await call(token, "maintenance_core_update")).value;
  fs.mkdirSync(path.join(db.dir, "update"), { recursive: true });
  fs.writeFileSync(path.join(db.dir, "update", "state.json"), JSON.stringify({ status: "running", target: "v0.1.16", startedAt: Date.now() }));
  D.setMaintenanceDeps({ dataDir: db.dir });
  const running = await M.approveRequest(b.requestId, owner);
  assert.match(running.message, /update is running/);
  assert.equal(calls.core.length, 0);
});

test("verrou à l'approbation : si une autre opération tourne, la demande reste en attente (l'approbation n'est pas gâchée)", async () => {
  const { token } = await maintenanceToken(["core_update", "module_reinstall"]);
  const req = (await call(token, "maintenance_core_update")).value;
  let release;
  D.setMaintenanceDeps({ reinstall: () => new Promise((resolve) => { release = () => resolve(reinstallResult); }) });
  const slow = call(token, "maintenance_module_reinstall", { module: "alpha" });
  await new Promise((r) => setTimeout(r, 30));
  const r = await M.approveRequest(req.requestId, owner);
  assert.deepEqual([r.ok, r.reason], [false, "busy"]);
  assert.equal((await Q.getRequest(req.requestId)).status, "pending");
  release(); await slow;
  assert.equal((await M.approveRequest(req.requestId, owner)).ok, true);
  assert.equal(calls.core.length, 1);
});

test("deux approbations en même temps : une seule exécution", async () => {
  const { token } = await maintenanceToken(["core_update"]);
  const req = (await call(token, "maintenance_core_update")).value;
  const results = await Promise.all([M.approveRequest(req.requestId, owner), M.approveRequest(req.requestId, owner), M.approveRequest(req.requestId, owner)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(calls.core.length, 1);
});

test("request_status : une IA ne relit que ses propres demandes", async () => {
  const a = await maintenanceToken(["core_update"], "A");
  const b = await maintenanceToken([], "B");
  const req = (await call(a.token, "maintenance_core_update")).value;
  assert.equal((await call(a.token, "maintenance_request_status", { requestId: req.requestId })).value.status, "pending_approval");
  assert.match((await call(b.token, "maintenance_request_status", { requestId: req.requestId })).error, /Unknown request/);
  assert.match((await call(b.token, "maintenance_request_status", { requestId: "req_nope" })).error, /Unknown request/);
});

test("file de demandes : au plus 5 en attente par jeton", async () => {
  const { token } = await maintenanceToken(["module_uninstall"]);
  for (let i = 0; i < 7; i++) await db.prisma.module.create({ data: { id: `m${i}`, source: "git", repoUrl: "https://example.org/a.git", ref: "v1.0.0", version: "1.0.0", enabled: false } });
  for (let i = 0; i < 5; i++) assert.equal((await call(token, "maintenance_module_uninstall", { module: `m${i}` })).value.status, "pending_approval");
  assert.match((await call(token, "maintenance_module_uninstall", { module: "m5" })).error, /Too many requests/);
});

// ── Niveau 3 : exécution directe ────────────────────────────────────────────────────────────────────────────────────────────

test("exécution directe (choix explicite de l'administrateur, par jeton) : exécuté tout de suite ; l'autre jeton reste en validation humaine", async () => {
  const direct = await maintenanceToken(["core_update"], "Directe");
  const other = await maintenanceToken(["core_update"], "Prudente");
  assert.equal(await S.getApprovalMode(direct.id), "human", "défaut");
  await S.setApprovalMode(direct.id, "direct");
  const { value } = await call(direct.token, "maintenance_core_update");
  assert.equal(value.status, "done");
  assert.deepEqual(calls.core.map((c) => c.tag), ["v0.1.15"]);
  assert.equal((await auditRows("mcp.maintenance.core_update"))[0].actor, "mcp:Directe");
  assert.equal((await call(other.token, "maintenance_core_update")).value.status, "pending_approval");
  assert.equal(calls.core.length, 1);
  await S.setApprovalMode(direct.id, "human");
  assert.equal(await S.getApprovalMode(direct.id), "human");
});

// ── JAMAIS de candidate / d'instantané / de rétrogradation ──────────────────────────────────────────────────────────────────

test("core_update : refuse s'il n'y a rien de plus récent en stable (même version, plus ancienne) — jamais de rétrogradation", async () => {
  const { token, id } = await maintenanceToken(["core_update"]);
  await S.setApprovalMode(id, "direct");
  for (const tag of ["v0.1.14", "v0.1.13", "v0.0.9"]) {
    latest = { tag, notes: "" };
    const r = await call(token, "maintenance_core_update");
    assert.match(r.error, /Nothing to do/);
    assert.match(r.error, /never downgraded/);
  }
  setVersion("0.1.15-rc.2");
  latest = { tag: "v0.1.14", notes: "" };
  assert.match((await call(token, "maintenance_core_update")).error, /Nothing to do/, "un site en candidate ne « descend » pas vers une stable plus ancienne");
  assert.equal(calls.core.length, 0);
  latest = null;
  assert.match((await call(token, "maintenance_core_update")).error, /No stable release/);
});

test("core_update : une version candidate ou un instantané n'est jamais visé, même si la source le propose et quel que soit le canal du site", async () => {
  const { token, id } = await maintenanceToken(["core_update"]);
  await S.setApprovalMode(id, "direct");
  await setSetting("updates.channel", "rc");
  for (const tag of ["v0.2.0-rc.1", "dev-20261012", "v0.2.0-rc.3", "main", "v0.2"]) {
    latest = { tag, notes: "" };
    const r = await call(token, "maintenance_core_update");
    assert.ok(r.error, `${tag} doit être refusé`);
  }
  assert.equal(calls.core.length, 0);
  // Même une demande déjà approuvée visant une candidate (forgée dans la file) ne passe pas.
  latest = { tag: "v0.1.15", notes: "" };
  const forged = await Q.createRequest({ action: "core_update", plan: { from: "0.1.14", to: "0.2.0-rc.1" }, tokenId: id, tokenName: "x" });
  const r = await M.approveRequest(forged.request.id, owner);
  assert.equal(r.ok, false);
  assert.equal(calls.core.length, 0);
  // Et la fonction du cœur refuse aussi, en dernier recours.
  assert.deepEqual(await U.startUpdate("v0.2.0-rc.1", "x", { appDir: app, dataDir: db.dir, stableOnly: true, spawner: () => calls.core.push("SPAWN") }), { ok: false, error: "invalid-tag" });
});

test("modules : un module dont la cible est une préversion, un instantané, un commit ou une branche n'est jamais mis à jour par l'IA (module_update et modules_update_all)", async () => {
  const { token, id } = await maintenanceToken(["module_update", "modules_update_all"]);
  await S.setApprovalMode(id, "direct");
  await db.prisma.module.create({ data: { id: "tagged", source: "git", repoUrl: "https://example.org/t.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "branchy", source: "git", repoUrl: "https://example.org/b.git", ref: "main", version: "1.0.0", enabled: true } });
  for (const target of ["v1.1.0-rc.1", "dev-20261012", "abc1234"]) {
    moduleCheck = { check: { available: true, target, level: "minor" }, failed: false };
    assert.match((await call(token, "maintenance_module_update", { module: "tagged" })).error, /cannot be updated by an AI/, target);
  }
  moduleCheck = { check: { available: true, target: "abc1234" }, failed: false };
  assert.match((await call(token, "maintenance_module_update", { module: "branchy" })).error, /branch or a fixed commit/);
  moduleCheck = { check: { available: true, target: "v2.0.0", level: "major", needsCore: "0.9.0" }, failed: false };
  assert.match((await call(token, "maintenance_module_update", { module: "tagged" })).error, /core 0\.9\.0/);
  report = { checkedAt: Date.now(), checked: 3, unchecked: [], outdated: [
    { id: "tagged", current: "1.0.0", target: "1.1.0-rc.1" }, { id: "branchy", current: "1.0.0", target: "abc1234" },
  ] };
  assert.match((await call(token, "maintenance_modules_update_all")).error, /No module can be updated by an AI/);
  assert.equal(calls.update.length, 0);
});

// ── Niveau 3 : modules ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("module_update : demande, puis approbation → le module est mis à jour (même fonction que l'admin) ; une version qui a changé entre-temps n'est pas exécutée", async () => {
  const { token } = await maintenanceToken(["module_update"]);
  await db.prisma.module.create({ data: { id: "tagged", source: "git", repoUrl: "https://example.org/t.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  moduleCheck = { check: { available: true, target: "v1.0.1", level: "patch" }, failed: false };
  const a = (await call(token, "maintenance_module_update", { module: "tagged" })).value;
  assert.deepEqual(a.plan, { module: "tagged", from: "1.0.0", to: "1.0.1", level: "patch" });
  assert.equal(calls.update.length, 0);
  assert.equal((await M.approveRequest(a.requestId, owner)).ok, true);
  assert.deepEqual(calls.update, [["tagged"]]);

  moduleCheck = { check: { available: true, target: "v1.0.2", level: "patch" }, failed: false };
  const b = (await call(token, "maintenance_module_update", { module: "tagged" })).value;
  moduleCheck = { check: { available: true, target: "v1.0.3", level: "patch" }, failed: false };
  const r = await M.approveRequest(b.requestId, owner);
  assert.equal(r.ok, false);
  assert.match(r.message, /changed since the request/);
  assert.equal(calls.update.length, 1);
  moduleCheck = { check: { available: false }, failed: false };
  assert.match((await call(token, "maintenance_module_update", { module: "tagged" })).error, /already up to date/);
  assert.match((await call(token, "maintenance_module_update", { module: "ghost" })).error, /Unknown module/);
});

test("modules_update_all : ne met à jour que les modules éligibles, un par un (liste figée à la demande, revérifiée à l'exécution)", async () => {
  const { token } = await maintenanceToken(["modules_update_all"]);
  for (const id of ["a", "b", "c"]) await db.prisma.module.create({ data: { id, source: "git", repoUrl: `https://example.org/${id}.git`, ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "d", source: "git", repoUrl: "https://example.org/d.git", ref: "develop", version: "1.0.0", enabled: true } });
  report = { checkedAt: Date.now(), checked: 4, unchecked: [], outdated: [
    { id: "a", current: "1.0.0", target: "1.0.1" }, { id: "b", current: "1.0.0", target: "1.1.0-rc.1" }, { id: "c", current: "1.0.0", target: "1.2.0" }, { id: "d", current: "1.0.0", target: "ffffff0" },
  ] };
  const req = (await call(token, "maintenance_modules_update_all")).value;
  assert.deepEqual(req.plan.modules, [{ id: "a", from: "1.0.0", to: "1.0.1" }, { id: "c", from: "1.0.0", to: "1.2.0" }]);
  // « c » change de cible avant l'approbation : il est sauté, « a » est fait.
  report = { ...report, outdated: report.outdated.map((o) => (o.id === "c" ? { ...o, target: "1.3.0" } : o)) };
  const r = await M.approveRequest(req.requestId, owner);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.update, [["a"]]);
  assert.match(r.message, /skipped \(changed since the request\): c/);
});

test("module_uninstall : demande, puis approbation → désinstallé ; refusé d'avance si un autre module en dépend ou s'il n'existe pas", async () => {
  const { token } = await maintenanceToken(["module_uninstall"]);
  await db.prisma.module.create({ data: { id: "alpha", source: "git", repoUrl: "https://example.org/a.git", ref: "v1.0.0", version: "1.0.0", enabled: false } });
  assert.match((await call(token, "maintenance_module_uninstall", { module: "ghost" })).error, /Unknown module/);
  const req = (await call(token, "maintenance_module_uninstall", { module: "alpha" })).value;
  assert.equal(calls.uninstall.length, 0);
  assert.equal((await M.approveRequest(req.requestId, owner)).ok, true);
  assert.deepEqual(calls.uninstall, ["alpha"]);
  assert.deepEqual(calls.uninstallOpts, [{ keepData: true }], "sans précision : les données sont GARDÉES (non destructif)");
  uninstallResult = { ok: false, error: "modules.error.requiredBy" };
  await db.prisma.module.create({ data: { id: "beta", source: "git", repoUrl: "https://example.org/b.git", ref: "v1.0.0", version: "1.0.0", enabled: false } });
  const req2 = (await call(token, "maintenance_module_uninstall", { module: "beta" })).value;
  const r = await M.approveRequest(req2.requestId, owner);
  assert.equal(r.ok, false);
  assert.match(r.message, /other modules need it/);
  assert.equal((await Q.getRequest(req2.requestId)).status, "failed");
});

test("module_uninstall : keepData=false (tout effacer) est une demande distincte, dite telle quelle à l'humain ; la valeur doit être un booléen", async () => {
  const { token } = await maintenanceToken(["module_uninstall"]);
  await db.prisma.module.create({ data: { id: "gamma", source: "git", repoUrl: "https://example.org/g.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  assert.match((await call(token, "maintenance_module_uninstall", { module: "gamma", keepData: "non" })).error, /boolean/);
  const keep = (await call(token, "maintenance_module_uninstall", { module: "gamma" })).value;
  assert.equal((await Q.getRequest(keep.requestId)).plan.keepData, true);
  const erase = (await call(token, "maintenance_module_uninstall", { module: "gamma", keepData: false })).value;
  assert.notEqual(erase.requestId, keep.requestId, "garder et effacer ne sont pas la même demande");
  assert.equal((await Q.getRequest(erase.requestId)).plan.keepData, false);
  uninstallResult = { ok: true, id: "gamma" };
  calls.uninstallOpts.length = 0;
  const done = await M.approveRequest(erase.requestId, owner);
  assert.equal(done.ok, true);
  assert.match(done.message, /erased/);
  assert.deepEqual(calls.uninstallOpts, [{ keepData: false }]);
  const tool = (await call(token, "maintenance_module_uninstall", {})).error;
  assert.match(tool, /module/);
});

// ── Audit, avertissements, e-mail ───────────────────────────────────────────────────────────────────────────────────────────

test("audit des actions : jeton nommé, paramètres non sensibles, résultat — jamais de secret, de chemin ni de jeton", async () => {
  const { token } = await maintenanceToken(["backup_run", "module_reinstall"], "Claude de test");
  await call(token, "maintenance_backup_run");
  reinstallResult = { ok: false, id: "alpha", error: "x", rolledBack: true };
  await call(token, "maintenance_module_reinstall", { module: "alpha" });
  const rows = await auditRows("mcp.maintenance.");
  assert.deepEqual(rows.map((r) => r.action), ["mcp.maintenance.backup_run", "mcp.maintenance.module_reinstall"]);
  assert.ok(rows.every((r) => r.actor === "mcp:Claude de test"));
  assert.match(rows[0].target, /^ok/);
  assert.match(rows[1].target, /^failed \[alpha\]/);
  for (const r of rows) assert.ok(!r.target.includes(token) && !r.target.includes(db.dir) && !/vit_/.test(r.target));
});

test("notification dans l'admin : la demande en attente et l'action faite alimentent la pastille ; la visite de la page la remet à zéro", async () => {
  const { token } = await maintenanceToken(["core_update", "backup_run"]);
  assert.deepEqual(await N.maintenanceSummary(), { pending: 0, doneSinceVisit: 0, total: 0 });
  await call(token, "maintenance_core_update");
  assert.equal((await N.maintenanceSummary()).pending, 1);
  await call(token, "maintenance_backup_run");
  const s = await N.maintenanceSummary();
  assert.deepEqual([s.pending, s.doneSinceVisit, s.total], [1, 1, 2]);
  await new Promise((r) => setTimeout(r, 5));
  await S.markSeen(Date.now());
  const after = await N.maintenanceSummary();
  assert.deepEqual([after.pending, after.doneSinceVisit], [1, 0], "la demande attend toujours ; ce qui est fait a été vu");
});

test("e-mail : « dans l'admin » (défaut) n'envoie rien ; « dans l'admin et par e-mail » prévient à la demande et à l'exécution, sans aucun secret", async () => {
  const { token, id } = await maintenanceToken(["core_update", "backup_run"], "Claude");
  await call(token, "maintenance_core_update");
  await call(token, "maintenance_backup_run");
  assert.equal(calls.mails.length, 0, "défaut : l'admin seulement");
  await Q.listRequests();
  await db.prisma.setting.deleteMany({ where: { key: "maintenance.requests" } });
  await S.setNotifyMode("email");
  const req = (await call(token, "maintenance_core_update")).value;
  assert.equal(calls.mails.length, 1);
  assert.match(calls.mails[0].subject, /waiting|attend/i);
  await M.approveRequest(req.requestId, owner);
  await call(token, "maintenance_backup_run");
  assert.equal(calls.mails.length, 3, "demande + exécution approuvée + action de niveau 2");
  for (const m of calls.mails) {
    const all = `${m.subject}\n${m.text}`;
    assert.ok(!all.includes(token) && !/vit_|password|hunter|secret/i.test(all), `secret dans l'e-mail : ${all}`);
    assert.ok(all.includes("Claude") && all.includes("/admin/assistants?tab=requests"));
  }
  assert.equal((await S.getNotifyMode()), "email");
  void id;
});

test("e-mail : passe par le service e-mail du cœur (au propriétaire) ; sans configuration, rien ne casse", async () => {
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  D.setMaintenanceDeps({ appDir: app, latestStable: async () => latest, modulesReport: async () => report, recheckCore: async () => {} });
  await setSetting("mail.host", "smtp.example.org");
  await setSetting("mail.from", "site@example.org");
  await setSetting("site.contactEmail", "emma@example.org");
  await S.setNotifyMode("email");
  const sent = [];
  mail.setMailTransportFactory(() => ({ sendMail: async (m) => { sent.push(m); } }));
  mail.resetMailLimits();
  const { token } = await maintenanceToken(["check_updates"], "Claude");
  assert.equal((await call(token, "maintenance_check_updates")).value.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "emma@example.org");
  assert.ok(!/vit_/.test(sent[0].text));
  // Service e-mail non configuré : l'action réussit quand même.
  await db.prisma.setting.deleteMany({ where: { key: { startsWith: "mail." } } });
  mail.resetMailLimits();
  assert.equal((await call(token, "maintenance_check_updates")).value.ok, true);
});

test("serveur MCP : l'outil de maintenance consigne lui-même son audit (pas de ligne générique en double) et rien d'interne n'est renvoyé en cas de panne", async () => {
  const { token } = await maintenanceToken(["backup_run"]);
  D.setMaintenanceDeps({ backup: () => { throw new Error("secret interne /srv/data password=hunter2"); } });
  const log = console.error; console.error = () => {};
  let r; try { r = await call(token, "maintenance_backup_run"); } finally { console.error = log; }
  assert.equal(r.value.ok, false);
  assert.ok(!JSON.stringify(r).includes("hunter2") && !JSON.stringify(r).includes("/srv"));
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "mcp.maintenance_backup_run" } })).length, 0);
  assert.equal((await auditRows("mcp.maintenance.backup_run")).length, 1);
});

// ── Contrôle du contenu (maintenance_content_check / maintenance_content_check_run) ────────────────────────────────────────

const { setContentCheckDeps } = await import("@/core/maintenance/content/run");
const contentService = await import("@/core/maintenance/content/service");
const contentStore = await import("@/core/maintenance/content/store");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");
const { makeNet, publicDns, clock } = await import("../helpers/content-check-kit.mjs");

async function siteWith(body, { title = "Page", summary = "" } = {}) {
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr"]);
  await db.fixture("pages");
  const manifest = FIXTURE_MODULES.find((m) => m.manifest.id === "pages").manifest;
  const inst = (await db.prisma.moduleInstance.findFirst({ where: { moduleId: "pages" } })) ?? (await createInstance(db.prisma, { manifest, basePath: "", names: { fr: "Pages" } }));
  const e = await createEntry(db.prisma, { instanceId: inst.id, locale: "fr", status: "published", title, summary, body });
  await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - 1000) } });
}
/** Un faux site distant et une horloge simulée pour les vérifications lancées par un assistant. */
function fakeWeb(routes) {
  const c = clock();
  const net = makeNet(routes);
  setContentCheckDeps({ now: c.now, sleep: c.sleep, net: { client: net.client, pins: net.pins }, resolve: publicDns });
  return net;
}
test.afterEach(() => setContentCheckDeps(null));

test("content_check (niveau 1) : jamais vérifié → le dit ; lecture seule ; ne contacte aucun site", async () => {
  const { token } = await maintenanceToken();
  const net = fakeWeb({ "*": { status: 200 } });
  const { value } = await call(token, "maintenance_content_check");
  assert.deepEqual([value.checked, value.verdict, value.issues], [false, "none", []]);
  assert.match(value.note, /never been checked/);
  assert.equal(net.calls.length, 0);
  assert.deepEqual(await contentStore.readReport(), null, "rien n'a été créé en lisant");
});

test("content_check_run (niveau 2) : désactivé par défaut, accordé un à un ; lance la vérification, rien n'est modifié sur le site, audité", async () => {
  await siteWith("![](https://img.example.org/a.png) [mort](https://mort.example.net/x) [vivant](https://vivant.example.net/y) lien /blog/disparu", { title: "Accueil" });
  const read = (await maintenanceToken()).token;
  const refused = await call(read, "maintenance_content_check_run");
  assert.ok(refused.error, "un jeton qui n'a que le niveau 1 ne peut pas lancer");
  const { token } = await maintenanceToken(["content_check_run"], "Claude");
  const net = fakeWeb({ "https://mort.example.net/x": { status: 404 }, "https://img.example.org/a.png": { status: 200 }, "*": { status: 200 } });
  const before = await db.prisma.entry.count();
  const run = await call(token, "maintenance_content_check_run");
  assert.equal(run.value.ok, true);
  assert.equal(run.value.details.finished, true);
  assert.equal(net.calls.length, 4, "image, lien vivant : HEAD ; lien mort : HEAD puis GET (404 doublement confirmé)");
  assert.equal(await db.prisma.entry.count(), before);
  assert.equal(JSON.stringify(run.value).includes("img.example.org"), false, "la réponse de l'action ne cite aucune adresse");
  const rows = await auditRows("mcp.maintenance.content_check_run");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "mcp:Claude");
  assert.match(rows[0].target, /^ok/);
});

test("content_check : le dernier résultat — importance, phrase, pourquoi, exemples, ce qui n'a pas été regardé ; jamais de note ; pour un lien externe seulement le NOM DU SITE, sans secret", async () => {
  await siteWith("![](/uploads/55555555-5555-5555-5555-555555555555.png) [mort](https://mort.example.net/dossier/doc?token=SECRETVALUE&k=1) [ici](/blog/disparu)", { title: "Accueil" });
  const { token } = await maintenanceToken(["content_check_run"]);
  fakeWeb({ "*": { status: 404 } });
  await call(token, "maintenance_content_check_run");
  const { value } = await call(token, "maintenance_content_check");
  assert.equal(value.checked, true);
  assert.equal(value.verdict, "look");
  assert.equal(value.finished, true);
  const byId = Object.fromEntries(value.issues.map((i) => [i.id, i]));
  assert.equal(byId.link_gone.importance, "important");
  assert.equal(byId.link_gone.examples[0].site, "mort.example.net");
  assert.equal(byId.internal.importance, "important");
  assert.ok(byId.summary && byId.home);
  for (const i of value.issues) assert.ok(i.summary && i.why && ["important", "advised", "info"].includes(i.importance), i.id);
  assert.ok(Array.isArray(value.notChecked) && value.notChecked.length >= 2);
  const raw = JSON.stringify(value);
  assert.ok(!/SECRETVALUE|token=|\/dossier\/doc/.test(raw), "aucun paramètre ni chemin d'adresse externe");
  assert.ok(!raw.includes(db.dir), "pas de chemin du serveur");
  assert.ok(!/score|grade|\d+\s*\/\s*100|%/.test(raw), "jamais de note");
  assert.equal(value.history.length, 1);
  // Les remarques masquées par le propriétaire ne sont pas répétées à l'IA.
  const g = (await contentStore.readReport()).groups.find((x) => x.id === "summary");
  await (await import("@/core/maintenance/content/run")).ignoreItem(g.items[0].k);
  assert.ok(!(await call(token, "maintenance_content_check")).value.issues.some((i) => i.id === "summary"));
});

test("content_check_run : « continue » reprend la vérification commencée ; un argument inconnu ou mal typé est refusé ; une vérification en cours n'est pas doublée", async () => {
  await siteWith(Array.from({ length: 130 }, (_, i) => `[l](https://s${i}.example.net/p)`).join(" "), { title: "Beaucoup", summary: "r" });
  const { token } = await maintenanceToken(["content_check_run"]);
  const net = fakeWeb({ "*": { status: 200 } });
  const bad = await call(token, "maintenance_content_check_run", { continue: "oui" });
  assert.ok(bad.error);
  const first = await call(token, "maintenance_content_check_run");
  assert.equal(first.value.details.finished, false, "130 liens : le premier paquet n'est pas tout");
  assert.match(first.value.message, /continue: true/);
  const done = first.value.details.linksVisited;
  assert.ok(done > 0 && done < 130);
  const mid = (await call(token, "maintenance_content_check")).value;
  assert.deepEqual([mid.finished, mid.progress.done], [false, done]);
  const second = await call(token, "maintenance_content_check_run", { continue: true });
  assert.equal(second.value.details.finished, true);
  assert.equal(net.calls.length, 130, "chaque lien visité une seule fois");
  assert.match((await auditRows("mcp.maintenance.content_check_run"))[1].target, /\[continue\]/);
});

test("diagnose : les remarques du contenu y figurent en « info » seulement — jamais en alarme —, et rien ne change pour un site sans remarque", async () => {
  latest = { tag: "v0.1.14", notes: "" };
  await db.prisma.auditLog.create({ data: { actor: "owner@example.org", action: "backup.create", target: "" } });
  const { token } = await maintenanceToken(["content_check_run"]);
  assert.equal((await call(token, "maintenance_diagnose")).value.verdict, "healthy", "jamais vérifié : aucun bruit");
  await siteWith("[mort](https://mort.example.net/x)", { title: "Accueil" });
  fakeWeb({ "*": { status: 404 } });
  await call(token, "maintenance_content_check_run");
  const { value } = await call(token, "maintenance_diagnose");
  const p = value.problems.find((x) => x.tool === "maintenance_content_check");
  assert.ok(p, "le diagnostic renvoie vers l'outil de lecture");
  assert.equal(p.severity, "info");
  assert.equal(p.needsHuman, true);
  assert.equal(value.verdict, "healthy, with updates or notes", "jamais « needs attention »");
  assert.ok(value.problems.every((x) => x.severity === "info"));
});

test("audit : les vérifications du contenu faites depuis l'admin (content.check) apparaissent dans l'audit de la maintenance", async () => {
  await db.prisma.auditLog.create({ data: { actor: "emma@example.org", action: "content.check", target: "done · 3/3 links · important 1, advised 0, info 0" } });
  const { token } = await maintenanceToken();
  const { value } = await call(token, "maintenance_audit");
  const row = value.find((r) => r.action === "content.check");
  assert.ok(row);
  assert.equal(row.by, "human");
  assert.ok(!JSON.stringify(row).includes("emma"));
});

test("pastille sobre du tableau de bord : seulement s'il y a du conseillé ou de l'important, jamais pendant une vérification en cours", async () => {
  assert.equal(await contentService.contentBadge(), null);
  await contentStore.writeSummary({ at: "2026-10-22T10:00:00.000Z", finished: true, counts: { important: 0, advised: 0, info: 4 }, progress: null, groups: [] });
  assert.equal(await contentService.contentBadge(), null, "pour info seulement : rien à afficher");
  await contentStore.writeSummary({ at: "2026-10-22T10:00:00.000Z", finished: true, counts: { important: 0, advised: 2, info: 0 }, progress: null, groups: [] });
  assert.deepEqual(await contentService.contentBadge(), { look: true, at: "2026-10-22T10:00:00.000Z" });
  await contentStore.writeSummary({ at: "2026-10-22T10:00:00.000Z", finished: false, counts: { important: 3, advised: 0, info: 0 }, progress: { done: 1, total: 9 }, groups: [] });
  assert.equal(await contentService.contentBadge(), null);
});
