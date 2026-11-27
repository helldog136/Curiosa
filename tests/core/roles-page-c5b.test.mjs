// C5b: the Roles page and the Team page. Server rules (duplicate, rename, delete, anti-escalation) on a real SQLite base, and the wiring of the page (access row, menu, matrix, forms).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const R = await import("@/core/auth/roles");
const A = await import("@/core/auth/access");
const Rt = await import("@/core/auth/rights");
const V = await import("@/core/auth/rolesView");
const M = await import("@/core/adminkit/rightsMatrix");
const AA = await import("@/core/adminAccess");
const L = await import("@/core/adminLinks");
const { createInstance } = await import("@/core/instanceService");
const { parseManifest: parse } = await import("@/core/modules/manifest");
after(() => db.close());

const read = (f) => fs.readFileSync(f, "utf8");
const PHONE = "demo-guarded:phone.edit"; // a module right that administrators do NOT get by default

let T;
beforeEach(async () => {
  await db.reset();
  await db.fixture("demo-guarded");
  const parsed = parse(JSON.parse(read(path.join("tests/fixtures/extras/modules/demo-guarded/module.json"))));
  assert.ok(parsed.ok, parsed.error);
  await createInstance(prisma, { manifest: parsed.manifest, names: { en: "demo-guarded" } });
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
  T = { owner: await mk("olive", "owner"), coord: await mk("cora", "admin", { coordinator: true }), admin: await mk("adam", "admin"), editor: await mk("emma", "editor") };
  await R.syncSystemAssignments();
});
const make = async (name, rights, by = T.owner) => { const r = await R.createRole(by.id, { name, description: "Keeps things tidy.", rights }); assert.equal(r.ok, true, JSON.stringify(r)); return r.id; };
const roleRow = (id) => prisma.role.findUnique({ where: { id } });
const auditCount = (action) => prisma.auditLog.count({ where: { action } });

// ─── duplicate ───────────────────────────────────────────────────────────────

test("duplicate: a custom role is copied with its rights, a free name, no people, an audit entry", async () => {
  const id = await make("Moderation", ["core:entries.edit", "core:entries.publish"]);
  const holder = await prisma.user.create({ data: { email: "lune_douce@example.org", name: "lune_douce", role: "editor", passwordHash: "x" } });
  await prisma.userRole.create({ data: { userId: holder.id, roleId: id } });
  const r = await R.duplicateRole(T.owner.id, id, { name: "Moderation" });
  assert.equal(r.ok, true);
  assert.equal(r.name, "Moderation 2", "a name nobody uses: a number follows");
  const copy = await roleRow(r.id);
  assert.equal(copy.system, false);
  assert.deepEqual(JSON.parse(copy.rights), ["core:entries.edit", "core:entries.publish"]);
  assert.equal(await prisma.userRole.count({ where: { roleId: r.id } }), 0, "the copy has no people");
  assert.equal(await auditCount("role.duplicate"), 1);
  assert.equal((await R.duplicateRole(T.owner.id, id, {})).name, "Moderation 3");
});

test("duplicate: a built-in role becomes a custom role WITHOUT its reserved rights; the owner role is never copied", async () => {
  const admin = await prisma.role.findUnique({ where: { key: "admin" } });
  const r = await R.duplicateRole(T.owner.id, admin.id, { name: "Site helpers" });
  assert.equal(r.ok, true);
  const rights = JSON.parse((await roleRow(r.id)).rights);
  assert.ok(rights.includes("core:entries.edit"));
  for (const x of rights) assert.equal(Rt.isReserved(x), false, x);
  assert.equal((await roleRow(r.id)).system, false);
  const coord = await prisma.role.findUnique({ where: { key: "coordinator" } });
  const c = await R.duplicateRole(T.owner.id, coord.id, { name: "Tech copy" });
  for (const x of JSON.parse((await roleRow(c.id)).rights)) assert.equal(Rt.isReserved(x), false, x);
  const owner = await prisma.role.findUnique({ where: { key: "owner" } });
  assert.deepEqual(await R.duplicateRole(T.owner.id, owner.id, { name: "Nope" }), { ok: false, reason: "system" });
});

