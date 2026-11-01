// JOURNAL CENTRAL (prochaine version) : écriture par les modules, acteur déduit par le cœur, liste blanche des champs, bornes sans minuteur, purge à l'écriture,
// droit « historique », migration additive, lecture filtrée et phrases en clair. Vraie base SQLite, vrai code du cœur.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const J = await import("@/core/journal/events");
const { writeModuleLog, purgeModuleLog } = await import("@/core/journal/write");
const { describeRows } = await import("@/core/journal/describe");
const { listAudit, auditWhere, CORE_ONLY } = await import("@/core/audit");
const { audit } = await import("@/core/permissions");
const { buildContext, forViewer } = await import("@/core/modules/context");
const { getActiveInstances } = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest } = await import("@/core/modules/manifest");
const { moduleActionProvider } = await import("@/core/modules/mcpProvider");
const Rt = await import("@/core/auth/rights");
const { makeTranslator } = await import("@/core/i18n/dictionary");

after(() => db.close());

const manifest = JSON.parse(fs.readFileSync("tests/fixtures/extras/modules/demo-journal/module.json", "utf8"));
const EVENTS = manifest.logEvents;
const DAY = 24 * 3600 * 1000;
let active;

beforeEach(async () => {
  await db.reset();
  await db.fixture("demo-journal");
  const parsed = parseManifest(manifest);
  assert.ok(parsed.ok, parsed.error);
  await createInstance(prisma, { manifest: parsed.manifest, names: { en: "journal" } });
  active = (await getActiveInstances()).find((a) => a.mod.manifest.id === "demo-journal");
  assert.ok(active, "l'instance de test est active");
});

const rows = (where = {}) => prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const ctxOf = async () => buildContext(active.mod, active.instance, "fr");

/* ───────────── Écriture et acteur ───────────── */

test("écriture : le module dit quoi, le cœur injecte module, instance, niveau et origine ; l'acteur n'est jamais fourni par le module", async () => {
  const ctx = await ctxOf();
  assert.equal(await ctx.api.log.write({ action: "thing.done", target: "ping", data: { name: "Alice", count: 3, urgent: true }, actor: "boss@example.org", actorKind: "person", module: "autre" }), true);
  const [r] = await rows();
  assert.deepEqual([r.module, r.instance, r.level, r.actorKind, r.action, r.target], ["demo-journal", active.instance.key, "info", "module", "thing.done", "ping"]);
  assert.equal(r.actor, `module:${active.instance.key}`, "un module ne choisit jamais l'acteur : champs en trop ignorés");
  assert.deepEqual(J.parseData(r.data), { name: "Alice", count: 3, urgent: true });
});

test("acteur déduit : personne connectée (action d'administration), assistant IA (action MCP), sinon le module lui-même", async () => {
  const person = forViewer(await ctxOf(), { id: "u1", email: "alice@example.org" }, { carryRights: true });
  await person.api.log.write({ action: "thing.done", data: { name: "x" } });
  const tool = (await moduleActionProvider.list()).find((t) => t.name.endsWith("__noisy"));
  assert.ok(tool, "l'action MCP du module est proposée");
  assert.equal(tool.moduleId, "demo-journal");
  await tool.call({}, { name: "Claude" });
  await (await ctxOf()).api.log.write({ action: "thing.done", data: { name: "y" } });
  assert.deepEqual((await rows()).map((r) => [r.actor, r.actorKind]), [["alice@example.org", "person"], ["mcp:Claude", "assistant"], [`module:${active.instance.key}`, "module"]]);
});

test("un contexte d'affichage (sans carryRights) n'écrit jamais au nom d'une personne", async () => {
  const viewing = forViewer(await ctxOf(), { id: "u1", email: "alice@example.org" });
  await viewing.api.log.write({ action: "thing.done", data: { name: "x" } });
  assert.equal((await rows())[0].actorKind, "module");
});

