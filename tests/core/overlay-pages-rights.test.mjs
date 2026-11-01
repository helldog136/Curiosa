// Pages d'overlay (0.5.0) : droits (palier « admin » et au-dessus), formulaires forgés, acteur relu en base, journal d'audit sans secret, menu.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

process.env.AUTH_SECRET = "test-auth-secret-overlay";
const db = await useTestDb();
const { prisma } = db;
const Act = await import("@/app/admin/(panel)/overlay-pages/actions");
const Preview = await import("@/app/admin/(panel)/overlay-pages/[id]/preview/route");
const S = await import("@/core/overlays/store");
const { administrationEntries } = await import("@/core/modules/adminMenu");
const { RedirectError } = await import("next/navigation");
const { auditLabelKey } = await import("@/core/auditLabels");
const R = await import("@/core/auth/roles");
const { createRole } = R;

after(() => db.close());
let T;
beforeEach(async () => {
  await db.reset();
  globalThis.curiosaTestSession = null;
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
  T = { owner: await mk("olive", "owner"), coordinator: await mk("coralie", "admin", { coordinator: true }), admin: await mk("adam", "admin"), editor: await mk("emma", "editor"), none: await mk("nina", "none") };
  await R.syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: "owner" } } : null; };   // « role » du jeton : forgé, doit être ignoré
const form = (entries) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const outcome = async (fn) => { try { await fn(); return "ok"; } catch (e) { if (e instanceof RedirectError) return e.url; throw e; } };

test("palier « admin » : propriétaire, coordination technique et administration entrent ; édition, rôle sans palier et visiteur anonyme non", async () => {
  const create = () => Act.createPageAction(form([["name", "Principale"], ["resolution", "1920x1080"]]));
  for (const who of ["owner", "coordinator", "admin"]) {
    as(T[who]);
    assert.match(await outcome(create), /^\/admin\/overlay-pages\/[a-z0-9]+$/, who);
  }
  assert.equal((await S.listPages()).length, 3);
  as(T.editor); assert.equal(await outcome(create), "/admin?denied=1");
  as(T.none); assert.notEqual(await outcome(create), "ok"); assert.doesNotMatch(await outcome(create), /overlay-pages/);
  as(null); assert.equal(await outcome(create), "/admin/login");
  assert.equal((await S.listPages()).length, 3, "aucune page créée par un refus");
});

test("chaque action exportée est refusée à l'édition et à l'anonyme, et ne change rien", async () => {
  as(T.owner);
  const page = (await S.createPage({ name: "Cible", width: 1920, height: 1080 })).page;
  const before = JSON.stringify(await S.listPages());
  const calls = {
    createPageAction: () => Act.createPageAction(form([["name", "x"], ["resolution", "1920x1080"]])),
    duplicatePageAction: () => Act.duplicatePageAction(page.id, "(copie)"),
    renamePageAction: () => Act.renamePageAction(page.id, form([["name", "Piraté"]])),
    toggleActiveAction: () => Act.toggleActiveAction(page.id, false),
    deletePageAction: () => Act.deletePageAction(page.id),
    resetSecretAction: () => Act.resetSecretAction(page.id),
    testAction: () => Act.testAction(page.id, "start"),
    savePageAction: () => Act.savePageAction(page.id, null, form([["data", JSON.stringify({ name: "Piraté", width: 1920, height: 1080, elements: [] })]])),
  };
  assert.deepEqual(Object.keys(calls).sort(), Object.keys(Act).sort(), "ce test couvre toutes les actions exportées");
  const secret = await S.readSecret(page.id);
  for (const who of ["editor", "none", null]) {
    as(who ? T[who] : null);
    for (const [name, call] of Object.entries(calls)) assert.notEqual(await outcome(call), "ok", `${name} (${who})`);
  }
  as(T.owner);
  assert.equal(JSON.stringify(await S.listPages()), before, "ni nom, ni état, ni mode test, ni élément modifiés");
  assert.equal(await S.readSecret(page.id), secret);
  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "overlay." } } }), 0, "un refus n'écrit rien d'autre qu'un refus au journal");
});