test("duplicate: nobody copies a role that gives what they do not hold, nobody without core:roles copies anything, a forged id is refused", async () => {
  const id = await make("Phone desk", [PHONE]);
  assert.equal((await R.duplicateRole(T.coord.id, id, { name: "Stolen" })).reason, "rights", "technical coordination does not hold the right: anti-escalation");
  assert.equal(await prisma.role.count({ where: { name: "Stolen" } }), 0);
  assert.equal((await R.duplicateRole(T.admin.id, id, {})).reason, "denied", "an administrator has no core:roles");
  assert.equal((await R.duplicateRole(T.editor.id, id, {})).reason, "denied");
  assert.equal((await R.duplicateRole(T.owner.id, "does-not-exist", {})).reason, "missing");
  assert.equal((await R.duplicateRole("forged", id, {})).reason, "denied");
  assert.equal((await R.duplicateRole(T.owner.id, id, { name: "x".repeat(61) })).reason, "name");
});

test("duplicate: the limit of custom roles holds", async () => {
  const id = await make("Seed", ["core:entries.edit"]);
  for (let i = 1; i < R.MAX_CUSTOM_ROLES; i++) await prisma.role.create({ data: { key: `r-fill-${i}`, name: `Fill ${i}`, description: "", system: false, rights: "[]" } });
  assert.equal((await R.duplicateRole(T.owner.id, id, {})).reason, "limit");
});

// ─── rename, rights, delete, escalation ──────────────────────────────────────

test("rename and rights: the matrix form can never post a reserved or unknown right, even crafted; an update never gives what the person lacks", async () => {
  const id = await make("Moderation", ["core:entries.edit"]);
  assert.equal((await R.updateRole(T.owner.id, id, { name: "Community team", description: "", rights: ["core:entries.edit"] })).ok, true);
  assert.equal((await roleRow(id)).name, "Community team");
  for (const bad of [["core:team"], ["core:roles"], ["core:backup", "core:entries.edit"], ["nope:nothing"], ["core:security"]]) {
    assert.equal((await R.updateRole(T.owner.id, id, { name: "Community team", rights: bad })).reason, "rights", bad.join());
    assert.equal((await R.createRole(T.owner.id, { name: "Crafted", rights: bad })).reason, "rights", bad.join());
  }
  assert.deepEqual(JSON.parse((await roleRow(id)).rights), ["core:entries.edit"], "nothing was half-saved");
  assert.equal((await R.updateRole(T.coord.id, id, { name: "Community team", rights: ["core:entries.edit", PHONE] })).reason, "rights");
  const phone = await make("Phone desk", [PHONE]);
  assert.equal((await R.updateRole(T.coord.id, phone, { name: "Phone desk 2", rights: [PHONE] })).reason, "rights", "a role above the person cannot be remodelled");
  const sys = await prisma.role.findUnique({ where: { key: "admin" } });
  assert.equal((await R.updateRole(T.owner.id, sys.id, { name: "Hacked", rights: [] })).reason, "system");
  assert.equal((await R.deleteRole(T.owner.id, sys.id, null)).reason, "system");
  const owner = await prisma.role.findUnique({ where: { key: "owner" } });
  assert.equal((await R.deleteRole(T.owner.id, owner.id, null)).reason, "system");
});

test("delete: the people who hold the role are moved to the chosen role; no replacement, the owner role or a role above the person is refused", async () => {
  const id = await make("Moderation", ["core:entries.edit"]);
  const other = await make("Reviewers", ["core:entries.edit"]);
  await prisma.userRole.create({ data: { userId: T.editor.id, roleId: id } });
  assert.equal((await R.deleteRole(T.owner.id, id, null)).reason, "inUse");
  const ownerRole = await prisma.role.findUnique({ where: { key: "owner" } });
  assert.equal((await R.deleteRole(T.owner.id, id, ownerRole.id)).reason, "replacement");
  assert.equal((await R.deleteRole(T.owner.id, id, id)).reason, "replacement");
  const done = await R.deleteRole(T.owner.id, id, other);
  assert.deepEqual([done.ok, done.moved], [true, 1]);
  assert.equal(await prisma.userRole.count({ where: { userId: T.editor.id, roleId: other } }), 1);
  assert.equal(await roleRow(id), null);
  assert.equal(await auditCount("role.delete"), 1);
  const phone = await make("Phone desk", [PHONE]);
  assert.equal((await R.deleteRole(T.coord.id, phone, null)).reason, "rights");
});