test("liste blanche : seuls les champs déclarés sont gardés, convertis à leur type, 200 caractères au plus ; secrets et objets écartés", async () => {
  const ctx = await ctxOf();
  await ctx.api.log.write({ action: "thing.done", data: { name: "N".repeat(500), count: "7", urgent: "oui", token: "abc", nested: { a: 1 } } });
  await ctx.api.log.write({ action: "thing.done", data: { name: "Bearer abcdefghijklmnop", count: Number.NaN } });
  await ctx.api.log.write({ action: "thing.done", data: { name: "ghp_0123456789abcdefghij0123" } });
  await ctx.api.log.write({ action: "thing.done", data: { name: "a0123456789b0123456789c0123456789d" }, target: "oauth:xyz" });
  const [a, b, c, d] = (await rows()).map((r) => ({ ...r, d: J.parseData(r.data) }));
  assert.equal(a.d.name.length, J.JOURNAL_LIMITS.fieldChars);
  assert.equal(a.d.count, 7, "un nombre écrit en texte est lu");
  assert.equal("urgent" in a.d, false, "un booléen se donne en booléen");
  assert.deepEqual(Object.keys(a.d).sort(), ["count", "name"]);
  assert.deepEqual(b.d, {}, "en-tête d'autorisation écarté, nombre non fini écarté");
  assert.deepEqual(c.d, {}, "jeton d'un service connu écarté");
  assert.deepEqual(d.d, {}, "longue chaîne opaque écartée");
  assert.equal(d.target, "", "la cible aussi est filtrée");
});

test("module sans déclaration, ou clé non déclarée : ligne générique SANS données ; niveau demandé gardé, niveau inconnu ramené à info", async () => {
  await writeModuleLog({ action: "free.form", data: { name: "x" }, target: "t", level: "warn", actor: { kind: "module", name: "module:k" }, module: "sans-declaration", instance: "k" });
  await writeModuleLog({ action: "undeclared", data: { name: "x" }, level: "bogus", actor: { kind: "module", name: "module:k" }, module: "demo-journal", instance: "k", events: EVENTS });
  await writeModuleLog({ action: "thing.failed", data: { name: "x" }, actor: { kind: "module", name: "module:k" }, module: "demo-journal", instance: "k", events: EVENTS });
  const [a, b, c] = await rows();
  assert.deepEqual([a.data, a.level, a.target], ["", "warn", "t"]);
  assert.deepEqual([b.data, b.level], ["", "info"]);
  assert.deepEqual([c.level, J.parseData(c.data)], ["error", { name: "x" }], "le niveau par défaut vient de l'événement déclaré");
});

test("clé refusée : renvoie false sans lever ; les premiers segments du cœur sont réservés", async () => {
  const ctx = await ctxOf();
  for (const action of ["", "Bad Key", "module.install", "mcp.x", "instance.update", "a".repeat(60), "x..y", undefined, 42]) assert.equal(await ctx.api.log.write({ action }), false, String(action));
  assert.equal(await ctx.api.log.write(undefined), false);
  assert.equal((await rows()).length, 0);
});

test("l'écriture neutre : une route et une tâche écrivent comme le module ; l'écriture ne lève jamais même si la base refuse", async () => {
  const ctx = await ctxOf();
  await active.mod.def.routes.hit(new Request("https://example.test/"), ctx);
  await active.mod.def.tasks.tick.run(await ctxOf());
  assert.deepEqual((await rows()).map((r) => r.action), ["hit", "thing.failed"]);
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" RENAME TO "AuditLogX"');
  try { assert.equal(await ctx.api.log.write({ action: "thing.done" }), false); } finally { await prisma.$executeRawUnsafe('ALTER TABLE "AuditLogX" RENAME TO "AuditLog"'); }
});

/* ───────────── Bornes et purge ───────────── */

const seed = (n, over = {}) => prisma.auditLog.createMany({ data: Array.from({ length: n }, (_, i) => ({ actor: "module:k", actorKind: "module", action: "thing.done", module: "demo-journal", instance: "k", createdAt: new Date(Date.now() - (n - i) * 1000), ...over })) });

