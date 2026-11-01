import test from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const L = await import("@/core/modules/loadLog");
const { loadModule } = await import("@/core/modules/registry");
import { after } from "node:test";
after(() => db.close());

const sink = () => { const lines = []; return { lines, error: (...a) => lines.push(a) }; };
const MIN = 60_000;

test("journal des échecs de chargement : une pile entière la première fois, puis rien, puis un compteur toutes les 10 minutes", () => {
  L.forgetLoadFailures();
  const s = sink();
  const err = new Error("boom");
  let t = 1_000_000;
  L.reportLoadFailure("monmodule", err, t, s);
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0][1], err, "l'erreur (donc la pile) est transmise telle quelle");
  for (let i = 0; i < 500; i++) L.reportLoadFailure("monmodule", err, t + i * 1000, s);   // 500 requêtes sur ~8 min
  assert.equal(s.lines.length, 1, "aucune autre ligne avant 10 minutes");
  L.reportLoadFailure("monmodule", err, t + 10 * MIN, s);
  assert.equal(s.lines.length, 2);
  assert.match(String(s.lines[1][0]), /501 more failures in the last 10 min/);
  assert.equal(s.lines[1].length, 1, "la ligne compteur ne porte pas de pile");
  L.reportLoadFailure("monmodule", err, t + 10 * MIN + 1, s);
  assert.equal(s.lines.length, 2);
  L.reportLoadFailure("monmodule", err, t + 20 * MIN + 5, s);
  assert.match(String(s.lines[2][0]), /2 more failures/);
});

test("journal : une raison différente ou un autre module est de nouveau écrit en entier ; une reprise réussie remet à zéro ; la mémoire est bornée", () => {
  L.forgetLoadFailures();
  const s = sink();
  L.reportLoadFailure("a", new Error("x"), 0, s);
  L.reportLoadFailure("a", new Error("y"), 1, s);
  L.reportLoadFailure("b", new Error("x"), 2, s);
  assert.equal(s.lines.length, 3);
  L.reportLoadFailure("a", new Error("x"), 3, s);
  assert.equal(s.lines.length, 3);
  L.forgetLoadFailures("a");
  L.reportLoadFailure("a", new Error("x"), 4, s);
  assert.equal(s.lines.length, 4);
  for (let i = 0; i < 1000; i++) L.reportLoadFailure(`m${i}`, new Error("z"), 5, s);
  assert.equal(s.lines.length, 1004, "tout reste journalisé une fois");
  L.reportLoadFailure("m0", new Error("z"), 6, s);   // la plus ancienne a été oubliée (borne 200) : réécrite
  assert.equal(s.lines.length, 1005);
  L.reportLoadFailure("m999", new Error("z"), 7, s);
  assert.equal(s.lines.length, 1005);
});

test("loadModule : un module introuvable chargé 50 fois (50 requêtes) n'écrit qu'une seule fois dans le journal", async () => {
  L.forgetLoadFailures();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    for (let i = 0; i < 50; i++) assert.equal(await loadModule({ id: "module-casse", version: "1.0.0", commit: null }), null);
  } finally { console.error = orig; }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /cannot load "module-casse"/);
});
