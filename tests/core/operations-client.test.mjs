// Côté navigateur du suivi d'opération (logique pure) : lecture seulement pendant une opération lancée ici, pause onglet caché, arrêt, attente bornée du redémarrage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const C = await import("@/components/admin/operationClient");

function harness(responses, { hidden = () => false } = {}) {
  const timers = []; let now = 0; const seen = []; const calls = [];
  const events = { snaps: [], unknown: 0, unreachable: 0, giveUp: 0 };
  let i = 0;
  const poller = C.createPoller({
    fetchOp: async (id) => { calls.push(id); const r = responses[Math.min(i++, responses.length - 1)]; return typeof r === "function" ? r() : r; },
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
    isHidden: hidden,
    onSnapshot: (s) => events.snaps.push(s), onUnknown: () => events.unknown++, onUnreachable: () => events.unreachable++, onGiveUp: () => events.giveUp++,
  });
  const fire = async () => { const t = [...timers].reverse().find((x) => x.live); assert.ok(t, "un minuteur est attendu"); t.live = false; seen.push(t.ms); t.fn(); await new Promise((r) => setImmediate(r)); };
  return { poller, fire, events, calls, seen, advance: (ms) => { now += ms; }, live: () => timers.filter((t) => t.live).length };
}
const running = { status: 200, operation: { id: "x", kind: "install", state: "running", steps: ["a", "b"], step: "a", stepIndex: 1, unit: null, fraction: 0, error: null } };
const done = { status: 200, operation: { ...running.operation, state: "done", fraction: 1 } };

test("lecture : rien tant qu'aucune opération n'est lancée ; première lecture différée, délais croissants et plafonnés", async () => {
  const h = harness([running]);
  assert.equal(h.live(), 0, "aucun minuteur de fond");
  h.poller.start("op-0000000000000001");
  assert.equal(h.live(), 1);
  for (let k = 0; k < 12; k++) await h.fire();
  assert.equal(h.seen[0], C.POLL_FIRST_MS);
  assert.ok(h.seen.slice(1).every((ms, k, a) => k === 0 || ms >= a[k - 1]), "croissants");
  assert.equal(Math.max(...h.seen), C.POLL_MAX_MS);
  assert.equal(C.nextPollDelay(0), 700);
  assert.ok(C.nextPollDelay(100) <= C.POLL_MAX_MS);
});

test("lecture : s'arrête à la fin de l'opération (aucun minuteur restant)", async () => {
  const h = harness([running, done]);
  h.poller.start("op-0000000000000002");
  await h.fire(); await h.fire();
  assert.equal(h.events.snaps.length, 2);
  assert.equal(h.live(), 0);
  assert.equal(h.poller.active, false);
});

test("lecture : opération inconnue du serveur (404) → on le dit une fois et on s'arrête ; stop() ne laisse rien tourner", async () => {
  const h = harness([{ status: 404 }]);
  h.poller.start("op-0000000000000003");
  await h.fire();
  assert.equal(h.events.unknown, 1);
  assert.equal(h.live(), 0);
  const g = harness([running]);
  g.poller.start("op-0000000000000004");
  g.poller.stop();
  assert.equal(g.live(), 0);
  assert.equal(g.calls.length, 0);
});

test("lecture : trois échecs de suite (site qui redémarre) → « injoignable », on continue d'essayer avec patience", async () => {
  const h = harness([null, null, { status: 502 }, running]);
  h.poller.start("op-0000000000000005");
  for (let k = 0; k < 3; k++) await h.fire();
  assert.equal(h.events.unreachable, 1);
  assert.equal(h.live(), 1, "continue");
  await h.fire();
  assert.equal(h.events.snaps.length, 1);
});

test("lecture : onglet caché → aucune lecture ni minuteur ; reprise immédiate à la réapparition", async () => {
  let hidden = true;
  const h = harness([running], { hidden: () => hidden });
  h.poller.start("op-0000000000000006");
  await h.fire();
  assert.equal(h.calls.length, 0, "pas de lecture onglet caché");
  assert.equal(h.live(), 0, "pas de minuteur de fond");
  hidden = false;
  h.poller.visibilityChanged();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.length, 1);
});

