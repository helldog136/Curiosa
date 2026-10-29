// SUITE DE SÉCURITÉ des rôles et droits (0.2.0) : c'est le critère d'acceptation du lot. Chaque test dit l'attaque, ou l'acquis protégé.
// La session est choisie par le test (tests/helpers/stubs/auth.mjs) ; tout le reste est le vrai code du cœur, sur une vraie base SQLite.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const A = await import("@/core/auth/access");
const R = await import("@/core/auth/roles");
const Rt = await import("@/core/auth/rights");
const { adminCtx } = await import("@/core/admin");
const { decideAdminAction } = await import("@/core/modules/adminActionAccess");
const { buildContext, forViewer } = await import("@/core/modules/context");
const { getActiveInstances, getInstalledModules } = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest } = await import("@/core/modules/manifest");
const { setSetting } = await import("@/core/settings");
const { RedirectError } = await import("next/navigation");
const Rs = await import("@/core/backup/restore");
const B = await import("@/core/backup/export");
const { readTarGz } = await import("@/core/backup/tar");

after(() => db.close());

const read = (f) => fs.readFileSync(f, "utf8");
const manifestOf = (id) => JSON.parse(read(path.join("tests/fixtures/extras/modules", id, "module.json")));

let T; // l'équipe du test courant
beforeEach(async () => {
  await db.reset();
  globalThis.curiosaTestSession = null;
  await db.fixture("demo-guarded");
  await db.fixture("demo-other");
  for (const id of ["demo-guarded", "demo-other"]) {
    const parsed = parseManifest(manifestOf(id));
    assert.ok(parsed.ok, parsed.error);
    await createInstance(prisma, { manifest: parsed.manifest, names: { en: id } });
  }
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
  T = { owner: await mk("olive", "owner"), admin: await mk("adam", "admin"), editor: await mk("emma", "editor"), member: await mk("max", "editor") };
  await R.syncSystemAssignments();
});

/** Se connecter comme cette personne. `role` : ce qu'un jeton (JWT) forgé ou périmé prétendrait ; le cœur doit l'ignorer. */
const as = (u, role = "owner") => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role } } : null; };
const load = async (u) => A.loadAdminUser(u.id, (await prisma.user.findUnique({ where: { id: u.id } })).sessionVersion);
/** Ce que fait `adminCtx(need)` pour la personne connectée : "ok" ou l'adresse de renvoi. */
async function gate(need, opts) {
  try { await adminCtx(need, opts); return "ok"; } catch (e) { if (e instanceof RedirectError) return e.url; throw e; }
}
const roleId = async (key) => (await prisma.role.findUnique({ where: { key } })).id;
async function customRole(rights, name = "Modérateur") {
  const r = await R.createRole(T.owner.id, { name, description: "", rights });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}

/* ───────────── Non-régression : les 3 rôles d'avant se comportent exactement comme en 0.1.28 ───────────── */

const OLD_RANK = { editor: 1, admin: 2, owner: 3 };
/** La règle de 0.1.28 (access.ts d'avant) : connecté → mot de passe temporaire → rang → double vérification. */
function oldGate(row, min, { needs2fa = false } = {}) {
  if (!row) return "login";
  if (row.mustChangePassword) return "password";
  if (!((OLD_RANK[row.role] ?? 0) >= OLD_RANK[min])) return "denied";
  if (needs2fa) return "enroll";
  return "ok";
}

test("non-régression : pour owner/admin/editor, chaque palier donne exactement le même verdict qu'en 0.1.28 (pages et actions), avec et sans mot de passe temporaire ou double vérification exigée", async () => {
  for (const require2fa of [false, true]) {
    await setSetting("security.require2fa", require2fa);
    for (const key of ["owner", "admin", "editor"]) {
      for (const mustChangePassword of [false, true]) {
        await prisma.user.update({ where: { id: T[key].id }, data: { mustChangePassword } });
        const row = await prisma.user.findUnique({ where: { id: T[key].id } });
        const user = await load(row);
        for (const min of ["owner", "admin", "editor"]) {
          assert.equal(A.accessGate(user, min), oldGate(row, min, { needs2fa: require2fa }), `${key} ${min} 2fa=${require2fa} temp=${mustChangePassword}`);
          // « member » (menu, tableau de bord, Mon compte) : tout palier d'avant y entre, comme `adminCtx("editor")` avant.
          assert.equal(A.accessGate(user, "member"), oldGate(row, "editor", { needs2fa: require2fa }), `${key} member`);
        }
      }
      await prisma.user.update({ where: { id: T[key].id }, data: { mustChangePassword: false } });
    }
  }
});

/** Pages et actions d'admin importantes : le palier qu'elles exigeaient en 0.1.28, et ce qu'elles exigent maintenant (lu dans le code). */
const PANEL = "src/app/admin/(panel)";
const PAGES = [
  ["layout.tsx", "editor"], ["page.tsx", "editor"], ["account/page.tsx", "editor"], ["mode/page.tsx", "editor"],
  ["entries/page.tsx", "editor"], ["entries/[id]/page.tsx", "editor"], ["entries/new/page.tsx", "editor"], ["redirects/page.tsx", "editor"],
  ["settings/page.tsx", "admin"], ["home/page.tsx", "admin"], ["navigation/page.tsx", "admin"], ["social/page.tsx", "admin"], ["users/page.tsx", "admin"],
  ["extensions/page.tsx", "admin"], ["extensions/add/page.tsx", "admin"], ["modules/[id]/ModuleView.tsx", "admin"],
  ["backup/page.tsx", "owner"], ["updates/page.tsx", "owner"], ["assistants/page.tsx", "owner"], ["audit/page.tsx", "owner"],
];

