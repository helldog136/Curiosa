// COORDINATEUR TECHNIQUE (0.4.0) : matrice des droits par niveau, anti-élévation, formulaires forgés, anti-verrouillage, synchronisation des affectations,
// sauvegarde → restauration, MCP, migration depuis un état 0.3.1 et parité FR/EN. Tout le reste est le vrai code du cœur, sur une vraie base SQLite.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const db = await useTestDb();
const { prisma } = db;
const A = await import("@/core/auth/access");
const R = await import("@/core/auth/roles");
const Rt = await import("@/core/auth/rights");
const M = await import("@/core/auth/members");
const Tm = await import("@/core/auth/team");
const { resetMemberPassword, resetTeamPasswordLimits } = await import("@/core/auth/teamPassword");
const { describeAccess } = await import("@/core/auth/describe");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { adminCtx } = await import("@/core/admin");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest: parse } = await import("@/core/modules/manifest");
const { viewerOf } = await import("@/core/operations/run");
const { administrationEntries } = await import("@/core/modules/adminMenu");
const Rs = await import("@/core/backup/restore");
const B = await import("@/core/backup/export");
const { readTarGz } = await import("@/core/backup/tar");
const { RedirectError } = await import("next/navigation");

after(() => db.close());

const read = (f) => fs.readFileSync(f, "utf8");
let T;
beforeEach(async () => {
  await db.reset();
  globalThis.curiosaTestSession = null;
  resetTeamPasswordLimits();
  await db.fixture("demo-guarded");
  const parsed = parse(JSON.parse(read("tests/fixtures/extras/modules/demo-guarded/module.json")));
  assert.ok(parsed.ok, parsed.error);
  await createInstance(prisma, { manifest: parsed.manifest, names: { en: "demo-guarded" } });
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
  T = {
    owner: await mk("olive", "owner"),
    coord: await mk("cora", "admin", { coordinator: true }),
    coord2: await mk("coralie", "admin", { coordinator: true }),
    admin: await mk("adam", "admin"),
    editor: await mk("emma", "editor"),
    member: await mk("max", "editor"),
  };
  await R.syncSystemAssignments();
});

const as = (u, role = "owner") => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role } } : null; };
const load = async (u) => A.loadAdminUser(u.id, (await prisma.user.findUnique({ where: { id: u.id } })).sessionVersion);
async function gate(need) {
  try { await adminCtx(need); return "ok"; } catch (e) { if (e instanceof RedirectError) return e.url; throw e; }
}
const roleId = async (key) => (await prisma.role.findUnique({ where: { key } })).id;
const row = (u) => prisma.user.findUnique({ where: { id: u.id } });

const RESERVED = ["core:team", "core:roles", "core:backup", "core:updates", "core:modules.install", "core:mcp.tokens", "core:security"];
/** LA DÉCISION DE LA PROPRIÉTAIRE, écrite en clair : le coordinateur détient les sept droits réservés ; ni l'administrateur ni l'éditeur n'en ont. */
const MATRIX = {
  owner: Object.fromEntries(RESERVED.map((r) => [r, true])),
  coordinator: Object.fromEntries(RESERVED.map((r) => [r, true])),
  admin: Object.fromEntries(RESERVED.map((r) => [r, false])),
  editor: Object.fromEntries(RESERVED.map((r) => [r, false])),
};

/* ───────────── Matrice des droits ───────────── */

test("matrice : propriétaire / coordinateur / administrateur / éditeur × chacun des sept droits réservés (can, accessGate, et la table LEVEL_RESERVED)", async () => {
  const who = { owner: T.owner, coordinator: T.coord, admin: T.admin, editor: T.editor };
  for (const [level, u] of Object.entries(who)) {
    const user = await load(u);
    assert.equal(user.level, level);
    for (const right of RESERVED) {
      assert.equal(A.can(user, right), MATRIX[level][right], `${level} ${right}`);
      assert.equal(A.accessGate(user, { right }) === "ok", MATRIX[level][right], `${level} gate ${right}`);
      assert.equal(Tm.levelHolds(level, right), MATRIX[level][right], `table ${level} ${right}`);
    }
    assert.deepEqual([...Rt.LEVEL_RESERVED[level]].sort(), RESERVED.filter((r) => MATRIX[level][r]).sort(), `la table dit la même chose pour ${level}`);
  }
});

test("le coordinateur a les droits de l'administrateur, y compris les droits de module par défaut, mais pas ceux qu'un module refuse à l'administrateur", async () => {
  const cat = await A.currentCatalogue();
  const admin = Rt.systemRights("admin", cat);
  const coord = Rt.systemRights("coordinator", cat);
  for (const r of admin) assert.ok(coord.has(r), `le coordinateur a ${r}`);
  assert.deepEqual([...coord].filter((r) => !admin.has(r)).sort(), [...RESERVED].sort(), "rien de plus que les droits réservés de la table");
  const c = await load(T.coord);
  assert.equal(A.can(c, "demo-guarded:open"), true);
  assert.equal(A.can(c, "demo-guarded:notes.view"), true);
  assert.equal(A.can(c, "demo-guarded:drafts"), true);
  assert.equal(A.can(c, "demo-guarded:phone.edit"), false, "droit sensible dont le module exclut l'administrateur : comme l'administrateur");
  assert.equal(A.can(await load(T.admin), "demo-guarded:phone.edit"), false);
  assert.equal(A.can(await load(T.owner), "demo-guarded:phone.edit"), true);
});