test("bornes : 500 lignes au plus par module, supprimées par petites tranches à l'écriture, sans toucher aux autres modules ni au cœur", async () => {
  await seed(620);
  await seed(3, { module: "autre-module" });
  await prisma.auditLog.create({ data: { actor: "alice@example.org", action: "login" } });
  await writeModuleLog({ action: "thing.done", actor: { kind: "module", name: "module:k" }, module: "demo-journal", instance: "k", events: EVENTS });
  const count = (module) => prisma.auditLog.count({ where: { module } });
  assert.equal(await count("demo-journal"), 621 - J.JOURNAL_LIMITS.purgeSlice, "une tranche à la fois (jamais un gros nettoyage dans une écriture)");
  for (let i = 0; i < 3; i++) await writeModuleLog({ action: "thing.done", actor: { kind: "module", name: "module:k" }, module: "demo-journal", instance: "k", events: EVENTS });
  assert.ok((await count("demo-journal")) <= J.JOURNAL_LIMITS.maxPerModule, "revenu sous la borne en quelques écritures");
  assert.equal(await count("autre-module"), 3);
  assert.equal(await count(""), 1, "les lignes du cœur ne sont jamais purgées");
});

test("bornes : rien de plus de 90 jours pour un module ; les plus anciennes partent d'abord", async () => {
  await seed(2, { createdAt: new Date(Date.now() - 91 * DAY), action: "old" });
  await seed(2, { createdAt: new Date(Date.now() - 89 * DAY), action: "recent" });
  await purgeModuleLog("demo-journal");
  assert.deepEqual((await rows()).map((r) => r.action), ["recent", "recent"]);
  assert.equal(await purgeModuleLog(""), 0, "sans module : rien");
});

test("quota des lignes très fréquentes : 7 jours et 200 lignes ; les autres événements du module restent", async () => {
  await seed(230, { action: "hit" });
  await seed(2, { action: "hit", createdAt: new Date(Date.now() - 8 * DAY) });
  await seed(2, { action: "thing.done" });
  for (let i = 0; i < 4; i++) await purgeModuleLog("demo-journal", ["hit"]);
  assert.equal(await prisma.auditLog.count({ where: { action: "hit" } }), J.JOURNAL_LIMITS.frequentMax);
  assert.equal(await prisma.auditLog.count({ where: { action: "hit", createdAt: { lt: new Date(Date.now() - 7 * DAY) } } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "thing.done" } }), 2);
  // Par l'écriture : un événement `frequent` déclaré déclenche ce quota.
  await seed(60, { action: "hit" });
  await writeModuleLog({ action: "hit", data: { name: "Bob" }, actor: { kind: "module", name: "module:k" }, module: "demo-journal", instance: "k", events: EVENTS });
  assert.ok((await prisma.auditLog.count({ where: { action: "hit" } })) < 200 + 60 + 1);
});

test("aucun minuteur de fond : le module journal n'installe ni setInterval ni setTimeout", () => {
  for (const f of ["events.ts", "write.ts", "describe.ts"]) assert.doesNotMatch(fs.readFileSync(path.join("src/core/journal", f), "utf8"), /setInterval|setTimeout/, f);
});

/* ───────────── Déclarations (manifeste) ───────────── */

const withEvents = (logEvents) => parseManifest({ ...manifest, logEvents });
const ev = (over = {}) => ({ key: "a.b", label: { fr: "A {x}", en: "A {x}" }, fields: [{ key: "x" }], ...over });

test("manifeste : déclarations valides acceptées ; secrets, texte du public, variables inconnues, langues manquantes, doublons et excès refusés", () => {
  assert.ok(withEvents([ev()]).ok);
  assert.ok(parseManifest({ ...manifest, logEvents: undefined }).ok, "sans déclaration : rien à signaler (rétrocompatibilité)");
  const bad = [
    ev({ fields: [{ key: "apiToken" }] }), ev({ fields: [{ key: "password" }] }), ev({ fields: [{ key: "message" }] }), ev({ fields: [{ key: "x" }], label: { fr: "A {y}", en: "A {y}" } }),
    ev({ label: { fr: "A {x}", en: "A" } }), ev({ label: { fr: "A {x}" } }), ev({ label: { fr: "A {x}", en: "B".repeat(121) } }),
    ev({ key: "Bad" }), ev({ key: "module.x" }), ev({ key: "mcp" }), ev({ fields: Array.from({ length: 6 }, (_, i) => ({ key: `f${i}` })), label: { fr: "A", en: "A" } }),
    ev({ fields: [{ key: "x" }, { key: "x" }] }), ev({ fields: [{ key: "x", type: "json" }] }), ev({ extra: 1 }),
  ];
  for (const e of bad) assert.equal(withEvents([e]).ok, false, JSON.stringify(e).slice(0, 80));
  assert.equal(withEvents([ev(), ev()]).ok, false, "doublon");
  assert.equal(withEvents(Array.from({ length: 31 }, (_, i) => ev({ key: `k${i}` }))).ok, false, "31 événements");
});

