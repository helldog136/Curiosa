import test from "node:test";
import assert from "node:assert/strict";

const { StallTracker } = await import("@/core/modules/stallTracker");
const { stalledLine, slowLine, recoveredLine, resetLine, seconds, safeName } = await import("@/core/modules/stallMessages");
const { stallConfig, DEFAULT_SECTION_TIMEOUT_MS } = await import("@/core/modules/budget");

const CFG = { timeoutMs: 8000, slowMs: 3000, pauseMs: 16000, resetAfter: 3, resetEveryMs: 3_600_000, relogMs: 3_600_000 };
const unit = (over = {}) => ({ kind: "section", moduleId: "demo-mod", instanceKey: "demo-mod", name: "player", ...over });
function make(over = {}) {
  const clock = { t: 1_000_000 };
  const said = [], resets = [];
  const tracker = new StallTracker({ now: () => clock.t, say: (level, line) => said.push([level, line]), reset: (id) => resets.push(id) }, () => ({ ...CFG, ...over }));
  return { clock, said, resets, tracker };
}

test("phrases : la phrase demandée, mot pour mot, et pas de secret ni de retour à la ligne", () => {
  assert.equal(stalledLine(unit(), 8000), "[modules] La section « player » du module demo-mod (instance demo-mod) n'a pas répondu en 8 s ; elle est ignorée pour cette page.");
  assert.equal(slowLine(unit(), 3400, 3000, 8000), "[modules] La section « player » du module demo-mod (instance demo-mod) est lente : 3,4 s pour répondre (seuil : 3 s) ; passé 8 s, elle est ignorée pour cette page.");
  assert.equal(recoveredLine(unit()), "[modules] La section « player » du module demo-mod (instance demo-mod) répond de nouveau.");
  assert.equal(resetLine("autre-mod", 3), "[modules] Le module autre-mod est resté sans réponse 3 fois de suite : il est réinitialisé (son code est rechargé ; ses données et ses réglages ne sont pas touchés).");
  assert.equal(seconds(8000), "8 s"); assert.equal(seconds(400), "0,4 s"); assert.equal(seconds(3040), "3 s");
  assert.equal(safeName("a\nb c  d"), "a b c d");
  assert.ok(!stalledLine(unit({ name: "x\ny" }), 8000).includes("\n"));
});

test("configuration : 8 s par défaut, seuil « lent » 3 s, une variable facultative pour les développeurs (bornée), rien d'autre à régler", () => {
  const was = process.env.CURIOSA_SECTION_TIMEOUT_MS;
  try {
    delete process.env.CURIOSA_SECTION_TIMEOUT_MS;
    assert.equal(DEFAULT_SECTION_TIMEOUT_MS, 8000);
    assert.deepEqual(stallConfig(), CFG);
    process.env.CURIOSA_SECTION_TIMEOUT_MS = "2000";
    assert.deepEqual(stallConfig(), { ...CFG, timeoutMs: 2000, slowMs: 750, pauseMs: 4000 });
    for (const bad of ["abc", "5", "-1", "999999999", ""]) { process.env.CURIOSA_SECTION_TIMEOUT_MS = bad; assert.equal(stallConfig().timeoutMs, 8000, bad); }
  } finally { if (was === undefined) delete process.env.CURIOSA_SECTION_TIMEOUT_MS; else process.env.CURIOSA_SECTION_TIMEOUT_MS = was; }
});

test("blocage : une ligne par épisode, même avec des dizaines de visites ; pendant la pause on n'attend plus ; un seul essai à la fois ensuite", () => {
  const { clock, said, tracker } = make();
  assert.equal(tracker.gate(unit()), "run");
  for (let i = 0; i < 30; i++) tracker.stalled(unit());   // 30 visites simultanées qui dépassent le délai
  assert.equal(said.filter(([l]) => l === "error").length, 1);
  for (let i = 0; i < 30; i++) assert.equal(tracker.gate(unit()), "skip", "pendant la pause : omis aussitôt");
  clock.t += 16_000;
  assert.equal(tracker.gate(unit()), "run", "après la pause : un essai");
  assert.equal(tracker.gate(unit()), "skip", "pendant cet essai, les autres visites n'attendent pas");
  tracker.stalled(unit());
  assert.equal(said.filter(([l]) => l === "error").length, 1, "toujours la même ligne : même épisode");
  assert.equal(tracker.gate(unit()), "skip");
});