test("non-régression : sur chaque page d'admin importante, propriétaire, administrateur et éditeur entrent (ou non) exactement comme avant", async () => {
  for (const [file, before] of PAGES) {
    // 0.4.0 : les opérations techniques exigent un DROIT (propriétaire et coordinateur), plus « owner » ; pour owner/admin/editor le verdict est inchangé.
    const m = read(`${PANEL}/${file}`).match(/adminCtx\((?:"(owner|admin|editor|member)"|\{ right: "([^"]+)" \})/);
    assert.ok(m, `${file} : adminCtx introuvable`);
    for (const key of ["owner", "admin", "editor"]) {
      as(T[key]);
      const now = await gate(m[1] ?? { right: m[2] });
      const then = OLD_RANK[key] >= OLD_RANK[before] ? "ok" : "/admin?denied=1";
      assert.equal(now, then, `${file} pour ${key}`);
    }
  }
});

test("non-régression : la page d'un module (réglages et panneau) et ses actions « fonction » restent réservées aux administrateurs ; un éditeur est refusé comme avant", async () => {
  const view = read(`${PANEL}/instances/[id]/InstanceView.tsx`);
  assert.match(view, /adminCtx\("member"\)[\s\S]*if \(!can\(user, `\$\{mod\.manifest\.id\}:open`\)\)[\s\S]*redirect\(deniedPath\(user\)\)/);
  assert.match(view, /const manage = hasRole\(user, "admin"\)/, "réglages, retrait, données gardées : administrateurs");
  const mod = (await getInstalledModules()).find((m) => m.manifest.id === "demo-guarded");
  for (const key of ["owner", "admin", "editor"]) {
    const user = await load(T[key]);
    const opens = A.can(user, "demo-guarded:open");
    assert.equal(opens, key !== "editor", `${key} ouvre la page du module`);
    const legacy = decideAdminAction(user, "demo-guarded", mod.def.adminActions, "legacy");
    assert.equal("handler" in legacy, key !== "editor", `${key} : action « fonction »`);
  }
});

test("non-régression : menu d'administration identique par palier ; un éditeur ne voit plus les liens qui le refusaient (pages de modules)", async () => {
  const { administrationEntries, navItemVisible } = await import("@/core/modules/adminMenu");
  assert.deepEqual(administrationEntries({ role: "owner", advanced: true }), ["extensions", "assistants", "users", "health", "backup", "updates", "audit"]);
  assert.deepEqual(administrationEntries({ role: "admin", advanced: true }), ["extensions", "users", "health"]);
  assert.deepEqual(administrationEntries({ role: "editor", advanced: true }), []);
  assert.deepEqual(administrationEntries({ role: "none", advanced: true }), []);
  const editor = await load(T.editor);
  const admin = await load(T.admin);
  assert.equal(navItemVisible({ content: true, moduleId: "x" }, (r) => A.can(editor, r)), true, "contenus : l'éditeur les voit, comme avant");
  assert.equal(navItemVisible({ content: false, moduleId: "demo-guarded" }, (r) => A.can(editor, r)), false);
  assert.equal(navItemVisible({ content: false, moduleId: "demo-guarded" }, (r) => A.can(admin, r)), true);
});

test("non-régression : un éditeur publie toujours ; l'éditeur d'entrée reçoit owner/admin/editor comme avant", async () => {
  for (const key of ["owner", "admin", "editor"]) {
    const user = await load(T[key]);
    assert.equal(A.can(user, "core:entries.edit"), true, key);
    assert.equal(A.can(user, "core:entries.publish"), true, key);
    assert.equal(A.panelRole(user), key);
  }
});

/* ───────────── Élévation de privilège ───────────── */

test("élévation : formulaire forgé — un administrateur ou un éditeur ne peut ni affecter des rôles, ni s'en ajouter, ni créer/modifier/supprimer un rôle", async () => {
  const mod = await customRole(["demo-guarded:open"]);
  for (const key of ["admin", "editor", "member"]) {
    const actor = T[key];
    assert.deepEqual(await R.setUserRoles(actor.id, actor.id, [await roleId("admin"), mod]), { ok: false, reason: "denied" }, `${key} s'ajoute des rôles`);
    assert.deepEqual(await R.setUserRoles(actor.id, T.editor.id, [await roleId("admin")]), { ok: false, reason: "denied" }, `${key} élève quelqu'un`);
    assert.deepEqual(await R.createRole(actor.id, { name: "Pirate", rights: ["demo-guarded:open"] }), { ok: false, reason: "denied" });
    assert.deepEqual(await R.updateRole(actor.id, mod, { name: "Pirate", rights: ["demo-guarded:phone.edit"] }), { ok: false, reason: "denied" });
    assert.deepEqual(await R.deleteRole(actor.id, mod, await roleId("editor")), { ok: false, reason: "denied" });
  }
  assert.equal(levelOfRow(await prisma.user.findUnique({ where: { id: T.admin.id } })), "admin");
  assert.equal(levelOfRow(await prisma.user.findUnique({ where: { id: T.editor.id } })), "editor");
});
const levelOfRow = (row) => A.levelOf(row);

test("élévation : remplacer un roleId dans le formulaire — `owner`, un identifiant inconnu ou un rôle supprimé sont refusés, rien n'est écrit", async () => {
  const before = await prisma.userRole.findMany({ where: { userId: T.editor.id } });
  for (const forged of [[await roleId("owner")], ["n-existe-pas"], [await roleId("editor"), await roleId("owner")], [await roleId("editor"), "x"], "editor", null]) {
    const r = await R.setUserRoles(T.owner.id, T.editor.id, forged);
    assert.equal(r.ok, false, JSON.stringify(forged));
  }
  assert.deepEqual(await prisma.userRole.findMany({ where: { userId: T.editor.id } }), before);
  assert.equal((await prisma.user.findUnique({ where: { id: T.editor.id } })).role, "editor");
  // Remplaçant forgé à la suppression d'un rôle : jamais `owner`, jamais lui-même.
  const mod = await customRole(["demo-guarded:open"]);
  await R.setUserRoles(T.owner.id, T.member.id, [mod]);
  assert.deepEqual(await R.deleteRole(T.owner.id, mod, await roleId("owner")), { ok: false, reason: "replacement" });
  assert.deepEqual(await R.deleteRole(T.owner.id, mod, mod), { ok: false, reason: "replacement" });
  assert.deepEqual(await R.deleteRole(T.owner.id, mod, "inconnu"), { ok: false, reason: "replacement" });
});

test("élévation : créer un rôle plus fort que soi — droits réservés au propriétaire, inconnus, d'un module non installé ou mal formés refusés en bloc", async () => {
  for (const right of [...Rt.CORE_RESERVED, "core:everything", "absent:open", "demo-guarded:inexistant", "demo-guarded", ":open", "demo-guarded:open:x", 42]) {
    assert.deepEqual(await R.createRole(T.owner.id, { name: `R ${String(right)}`, rights: ["demo-guarded:open", right] }), { ok: false, reason: "rights" }, String(right));
  }
  assert.equal(await prisma.role.count({ where: { system: false } }), 0, "aucun enregistrement partiel");
  // Les droits réservés ne sont jamais proposés : le catalogue délégable n'en contient aucun.
  const cat = await A.currentCatalogue();
  for (const r of Rt.CORE_RESERVED) assert.equal(Rt.delegableRights(cat).has(r), false, r);
  // Une ligne modifiée à la main (base) ne donne pas non plus un droit réservé.
  const id = await customRole(["demo-guarded:open"]);
  await prisma.role.update({ where: { id }, data: { rights: JSON.stringify(["core:backup", "core:roles", "demo-guarded:open"]) } });
  await R.setUserRoles(T.owner.id, T.member.id, [id]);
  const m = await load(T.member);
  assert.equal(A.can(m, "core:backup"), false);
  assert.equal(A.can(m, "core:roles"), false);
  assert.equal(A.can(m, "demo-guarded:open"), true);
});

test("élévation : le propriétaire est unique et intouchable — ses rôles ne changent pas, le rôle `owner` ne s'affecte jamais, les rôles prédéfinis ne se modifient pas", async () => {
  const mod = await customRole(["demo-guarded:open"]);
  assert.deepEqual(await R.setUserRoles(T.owner.id, T.owner.id, [mod]), { ok: false, reason: "owner" });
  const second = await prisma.user.create({ data: { email: "o2@example.org", name: "O2", role: "owner", passwordHash: "x" } });
  assert.deepEqual(await R.setUserRoles(T.owner.id, second.id, [await roleId("editor")]), { ok: false, reason: "owner" });
  assert.deepEqual(await R.setUserRoles(T.owner.id, T.editor.id, [await roleId("owner")]), { ok: false, reason: "role" });
  for (const key of ["owner", "admin", "editor"]) {
    assert.deepEqual(await R.updateRole(T.owner.id, await roleId(key), { name: "X", rights: [] }), { ok: false, reason: "system" });
    assert.deepEqual(await R.deleteRole(T.owner.id, await roleId(key), mod), { ok: false, reason: "system" });
  }
  assert.equal((await prisma.user.findUnique({ where: { id: T.owner.id } })).role, "owner");
  // Les anciennes protections restent : mot de passe temporaire jamais sur un propriétaire (teamPassword lit le niveau relu en base).
  const { resetMemberPassword } = await import("@/core/auth/teamPassword");
  assert.equal((await resetMemberPassword({ actorId: T.owner.id, targetId: second.id, mode: "generate" })).reason, "owner");
  assert.equal((await resetMemberPassword({ actorId: T.admin.id, targetId: T.editor.id, mode: "generate" })).reason, "denied");
});

test("élévation : fabriquer l'appel d'un autre utilisateur — l'acteur vient de la session relue en base, jamais du formulaire ni du jeton", async () => {
  const actions = await import("@/app/admin/(panel)/users/actions");
  const form = (entries) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
  // Un administrateur connecté envoie le formulaire du propriétaire (avec l'identifiant du propriétaire glissé dedans) : refusé, rien n'est écrit.
  as(T.admin, "owner");
  const forged = form([["roleId", await roleId("admin")], ["actorId", T.owner.id], ["userId", T.owner.id]]);
  await assert.rejects(actions.setUserRolesAction(T.editor.id, null, forged), (e) => e instanceof RedirectError && e.url === "/admin?denied=1");
  await assert.rejects(actions.createRoleAction(null, form([["name", "Pirate"], ["right", "demo-guarded:open"]])), RedirectError);
  assert.equal((await prisma.user.findUnique({ where: { id: T.editor.id } })).role, "editor");
  assert.equal(await prisma.role.count({ where: { system: false } }), 0);
  // Le propriétaire, lui, passe ; le serveur ne lit que la session.
  as(T.owner, "editor");
  const done = await actions.setUserRolesAction(T.editor.id, null, form([["roleId", await roleId("admin")]]));
  assert.ok(done.ok && !done.error, JSON.stringify(done));
  assert.equal((await prisma.user.findUnique({ where: { id: T.editor.id } })).role, "admin");
  const src = read(`${PANEL}/users/actions.ts`);
  for (const fn of ["setUserRolesAction", "createRoleAction", "updateRoleAction", "deleteRoleAction"]) assert.match(src, new RegExp(`export async function ${fn}[\\s\\S]*?adminCtx\\("owner"\\)[\\s\\S]*?\\(user\\.id,`), fn);
  assert.doesNotMatch(src, /formData\.get\("(actor|actorId|userId|level|role)"\)[^;]*setUserRoles/);
});

test("JWT : le rôle porté par le jeton de session ne décide jamais (le compte est relu en base à chaque requête)", async () => {
  as(T.editor, "owner");
  assert.equal(await gate("owner"), "/admin?denied=1");
  assert.equal(await gate("admin"), "/admin?denied=1");
  as(T.owner, "editor");
  assert.equal(await gate("owner"), "ok");
  // Le code n'a aucun chemin qui lise le rôle de la session.
  for (const f of ["src/core/permissions.ts", "src/core/admin.ts", "src/core/auth/access.ts"]) assert.doesNotMatch(read(f), /session\??\.user\??\.role|token\.role/, f);
  // Le jeton garde `role` (compatibilité, auth.ts) mais rien d'autre ne le lit.
  assert.match(read("src/auth.ts"), /token\.role = user\.role/);
});

test("cache : un droit retiré est refusé à la requête suivante, sans reconnexion ni coupure de session", async () => {
  const mod = await customRole(["demo-guarded:open", "demo-guarded:notes.view"]);
  assert.equal((await R.setUserRoles(T.owner.id, T.member.id, [mod])).ok, true);
  const sv = (await prisma.user.findUnique({ where: { id: T.member.id } })).sessionVersion;
  as({ ...T.member, sessionVersion: sv });
  const mod0 = (await getInstalledModules()).find((m) => m.manifest.id === "demo-guarded");
  let user = await A.loadAdminUser(T.member.id, sv);
  assert.ok("handler" in decideAdminAction(user, "demo-guarded", mod0.def.adminActions, "guarded"));
  assert.equal(await gate("member"), "ok");
  // Le propriétaire retire le droit : même session, requête suivante → refusé.
  assert.equal((await R.updateRole(T.owner.id, mod, { name: "Modérateur", rights: ["demo-guarded:open"] })).ok, true);
  user = await A.loadAdminUser(T.member.id, sv);
  assert.ok(user, "la session reste valide (pas de déconnexion)");
  assert.deepEqual(decideAdminAction(user, "demo-guarded", mod0.def.adminActions, "guarded"), { denied: "demo-guarded:notes.view" });
  // Puis le rôle lui-même : plus aucun accès.
  assert.equal((await R.updateRole(T.owner.id, mod, { name: "Modérateur", rights: [] })).ok, true);
  assert.equal(await gate("member"), "/admin/no-access");
  // Rétrogradation d'un administrateur : refusé tout de suite.
  as(T.admin);
  assert.equal(await gate("admin"), "ok");
  await R.setUserRoles(T.owner.id, T.admin.id, [await roleId("editor")]);
  assert.equal(await gate("admin"), "/admin?denied=1");
});

test("utilisateur sans rôle utile (« none ») : aucun droit, aucune page, renvoyé vers « aucun accès » sans boucle", async () => {
  const empty = await customRole([], "Vide");
  assert.equal((await R.setUserRoles(T.owner.id, T.member.id, [empty])).ok, true);
  assert.equal((await prisma.user.findUnique({ where: { id: T.member.id } })).role, "none", "User.role recalculé : « none »");
  const u = await load(T.member);
  assert.equal(u.level, "none");
  assert.equal(A.isMember(u), false);
  for (const r of ["core:entries.edit", "core:entries.publish", "demo-guarded:open", "core:backup"]) assert.equal(A.can(u, r), false, r);
  as(T.member);
  for (const need of ["member", "editor", "admin", "owner", { right: "demo-guarded:open" }]) assert.equal(await gate(need), "/admin/no-access", JSON.stringify(need));
  // La page « aucun accès » est hors du menu (groupe (auth)) : elle ne repasse pas par la règle qui y renvoie.
  assert.ok(fs.existsSync("src/app/admin/(auth)/no-access/page.tsx"));
  assert.doesNotMatch(read("src/app/admin/(auth)/no-access/page.tsx"), /adminCtx|requireRole/);
  // Une valeur inconnue en base vaut « none » (jamais un palier).
  await prisma.user.update({ where: { id: T.editor.id }, data: { role: "superadmin" } });
  assert.equal((await load(T.editor)).level, "none");
  // Au moins un rôle : on ne peut pas tout décocher.
  assert.deepEqual(await R.setUserRoles(T.owner.id, T.admin.id, []), { ok: false, reason: "empty" });
});

test("rôle personnalisé : droits combinés par union, `core:entries.edit` vaut le palier éditeur, publier reste un droit à part", async () => {
  const writer = await customRole(["core:entries.edit"], "Rédacteur");
  const mod = await customRole(["demo-guarded:open", "demo-guarded:notes.view"], "Modérateur");
  await R.setUserRoles(T.owner.id, T.member.id, [writer, mod]);
  const u = await load(T.member);
  assert.equal(u.level, "none");
  assert.deepEqual(u.roles.sort(), ["r-moderateur", "r-redacteur"]);
  assert.equal(A.hasRole(u, "editor"), true, "écrire = palier éditeur (contenus, redirections)");
  assert.equal(A.hasRole(u, "admin"), false);
  assert.equal(A.panelRole(u), "editor");
  assert.equal(A.can(u, "demo-guarded:notes.view"), true);
  assert.equal(A.can(u, "core:entries.publish"), false);
  const entries = read(`${PANEL}/entries/actions.ts`);
  assert.match(entries, /if \(status === "published" && !mayPublish\) return \{ error: t\("entries\.error\.publish"\) \}/);
  assert.match(entries, /if \(entry\.status === "published" && !mayPublish\)/);
  // Éditeur + rôle personnalisé : cumul (puces), le niveau reste « editor ».
  await R.setUserRoles(T.owner.id, T.member.id, [await roleId("editor"), mod]);
  const v = await load(T.member);
  assert.equal(v.level, "editor");
  assert.equal(A.can(v, "core:entries.publish"), true);
  assert.equal(A.can(v, "demo-guarded:notes.view"), true);
  // admin + editor cochés : le plus haut gagne (une seule affectation prédéfinie).
  await R.setUserRoles(T.owner.id, T.member.id, [await roleId("editor"), await roleId("admin")]);
  assert.equal((await prisma.user.findUnique({ where: { id: T.member.id } })).role, "admin");
  assert.equal(await prisma.userRole.count({ where: { userId: T.member.id, role: { system: true } } }), 1);
});

test("rôle supprimé en usage : refus sans réaffectation (la base le refuse aussi), puis réaffectation complète et niveau recalculé", async () => {
  const mod = await customRole(["demo-guarded:open"]);
  await R.setUserRoles(T.owner.id, T.member.id, [mod]);
  assert.deepEqual(await R.deleteRole(T.owner.id, mod), { ok: false, reason: "inUse" });
  await assert.rejects(prisma.role.delete({ where: { id: mod } }), "onDelete: Restrict : la base refuse elle aussi");
  const r = await R.deleteRole(T.owner.id, mod, await roleId("editor"));
  assert.deepEqual(r, { ok: true, moved: 1 });
  assert.equal(await prisma.role.findUnique({ where: { id: mod } }), null);
  const u = await load(T.member);
  assert.equal(u.level, "editor", "la personne n'est jamais sans rôle");
  assert.equal((await prisma.user.findUnique({ where: { id: T.member.id } })).role, "editor");
  // Un rôle inutilisé se supprime sans réaffectation.
  const unused = await customRole([], "Inutile");
  assert.deepEqual(await R.deleteRole(T.owner.id, unused), { ok: true, moved: 0 });
});

/* ───────────── Modules ───────────── */

test("modules : un module ne peut pas déclarer le droit d'un autre ; droits mal formés ou `open` refusés au manifeste", () => {
  const base = { ...manifestOf("demo-other") };
  for (const bad of [[{ id: "demo-guarded:notes.view", label: "x" }], [{ id: "open", label: "x" }], [{ id: "Notes", label: "x" }], [{ id: "a.b.c.d", label: "x" }], [{ id: "a", label: "x" }, { id: "a", label: "y" }], Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, label: "x" }))]) {
    assert.equal(parseManifest({ ...base, rights: bad }).ok, false, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(parseManifest({ ...base, rights: [{ id: "a.b-c.d", label: "x", default: { admin: false, editor: true } }] }).ok, true);
  // Même sans le manifeste (catalogue construit autrement), le préfixe est imposé.
  const cat = Rt.rightsCatalogue([{ moduleId: "demo-other", name: "o", rights: [{ id: "demo-guarded:notes.view" }, { id: "x:y" }, { id: "ok" }] }]);
  assert.deepEqual(cat.filter((r) => r.moduleId).map((r) => r.id), ["demo-other:open", "demo-other:ok"]);
});

test("modules : les droits du module A ne valent rien pour B (actions, ctx.can) — même pour le propriétaire, un droit d'un autre module est refusé", async () => {
  const both = await customRole(["demo-guarded:open", "demo-other:open", "demo-other:secret.view"]);
  await R.setUserRoles(T.owner.id, T.member.id, [both]);
  const u = await load(T.member);
  const mods = await getInstalledModules();
  const guarded = mods.find((m) => m.manifest.id === "demo-guarded");
  const other = mods.find((m) => m.manifest.id === "demo-other");
  for (const who of [u, await load(T.owner)]) {
    assert.deepEqual(decideAdminAction(who, "demo-guarded", guarded.def.adminActions, "foreign"), { denied: "module:demo-guarded:foreign" });
    assert.deepEqual(decideAdminAction(who, "demo-guarded", guarded.def.adminActions, "bogus"), { denied: "module:demo-guarded:bogus" });
  }
  assert.ok("handler" in decideAdminAction(u, "demo-other", other.def.adminActions, "peek"), "son propre droit, dans son module : oui");
  assert.deepEqual(decideAdminAction(u, "demo-guarded", guarded.def.adminActions, "guarded"), { denied: "demo-guarded:notes.view" }, "B n'a pas notes.view");
  assert.equal(decideAdminAction(u, "demo-guarded", guarded.def.adminActions, "__proto__"), null, "pas d'action héritée");
  assert.equal(decideAdminAction(u, "demo-guarded", guarded.def.adminActions, "toString"), null);
  const active = (await getActiveInstances()).find((a) => a.mod.manifest.id === "demo-guarded");
  const ctx = forViewer(await buildContext(active.mod, active.instance), u);
  assert.equal(ctx.can("open"), true);
  assert.equal(ctx.can("demo-other:secret.view"), false, "préfixe imposé : jamais le droit d'un autre module");
  assert.equal(ctx.can("secret.view"), false);
  assert.equal(ctx.can(""), false);
});

test("actions à droit : vérifiées par le cœur AVANT `run` ; `ctx.can` y répond pour la personne ; un droit `default.admin: false` n'est pas donné aux administrateurs", async () => {
  const mods = await getInstalledModules();
  const g = mods.find((m) => m.manifest.id === "demo-guarded");
  const admin = await load(T.admin);
  assert.ok("handler" in decideAdminAction(admin, "demo-guarded", g.def.adminActions, "guarded"));
  assert.ok("handler" in decideAdminAction(admin, "demo-guarded", g.def.adminActions, "prefixed"), "« <ce module>:droit » accepté");
  assert.deepEqual(decideAdminAction(admin, "demo-guarded", g.def.adminActions, "sensitive"), { denied: "demo-guarded:phone.edit" });
  const owner = await load(T.owner);
  assert.ok("handler" in decideAdminAction(owner, "demo-guarded", g.def.adminActions, "sensitive"), "le propriétaire a tout");
  const editor = await load(T.editor);
  assert.equal(A.can(editor, "demo-guarded:drafts"), true, "default.editor: true");
  assert.deepEqual(decideAdminAction(editor, "demo-guarded", g.def.adminActions, "guarded"), { denied: "demo-guarded:notes.view" }, "sans <module>:open, rien");
  const active = (await getActiveInstances()).find((a) => a.mod.manifest.id === "demo-guarded");
  const run = decideAdminAction(admin, "demo-guarded", g.def.adminActions, "guarded").handler;
  assert.deepEqual(await run(forViewer(await buildContext(active.mod, active.instance), admin), {}), { ok: "guarded:false" });
  assert.deepEqual(await run(forViewer(await buildContext(active.mod, active.instance), owner), {}), { ok: "guarded:true" });
});

test("ctx.can est faux hors administration : route publique, MCP, tâche planifiée, contexte de service — même si la personne connectée est propriétaire", async () => {
  as(T.owner);
  const active = (await getActiveInstances()).find((a) => a.mod.manifest.id === "demo-guarded");
  const plain = await buildContext(active.mod, active.instance);
  assert.equal(plain.can("notes.view"), false, "contexte ordinaire : refus par défaut");
  const { GET } = await import("@/app/m/[instance]/[...path]/route");
  const res = await GET(new Request(`http://localhost/m/${active.instance.key}/probe`), { params: Promise.resolve({ instance: active.instance.key, path: ["probe"] }) });
  assert.equal(await res.text(), "route:false", "route publique");
  const { moduleActionProvider } = await import("@/core/modules/mcpProvider");
  const tool = (await moduleActionProvider.list()).find((t) => t.name === `${active.instance.key}__probe`);
  assert.ok(tool, "outil MCP du module");
  assert.deepEqual(await tool.call({}, "jeton"), { can: false }, "MCP");
  const { runDueTasks } = await import("@/core/services/scheduler");
  globalThis.curiosaTaskCan = "jamais appelé";
  await runDueTasks({ instanceId: active.instance.id, force: true });
  assert.equal(globalThis.curiosaTaskCan, false, "tâche planifiée");
  // `forViewer` (le seul moyen d'obtenir un `ctx.can` qui dise oui) n'est utilisé que dans les contextes d'administration d'un humain.
  const users = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /forViewer\(/.test(read(p))) users.push(p); } };
  walk("src");
  // dependencies.ts : le `create` d'un réglage `choice` (contrats 1 et 6), appelé pour la personne connectée ; seul choice.ts lui passe `viewer`.
  assert.deepEqual(users.sort(), [`${PANEL}/entries/panel-actions.ts`, `${PANEL}/instances/[id]/InstanceView.tsx`, `${PANEL}/instances/module-actions.ts`, "src/core/modules/adminTransferDeps.ts", "src/core/modules/dependencies.ts", "src/core/modules/entryPanelsLoad.ts"]);
  const viewers = [];
  const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk2(p); else if (/\.(ts|tsx)$/.test(e.name) && /callService\([^;]*\{\s*viewer\b/.test(read(p))) viewers.push(p); } };
  walk2("src");
  assert.deepEqual(viewers, ["src/core/modules/choice.ts"], "seule la création d'un choix passe la personne connectée au fournisseur");
  assert.ok(!/viewer/.test(read("src/core/modules/api.ts")), "un module ne peut jamais passer `viewer` (ctx.api.services.call ne le transmet pas)");
});