/* ───────────── Droit « historique » ───────────── */

test("droit « historique » : implicite pour chaque module, Administration par défaut, jamais pour la Rédaction, non redéclarable", () => {
  const cat = Rt.rightsCatalogue([{ moduleId: "demo-journal", name: "j", rights: [{ id: "history", label: "x" }, { id: "ok" }] }]);
  assert.deepEqual(cat.filter((r) => r.moduleId).map((r) => r.id), ["demo-journal:open", "demo-journal:history", "demo-journal:ok"], "pas de doublon si un ancien module le déclare");
  const history = cat.find((r) => r.id === "demo-journal:history");
  assert.deepEqual([history.admin, history.editor, history.reserved], [true, false, false]);
  assert.ok(Rt.systemRights("admin", cat).has("demo-journal:history"));
  assert.ok(!Rt.systemRights("editor", cat).has("demo-journal:history"));
  assert.ok(Rt.delegableRights(cat).has("demo-journal:history"), "réglable dans un rôle personnalisé");
  assert.equal(parseManifest({ ...manifest, rights: [{ id: "history", label: "x" }] }).ok, false);
});

/* ───────────── Migration additive ───────────── */

test("migration additive : aucune ligne perdue, valeurs par défaut, origine déduite de l'acteur ; un ancien cœur peut encore écrire", () => {
  const migrations = path.resolve("prisma/migrations");
  const init = fs.readFileSync(path.join(migrations, "20261007085017_init/migration.sql"), "utf8");
  const oldTable = /CREATE TABLE "AuditLog" \([^;]*\);/.exec(init)[0];
  const raw = fs.readFileSync(path.join(migrations, "20261101090000_central_journal/migration.sql"), "utf8");
  const sql = raw.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.doesNotMatch(sql, /DROP|DELETE/i, "additive : rien n'est supprimé");
  const file = path.join(db.dir, "old.db");
  const old = new DatabaseSync(file);
  old.exec(oldTable);
  const ins = old.prepare('INSERT INTO "AuditLog" (id, actor, action, target) VALUES (?, ?, ?, ?)');
  ins.run("1", "alice@example.org", "login", ""); ins.run("2", "mcp:Claude", "mcp.k__x", "k"); ins.run("3", "module:k", "file.remove", "f"); ins.run("4", "system", "setup.completed", "");
  old.exec(sql);
  assert.deepEqual(old.prepare('SELECT id, actor, action, target, module, instance, level, actorKind, data FROM "AuditLog" ORDER BY id').all().map((r) => ({ ...r })), [
    { id: "1", actor: "alice@example.org", action: "login", target: "", module: "", instance: "", level: "info", actorKind: "person", data: "" },
    { id: "2", actor: "mcp:Claude", action: "mcp.k__x", target: "k", module: "", instance: "", level: "info", actorKind: "assistant", data: "" },
    { id: "3", actor: "module:k", action: "file.remove", target: "f", module: "", instance: "", level: "info", actorKind: "module", data: "" },
    { id: "4", actor: "system", action: "setup.completed", target: "", module: "", instance: "", level: "info", actorKind: "system", data: "" },
  ]);
  old.prepare('INSERT INTO "AuditLog" (id, actor, action) VALUES (?, ?, ?)').run("5", "x@y.z", "login");
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM "AuditLog"').get().n, 5, "un ancien cœur écrit sans connaître les nouvelles colonnes");
  old.close();
});