test("escalation: a person cannot give themselves a role, and assigning a role above one's rights is refused", async () => {
  const phone = await make("Phone desk", [PHONE]);
  assert.equal((await R.setUserRoles(T.coord.id, T.coord.id, [phone])).reason, "owner", "nobody edits their own roles");
  assert.equal((await R.setUserRoles(T.coord.id, T.editor.id, [phone])).reason, "rights");
  assert.equal((await R.setUserRoles(T.admin.id, T.editor.id, [phone])).reason, "denied");
});

// ─── the pure view ───────────────────────────────────────────────────────────

const catalogue = () => A.currentCatalogue();
const text = { coreTitle: "Core", reservedTitle: "Reserved", moduleTitle: (r) => r.moduleId, label: (r) => r.id };

test("the edit matrix offers only rights the person holds, never a reserved one; the overview lists the reserved ones as locked", async () => {
  const cat = await catalogue();
  const held = new Set(cat.filter((r) => !r.reserved && r.id !== PHONE).map((r) => r.id));
  const edit = V.matrixGroups(cat, text, { reserved: false, keep: (r) => held.has(r.id) });
  const offered = edit.flatMap((g) => g.rights.map((r) => r.id));
  assert.ok(offered.length > 0);
  for (const id of offered) { assert.equal(Rt.isReserved(id), false, id); assert.ok(held.has(id), id); }
  assert.ok(!offered.includes(PHONE));
  const over = V.matrixGroups(cat, text, { reserved: true });
  const all = over.flatMap((g) => g.rights);
  for (const id of Rt.CORE_RESERVED) assert.equal(M.cellState({ id: "r", name: "r" }, all.find((x) => x.id === id), new Set([id])), "locked", `${id} is locked for a custom role, even if the data says it is held`);
  assert.deepEqual(M.editableSelection(over, [...Rt.CORE_RESERVED, "core:entries.edit"]), ["core:entries.edit"]);
});

test("roleEditable and roleCopyable mirror the server rules", async () => {
  const cat = await catalogue();
  const heldAll = new Set(cat.map((r) => r.id));
  const heldNoPhone = new Set(cat.filter((r) => r.id !== PHONE).map((r) => r.id));
  const custom = { system: false, key: "r-x", rights: [PHONE] };
  assert.equal(V.roleEditable(custom, heldAll), true);
  assert.equal(V.roleEditable(custom, heldNoPhone), false);
  assert.equal(V.roleEditable({ system: true, key: "admin", rights: [] }, heldAll), false);
  assert.equal(V.roleCopyable({ system: true, key: "owner", rights: [] }, heldAll, cat), false);
  assert.equal(V.roleCopyable({ system: true, key: "admin", rights: [] }, heldNoPhone, cat), true);
  assert.equal(V.roleCopyable(custom, heldNoPhone, cat), false);
});

test("roleGrants: built-in roles by level (owner holds the reserved), custom roles by their list without reserved or unknown entries", async () => {
  const cat = await catalogue();
  const roles = await R.listRoles();
  const row = await prisma.role.create({ data: { key: "r-dirty", name: "Dirty", description: "", system: false, rights: JSON.stringify(["core:team", "core:entries.edit", "ghost:x"]) } });
  const roles2 = await R.listRoles();
  const g = V.roleGrants(roles2, cat);
  assert.deepEqual(g[row.id], ["core:entries.edit"]);
  const owner = roles.find((r) => r.key === "owner");
  assert.ok(V.roleGrants(roles, cat)[owner.id].includes("core:team"));
  const admin = roles.find((r) => r.key === "admin");
  assert.ok(!V.roleGrants(roles, cat)[admin.id].includes("core:team"));
});

