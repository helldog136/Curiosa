import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const S = await import("@/core/services/store");
beforeEach(() => db.reset());
after(() => db.close());

const A = S.createStore("inst-a");
const B = S.createStore("inst-b");
const rows = (n, key) => Array.from({ length: n }, (_, i) => ({ data: { i }, ...(key ? { key: typeof key === "function" ? key(i) : key } : {}) }));

async function walk(store, collection, opts) {
  const seen = []; let cursor = null; let pages = 0;
  do {
    const p = await store.page(collection, { ...opts, cursor, limit: 100 });
    seen.push(...p.items.map((r) => r.id)); cursor = p.next; pages++;
    assert.ok(pages < 100, "pas de boucle infinie");
  } while (cursor);
  return { seen, pages };
}

test("pagination : 1 200 lignes de même createdAt, parcours complet sans doublon ni trou, dans les deux sens", async () => {
  const ids = await A.addMany("c", rows(1200));
  assert.equal(new Set(ids).size, 1200);
  assert.equal(new Set((await db.prisma.moduleRecord.findMany({ select: { createdAt: true } })).map((r) => r.createdAt.getTime())).size, 1, "tous le même createdAt");
  const desc = await walk(A, "c", { order: "desc" });
  const asc = await walk(A, "c", { order: "asc" });
  assert.equal(desc.seen.length, 1200); assert.equal(new Set(desc.seen).size, 1200);
  assert.equal(asc.seen.length, 1200); assert.equal(new Set(asc.seen).size, 1200);
  assert.deepEqual([...desc.seen].reverse(), asc.seen, "le sens inverse donne la même suite");
  assert.deepEqual(asc.seen, ids, "ordre croissant = ordre d'insertion de addMany");
  assert.equal(desc.pages, 12);
});

test("pagination : des lignes ajoutées ou retirées entre deux pages ne créent ni doublon ni trou pour ce qui reste", async () => {
  await A.addMany("c", rows(250));
  const first = await A.page("c", { limit: 100, order: "asc" });
  await A.remove(first.items[99].id);                 // la dernière ligne vue disparaît
  await A.add("c", { late: true });                  // une ligne arrive
  const rest = []; let cursor = first.next;
  while (cursor) { const p = await A.page("c", { limit: 100, order: "asc", cursor }); rest.push(...p.items); cursor = p.next; }
  assert.equal(rest.length, 151);                     // 150 restantes + la nouvelle
  assert.equal(new Set([...first.items, ...rest].map((r) => r.id)).size, 251, "aucun doublon : 250 d'origine + 1 nouvelle");
});

test("pagination : createdAt variés et identiques mélangés ; limite bornée ; curseur illisible = page vide", async () => {
  for (let t = 0; t < 3; t++) {
    const base = new Date(Date.UTC(2026, 0, 1 + t));
    for (let i = 0; i < 40; i++) await db.prisma.moduleRecord.create({ data: { instanceId: "inst-a", collection: "m", data: "{}", createdAt: base } });
  }
  const { seen } = await walk(A, "m", { order: "desc" });
  assert.equal(new Set(seen).size, 120);
  const big = await A.page("m", { limit: 99999 });
  assert.equal(big.items.length, 120);
  assert.equal((await A.page("m", { limit: 0 })).items.length, 1, "limite minimale 1");
  assert.equal((await A.page("m")).items.length, 100, "défaut 100");
  for (const bad of ["%%%", "abc", Buffer.from("pas-de-barre").toString("base64url"), Buffer.from("nope|x").toString("base64url"), "x".repeat(1000)]) {
    assert.deepEqual(await A.page("m", { cursor: bad }), { items: [], next: null }, bad.slice(0, 20));
  }
});

test("plafonds : page ≤ 1 000, list ≤ 10 000 (avertissement unique), limit 1000 et 5000 des appels existants valides", async () => {
  await db.prisma.moduleRecord.createMany({ data: Array.from({ length: 10_050 }, (_, i) => ({ instanceId: "inst-a", collection: "big", data: "{}", createdAt: new Date(1_700_000_000_000 + i) })) });
  assert.equal((await A.page("big", { limit: 5000 })).items.length, 1000);
  assert.equal((await A.list("big", { limit: 1000 })).length, 1000);
  assert.equal((await A.list("big", { limit: 5000 })).length, 5000);
  const warn = console.warn; const warnings = []; console.warn = (m) => warnings.push(m);
  try {
    assert.equal((await A.list("big", { limit: 50_000 })).length, 10_000);
    assert.equal((await A.list("big", { limit: 50_000 })).length, 10_000);
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1, "un seul avertissement par instance");
  assert.equal((await A.list("big")).length, 100, "défaut inchangé");
  const newest = await A.list("big", { limit: 1 });
  assert.equal(newest[0].createdAt.getTime(), 1_700_000_000_000 + 10_049, "list reste du plus récent au plus ancien");
});

