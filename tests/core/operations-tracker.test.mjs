// Suivi d'opération (src/core/operations) : étapes honnêtes, bornes, un seul lancement à la fois, droits, « trou noir », aucune donnée sensible.
import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const T = await import("@/core/operations/tracker");
const { coreUpdateSnapshot, CORE_STEPS } = await import("@/core/operations/coreUpdate");
const { sanitizeFieldErrors } = await import("@/core/fieldErrors");

const ME = { email: "emma@example.org", owner: false };
const OWNER = { email: "olive@example.org", owner: true };
const OTHER = { email: "autre@example.org", owner: false };
const id = (n) => `op-${String(n).padStart(20, "0")}`;
const gate = () => { let go; const p = new Promise((r) => { go = r; }); return { p, go }; };
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => T.resetOperations());

test("étapes : seules les étapes annoncées par le type d'opération font avancer la barre ; hors opération, aucun effet", async () => {
  T.opStep("download");   // hors opération : sans effet, sans erreur
  const g = gate();
  const run = T.runOperation({ kind: "install", key: "install:monmodule", owner: ME.email, opId: id(1) }, async () => { T.opStep("download"); await g.p; T.opStep("verify"); T.opStep("n-importe-quoi"); return "ok"; });
  await tick();
  let s = T.readOperation(id(1), ME);
  assert.equal(s.state, "running");
  assert.equal(s.step, "download");
  assert.equal(s.stepIndex, 1);
  assert.deepEqual(s.steps, ["download", "verify", "deps", "activate", "data"]);
  assert.equal(s.fraction, 0, "la première étape est en cours, aucune n'est finie");
  g.go();
  const r = await run;
  s = T.readOperation(id(1), ME);
  assert.equal(r.result, "ok");
  assert.equal(s.state, "done");
  assert.equal(s.fraction, 1);
  assert.equal(s.step, "verify", "une étape inconnue est ignorée (jamais de fausse étape)");
});

test("fraction : (étapes finies) / (étapes) ; avec « module N sur M » la part des modules finis s'ajoute", async () => {
  const g = gate();
  const run = T.runOperation({ kind: "modules-update", key: "modules-update:all", owner: ME.email, opId: id(2), unitTotal: 4 }, async () => {
    T.opUnit(2, 4, "Agenda");
    T.opStep("deps");   // 3e étape sur 5
    await g.p;
  });
  await tick();
  const s = T.readOperation(id(2), ME);
  assert.deepEqual(s.unit, { index: 2, total: 4, name: "Agenda" });
  assert.ok(Math.abs(s.fraction - (1 + 2 / 5) / 4) < 1e-9, String(s.fraction));
  g.go(); await run;
});

test("un seul lancement à la fois par clé : le second appel rejoint l'opération en cours et reçoit son résultat", async () => {
  const g = gate();
  let launched = 0;
  const first = T.runOperation({ kind: "install", key: "install:monmodule", owner: ME.email, opId: id(3) }, async () => { launched++; await g.p; return { n: 1 }; });
  await tick();
  const second = T.runOperation({ kind: "install", key: "install:monmodule", owner: ME.email, opId: id(4) }, async () => { launched++; return { n: 2 }; });
  await tick();
  g.go();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(launched, 1);
  assert.equal(a.joined, false);
  assert.equal(b.joined, true);
  assert.deepEqual(b.result, { n: 1 });
  assert.equal(T.readOperation(id(4), ME)?.id, id(3), "l'identifiant du second clic suit l'opération rejointe");
  // Une clé différente n'est pas gênée ; une fois finie, la clé est libre.
  const again = await T.runOperation({ kind: "install", key: "install:monmodule", owner: ME.email }, async () => "neuf");
  assert.equal(again.joined, false);
  assert.equal(again.result, "neuf");
});

test("l'opération continue sans personne pour l'attendre, et un échec est noté sans secret ni chemin", async () => {
  const g = gate();
  let finished = false;
  void T.runOperation({ kind: "backup", key: "backup:x", owner: ME.email, opId: id(5) }, async () => { await g.p; finished = true; return 1; });
  await tick();
  g.go(); await tick(); await tick();
  assert.equal(finished, true);
  await assert.rejects(T.runOperation({ kind: "restore", key: "restore", owner: ME.email, opId: id(6) }, async () => { throw new Error("boom /home/site/data/secret.db jeton=abcdefghijklmnopqrstuvwxyz0123456789ABCD"); }));
  const s = T.readOperation(id(6), ME);
  assert.equal(s.state, "failed");
  const bad = await T.runOperation({ kind: "install", key: "install:y", owner: ME.email, opId: id(7) }, async () => "x", () => ({ ok: false, error: "échec à /home/site/data/secret.db avec abcdefghijklmnopqrstuvwxyz0123456789ABCD" }));
  assert.equal(bad.result, "x");
  const e = T.readOperation(id(7), ME).error;
  assert.ok(!/\/home|secret\.db|abcdefghijklmnop/.test(e), e);
  assert.equal(T.safeText("mot ".repeat(400)).length, 300);
  assert.equal(T.safeText("a".repeat(1000)), "…", "un long identifiant opaque (jeton possible) est masqué");
  assert.equal(T.safeText("lu dans C:\\Users\\emma\\site.db"), "lu dans …");
});