test("hiérarchie : le coordinateur passe « admin » et « editor », jamais « owner » ; les modules le voient comme un administrateur", async () => {
  const c = await load(T.coord);
  assert.equal(A.hasRole(c, "admin"), true);
  assert.equal(A.hasRole(c, "editor"), true);
  assert.equal(A.hasRole(c, "owner"), false);
  assert.equal(A.isOwner(c), false);
  assert.equal(A.isTechnical(c), true);
  assert.equal(A.panelRole(c), "admin");
  assert.equal(Rt.RANK.owner > Rt.RANK.coordinator && Rt.RANK.coordinator > Rt.RANK.admin && Rt.RANK.admin > Rt.RANK.editor, true);
  as(T.coord);
  assert.equal(await gate("owner"), "/admin?denied=1");
  assert.equal(await gate("admin"), "ok");
  assert.equal(await gate({ right: "core:updates" }), "ok");
  as(T.admin);
  assert.equal(await gate({ right: "core:updates" }), "/admin?denied=1");
  assert.equal(await gate({ right: "core:team" }), "/admin?denied=1");
  // Un jeton de session qui prétend « owner » ne décide de rien.
  as(T.coord, "owner");
  assert.equal(await gate("owner"), "/admin?denied=1");
});

test("une personne dont une ancienne version a changé User.role perd le niveau coordinateur (le drapeau seul ne donne rien)", async () => {
  await prisma.user.update({ where: { id: T.coord.id }, data: { role: "editor" } });
  const c = await load(T.coord);
  assert.equal(c.level, "editor");
  assert.equal(A.can(c, "core:updates"), false);
  assert.equal(Rt.levelOfRow({ role: "none", coordinator: true }), "none");
  assert.equal(Rt.levelOfRow({ role: "owner", coordinator: true }), "owner");
  assert.equal(Rt.levelOfRow({ role: "coordinator" }), "none", "« coordinator » n'est pas une valeur historique : jamais lu dans User.role");
  await R.syncSystemAssignments();
  assert.equal((await row(T.coord)).coordinator, false, "drapeau périmé effacé");
});

test("menu d'administration par niveau (sans changement pour owner, admin, editor)", () => {
  assert.deepEqual(administrationEntries({ role: "owner", advanced: true }), ["extensions", "assistants", "users", "health", "backup", "updates", "audit"]);
  assert.deepEqual(administrationEntries({ role: "coordinator", advanced: true }), ["extensions", "assistants", "users", "health", "backup", "updates", "audit"]);
  assert.deepEqual(administrationEntries({ role: "coordinator", advanced: false }), ["extensions", "assistants", "users", "health", "backup", "updates"]);
  assert.deepEqual(administrationEntries({ role: "admin", advanced: true }), ["extensions", "users", "health"]);
  assert.deepEqual(administrationEntries({ role: "editor", advanced: true }), []);
});

test("la page Équipe décrit le niveau en une phrase, comme pour les autres", async () => {
  const cat = await A.currentCatalogue();
  const t = makeTranslator("fr");
  const lines = describeAccess("coordinator", Rt.systemRights("coordinator", cat), cat, t, "fr", "fr");
  assert.deepEqual(lines, [t("access.coordinator")]);
  assert.ok(t("access.coordinator") !== "access.coordinator");
  assert.ok(t("roles.system.coordinator") !== "roles.system.coordinator");
});

/* ───────────── Qui peut gérer qui ───────────── */

test("team.ts : règles pures", () => {
  assert.equal(Tm.canManageMember("owner", "coordinator"), true);
  assert.equal(Tm.canManageMember("owner", "owner"), false);
  assert.equal(Tm.canManageMember("owner", "admin", { self: true }), false);
  assert.equal(Tm.canManageMember("coordinator", "admin"), true);
  assert.equal(Tm.canManageMember("coordinator", "editor"), true);
  assert.equal(Tm.canManageMember("coordinator", "none"), true);
  assert.equal(Tm.canManageMember("coordinator", "coordinator"), false);
  assert.equal(Tm.canManageMember("coordinator", "owner"), false);
  assert.equal(Tm.canManageMember("admin", "editor"), false, "l'administrateur n'a pas la gestion de l'équipe (sauf inviter et retirer un éditeur)");
  assert.deepEqual(Tm.grantableLevels("owner"), ["coordinator", "admin", "editor"]);
  assert.deepEqual(Tm.grantableLevels("coordinator"), ["admin", "editor"]);
  assert.deepEqual(Tm.grantableLevels("admin"), ["editor"]);
  assert.deepEqual(Tm.grantableLevels("editor"), []);
});

