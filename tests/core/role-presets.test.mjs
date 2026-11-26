// ROLE PRESETS: only starting points. A preset fills the "New role" form; what is saved is an ordinary custom role (createRole), with no link back to the preset.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const R = await import("@/core/auth/roles");
const A = await import("@/core/auth/access");
const I = await import("@/core/auth/invitations");
const { ROLE_PRESETS, presetRights } = await import("@/core/auth/rolePresets");
const { isReserved, CORE_RESERVED } = await import("@/core/auth/rights");
after(() => db.close());

let T;
const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
beforeEach(async () => {
  await db.reset();
  T = { owner: await mk("olive", "owner"), coord: await mk("cora", "admin", { coordinator: true }), admin: await mk("adam", "admin") };
  await R.syncSystemAssignments();
});
const rightsOf = async (user) => (await A.accessOf(await prisma.user.findUnique({ where: { id: user.id } }))).rights;
const catalogue = () => A.currentCatalogue();

test("presets are plain data: delegable rights only, never a reserved right, labels in both languages", async () => {
  const cat = await catalogue();
  assert.ok(ROLE_PRESETS.length >= 3);
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  for (const p of ROLE_PRESETS) {
    for (const r of p.core) assert.equal(isReserved(r), false, `${p.id} ${r}`);
    const all = presetRights(p, cat, new Set(cat.map((r) => r.id)));
    for (const r of all) assert.equal(cat.find((c) => c.id === r).reserved, false, `${p.id} ${r}`);
    for (const k of ["name", "description"]) { assert.ok(en[`rolePreset.${p.id}.${k}`]); assert.ok(fr[`rolePreset.${p.id}.${k}`]); }
  }
  // even if the data were wrong, the function drops a reserved right
  const poisoned = { id: "x", core: [...CORE_RESERVED, "core:entries.edit"], moduleLocals: [] };
  assert.deepEqual(presetRights(poisoned, cat, new Set(cat.map((r) => r.id))), ["core:entries.edit"]);
});

test("a preset proposes only the rights the person holds (anti-elevation); the server checks again on save", async () => {
  const cat = await catalogue();
  const held = new Set(["core:entries.edit"]);
  const chief = ROLE_PRESETS.find((p) => p.id === "editor-in-chief");
  assert.deepEqual(presetRights(chief, cat, held), ["core:entries.edit"]);
  // a forged form that adds a right the actor does not hold, or a reserved one, is refused whole
  assert.equal((await R.createRole(T.coord.id, { name: "Moderator", rights: ["core:entries.edit", "core:backup"] })).reason, "rights");
  assert.equal((await R.createRole(T.admin.id, { name: "Moderator", rights: ["core:entries.edit"] })).reason, "denied", "the existing rule for who creates roles is unchanged");
});

test("create from a preset, rename, edit the rights: an ordinary role the owner owns", async () => {
  const cat = await catalogue();
  const p = ROLE_PRESETS.find((x) => x.id === "moderator");
  const rights = presetRights(p, cat, await rightsOf(T.owner));
  const made = await R.createRole(T.owner.id, { name: "Moderator", description: "Keeps the comments tidy.", rights });
  assert.equal(made.ok, true);
  const row = await prisma.role.findUnique({ where: { id: made.id } });
  assert.equal(row.system, false); assert.deepEqual(Object.keys(row).filter((k) => /preset/i.test(k)), [], "no hidden link to the preset");
  assert.equal((await R.updateRole(T.owner.id, made.id, { name: "Community team", description: "x", rights: ["core:entries.edit", "core:entries.publish"] })).ok, true);
  const after = await prisma.role.findUnique({ where: { id: made.id } });
  assert.equal(after.name, "Community team"); assert.deepEqual(JSON.parse(after.rights), ["core:entries.edit", "core:entries.publish"]);
  // a role built from scratch works the same way
  assert.equal((await R.createRole(T.owner.id, { name: "Photographer", rights: ["core:entries.edit"] })).ok, true);
});

test("a later change to a preset never alters a role that exists", async () => {
  const p = ROLE_PRESETS.find((x) => x.id === "contributor");
  const cat = await catalogue();
  const made = await R.createRole(T.owner.id, { name: "Contributor", rights: presetRights(p, cat, await rightsOf(T.owner)) });
  const before = (await prisma.role.findUnique({ where: { id: made.id } })).rights;
  const saved = p.core;
  try { Object.defineProperty(p, "core", { value: ["core:entries.edit", "core:entries.publish"], configurable: true }); } catch { /* frozen: nothing to change */ }
  assert.equal((await prisma.role.findUnique({ where: { id: made.id } })).rights, before);
  Object.defineProperty(p, "core", { value: saved, configurable: true });
});

test("a preset appears in the invitation picker only once it is a role; two sites configured differently", async () => {
  const cat = await catalogue();
  // site A: predefined roles only
  let ids = (await R.listRoles()).map((r) => r.key);
  assert.equal(ids.some((k) => /moderator|reviewer|contributor/.test(k)), false);
  // site B: the owner created two roles from presets, one renamed
  const m = await R.createRole(T.owner.id, { name: "Moderator", rights: presetRights(ROLE_PRESETS.find((x) => x.id === "moderator"), cat, await rightsOf(T.owner)) });
  const c = await R.createRole(T.owner.id, { name: "Fact-checker", rights: presetRights(ROLE_PRESETS.find((x) => x.id === "reviewer"), cat, await rightsOf(T.owner)) });
  ids = (await R.listRoles()).map((r) => r.key);
  assert.ok(ids.includes(m.key) && ids.includes(c.key));
  const inv = await I.createInvitation(T.coord.id, { email: "etoile_nord@example.org", roleId: m.id, origin: "https://site.example.org", mailConfigured: false });
  assert.equal(inv.ok, true);
  assert.equal(inv.roleName, "Moderator");
});