test("mot de passe temporaire : prioritaire sur tout droit, tout palier et tout rôle personnalisé", async () => {
  const mod = await customRole(["demo-guarded:open", "core:entries.edit"]);
  await R.setUserRoles(T.owner.id, T.member.id, [mod]);
  for (const who of [T.admin, T.member, T.editor]) await prisma.user.update({ where: { id: who.id }, data: { mustChangePassword: true } });
  for (const who of [T.admin, T.member, T.editor]) {
    const u = await load(who);
    for (const need of ["member", "editor", "admin", "owner", { right: "demo-guarded:open" }]) assert.equal(A.accessGate(u, need), "password", JSON.stringify(need));
    assert.equal(A.can(u, "demo-guarded:open"), false);
    assert.equal(A.can(u, "core:entries.edit"), false);
    as(who);
    assert.equal(await gate("member"), "/admin/choose-password");
  }
  // Double vérification exigée et pas activée : `can` refuse aussi (seule « Mon compte » reste ouverte).
  await prisma.user.update({ where: { id: T.member.id }, data: { mustChangePassword: false } });
  await setSetting("security.require2fa", true);
  const u = await load(T.member);
  assert.equal(A.can(u, "demo-guarded:open"), false);
  assert.equal(A.accessGate(u, "member"), "enroll");
  assert.equal(A.accessGate(u, "member", { allowUnenrolled: true }), "ok");
});