test("invitation : qui invite qui (formulaire forgé compris)", async () => {
  const mk = (actor, role, n) => M.createMember(actor.id, { name: "Nouvelle", email: `n${n}@example.org`, password: "un-mot-de-passe-solide", role });
  assert.deepEqual(await mk(T.owner, "coordinator", 1), { ok: true, id: (await prisma.user.findUnique({ where: { email: "n1@example.org" } })).id, level: "coordinator" });
  const made = await prisma.user.findUnique({ where: { email: "n1@example.org" } });
  assert.equal(made.role, "admin", "valeur historique de repli");
  assert.equal(made.coordinator, true);
  assert.equal((await load(made)).level, "coordinator");
  assert.deepEqual((await prisma.userRole.findMany({ where: { userId: made.id }, include: { role: true } })).map((r) => r.role.key), ["coordinator"]);
  assert.equal((await mk(T.owner, "admin", 2)).ok, true);
  assert.equal((await mk(T.owner, "owner", 3)).reason, "level", "jamais un second propriétaire");
  assert.equal((await mk(T.owner, "none", 4)).reason, "level");
  assert.equal((await mk(T.owner, "r-quelconque", 5)).reason, "level");
  // coordinateur
  assert.equal((await mk(T.coord, "admin", 6)).ok, true);
  assert.equal((await mk(T.coord, "editor", 7)).ok, true);
  assert.equal((await mk(T.coord, "coordinator", 8)).reason, "level", "un coordinateur n'en crée pas");
  assert.equal((await mk(T.coord, "owner", 9)).reason, "level");
  assert.equal(await prisma.user.count({ where: { email: { in: ["n8@example.org", "n9@example.org", "n3@example.org"] } } }), 0);
  // administrateur et éditeur : comme avant
  assert.equal((await mk(T.admin, "editor", 10)).ok, true);
  assert.equal((await mk(T.admin, "admin", 11)).reason, "level");
  assert.equal((await mk(T.admin, "coordinator", 12)).reason, "level");
  assert.equal((await mk(T.editor, "editor", 13)).reason, "denied");
  // mot de passe temporaire à remplacer : l'acteur n'agit pas
  await prisma.user.update({ where: { id: T.coord.id }, data: { mustChangePassword: true } });
  assert.equal((await mk(T.coord, "editor", 14)).reason, "denied");
  await prisma.user.update({ where: { id: T.coord.id }, data: { mustChangePassword: false } });
  // erreurs de saisie
  assert.equal((await M.createMember(T.coord.id, { name: "", email: "pas-un-mail", password: "un-mot-de-passe-solide", role: "editor" })).reason, "invalid");
  assert.equal((await M.createMember(T.coord.id, { name: "X", email: "x@example.org", password: "court", role: "editor" })).reason, "password");
  assert.equal((await M.createMember(T.coord.id, { name: "X", email: T.editor.email, password: "un-mot-de-passe-solide", role: "editor" })).reason, "exists");
  assert.equal((await M.createMember("inconnu", { name: "X", email: "z@example.org", password: "un-mot-de-passe-solide", role: "editor" })).reason, "denied");
  const audits = await prisma.auditLog.findMany({ where: { action: "user.create" } });
  assert.ok(audits.some((a) => a.target === "n1@example.org:coordinator" && a.actor === T.owner.email), "le niveau est inscrit au journal");
});

test("affecter des rôles : le coordinateur gère administrateurs et éditeurs, jamais le propriétaire, un coordinateur, ni lui-même ; seul le propriétaire nomme un coordinateur", async () => {
  const [admin, editor, coordinator, owner] = await Promise.all(["admin", "editor", "coordinator", "owner"].map(roleId));
  // coordinateur → éditeur devient administrateur, et inversement
  assert.deepEqual(await R.setUserRoles(T.coord.id, T.member.id, [admin]), { ok: true, level: "admin" });
  assert.equal((await row(T.member)).role, "admin");
  assert.equal((await row(T.member)).coordinator, false);
  assert.deepEqual(await R.setUserRoles(T.coord.id, T.member.id, [editor]), { ok: true, level: "editor" });
  // interdits
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, [coordinator])).reason, "level", "se promouvoir ou promouvoir : propriétaire seul");
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, [owner])).reason, "role");
  assert.equal((await R.setUserRoles(T.coord.id, T.coord.id, [admin])).reason, "owner", "pas soi-même");
  assert.equal((await R.setUserRoles(T.coord.id, T.coord2.id, [editor])).reason, "level", "pas un autre coordinateur");
  assert.equal((await R.setUserRoles(T.coord.id, T.owner.id, [editor])).reason, "owner", "pas le propriétaire");
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, ["fantome"])).reason, "role");
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, [])).reason, "empty");
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, "editor")).reason, "role");
  assert.equal((await R.setUserRoles(T.admin.id, T.member.id, [admin])).reason, "denied", "l'administrateur n'a pas core:team");
  assert.equal((await R.setUserRoles(T.editor.id, T.member.id, [admin])).reason, "denied");
  assert.equal((await row(T.coord2)).coordinator, true);
  assert.equal((await row(T.owner)).role, "owner");
  // propriétaire : nomme un coordinateur, puis le rétrograde ; jamais lui-même ni un second propriétaire
  assert.deepEqual(await R.setUserRoles(T.owner.id, T.member.id, [coordinator]), { ok: true, level: "coordinator" });
  let m = await row(T.member);
  assert.deepEqual([m.role, m.coordinator], ["admin", true]);
  assert.equal(A.can(await load(T.member), "core:backup"), true);
  assert.deepEqual(await R.setUserRoles(T.owner.id, T.member.id, [admin]), { ok: true, level: "admin" });
  m = await row(T.member);
  assert.deepEqual([m.role, m.coordinator], ["admin", false]);
  assert.equal(A.can(await load(T.member), "core:backup"), false);
  assert.equal((await R.setUserRoles(T.owner.id, T.owner.id, [admin])).reason, "owner");
  assert.equal((await R.setUserRoles(T.owner.id, T.member.id, [owner])).reason, "role");
  assert.equal(await prisma.user.count({ where: { role: "owner" } }), 1, "toujours un seul propriétaire");
  const log = (await prisma.auditLog.findMany({ where: { action: "user.roles" } })).map((l) => `${l.actor}|${l.target}`);
  assert.ok(log.includes(`${T.owner.email}|${T.member.email}:coordinator`));
});

