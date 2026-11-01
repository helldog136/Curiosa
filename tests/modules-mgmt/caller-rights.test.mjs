import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Droits de l'appelant (`asCaller`, cœur 0.2.4) : un service reçoit les droits de la personne connectée SEULEMENT (1) pour une action d'administration qu'elle
// a déclenchée, (2) si l'appelant le demande (`{ asCaller: true }`), (3) pour une méthode que le fournisseur a listée dans `offers[].callerRights`, et
// (4) le fournisseur décide de SON droit avec `ctx.can`. Jamais pour un panneau, une route, une tâche, un service ou le MCP. Aucun réseau.
const db = await useTestDb();
const { prisma } = db;
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { parseManifest } = await import("@/core/modules/manifest");
const { createInstance } = await import("@/core/instanceService");
const { getInstanceById } = await import("@/core/instances");
const { buildContext, forViewer } = await import("@/core/modules/context");

after(() => db.close());

const BOOK = "demo.book";
const BOOK_CODE = `
const seen = () => (globalThis.__book ??= []);
const answer = (name) => async (ctx, a) => { seen().push({ name, can: ctx.can("categories.create") }); return ctx.can("categories.create") ? { ok: true, id: "c1" } : { ok: false, error: "denied" }; };
export default { services: { "${BOOK}": { createCategory: answer("createCategory"), wipe: answer("wipe"), list: answer("list") } } };`;
const viewer = (rights = [], level = "admin") => ({ id: "u1", email: "ada@example.org", name: "Ada", level, roles: [level], rights: new Set(rights), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });
const install = async (files) => assert.equal((await installModule(makeRepo(files).url, { dependencies: false })).ok, true);

let consumer;
async function setup({ callerRights = ["createCategory"] } = {}) {
  await install({ "module.json": { apiVersion: 2, id: "book", name: "Book", version: "1.0.0", main: "index.mjs", offers: [{ service: BOOK, ...(callerRights ? { callerRights } : {}) }], rights: [{ id: "categories.create", label: { fr: "Créer", en: "Create" }, default: { admin: false } }] }, "index.mjs": BOOK_CODE });
  await install({ "module.json": { apiVersion: 2, id: "cons", name: "Cons", version: "1.0.0", main: "index.mjs", requires: [{ service: BOOK }] }, "index.mjs": "export default {};" });
  await prisma.moduleInstance.deleteMany({ where: { moduleId: { in: ["book", "cons"] } } });
  for (const [id, nick] of [["book", "Carnet"], ["cons", "Consommateur"]]) await createInstance(prisma, { manifest: (await R.getModule(id)).manifest, nickname: nick, names: { fr: nick } });
  const inst = (await prisma.moduleInstance.findFirst({ where: { moduleId: "cons" } }));
  consumer = { mod: await R.getModule("cons"), instance: await getInstanceById(inst.id) };
}
const ctxFor = async () => buildContext(consumer.mod, consumer.instance, "fr");
const call = (ctx, opts, method = "createCategory") => ctx.api.services.call(BOOK, method, { label: "X" }, opts);
const last = () => globalThis.__book.at(-1);

beforeEach(async () => { await db.reset(); globalThis.__book = []; });

test("manifeste : callerRights est une liste de noms de méthodes (10 au plus) ; un cœur plus ancien l'ignore", () => {
  const m = (callerRights) => parseManifest({ apiVersion: 2, id: "xx", name: "X", version: "1.0.0", offers: [{ service: BOOK, callerRights }] });
  assert.equal(m(["createCategory"]).ok, true);
  assert.equal(m(["a b"]).ok, false);
  assert.equal(m(Array.from({ length: 11 }, (_, i) => `m${i}`)).ok, false);
  assert.deepEqual(m(["createCategory"]).manifest.offers[0].callerRights, ["createCategory"]);
});