test("ordre de accessGate inchangé : connecté → mot de passe temporaire → droit → double vérification", () => {
  const src = read("src/core/auth/access.ts");
  const body = src.slice(src.indexOf("export function accessGate"));
  const order = ['return "login"', 'return "password"', 'return "denied"', 'return "enroll"'].map((s) => body.indexOf(s));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), String(order));
});

/* ───────────── Démarrage, retour en arrière, sauvegarde ───────────── */

test("démarrage : rôles prédéfinis créés une fois (idempotent), affectation initiale depuis User.role, User.role reste la source du niveau", async () => {
  await prisma.userRole.deleteMany(); await prisma.role.deleteMany();
  await R.syncSystemAssignments();
  await R.syncSystemAssignments();
  assert.deepEqual((await prisma.role.findMany({ orderBy: { key: "asc" } })).map((r) => [r.key, r.system]), [["admin", true], ["editor", true], ["owner", true]]);
  for (const key of ["owner", "admin", "editor"]) {
    const rows = await prisma.userRole.findMany({ where: { userId: T[key].id }, include: { role: true } });
    assert.deepEqual(rows.map((r) => r.role.key), [key]);
  }
  assert.match(read("src/instrumentation.ts"), /initRoles\(\)/);
  // Retour par un ancien cœur qui a rétrogradé quelqu'un (User.role = editor) alors que l'affectation dit encore « admin » : User.role gagne, jamais d'élévation.
  await prisma.user.update({ where: { id: T.admin.id }, data: { role: "editor" } });
  const u = await load(T.admin);
  assert.equal(u.level, "editor");
  assert.equal(A.hasRole(u, "admin"), false);
  await R.syncSystemAssignments();
  assert.deepEqual((await prisma.userRole.findMany({ where: { userId: T.admin.id }, include: { role: true } })).map((r) => r.role.key), ["editor"]);
});