test("anti-élévation : un coordinateur ne donne ni ne remodèle des droits qu'il n'a pas, et jamais un droit réservé", async () => {
  const sensitive = "demo-guarded:phone.edit"; // l'administrateur (donc le coordinateur) ne l'a pas par défaut
  const strong = await R.createRole(T.owner.id, { name: "Téléphones", description: "", rights: [sensitive, "demo-guarded:open"] });
  assert.equal(strong.ok, true);
  const weak = await R.createRole(T.owner.id, { name: "Notes", description: "", rights: ["demo-guarded:notes.view"] });
  assert.equal(weak.ok, true);
  const editor = await roleId("editor");
  // affectation
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, [editor, strong.id])).reason, "rights");
  assert.deepEqual(await R.setUserRoles(T.coord.id, T.member.id, [editor, weak.id]), { ok: true, level: "editor" });
  assert.equal(A.can(await load(T.member), sensitive), false);
  // le propriétaire donne le rôle fort ; le coordinateur peut le GARDER (il ne l'accorde pas) mais pas l'ajouter à un autre
  assert.equal((await R.setUserRoles(T.owner.id, T.member.id, [editor, strong.id])).ok, true);
  assert.equal((await R.setUserRoles(T.coord.id, T.member.id, [editor, strong.id, weak.id])).ok, true);
  // création / modification / suppression
  assert.equal((await R.createRole(T.coord.id, { name: "X", description: "", rights: [sensitive] })).reason, "rights");
  for (const reserved of RESERVED) assert.equal((await R.createRole(T.coord.id, { name: "R", description: "", rights: [reserved] })).reason, "rights", reserved);
  assert.equal((await R.createRole(T.coord.id, { name: "Y", description: "", rights: ["demo-guarded:open", "core:entries.edit", "nexiste:pas"] })).reason, "rights", "un droit inconnu refuse tout");
  const own = await R.createRole(T.coord.id, { name: "Brouillons", description: "d", rights: ["demo-guarded:drafts"] });
  assert.equal(own.ok, true);
  assert.equal((await R.updateRole(T.coord.id, own.id, { name: "Brouillons", rights: ["demo-guarded:drafts", sensitive] })).reason, "rights");
  assert.equal((await R.updateRole(T.coord.id, own.id, { name: "Brouillons 2", rights: ["demo-guarded:notes.view"] })).ok, true);
  assert.equal((await R.updateRole(T.coord.id, strong.id, { name: "Téléphones", rights: [] })).reason, "rights", "on ne remodèle pas un rôle qui donne plus que soi");
  assert.equal((await R.deleteRole(T.coord.id, strong.id, editor)).reason, "rights");
  assert.equal((await R.deleteRole(T.coord.id, own.id)).ok, true);
  assert.equal((await R.updateRole(T.coord.id, await roleId("admin"), { name: "x", rights: [] })).reason, "system");
  // sans core:roles : refus
  assert.equal((await R.createRole(T.admin.id, { name: "Z", description: "", rights: [] })).reason, "denied");
  assert.equal((await R.createRole(T.editor.id, { name: "Z", description: "", rights: [] })).reason, "denied");
});