// ─── wiring ──────────────────────────────────────────────────────────────────

test("wiring: the roles route has its access row, its menu entry points at it, the old tab address is redirected", () => {
  assert.equal(L.ROLES_HREF, "/admin/users/roles");
  assert.deepEqual(AA.needOf("/admin/users/roles"), { right: "core:roles" });
  assert.equal(AA.needOf("/admin/users"), "admin");
  assert.ok(fs.existsSync("src/app/admin/(panel)/users/roles/page.tsx"));
  const page = read("src/app/admin/(panel)/users/roles/page.tsx");
  assert.match(page, /adminCtx\(\{ right: "core:roles" \}\)/);
  assert.match(page, /adminTitle\(/);
  assert.doesNotMatch(page, /<title/);
  const team = read("src/app/admin/(panel)/users/page.tsx");
  assert.match(team, /LegacyHash map=\{\{ roles: ROLES_HREF \}\}/);
  assert.match(team, /<LinkTabs/);
  assert.doesNotMatch(team, /<Tabs/);
  assert.match(team, /invite\.manageRoles/);
});

test("wiring: the roles panel edits rights through the matrix, duplicates and deletes from the row menu, and every mutation uses the existing gated actions", () => {
  const panel = read("src/app/admin/(panel)/users/roles/RolesPanel.tsx");
  assert.match(panel, /<RightsMatrix[^>]*editRoleId=\{r\.id\}/);
  assert.match(panel, /duplicateRoleAction/);
  assert.match(panel, /deleteRoleAction/);
  assert.match(panel, /updateRoleAction/);
  assert.match(panel, /createRoleAction/);
  assert.match(panel, /keep: \(r\) => held\.has\(r\.id\)/, "only rights the person holds are offered");
  assert.match(panel, /reserved: false/);
  const actions = read("src/app/admin/(panel)/users/actions.ts");
  for (const fn of ["createRoleAction", "updateRoleAction", "deleteRoleAction", "duplicateRoleAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`)).split("\n}\n")[0];
    assert.match(body, /adminCtx\(\{ right: "core:roles" \}\)/, fn);
    assert.match(body, /user\.id/, `${fn} passes the session person, never a form value`);
    assert.doesNotMatch(body, /formData\.get\("(actor|userId)"\)/, fn);
  }
  const matrix = read("src/components/admin/RightsMatrix.tsx");
  assert.match(matrix, /name = "right"/);
});

test("wiring: the Team page keeps its gates and offers the invitation honestly", () => {
  const team = read("src/app/admin/(panel)/users/page.tsx");
  assert.match(team, /adminCtx\("admin"\)/);
  assert.match(team, /invite\.submit\.link/, "no mail: the button says it creates a link");
  assert.match(team, /initialQuery=/, "the people count of a role opens the team list on that role");
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  assert.equal(fr["invite.copy"], "Copier le lien d'invitation");
  assert.equal(en["invite.copy"], "Copy the invitation link");
  const keys = ["users.tabs.label", "roles.intro", "roles.group.reserved", "roles.duplicate", "roles.duplicateTitle", "roles.duplicateSubmit", "roles.copyName", "roles.duplicated", "roles.deleteTitle", "roles.deleteLoses", "roles.deleteLoses.one", "roles.matrix.title", "invite.button.link", "invite.submit.link", "invite.manageRoles", "audit.action.role.duplicate", ...Rt.CORE_RESERVED.map((k) => `right.${k.replace(":", ".")}`)];
  for (const k of keys) { assert.ok(en[k], k); assert.ok(fr[k], k); assert.deepEqual((en[k].match(/\{\w+\}/g) ?? []).sort(), (fr[k].match(/\{\w+\}/g) ?? []).sort(), `${k}: same variables`); }
  assert.equal(Object.keys(en).at(-1), "settings.contrast.accent2");
});