test("retour à 0.1.28 (documenté) : un « none » est refusé partout par l'ancien cœur (bloqué, jamais élevé)", () => {
  const OLD = { editor: 1, admin: 2, owner: 3 };
  for (const min of ["editor", "admin", "owner"]) assert.equal((OLD["none"] ?? 0) >= OLD[min], false);
  const doc = read("docs/SECURITE.md");
  assert.match(doc, /« none »/);
  assert.match(doc, /0\.1\.28/);
});

test("sauvegarde : rôles et affectations inclus, puis restaurés à l'identique", async () => {
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]);
  const mod = await customRole(["demo-guarded:open", "demo-guarded:notes.view"]);
  await R.setUserRoles(T.owner.id, T.member.id, [mod]);
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content.toString("utf8")]));
  const roles = JSON.parse(files["data/roles.json"]);
  assert.deepEqual(roles.find((r) => r.key === "r-moderateur").rights, ["demo-guarded:notes.view", "demo-guarded:open"], "droits en liste lisible");
  assert.ok(JSON.parse(files["data/user-roles.json"]).some((l) => l.userId === T.member.id && l.roleId === mod));
  // On abîme le site, puis on restaure.
  await R.deleteRole(T.owner.id, mod, await roleId("editor"));
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.equal(opened.ok, true, opened.error);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report));
  const u = await load(T.member);
  assert.equal(u.level, "none");
  assert.deepEqual(u.roles, ["r-moderateur"]);
  assert.equal(A.can(u, "demo-guarded:notes.view"), true);
});