test("supprimer un rôle réaffecte ses membres : un coordinateur ne touche pas un rôle tenu par un coordinateur et ne réaffecte pas vers coordinateur", async () => {
  const shared = await R.createRole(T.owner.id, { name: "Partagé", description: "", rights: ["demo-guarded:notes.view"] });
  await prisma.userRole.create({ data: { userId: T.coord2.id, roleId: shared.id } });
  const editor = await roleId("editor");
  assert.equal((await R.deleteRole(T.coord.id, shared.id, editor)).reason, "level");
  await prisma.userRole.delete({ where: { userId_roleId: { userId: T.coord2.id, roleId: shared.id } } });
  await prisma.userRole.create({ data: { userId: T.member.id, roleId: shared.id } });
  assert.equal((await R.deleteRole(T.coord.id, shared.id, await roleId("coordinator"))).reason, "replacement");
  assert.equal((await R.deleteRole(T.coord.id, shared.id, await roleId("owner"))).reason, "replacement");
  assert.deepEqual(await R.deleteRole(T.coord.id, shared.id, editor), { ok: true, moved: 1 });
  assert.equal((await row(T.member)).role, "editor");
});

test("supprimer et gérer des comptes : propriétaire intouchable, coordinateur géré par le propriétaire seul, administrateur → éditeurs seulement", async () => {
  assert.equal((await M.deleteMember(T.coord.id, T.owner.id)).ok, false);
  assert.equal((await M.deleteMember(T.coord.id, T.coord2.id)).ok, false);
  assert.equal((await M.deleteMember(T.coord.id, T.coord.id)).ok, false);
  assert.equal((await M.deleteMember(T.admin.id, T.admin.id)).ok, false);
  assert.equal((await M.deleteMember(T.admin.id, T.coord.id)).ok, false);
  assert.equal((await M.deleteMember(T.admin.id, T.owner.id)).ok, false);
  assert.equal((await M.deleteMember(T.editor.id, T.member.id)).ok, false);
  assert.equal((await M.deleteMember(T.admin.id, T.member.id)).ok, true);
  assert.equal((await M.deleteMember(T.coord.id, T.admin.id)).ok, true);
  assert.equal((await M.deleteMember(T.coord.id, "inconnu")).reason, "missing");
  assert.equal((await M.deleteMember(T.owner.id, T.owner.id)).ok, false);
  assert.equal((await M.deleteMember(T.owner.id, T.coord2.id)).ok, true);
  assert.equal(await prisma.user.count({ where: { role: "owner" } }), 1);
  assert.equal(await prisma.user.count({ where: { id: { in: [T.owner.id, T.coord.id] } } }), 2);
  assert.ok((await prisma.auditLog.findMany({ where: { action: "user.delete" } })).length >= 3);
  // débloquer / couper les sessions / double vérification
  for (const fn of [M.unlockMember, M.revokeMemberSessions, M.resetMemberTwoFactor]) {
    assert.equal((await fn(T.coord.id, T.owner.id)).ok, false, `${fn.name} sur le propriétaire`);
    assert.equal((await fn(T.admin.id, T.editor.id)).ok, false, `${fn.name} par un administrateur`);
    assert.equal((await fn(T.coord.id, T.editor.id)).ok, true, `${fn.name} par le coordinateur`);
    assert.equal((await fn(T.owner.id, T.coord.id)).ok, true, `${fn.name} par le propriétaire sur un coordinateur`);
  }
  const before = (await row(T.owner)).sessionVersion;
  await M.revokeMemberSessions(T.coord.id, T.owner.id);
  assert.equal((await row(T.owner)).sessionVersion, before);
});

test("mot de passe temporaire : le coordinateur l'applique aux administrateurs et éditeurs, jamais au propriétaire, à un coordinateur ni à lui-même ; règles inchangées", async () => {
  const pw = "un-mot-de-passe-solide";
  assert.equal((await resetMemberPassword({ actorId: T.coord.id, targetId: T.owner.id, mode: "generate" })).reason, "owner");
  assert.equal((await resetMemberPassword({ actorId: T.coord.id, targetId: T.coord2.id, mode: "generate" })).reason, "denied");
  assert.equal((await resetMemberPassword({ actorId: T.coord.id, targetId: T.coord.id, mode: "generate" })).reason, "self");
  assert.equal((await resetMemberPassword({ actorId: T.admin.id, targetId: T.editor.id, mode: "generate" })).reason, "denied");
  assert.equal((await resetMemberPassword({ actorId: T.editor.id, targetId: T.admin.id, mode: "generate" })).reason, "denied");
  assert.equal((await resetMemberPassword({ actorId: T.coord.id, targetId: T.editor.id, mode: "custom", password: "court" })).reason, "weak");
  const ok = await resetMemberPassword({ actorId: T.coord.id, targetId: T.editor.id, mode: "custom", password: pw });
  assert.equal(ok.ok, true);
  assert.equal(ok.password, undefined, "mot de passe choisi : jamais renvoyé");
  const e = await row(T.editor);
  assert.equal(e.mustChangePassword, true);
  const gen = await resetMemberPassword({ actorId: T.owner.id, targetId: T.coord.id, mode: "generate" });
  assert.equal(gen.ok, true);
  assert.equal(typeof gen.password, "string");
  assert.equal((await row(T.coord)).mustChangePassword, true);
  const audits = await prisma.auditLog.findMany({ where: { action: "user.password.reset" } });
  assert.ok(audits.every((a) => !JSON.stringify(a).includes(pw) && !JSON.stringify(a).includes(gen.password)));
});