/* ───────────── Lecture, filtres et phrases ───────────── */

test("audit() déduit l'origine ; les lignes du cœur ne portent aucun module", async () => {
  await audit("alice@example.org", "login");
  await audit("mcp:Claude", "mcp.k__x", "k", { module: "demo-journal", instance: "k" });
  await audit("system", "setup.completed");
  assert.deepEqual((await rows()).map((r) => [r.actorKind, r.module]), [["person", ""], ["assistant", "demo-journal"], ["system", ""]]);
});

test("lecture : filtres extension, niveau, origine, période et recherche (y compris dans les données), cumulables ; filtre inconnu ignoré", async () => {
  const now = new Date();
  const mk = (over) => prisma.auditLog.create({ data: { actor: "x@y.z", action: "settings.update", ...over } });
  await mk({ module: "m1", instance: "i1", level: "error", actorKind: "module", actor: "module:i1", action: "thing.failed", data: '{"name":"Zébulon"}' });
  await mk({ module: "m1", instance: "i1", level: "info", actorKind: "person" });
  await mk({ module: "m2", instance: "i2", level: "warn", actorKind: "assistant", actor: "mcp:Claude" });
  await mk({ createdAt: new Date(now.getTime() - 10 * DAY), actorKind: "person" });
  const n = async (f) => (await listAudit({ ...f, now })).total;
  assert.equal(await n({}), 4);
  assert.equal(await n({ module: "m1" }), 2);
  assert.equal(await n({ module: CORE_ONLY }), 1);
  assert.equal(await n({ instance: "i2" }), 1);
  assert.equal(await n({ level: "error" }), 1);
  assert.equal(await n({ kind: "assistant" }), 1);
  assert.equal(await n({ period: "week" }), 3);
  assert.equal(await n({ period: "month" }), 4);
  assert.equal(await n({ q: "zébulon" }) + await n({ q: "Zébulon" }) >= 1, true, "recherche dans les données");
  assert.equal(await n({ module: "m1", level: "error", kind: "module" }), 1);
  assert.equal(await n({ level: "bogus", kind: "bogus", period: "bogus" }), 4, "filtres inconnus ignorés");
  assert.deepEqual(auditWhere({}), {});
});

test("lecture : pagination bornée et taille de page choisie", async () => {
  await seed(30);
  const p = await listAudit({ pageSize: 10, page: 3 });
  assert.deepEqual([p.rows.length, p.pages, p.page, p.total], [10, 3, 3, 30]);
  assert.equal((await listAudit({ pageSize: 100000 })).rows.length, 30);
});

