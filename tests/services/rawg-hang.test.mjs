import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

// Suspect n°1 de l'enquête « l'accueil ne répond plus » : le service RAWG du cœur garde 2 places et une table des demandes en cours.
// Si une requête ne se termine jamais (un `fetch` qui ignore son signal d'abandon, une base figée), AVANT la correction : la place n'était jamais rendue,
// l'entrée « en cours » restait pour toujours et chaque page demandant une jaquette (Planning → « Prochain stream ») attendait sans fin, alors que les autres pages répondaient.
const db = await useTestDb();
const R = await import("@/core/services/rawg");
beforeEach(async () => { await db.reset(); R.clearRawgCache(); R.setRawgLimits({ requestMs: 150, queueMs: 200, coverMs: 400 }); await R.saveRawgKey("cle-factice-0123456789abcdef"); });
after(() => { R.setRawgFetch(); R.setRawgLimits(); return db.close(); });

const settlesWithin = (promise, ms) => Promise.race([promise.then((v) => ({ done: true, v })), new Promise((r) => setTimeout(() => r({ done: false }), ms))]);

test("rawg : une requête qui ne se termine jamais ne bloque pas la demande — elle rend « unreachable » dans le délai", async () => {
  const log = console.error; console.error = () => {};
  try {
    R.setRawgFetch(() => new Promise(() => {}));   // ignore son signal d'abandon, ne répond jamais
    const out = await settlesWithin(R.rawgCover("Hades"), 1500);
    assert.equal(out.done, true, "la demande doit se terminer");
    assert.deepEqual(out.v, { status: "unreachable", url: null });
  } finally { console.error = log; }
});

test("rawg : les 2 places ne restent pas prises — une demande suivante, après la panne, est servie normalement", async () => {
  const log = console.error; console.error = () => {};
  try {
    R.setRawgFetch(() => new Promise(() => {}));
    // Trois titres en même temps : deux prennent les places, le troisième attend une place ; tous finissent.
    const all = await settlesWithin(Promise.all(["A", "B", "C"].map((t) => R.rawgCover(t))), 2500);
    assert.equal(all.done, true, "même la demande qui attend une place finit");
    assert.deepEqual(all.v.map((x) => x.status), ["unreachable", "unreachable", "unreachable"]);
    // La panne est finie : RAWG répond. Les places et la table « en cours » sont libres.
    R.setRawgFetch(async () => ({ status: 200, ok: true, json: async () => ({ results: [{ background_image: "https://media.rawg.io/x.jpg" }] }) }));
    const again = await settlesWithin(Promise.all(["A", "B", "C"].map((t) => R.rawgCover(t))), 1500);
    assert.equal(again.done, true);
    assert.deepEqual(again.v.map((x) => x.status), ["found", "found", "found"]);
  } finally { console.error = log; }
});

test("rawg : une demande qui partage la demande en cours d'un autre titre identique ne l'attend pas sans fin non plus", async () => {
  const log = console.error; console.error = () => {};
  try {
    R.setRawgFetch(() => new Promise(() => {}));
    const first = R.rawgCover("Hades");
    const second = R.rawgCover("hades");   // même titre : partage la demande en cours
    const out = await settlesWithin(Promise.all([first, second]), 1500);
    assert.equal(out.done, true);
    assert.deepEqual(out.v.map((x) => x.status), ["unreachable", "unreachable"]);
  } finally { console.error = log; }
});

test("rawg : une lecture de réponse qui ne finit pas (en-têtes reçus, corps jamais) est bornée aussi", async () => {
  const log = console.error; console.error = () => {};
  try {
    R.setRawgFetch(async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }));
    const out = await settlesWithin(R.rawgCover("Hades"), 1500);
    assert.equal(out.done, true);
    assert.equal(out.v.status, "unreachable");
  } finally { console.error = log; }
});