/* ───────────── Synchronisation ───────────── */

test("syncSystemAssignments : chacun a exactement le rôle prédéfini de son niveau (le coordinateur aussi), idempotent, rôles personnalisés intacts", async () => {
  const custom = await R.createRole(T.owner.id, { name: "Notes", description: "", rights: ["demo-guarded:notes.view"] });
  await prisma.userRole.create({ data: { userId: T.member.id, roleId: custom.id } });
  await prisma.userRole.deleteMany({ where: { userId: T.coord.id } });
  await prisma.userRole.create({ data: { userId: T.admin.id, roleId: await roleId("coordinator") } }); // affectation périmée : admin ≠ coordinateur
  const r = await R.syncSystemAssignments();
  assert.ok(r.added >= 1 && r.removed >= 1);
  const keys = async (u) => (await prisma.userRole.findMany({ where: { userId: u.id }, include: { role: true } })).map((x) => x.role.key).sort();
  assert.deepEqual(await keys(T.owner), ["owner"]);
  assert.deepEqual(await keys(T.coord), ["coordinator"]);
  assert.deepEqual(await keys(T.admin), ["admin"]);
  assert.deepEqual(await keys(T.editor), ["editor"]);
  assert.deepEqual(await keys(T.member), ["editor", custom.key].sort());
  assert.deepEqual(await R.syncSystemAssignments(), { added: 0, removed: 0 });
  assert.equal(await prisma.role.count({ where: { system: true } }), 4);
  assert.equal((await prisma.role.findUnique({ where: { key: "coordinator" } })).rights, "[]");
  // Un rôle « coordinator » bricolé en rôle personnalisé n'existe pas : la clé est prédéfinie
  assert.equal(Rt.isSystemKey("coordinator"), true);
});

test("passage par un ancien cœur : User.role « admin » (repli sûr), la clé coordinator survit, aucune élévation", async () => {
  // Ce que fait un ancien cœur : il ne connaît que owner|admin|editor|none et ignore la colonne coordinator.
  const oldLevel = (r) => (["owner", "admin", "editor"].includes(r.role) ? r.role : "none");
  const c = await row(T.coord);
  assert.equal(oldLevel(c), "admin", "au pire un administrateur : ni propriétaire, ni verrouillé");
  assert.equal(c.coordinator, true);
  assert.equal(Rt.LEGACY_ROLE.coordinator, "admin");
  // L'ancien cœur supprime l'affectation « coordinator » (il la prend pour une affectation prédéfinie périmée) : le niveau, lui, vient de la colonne.
  await prisma.userRole.deleteMany({ where: { userId: T.coord.id } });
  assert.equal((await load(T.coord)).level, "coordinator");
  await R.syncSystemAssignments();
  assert.deepEqual((await prisma.userRole.findMany({ where: { userId: T.coord.id }, include: { role: true } })).map((x) => x.role.key), ["coordinator"]);
  // L'ancien cœur rétrograde le coordinateur en éditeur : il ne revient pas tout seul.
  await prisma.user.update({ where: { id: T.coord.id }, data: { role: "editor" } });
  await R.syncSystemAssignments();
  assert.equal((await row(T.coord)).coordinator, false);
  await prisma.user.update({ where: { id: T.coord.id }, data: { role: "admin" } });
  assert.equal((await load(T.coord)).level, "admin", "redevenu administrateur : pas coordinateur");
});

/* ───────────── Sauvegarde → restauration ───────────── */

test("sauvegarde → restauration : la clé coordinator survit (colonne + affectation)", async () => {
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content.toString("utf8")]));
  const users = JSON.parse(files["data/users.json"]);
  assert.deepEqual(users.filter((u) => u.coordinator).map((u) => u.email).sort(), [T.coord.email, T.coord2.email].sort());
  assert.equal(users.find((u) => u.email === T.coord.email).role, "admin");
  await prisma.user.update({ where: { id: T.coord.id }, data: { role: "editor", coordinator: false } });
  await prisma.userRole.deleteMany({ where: { userId: T.coord.id } });
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.equal(opened.ok, true, opened.error);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report));
  const u = await load(T.coord);
  assert.equal(u.level, "coordinator");
  assert.equal(A.can(u, "core:backup"), true);
  assert.deepEqual(u.roles, ["coordinator"]);
  assert.equal((await load(T.admin)).level, "admin");
  assert.equal((await load(T.owner)).level, "owner");
});