test("source : chaque action commence par adminCtx(OVERLAY_NEED), l'acteur ne vient jamais du formulaire, chaque changement est audité", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/overlay-pages/actions.ts", "utf8");
  const fns = [...src.matchAll(/export async function (\w+)\(([^)]*)\)[^{]*\{\n([^\n]*)/g)];
  assert.ok(fns.length >= 8);
  for (const [, name, , first] of fns) assert.match(first, /await adminCtx\(OVERLAY_NEED\)/, name);
  assert.doesNotMatch(src, /formData\.get\("(actor|user|userId|email|role)"\)/);
  assert.equal((src.match(/await audit\(user\.email,/g) ?? []).length, 8, "chacune des huit actions qui changent quelque chose écrit au journal");
  assert.match(fs.readFileSync("src/app/admin/(panel)/overlay-pages/page.tsx", "utf8"), /adminCtx\(OVERLAY_NEED\)/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8"), /adminCtx\(OVERLAY_NEED\)/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/preview/route.ts", "utf8"), /hasRole\(user, OVERLAY_NEED\)/);
});

test("formulaire forgé : acteur relu en base, champs étrangers ignorés, résolution inconnue ramenée, nom nettoyé", async () => {
  as(T.admin);
  await outcome(() => Act.createPageAction(form([["name", "  <b>Ma</b>\n page  "], ["resolution", "99999x1"], ["actor", "olive@example.org"], ["email", "olive@example.org"], ["userId", T.owner.id], ["active", "false"], ["secret", "A".repeat(32)]])));
  const [p] = await S.listPages();
  assert.equal(p.name, "<b>Ma</b> page", "texte gardé tel quel (échappé à l'affichage), retours à la ligne nettoyés");
  assert.deepEqual([p.width, p.height, p.active], [1920, 1080, true], "résolution inconnue → défaut ; état non pris du formulaire");
  assert.notEqual(await S.readSecret(p.id), "A".repeat(32), "le secret ne vient jamais du formulaire");
  const log = await prisma.auditLog.findFirst({ where: { action: "overlay.create" } });
  assert.equal(log.actor, "adam@example.org", "l'acteur est la personne connectée, relue en base");
  assert.equal(log.target, p.id);
});

test("enregistrement forgé : élément inconnu, trop d'éléments, JSON cassé, énorme, autre page → rien d'écrit, erreurs sous les champs", async () => {
  as(T.admin);
  const page = (await S.createPage({ name: "P", width: 1920, height: 1080 })).page;
  const save = (data) => Act.savePageAction(page.id, null, form([["data", typeof data === "string" ? data : JSON.stringify(data)]]));
  const ghost = { uid: "aaaaaa", instance: "nope", element: "x", x: 0, y: 0, w: 10, h: 10, visible: true, options: {} };
  let r = await save({ name: "", width: 5, height: 1080, elements: [ghost] });
  assert.ok(r.error && r.errors.name && r.errors.resolution && r.errors["elements.aaaaaa"], JSON.stringify(r));
  r = await save({ name: "x", width: 1920, height: 1080, elements: Array.from({ length: 31 }, (_, i) => ({ ...ghost, uid: `u${String(i).padStart(6, "0")}` })) });
  assert.match(r.error, /30/);
  assert.ok((await save("{pas du json")).error);
  assert.ok((await save("x".repeat(400_001))).error);
  assert.ok((await Act.savePageAction("autre-page", null, form([["data", "{}"]]))).error);
  const stored = await S.getPage(page.id);
  assert.deepEqual([stored.name, stored.elements.length, stored.rev], ["P", 0, 1], "rien n'a été écrit");
  const ok = await save({ name: "Renommée", width: 2560, height: 1440, style: { text: "dark" }, elements: [] });
  assert.match(ok.ok, /^(Saved|Enregistré)\./);
  assert.deepEqual([(await S.getPage(page.id)).name, (await S.getPage(page.id)).width, (await S.getPage(page.id)).rev], ["Renommée", 2560, 2]);
});