test("restauration d'une sauvegarde d'avant les rôles (sans data/roles.json) : rôles prédéfinis recréés, affectation depuis User.role ; « système » jamais cru sur parole", async () => {
  const at = "2026-01-01T00:00:00Z";
  const user = (id, role) => ({ id, email: `${id}@x.org`, name: id, role, passwordHash: "h", createdAt: at, updatedAt: at, advanced: false, locale: null });
  const backup = (extra = {}) => ({ manifest: { createdAt: at, frameworkVersion: "0.1.28", site: { name: "S" }, counts: {}, modules: [], files: [], format: "curiosa-backup", formatVersion: 1 },
    data: { users: [user("o", "owner"), user("a", "admin"), user("e", "editor")], settings: [], modules: [], instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [], ...extra }, uploads: [] });
  const report = await Rs.applyRestore(backup(), { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(await prisma.role.count({ where: { system: true } }), 4);
  for (const [id, key] of [["o", "owner"], ["a", "admin"], ["e", "editor"]]) {
    assert.deepEqual((await prisma.userRole.findMany({ where: { userId: id }, include: { role: true } })).map((r) => r.role.key), [key], id);
  }
  // Sauvegarde forgée : un rôle « r-x » marqué system, une affectation vers une personne absente, un droit réservé.
  const report2 = await Rs.applyRestore(backup({
    roles: [{ id: "rx", key: "r-x", name: "X", description: "", system: true, rights: ["core:backup", "demo-guarded:open"], createdAt: at, updatedAt: at }],
    userRoles: [{ userId: "e", roleId: "rx" }, { userId: "fantome", roleId: "rx" }],
  }), { confirmCustom: [], actor: "o" });
  assert.equal(report2.ok, true);
  assert.equal((await prisma.role.findUnique({ where: { id: "rx" } })).system, false, "system recalculé d'après la clé");
  assert.equal(await prisma.userRole.count({ where: { userId: "fantome" } }), 0);
  const e = await A.loadAdminUser("e", 0);
  assert.equal(A.can(e, "core:backup"), false, "droit réservé jamais accordé");
  assert.equal(A.can(e, "demo-guarded:open"), true);
  // Format : version inchangée (les nouveaux fichiers sont facultatifs, comme `retired`).
  const F = await import("@/core/backup/format");
  assert.equal(F.FORMAT_VERSION, 1);
  assert.equal(F.DATA_FILES.roles, "data/roles.json");
  assert.equal(F.DATA_FILES.userRoles, "data/user-roles.json");
});

/* ───────────── Audit ───────────── */

test("audit : création, modification, suppression de rôle, rôles d'une personne, refus répétés (au plus un par personne et par droit toutes les 10 minutes)", async () => {
  const id = await customRole(["demo-guarded:open"]);
  await R.updateRole(T.owner.id, id, { name: "Modérateur", rights: [] });
  await R.setUserRoles(T.owner.id, T.member.id, [id, await roleId("editor")]);
  await R.deleteRole(T.owner.id, id, await roleId("editor"));
  const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((l) => l.action);
  for (const a of ["role.create", "role.update", "user.roles", "role.delete"]) assert.ok(actions.includes(a), a);
  const { AUDIT_ACTIONS } = await import("@/core/auditLabels");
  for (const a of ["role.create", "role.update", "role.delete", "user.roles", "access.denied"]) assert.ok(AUDIT_ACTIONS.includes(a), a);
  as(T.editor);
  await prisma.auditLog.deleteMany();
  for (let i = 0; i < 5; i++) await gate("owner");
  await gate("admin");
  const denied = await prisma.auditLog.findMany({ where: { action: "access.denied" } });
  assert.deepEqual(denied.map((d) => d.target).sort(), ["admin", "owner"]);
  const now = Date.now();
  assert.equal(A.shouldAuditDenied("x", "r", now), true);
  assert.equal(A.shouldAuditDenied("x", "r", now + 9 * 60_000), false);
  assert.equal(A.shouldAuditDenied("x", "r", now + 11 * 60_000), true);
});

/* ───────────── Garde-fous du code ───────────── */

test("les sites qui s'ouvrent à « tout accès » (member) sont connus : aucune page ne s'affaiblit sans le dire", () => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /adminCtx\("member"/.test(read(p))) out.push(p); } };
  walk("src/app");
  assert.deepEqual(out.sort(), [
    "src/app/admin/(auth)/choose-password/actions.ts", "src/app/admin/(auth)/choose-password/page.tsx",
    `${PANEL}/account/actions.ts`, `${PANEL}/account/page.tsx`, `${PANEL}/instances/[id]/InstanceView.tsx`, `${PANEL}/instances/module-actions.ts`,
    `${PANEL}/layout.tsx`, `${PANEL}/mode/actions.ts`, `${PANEL}/mode/page.tsx`, `${PANEL}/page.tsx`,
  ]);
});