test("restauration d'une sauvegarde d'avant (0.3.1, sans colonne) ou forgée : le drapeau ne vaut que sur un administrateur", async () => {
  const at = "2026-01-01T00:00:00Z";
  const user = (id, role, extra = {}) => ({ id, email: `${id}@x.org`, name: id, role, passwordHash: "h", createdAt: at, updatedAt: at, advanced: false, locale: null, ...extra });
  const backup = (users) => ({ manifest: { createdAt: at, frameworkVersion: "0.3.1", site: { name: "S" }, counts: {}, modules: [], files: [], format: "curiosa-backup", formatVersion: 1 },
    data: { users, settings: [], modules: [], instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [] }, uploads: [] });
  const report = await Rs.applyRestore(backup([user("o", "owner"), user("a", "admin"), user("e", "editor"), user("c", "admin", { coordinator: true }),
    user("fe", "editor", { coordinator: true }), user("fo", "owner", { coordinator: true }), user("fn", "none", { coordinator: true }), user("fs", "admin", { coordinator: "true" })]), { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report));
  const level = async (id) => (await A.loadAdminUser(id, 0)).level;
  assert.deepEqual([await level("o"), await level("a"), await level("e"), await level("c")], ["owner", "admin", "editor", "coordinator"]);
  assert.deepEqual([await level("fe"), await level("fo"), await level("fn"), await level("fs")], ["editor", "owner", "none", "admin"]);
  assert.equal((await prisma.user.findUnique({ where: { id: "fe" } })).coordinator, false, "drapeau forgé effacé à la restauration");
  assert.equal(await prisma.role.count({ where: { system: true } }), 4);
});

/* ───────────── MCP ───────────── */

test("MCP : jetons, droits et validation des demandes de maintenance suivent le droit core:mcp.tokens", async () => {
  const gateFor = async (u) => { as(u); return gate({ right: "core:mcp.tokens" }); };
  assert.equal(await gateFor(T.owner), "ok");
  assert.equal(await gateFor(T.coord), "ok");
  assert.equal(await gateFor(T.admin), "/admin?denied=1");
  assert.equal(await gateFor(T.editor), "/admin?denied=1");
  for (const f of ["page.tsx", "actions.ts", "requestsActions.ts", "[id]/page.tsx"]) assert.ok(!/adminCtx\("owner"/.test(read(`src/app/admin/(panel)/assistants/${f}`)), f);
  assert.match(read("src/app/admin/(panel)/assistants/requestsActions.ts"), /owner: can\(user, "core:mcp\.tokens"\)/);
  // Suivi des opérations longues (mises à jour, sauvegardes) : lisible par qui détient core:updates.
  assert.equal(viewerOf(await load(T.coord)).owner, true);
  assert.equal(viewerOf(await load(T.owner)).owner, true);
  assert.equal(viewerOf(await load(T.admin)).owner, false);
  // Une demande de maintenance ne s'approuve pas sans le droit.
  const { approveRequest } = await import("@/core/maintenance/actions");
  assert.equal((await approveRequest("x", { email: "a@x.org", owner: false })).ok, false);
});

test("backup : la garde HTTP exige le droit core:backup", async () => {
  const { guardBackup } = await import("@/core/backup/guard");
  const req = new Request("https://site.example/api/admin/backup", { method: "POST", headers: { origin: "https://site.example", host: "site.example" } });
  for (const [u, expected] of [[T.owner, null], [T.coord, null], [T.admin, 403], [T.editor, 403]]) {
    as(u);
    const r = await guardBackup(req);
    assert.equal(r === null ? null : r.status, expected, u.email);
  }
  as(null);
  assert.equal((await guardBackup(req)).status, 401);
});

/* ───────────── Ce qui reste au propriétaire seul ───────────── */

test("inventaire : les seules pages et actions qui exigent encore « owner » sont les réglages d'e-mail et de jaquettes (sans droit propre)", () => {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /adminCtx\("owner"/.test(read(p))) found.push(p); } };
  walk("src/app");
  assert.deepEqual(found.sort(), ["src/app/admin/(panel)/settings/mail-actions.ts", "src/app/admin/(panel)/settings/rawg-actions.ts"]);
});

/* ───────────── Migration depuis 0.3.1 ───────────── */

const root = process.cwd();
const MIGRATION = "20261029090000_coordinator";
const sqlite = (dbFile, sql) => execFileSync("node", ["-e", `const {PrismaClient}=require(${JSON.stringify(path.join(root, "node_modules/@prisma/client"))});const p=new PrismaClient({datasources:{db:{url:${JSON.stringify("file:" + dbFile)}}}});(async()=>{const rows=await p.$queryRawUnsafe(${JSON.stringify(sql)});console.log(JSON.stringify(rows,(k,v)=>typeof v==="bigint"?Number(v):v));await p.$disconnect()})()`], { encoding: "utf8" });
const deploy = (schema, dbFile) => execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdio: "pipe" });