test("action d'administration + asCaller + méthode listée + droit de la personne : le fournisseur voit ctx.can vrai ; audit écrit", async () => {
  await setup();
  const ctx = forViewer(await ctxFor(), viewer(["book:categories.create"]), { carryRights: true });
  assert.deepEqual(await call(ctx, { asCaller: true }), { ok: true, value: { ok: true, id: "c1" } });
  assert.equal(last().can, true);
  const log = await prisma.auditLog.findFirst({ where: { action: `module.${consumer.instance.key}.asCaller` } });
  assert.ok(log, "l'appel qui porte des droits est consigné");
  assert.equal(log.actor, "ada@example.org");
  assert.equal(log.target, `${BOOK}.createCategory`);
});

test("sans le droit : le fournisseur refuse (denied) ; le droit d'un AUTRE module ne vaut rien ; le propriétaire du site a tous les droits", async () => {
  await setup();
  const ctx = forViewer(await ctxFor(), viewer(["cons:categories.create", "other:categories.create"]), { carryRights: true });
  assert.deepEqual(await call(ctx, { asCaller: true }), { ok: true, value: { ok: false, error: "denied" } });
  assert.equal(last().can, false);
  const owner = forViewer(await ctxFor(), viewer([], "owner"), { carryRights: true });
  assert.equal((await call(owner, { asCaller: true })).value.ok, true);
});

test("sans asCaller, ou sans carryRights (panneau d'administration, route, tâche, MCP) : appel ordinaire, ctx.can reste faux", async () => {
  await setup();
  const rights = viewer(["book:categories.create"]);
  const carrying = forViewer(await ctxFor(), rights, { carryRights: true });
  assert.equal((await call(carrying, {})).value.ok, false, "pas demandé : pas de droits");
  assert.equal((await call(carrying, { asCaller: false })).value.ok, false);
  assert.equal((await call(carrying)).value.ok, false);
  const panel = forViewer(await ctxFor(), rights);   // un panneau : ctx.can du consommateur marche, mais ses appels de service ne portent rien
  assert.equal((await call(panel, { asCaller: true })).value.ok, false, "le rendu d'un panneau ne porte jamais de droits");
  const plain = await ctxFor();   // route publique, tâche, MCP, service : aucune personne
  assert.equal((await call(plain, { asCaller: true })).value.ok, false);
  assert.ok(globalThis.__book.every((x) => x.can === false));
  assert.equal(await prisma.auditLog.count({ where: { action: `module.${consumer.instance.key}.asCaller` } }), 0);
});

test("seules les méthodes listées par le fournisseur ; un fournisseur sans callerRights n'accepte rien", async () => {
  await setup();
  const ctx = forViewer(await ctxFor(), viewer(["book:categories.create"]), { carryRights: true });
  assert.equal((await call(ctx, { asCaller: true }, "wipe")).value.ok, false, "wipe n'est pas listée");
  assert.equal((await call(ctx, { asCaller: true }, "list")).value.ok, false);
  assert.equal(last().can, false);
  await db.reset(); globalThis.__book = [];
  await setup({ callerRights: null });
  const ctx2 = forViewer(await ctxFor(), viewer(["book:categories.create"]), { carryRights: true });
  assert.equal((await call(ctx2, { asCaller: true })).value.ok, false, "le fournisseur n'a rien listé");
});

test("la personne ne s'accroche pas au contexte suivant : un autre contexte de la même instance ne porte rien", async () => {
  await setup();
  forViewer(await ctxFor(), viewer(["book:categories.create"]), { carryRights: true });
  const other = await ctxFor();
  assert.equal((await call(other, { asCaller: true })).value.ok, false);
});

test("garde-fous du code : seules les deux exécutions d'adminAction demandent carryRights ; api.ts ne manipule jamais `viewer`", () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /carryRights\s*:\s*true/.test(fs.readFileSync(p, "utf8"))) files.push(p); } };
  walk("src");
  assert.deepEqual(files.sort(), ["src/app/admin/(panel)/instances/module-actions.ts", "src/core/modules/adminTransferDeps.ts"]);
  const api = fs.readFileSync("src/core/modules/api.ts", "utf8");
  assert.ok(!/viewer/.test(api));
  assert.ok(/asCaller/.test(api) && /caller\?\.person/.test(api));
});