test("limites par les actions : 20 pages, 10 actives ; message, aucune écriture", async () => {
  as(T.owner);
  for (let i = 0; i < 20; i++) await outcome(() => Act.createPageAction(form([["name", `P${i}`], ["resolution", "1920x1080"]])));
  assert.equal(await outcome(() => Act.createPageAction(form([["name", "21"], ["resolution", "1920x1080"]]))), "/admin/overlay-pages?e=limitPages");
  const inactive = (await S.listPages()).find((p) => !p.active);
  assert.equal(await outcome(() => Act.toggleActiveAction(inactive.id, true)), "/admin/overlay-pages?e=limitActive");
  assert.equal((await S.listPages()).length, 20);
});

test("journal d'audit : libellés connus, jamais d'adresse secrète ni de contenu de page", async () => {
  as(T.owner);
  await outcome(() => Act.createPageAction(form([["name", "Secrète"], ["resolution", "1920x1080"]])));
  const p = (await S.listPages())[0];
  const secret = await S.readSecret(p.id);
  await outcome(() => Act.duplicatePageAction(p.id, "(copie)")); await outcome(() => Act.renamePageAction(p.id, form([["name", "R"]]))); await outcome(() => Act.toggleActiveAction(p.id, false));
  await outcome(() => Act.toggleActiveAction(p.id, true)); await outcome(() => Act.resetSecretAction(p.id)); await outcome(() => Act.testAction(p.id, "start")); await outcome(() => Act.testAction(p.id, "extend")); await outcome(() => Act.testAction(p.id, "stop"));
  await Act.savePageAction(p.id, null, form([["data", JSON.stringify({ name: "R", width: 1920, height: 1080, elements: [] })]]));
  await outcome(() => Act.deletePageAction(p.id));
  const rows = await prisma.auditLog.findMany();
  assert.deepEqual([...new Set(rows.map((r) => r.action))].sort(), ["overlay.activate", "overlay.create", "overlay.deactivate", "overlay.delete", "overlay.duplicate", "overlay.rename", "overlay.secret", "overlay.test.extend", "overlay.test.start", "overlay.test.stop", "overlay.update"]);
  for (const r of rows) { assert.ok(auditLabelKey(r.action), r.action); assert.ok(!JSON.stringify(r).includes(secret)); assert.ok(r.target.length < 40, "l'identifiant de la page seulement"); }
});

test("aperçu en direct : réservé au palier « admin » (403 sinon), jamais d'adresse secrète dans l'adresse", async () => {
  const page = (await S.createPage({ name: "P", width: 1920, height: 1080 })).page;
  const call = () => Preview.GET(new Request(`http://localhost/admin/overlay-pages/${page.id}/preview`), { params: Promise.resolve({ id: page.id }) });
  as(null); assert.equal((await call()).status, 403);
  as(T.editor); assert.equal((await call()).status, 403);
  as(T.none); assert.equal((await call()).status, 403);
  for (const who of ["admin", "coordinator", "owner"]) { as(T[who]); const r = await call(); assert.equal(r.status, 200, who); assert.equal(r.headers.get("set-cookie"), null); }
  as(T.admin);
  const html = await (await call()).text();
  assert.doesNotMatch(html, new RegExp(await S.readSecret(page.id)));
  assert.equal((await Preview.GET(new Request("http://x"), { params: Promise.resolve({ id: "inconnue" }) })).status, 404);
});

test("menu d'administration : « Overlays » pour l'administration, la coordination technique et la personne propriétaire, en mode simple comme avancé", () => {
  for (const role of ["admin", "coordinator", "owner"]) for (const advanced of [true, false]) assert.ok(administrationEntries({ role, advanced }).includes("overlays"), `${role} ${advanced}`);
  for (const role of ["editor", "none"]) assert.ok(!administrationEntries({ role, advanced: true }).includes("overlays"), role);
  assert.match(fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8"), /overlays: <NavLink key="overlays" href="\/admin\/overlay-pages">/);
});

test("un rôle personnalisé ne donne pas accès aux overlays, même avec tous les droits délégables", async () => {
  as(T.owner);
  const roleId = await createRole(T.owner.id, { name: "Tout", description: "", rights: ["core:entries.edit", "core:entries.publish"] });
  assert.equal(roleId.ok, true);
  await prisma.userRole.create({ data: { userId: T.none.id, roleId: roleId.id } });
  as(T.none);
  const out = await outcome(() => Act.createPageAction(form([["name", "x"], ["resolution", "1920x1080"]])));
  assert.equal(out, "/admin?denied=1");
});