test("droits : le suivi d'une personne n'est lisible que par elle ou par un propriétaire ; inconnu, interdit et mal formé ont la même réponse", async () => {
  await T.runOperation({ kind: "install", key: "install:a", owner: ME.email, opId: id(8) }, async () => 1);
  assert.ok(T.readOperation(id(8), ME));
  assert.ok(T.readOperation(id(8), OWNER));
  assert.equal(T.readOperation(id(8), OTHER), null);
  assert.equal(T.readOperation(id(99), ME), null, "inconnu");
  assert.equal(T.readOperation("../../etc/passwd", OWNER), null, "identifiant mal formé");
  assert.equal(T.readOperation("court", OWNER), null);
  const s = JSON.stringify(T.readOperation(id(8), ME));
  assert.ok(!/owner|emma@|promise|key/.test(s), "ni propriétaire, ni clé, ni promesse dans la réponse");
});

test("un identifiant déjà pris par une autre personne n'est jamais repris (pas de lecture du suivi d'autrui)", async () => {
  await T.runOperation({ kind: "install", key: "install:a", owner: ME.email, opId: id(9) }, async () => 1);
  const r = await T.runOperation({ kind: "install", key: "install:b", owner: OTHER.email, opId: id(9) }, async () => 2);
  assert.notEqual(r.id, id(9));
  assert.equal(T.readOperation(id(9), OTHER), null);
});

test("bornes : au plus MAX_OPS opérations (les plus anciennes finies sont oubliées), refus quand tout tourne encore", async () => {
  for (let i = 0; i < T.MAX_OPS; i++) await T.runOperation({ kind: "install", key: `install:m${i}`, owner: ME.email }, async () => i);
  assert.equal(T.operationCount(), T.MAX_OPS);
  await T.runOperation({ kind: "install", key: "install:encore", owner: ME.email }, async () => 0);
  assert.equal(T.operationCount(), T.MAX_OPS, "une ancienne a été oubliée");
  T.resetOperations();
  const gates = [];
  for (let i = 0; i < T.MAX_OPS; i++) { const g = gate(); gates.push(g); void T.runOperation({ kind: "install", key: `install:r${i}`, owner: ME.email }, () => g.p); }
  await tick();
  await assert.rejects(T.runOperation({ kind: "install", key: "install:trop", owner: ME.email }, async () => 0), T.OperationBusy);
  gates.forEach((g) => g.go());
  await tick();
});

test("expiration : une opération finie est oubliée après le délai ; une opération « en cours » trop longtemps est déclarée perdue", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    await T.runOperation({ kind: "install", key: "install:a", owner: ME.email, opId: id(10) }, async () => 1);
    const g = gate();
    void T.runOperation({ kind: "backup", key: "backup:long", owner: ME.email, opId: id(11) }, () => g.p);
    await tick();
    mock.timers.tick(T.FINISHED_TTL_MS + 1000);
    assert.equal(T.readOperation(id(10), ME), null, "finie et ancienne : oubliée");
    assert.equal(T.readOperation(id(11), ME).state, "running");
    mock.timers.tick(T.MAX_RUN_MS);
    const lost = T.readOperation(id(11), ME);
    assert.equal(lost.state, "failed");
    assert.equal(lost.error, "lost");
    g.go();
  } finally { mock.timers.reset(); }
});

test("trou noir : rejoindre une opération qui ne finit jamais s'arrête à la borne au lieu d'attendre sans fin", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const never = new Promise(() => {});
    void T.runOperation({ kind: "install", key: "install:trou", owner: ME.email, opId: id(12) }, () => never);
    await tick();
    const join = T.runOperation({ kind: "install", key: "install:trou", owner: ME.email }, async () => 0);
    const check = assert.rejects(join, T.OperationWaitTimeout);
    mock.timers.tick(T.JOIN_WAIT_MS + 1);
    await check;
  } finally { mock.timers.reset(); }
});

test("mise à jour du site : suivi lu sur le disque (survit au redémarrage), étapes nommées, code d'erreur court sans chemin", () => {
  const run = coreUpdateSnapshot({ status: "running", step: "migrate", target: "v1.2.0", chain: { index: 2, total: 3, steps: ["v1.1.0", "v1.2.0", "v1.3.0"] }, startedAt: 1 });
  assert.deepEqual(run.steps, [...CORE_STEPS]);
  assert.equal(run.stepIndex, CORE_STEPS.indexOf("migrate") + 1);
  assert.deepEqual([run.unit.index, run.unit.total], [2, 3]);
  assert.ok(run.fraction > 1 / 3 && run.fraction < 2 / 3);
  assert.equal(run.restarting, false);
  const restart = coreUpdateSnapshot({ status: "running", step: "restarting", expectedVersion: "0.2.1", startedAt: 1 });
  assert.equal(restart.restarting, true);
  assert.equal(restart.expectedVersion, "0.2.1");
  const failed = coreUpdateSnapshot({ status: "failed", error: "step-failed:/opt/curiosa/data/x", rolledBack: true });
  assert.equal(failed.state, "failed");
  assert.ok(!/[\/\\ ]/.test(failed.error), failed.error);
  assert.equal(failed.fraction, null);
  assert.equal(coreUpdateSnapshot({ status: "success", step: "done" }).fraction, 1);
});

test("erreurs par champ : nettoyées, bornées (20 champs, 300 caractères), clés sûres seulement", () => {
  assert.equal(sanitizeFieldErrors(null), undefined);
  assert.equal(sanitizeFieldErrors([]), undefined);
  assert.equal(sanitizeFieldErrors({ "../x": "non", ok: "" }), undefined);
  assert.deepEqual(sanitizeFieldErrors({ "items.2.href": "  Écrivez\nune adresse  ", n: 4 }), { "items.2.href": "Écrivez une adresse" });
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, "m"]));
  assert.equal(Object.keys(sanitizeFieldErrors(many)).length, 20);
  assert.equal(sanitizeFieldErrors({ a: "x".repeat(1000) }).a.length, 300);
});