test("lecture : abandon après la durée maximale", async () => {
  const h = harness([running]);
  h.poller.start("op-0000000000000007");
  h.advance(C.POLL_GIVE_UP_MS + 1);
  await h.fire();
  assert.equal(h.events.giveUp, 1);
  assert.equal(h.live(), 0);
});

test("identifiant d'opération et vue : 16 à 64 caractères sûrs ; jamais de pourcentage inventé", () => {
  assert.ok(C.isOpId(C.newOpId()));
  assert.ok(C.isOpId(C.newOpId({ getRandomValues: (a) => { a.fill(7); return a; } })), "sans randomUUID (page en http)");
  assert.ok(!C.isOpId("court") && !C.isOpId("a/b/c/d/e/f/g/h/i/j/k/l") && !C.isOpId(undefined));
  assert.equal(C.viewOf(null).percent, null);
  assert.equal(C.viewOf({ ...running.operation, fraction: null }).percent, null, "étapes inconnues : indéterminé");
  assert.equal(C.viewOf({ ...running.operation, fraction: 0.4 }).percent, 40);
  assert.equal(C.viewOf({ ...running.operation, unit: { index: 1, total: 1, name: "x" } }).unit, null, "« module 1 sur 1 » n'est pas affiché");
  assert.equal(C.viewOf({ ...running.operation, unit: { index: 2, total: 5, name: "x" } }).unit.index, 2);
  assert.equal(C.viewOf({ ...running.operation, unit: { index: 0, total: 5, name: "" } }).preparing, true);
});

test("redémarrage du site : attente bornée ; « de retour » dès que /api/health répond ; l'empreinte de version dit si c'est la nouvelle", async () => {
  let t = 0; const slept = [];
  const mk = (health) => ({ health, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, aborted: () => false });
  let n = 0;
  const back = await C.waitForSite(mk(async () => (++n < 4 ? null : { ok: true, versionHash: "nouveau" })), "ancien");
  assert.deepEqual(back, { state: "back", fresh: true });
  assert.ok(slept.every((ms, k, a) => k === 0 || ms >= a[k - 1]) && Math.max(...slept) <= 5000);
  t = 0;
  assert.deepEqual(await C.waitForSite(mk(async () => ({ ok: true, versionHash: "ancien" })), "ancien"), { state: "back", fresh: false });
  t = 0;
  assert.deepEqual(await C.waitForSite(mk(async () => { throw new Error("réseau"); }), "ancien"), { state: "timeout" }, "trou noir : s'arrête à la borne");
  assert.ok(t <= C.RESTART_WATCH_MAX_MS + 5000);
  assert.deepEqual(await C.waitForSite({ ...mk(async () => null), aborted: () => true }, null), { state: "aborted" });
});

test("composants : états accessibles (aria-busy, aria-live, rouet/barre sans animation si mouvement réduit), cible 44 px, pas de faux pourcentage", () => {
  const read = (f) => fs.readFileSync(`src/components/admin/${f}`, "utf8");
  const pending = read("PendingButton.tsx"), animated = read("AnimatedActionButton.tsx"), progress = read("OperationProgress.tsx"), kit = read("ActionKit.tsx");
  for (const src of [pending, animated]) assert.match(src, /aria-busy/);
  assert.match(pending, /role="status" aria-live="polite" className="sr-only"/);
  assert.match(animated, /role="status" aria-live="polite" className="sr-only"/);
  assert.match(pending, /min-h-11/);
  assert.match(animated, /min-h-1[12]/);
  assert.match(kit, /motion-safe:animate-spin/);
  assert.match(pending, /SHOW_BUSY_AFTER_MS/, "état « en cours » après un court délai");
  assert.match(pending, /disabled=\{disabled \|\| pending\}/, "inactif dès le clic : pas de double envoi");
  assert.match(kit, /invisible/, "largeur stable : les libellés sont superposés");
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-valuenow=\{known \? done : undefined\}/, "barre indéterminée : pas de valeur annoncée");
  assert.match(progress, /motion-safe:animate-pulse/);
  assert.match(fs.readFileSync("src/app/globals.css", "utf8"), /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.ok(!/setInterval/.test(read("useTrackedRun.ts") + read("operationClient.ts") + read("CoreUpdateProgress.tsx")), "aucun minuteur répétitif de fond");
});