test("key : add/update/getByKey/listByKey, la plus ancienne gagne, update sans key la garde, key:null l'efface", async () => {
  const first = await A.add("n", { v: 1 }, { key: "twitch:abc" });
  await new Promise((r) => setTimeout(r, 5));   // createdAt a la milliseconde : on sépare l'ancien du récent
  await A.addMany("n", [{ data: { v: 2 }, key: "twitch:abc" }, { data: { v: 3 }, key: "twitch:other" }, { data: { v: 4 } }]);
  assert.equal((await A.getByKey("n", "twitch:abc")).id, first, "le plus ancien");
  assert.equal((await A.getByKey("n", "absent")), null);
  assert.equal((await B.getByKey("n", "twitch:abc")), null, "isolation entre instances");
  assert.equal((await A.getByKey("autre", "twitch:abc")), null, "isolation entre collections");
  const l = await A.listByKey("n", "twitch:abc");
  assert.deepEqual(l.items.map((r) => r.data.v), [2, 1], "plus récent d'abord"); assert.equal(l.next, null);
  const p1 = await A.listByKey("n", "twitch:abc", { limit: 1 });
  assert.equal(p1.items.length, 1); assert.ok(p1.next);
  assert.equal((await A.listByKey("n", "twitch:abc", { limit: 1, cursor: p1.next })).items.length, 1);
  assert.equal((await A.get(first)).key, "twitch:abc");
  await A.update(first, { v: 10 });
  assert.equal((await A.get(first)).key, "twitch:abc", "key absente = inchangée");
  await A.update(first, { v: 11 }, { key: "autre" });
  assert.equal((await A.get(first)).key, "autre");
  await A.update(first, { v: 12 }, { key: null });
  assert.equal((await A.get(first)).key, null);
  assert.equal((await A.list("n")).find((r) => r.data.v === 4).key, null);
});

test("key : 200 caractères au plus, texte seulement", async () => {
  await A.add("n", {}, { key: "k".repeat(200) });
  await assert.rejects(() => A.add("n", {}, { key: "k".repeat(201) }), /key/);
  await assert.rejects(() => A.addMany("n", [{ data: {} }, { data: {}, key: "k".repeat(201) }]), /key/);
  assert.equal(await A.count("n"), 1, "rien d'écrit par l'appel refusé");
  assert.equal(S.createStore("inst-a") && (await A.add("n", {}, { key: "" })) && (await A.list("n", { limit: 1 }))[0].key, null, "chaîne vide = pas de clé");
});

test("addMany : ids dans l'ordre, 5 000 au plus, vide = rien, tranches de 500 en une transaction", async () => {
  assert.deepEqual(await A.addMany("c", []), []);
  const ids = await A.addMany("c", rows(1234));
  assert.equal(ids.length, 1234);
  assert.equal(await A.count("c"), 1234);
  assert.deepEqual((await A.page("c", { order: "asc", limit: 1000 })).items.map((r) => r.id), ids.slice(0, 1000), "ids rendus dans l'ordre des lignes");
  await assert.rejects(() => A.addMany("c", rows(5001)), /5000/);
  assert.equal((await A.addMany("c", rows(5000))).length, 5000);
  assert.equal((await B.addMany("c", rows(3)), await B.count("c")), 3);
});

test("addMany : atomique — une tranche qui échoue (déclencheur SQLite) → 0 ligne, même pour les tranches déjà passées", async () => {
  await db.prisma.$executeRawUnsafe(`CREATE TRIGGER boom BEFORE INSERT ON "ModuleRecord" WHEN NEW."key" = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  try {
    const list = rows(1300); list[1250] = { data: {}, key: "boom" };   // 3e tranche
    await assert.rejects(() => A.addMany("c", list));
    assert.equal(await A.count("c"), 0);
  } finally { await db.prisma.$executeRawUnsafe(`DROP TRIGGER boom`); }
  assert.equal((await A.addMany("c", rows(10))).length, 10);
});

test("generation : 0 au départ ; add/addMany/update/remove ne la changent pas ; bump = max(avant, actuel)+1, jamais en arrière", async () => {
  assert.equal(await A.generation(), 0);
  await A.add("c", {}); await A.addMany("c", rows(5)); const id = await A.add("c", {}); await A.update(id, { a: 1 }); await A.remove(id);
  assert.equal(await A.generation(), 0);
  await S.bumpGenerations(["inst-a"]);
  assert.equal(await A.generation(), 1); assert.equal(await B.generation(), 0, "par instance");
  await S.bumpGenerations(["inst-a"], new Map([["inst-a", 7]]));
  assert.equal(await A.generation(), 8, "ne recule pas");
  assert.deepEqual([...(await S.readGenerations()).entries()], [["inst-a", 8]]);
});