test("phrases en clair : événement déclaré rempli, action d'administration, assistant, ligne du cœur, ligne générique ; jamais de JSON ; langue demandée", async () => {
  await seed(1, { action: "thing.done", data: '{"name":"Alice","count":3,"urgent":true}', level: "warn" });
  await seed(1, { action: "hit", data: '{"name":"Bob"}' });
  await seed(1, { action: "undeclared", data: "" });
  await seed(1, { action: "module.k.ping", actor: "alice@example.org", actorKind: "person" });
  await seed(1, { action: "mcp.k__noisy", actor: "mcp:Claude", actorKind: "assistant" });
  await seed(1, { action: "login", module: "", actor: "bob@example.org", actorKind: "person" });
  await seed(1, { action: "zzz.custom", module: "", actor: "bob@example.org", actorKind: "system" });
  await seed(1, { action: "login", actor: "bob@example.org", actorKind: "person" });
  const { rows: all } = await listAudit({ pageSize: 100 });
  const fr = await describeRows([...all].reverse(), { t: makeTranslator("fr"), locale: "fr", defaultLocale: "fr" });
  const sentences = fr.map((l) => l.sentence);
  assert.ok(sentences.includes("Chose faite : Alice (3 fois, urgent : oui)"), sentences.join(" | "));
  assert.ok(sentences.includes("Passage de Bob"));
  assert.ok(sentences.includes("Événement de l'extension"), "action non déclarée : phrase générique, jamais le code");
  assert.ok(sentences.includes("Action dans une fonctionnalité"), "action d'administration");
  assert.ok(sentences.includes("Action d'un assistant IA"));
  assert.ok(sentences.includes("Connexion"), "ligne du cœur connue : sa phrase");
  assert.ok(sentences.includes("zzz.custom"), "ligne du cœur sans traduction : le code (affiché seulement en avancé par la page)");
  assert.ok(!sentences.some((s) => /[{}]|\\"/.test(s)), "pas de JSON ni d'accolades");
  assert.equal(fr.find((l) => l.sentence.startsWith("Chose faite")).level, "warn");
  assert.deepEqual(fr.find((l) => l.code === "mcp.k__noisy").who, "Claude");
  const kinds = fr.filter((l) => l.code === "zzz.custom" || l.code === "login").map((l) => l.kind);
  assert.deepEqual(kinds, ["person", "person", "person"], "une ligne d'un ancien cœur (« system » par défaut) retrouve son origine d'après l'acteur");
  const en = await describeRows(all, { t: makeTranslator("en"), locale: "en", defaultLocale: "fr" });
  assert.ok(en.some((l) => l.sentence === "Thing done: Alice (3 times, urgent: yes)"));
});

test("une extension ne peut pas se faire passer pour le cœur : une action non déclarée d'une extension n'emprunte jamais le libellé d'une action du cœur", async () => {
  await prisma.auditLog.create({ data: { actor: "module:k", actorKind: "module", action: "backup.restore", module: "demo-journal", instance: "k" } });
  const { rows: all } = await listAudit();
  const [line] = await describeRows(all, { t: makeTranslator("fr"), locale: "fr", defaultLocale: "fr" });
  assert.equal(line.sentence, "Événement de l'extension");
});

/* ───────────── Outil MCP en lecture seule ───────────── */

test("outil MCP log_list : lecture seule, pas accordé d'office, mêmes filtres que la page, phrases en anglais, rien d'écrit", async () => {
  const { journalToolProvider } = await import("@/core/journalMcp");
  const { canUse } = await import("@/core/services/mcp/access");
  const { McpToolError } = await import("@/core/services/mcp/validate");
  const [tool] = await journalToolProvider.list();
  assert.deepEqual([tool.name, tool.readOnly, tool.destructive, tool.default], ["log_list", true, false, false]);
  assert.equal(canUse(tool, { scope: "read", grants: {} }), false, "jamais accordé sans décision de la personne propriétaire");
  assert.equal(canUse(tool, { scope: "read", grants: { log_list: true } }), true);
  const ctx = await ctxOf();
  await ctx.api.log.write({ action: "thing.done", data: { name: "Alice", count: 2, urgent: false, token: "nope" } });
  await ctx.api.log.write({ action: "thing.failed", data: { name: "Bob" } });
  await prisma.auditLog.create({ data: { actor: "owner@example.org", action: "login", actorKind: "person" } });
  const before = await prisma.auditLog.count();
  const all = await tool.call({}, { name: "Claude" });
  assert.equal(all.total, 3);
  assert.equal(all.items[0].text.length > 0, true);
  const mine = await tool.call({ module: "demo-journal", level: "error", origin: "module", period: "day", q: "Bob" }, { name: "Claude" });
  assert.deepEqual(mine.items.map((i) => [i.text, i.origin, i.level, i.module]), [["Failure for Bob", "module", "error", "demo-journal"]]);
  assert.equal(JSON.stringify(all).includes("nope"), false, "un champ écarté n'est jamais enregistré ni renvoyé");
  assert.equal((await tool.call({ module: "_core" }, { name: "Claude" })).total, 1);
  assert.equal((await tool.call({ limit: 1 }, { name: "Claude" })).items.length, 1);
  await assert.rejects(tool.call({ limit: 1000 }, { name: "Claude" }), McpToolError);
  await assert.rejects(tool.call({ level: "fatal" }, { name: "Claude" }), McpToolError);
  await assert.rejects(tool.call({ actor: "x" }, { name: "Claude" }), McpToolError, "pas d'argument inconnu");
  assert.equal(await prisma.auditLog.count(), before, "lire ne crée aucune ligne");
});