test("migration depuis un état 0.3.1 : propriétaire, administrateurs et éditeurs existants ne changent pas, le drapeau vaut faux partout", () => {
  const dir = makeTempDir("curiosa-mig-");
  try {
    const old = path.join(dir, "prisma");
    fs.cpSync(path.join(root, "prisma"), old, { recursive: true });
    fs.rmSync(path.join(old, "migrations", MIGRATION), { recursive: true });
    const file = path.join(dir, "site.db");
    deploy(path.join(old, "schema.prisma"), file);
    assert.ok(!/coordinator/.test(sqlite(file, `SELECT sql FROM sqlite_master WHERE name='User'`)), "état d'avant : pas de colonne");
    const insert = (id, role) => sqlite(file, `INSERT INTO "User" (id, email, name, role, passwordHash, createdAt, updatedAt) VALUES ('${id}','${id}@x.org','${id}','${role}','h',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    for (const [id, role] of [["u1", "owner"], ["u2", "admin"], ["u3", "editor"], ["u4", "none"], ["u5", "admin"]]) { try { insert(id, role); } catch { /* INSERT ne renvoie pas de lignes : $queryRaw peut s'en plaindre, l'écriture a eu lieu */ } }
    const before = JSON.parse(sqlite(file, `SELECT id, email, name, role, passwordHash, locale, advanced, sessionVersion, mustChangePassword FROM "User" ORDER BY id`));
    assert.equal(before.length, 5);
    deploy(path.join(root, "prisma", "schema.prisma"), file);
    const after = JSON.parse(sqlite(file, `SELECT id, email, name, role, passwordHash, locale, advanced, sessionVersion, mustChangePassword FROM "User" ORDER BY id`));
    assert.deepEqual(after, before, "aucune donnée existante ne change");
    const flags = JSON.parse(sqlite(file, `SELECT id, coordinator FROM "User" ORDER BY id`));
    assert.ok(flags.every((f) => f.coordinator === 0 || f.coordinator === false));
    // Les niveaux (donc les droits) sont ceux d'avant.
    const levels = Object.fromEntries(JSON.parse(sqlite(file, `SELECT id, role, coordinator FROM "User"`)).map((r) => [r.id, Rt.levelOfRow({ role: r.role, coordinator: r.coordinator === 1 || r.coordinator === true })]));
    assert.deepEqual(levels, { u1: "owner", u2: "admin", u3: "editor", u4: "none", u5: "admin" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("migration : texte SQL purement additif ; migration postérieure à toutes les autres", () => {
  const sql = read(path.join("prisma/migrations", MIGRATION, "migration.sql")).replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\b|\bRENAME\b|DELETE\s+FROM|UPDATE\s+"/i.test(sql));
  assert.match(sql, /ALTER TABLE "User" ADD COLUMN "coordinator" BOOLEAN NOT NULL DEFAULT false/);
  const all = fs.readdirSync("prisma/migrations").filter((d) => /^\d{8,}_/.test(d)).sort();
  assert.equal(all.at(-1), MIGRATION);
});

/* ───────────── Textes ───────────── */

test("textes : le niveau et ses explications existent en français ET en anglais, à parité exacte", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  const keys = ["role.coordinator", "roles.system.coordinator", "access.coordinator", "users.levelsTitle", "users.levelHelp.coordinator", "users.levelHelp.admin", "users.levelHelp.editor", "users.error.invalid", "users.error.level", "roles.error.level"];
  for (const k of keys) {
    assert.ok(typeof fr[k] === "string" && fr[k].length > 5, `fr ${k}`);
    assert.ok(typeof en[k] === "string" && en[k].length > 5, `en ${k}`);
    assert.notEqual(fr[k], en[k], `${k} traduit`);
    // mêmes paramètres {…} des deux côtés
    assert.deepEqual((fr[k].match(/\{\w+\}/g) ?? []).sort(), (en[k].match(/\{\w+\}/g) ?? []).sort(), k);
  }
  assert.equal(fr["role.coordinator"], "Coordination technique");
  assert.equal(en["role.coordinator"], "Technical coordination");
  assert.equal(fr["roles.system.coordinator"], "La coordination technique gère tout le côté technique du site : mises à jour, modules, sauvegardes, sécurité, équipe et rôles. Elle ne peut ni toucher à la personne propriétaire ni reprendre le site.");
  assert.equal(en["roles.system.coordinator"], "Technical coordination handles everything technical on the site: updates, modules, backups, security, the team and roles. It cannot touch the owner or take over the site.");
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), [], "aucune clé française sans anglais");
  assert.deepEqual(Object.keys(en).filter((k) => !(k in fr)), [], "aucune clé anglaise sans français");
  assert.match(fr["users.error.invalid"], /exemple/i);
  assert.match(en["users.error.invalid"], /example/i);
  const all = JSON.stringify([fr, en]);
  for (const k of keys) assert.ok(!/association|asbl|fondation/i.test(`${fr[k]} ${en[k]}`), k);
  void all;
});

test("page Équipe : le niveau est expliqué dans l'invitation, l'erreur s'affiche sous le champ avec un exemple", () => {
  const page = read("src/app/admin/(panel)/users/page.tsx");
  assert.match(page, /data-testid="invite-levels"/);
  assert.match(page, /users\.levelHelp\.\$\{r\}/);
  assert.match(page, /grantableLevels\(user\.level\)/);
  assert.match(page, /roles\.system\.\$\{level\}/);
  const actions = read("src/app/admin/(panel)/users/actions.ts");
  assert.match(actions, /errors: \{ email: t\("users\.error\.invalid"\) \}/);
  assert.match(actions, /errors: \{ role: t\("users\.error\.level"\) \}/);
});