test("un blocage qui dure : rappel au plus une fois par heure", () => {
  const { clock, said, tracker } = make({ resetAfter: 1000 });
  tracker.stalled(unit());
  for (let i = 0; i < 100; i++) { clock.t += 20_000; if (tracker.gate(unit()) === "run") tracker.stalled(unit()); }   // ~33 minutes
  assert.equal(said.filter(([l]) => l === "error").length, 1);
  for (let i = 0; i < 100; i++) { clock.t += 20_000; if (tracker.gate(unit()) === "run") tracker.stalled(unit()); }   // ~66 minutes
  assert.equal(said.filter(([l]) => l === "error").length, 2);
});

test("fin de l'épisode : « répond de nouveau » une fois, puis un nouveau blocage est un nouvel épisode (nouvelle ligne)", () => {
  const { clock, said, tracker } = make();
  tracker.stalled(unit());
  clock.t += 16_000; assert.equal(tracker.gate(unit()), "run");
  tracker.answered(unit(), 120);
  assert.equal(said.filter(([, l]) => l.includes("répond de nouveau")).length, 1);
  assert.equal(tracker.gate(unit()), "run");
  tracker.answered(unit(), 100);
  assert.equal(said.filter(([, l]) => l.includes("répond de nouveau")).length, 1, "pas de répétition");
  tracker.stalled(unit());
  assert.equal(said.filter(([l]) => l === "error").length, 2);
});

test("lenteur : « lente » une fois par heure et par élément, jamais pour une réponse rapide", () => {
  const { clock, said, tracker } = make();
  tracker.answered(unit(), 2900); assert.equal(said.length, 0);
  tracker.answered(unit(), 3100); tracker.answered(unit(), 5000); tracker.answered(unit(), 3500);
  assert.equal(said.filter(([, l]) => l.includes("est lente")).length, 1);
  clock.t += 3_600_000;
  tracker.answered(unit(), 3500);
  assert.equal(said.filter(([, l]) => l.includes("est lente")).length, 2);
  tracker.answered(unit({ name: "autre" }), 4000);
  assert.equal(said.filter(([, l]) => l.includes("est lente")).length, 3, "un autre élément a sa propre ligne");
});

test("réinitialisation : après 3 épisodes de suite, une fois ; pas deux fois dans l'heure ; de nouveau possible une heure plus tard ; aucune si le module répond entre-temps", () => {
  const { clock, said, resets, tracker } = make();
  const episode = () => { clock.t += 16_000; assert.equal(tracker.gate(unit()), "run"); tracker.stalled(unit()); };
  tracker.stalled(unit());                    // épisode 1
  episode();                                  // 2
  assert.deepEqual(resets, []);
  episode();                                  // 3 -> réinitialisation
  assert.deepEqual(resets, ["demo-mod"]);
  assert.equal(said.filter(([, l]) => l.includes("est réinitialisé")).length, 1);
  assert.equal(tracker.gate(unit()), "run", "juste après : on retente aussitôt avec le code rechargé");
  tracker.stalled(unit());                    // 1 (le compte est reparti de zéro)
  episode(); episode();                       // 2, 3 -> trop tôt : pas de seconde réinitialisation dans l'heure
  assert.deepEqual(resets, ["demo-mod"]);
  clock.t += 3_600_000;
  episode(); episode(); episode();
  assert.deepEqual(resets, ["demo-mod", "demo-mod"], "une heure plus tard, c'est de nouveau permis");
  // Un module qui répond entre deux blocages repart de zéro.
  const b = make();
  b.tracker.stalled(unit()); b.clock.t += 16_000; b.tracker.gate(unit()); b.tracker.stalled(unit());
  b.clock.t += 16_000; b.tracker.gate(unit()); b.tracker.answered(unit(), 50);
  b.tracker.stalled(unit()); b.clock.t += 16_000; b.tracker.gate(unit()); b.tracker.stalled(unit());
  assert.deepEqual(b.resets, [], "2 + 2 épisodes séparés par une réponse : pas de réinitialisation");
});

test("réinitialisation : par module (deux modules bloqués = deux), et un échec de la réinitialisation est journalisé sans casser", () => {
  const clock = { t: 5 }; const said = [];
  const tr = new StallTracker({ now: () => clock.t, say: (l, x) => said.push(x), reset: () => { throw new Error("disque plein"); } }, () => ({ ...CFG, resetAfter: 1 }));
  tr.stalled(unit());
  assert.ok(said.some((l) => l.includes("Réinitialisation du module demo-mod impossible : disque plein")));
});
