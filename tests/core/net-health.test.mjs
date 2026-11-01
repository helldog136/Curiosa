// Bloc d'admin « santé » (netHealth) et branchement de `ctx.api.net` : phrases simples FR/EN, budget de page, faux contexte du kit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx, withFakeFetch, netReplies } from "../../testsupport/index.mjs";

const { describeNetHealth } = await import("@/core/netHealthText");
const N = await import("@/core/services/net");

const now = new Date(2026, 9, 20, 11, 0, 0).getTime(); // heure locale du serveur, comme l'admin
const at = (h, m) => new Date(2026, 9, 20, h, m, 0).getTime();
const states = {
  "ok.example.org": { host: "ok.example.org", state: "ok", since: at(9, 0) },
  "slow.example.org": { host: "slow.example.org", state: "slow", since: at(10, 42) },
  "rate.example.org": { host: "rate.example.org", state: "rate", since: at(10, 50), retryAt: at(11, 30) },
  "quota.example.org": { host: "quota.example.org", state: "quota", since: at(8, 0), retryAt: new Date(2026, 9, 21, 9, 0).getTime() },
  "down.example.org": { host: "down.example.org", state: "down", since: at(10, 15) },
};
const lookup = (h) => states[h] ?? null;
const items = [
  { host: "ok.example.org", label: "Service A" },
  { host: "slow.example.org", label: "Service B", lastGoodAt: new Date(at(10, 30)).toISOString() },
  { host: "rate.example.org", label: "Service C" },
  { host: "quota.example.org", label: "Service D" },
  { host: "DOWN.example.org", label: "Service E", lastGoodAt: new Date(at(10, 0)).toISOString() },
  { host: "never.example.org", label: "Service F" },
];

test("bloc santé en français : une phrase simple par service, l'heure de reprise, la date des données, et le message d'ensemble", () => {
  const v = describeNetHealth(items, "fr", { now, lookup });
  const t = v.lines.map((l) => l.text);
  assert.equal(v.title, "Services externes");
  assert.equal(t[0], "Service A répond normalement.");
  assert.match(t[1], /^Service B répond lentement depuis 10:42\. Les données affichées datent de 10:30\.$/);
  assert.match(t[2], /^Service C : trop de demandes, pause jusqu'à 11:30\.$/);
  assert.match(t[3], /^Service D : quota du jour épuisé, reprise à .*09:00\.$/);
  assert.match(t[4], /^Service E ne répond pas depuis 10:15\. Les données affichées datent de 10:00\.$/);
  assert.match(t[5], /pas encore contacté/);
  assert.deepEqual(v.lines.map((l) => l.state), ["ok", "slow", "rate", "quota", "down", "unknown"]);
  assert.equal(v.summary, "Un service externe ne répond pas : le site affiche les dernières données connues.");
  assert.match(v.hint, /reprise est automatique/);
});

test("bloc santé en anglais ; tout va bien = pas de message d'ensemble ; entrées invalides ignorées, 20 au plus", () => {
  const v = describeNetHealth(items, "en", { now, lookup });
  assert.equal(v.title, "External services");
  assert.equal(v.lines[0].text, "Service A is working normally.");
  assert.match(v.lines[2].text, /^Service C: too many requests, paused until 11:30/);
  assert.match(v.lines[4].text, /has not been responding since .* The data shown is from/);
  assert.equal(v.summary, "An external service is not responding: the site shows the last known data.");
  const calm = describeNetHealth([{ host: "ok.example.org", label: "A" }, null, { host: 3 }, { label: "x" }, ...Array.from({ length: 30 }, () => ({ host: "ok.example.org", label: "A" }))], "fr", { now, lookup });
  assert.equal(calm.summary, null);
  assert.equal(calm.lines.length, 17, "les 20 premières entrées seulement, dont 3 invalides");
});

test("le bloc lit le VRAI état du client partagé par défaut", async () => {
  N.resetSharedNet();
  await withFakeFetch({ "*": netReplies.rateLimited(300) }, () => N.sharedNet().request({ url: "https://shared.example.org/x" }));
  const v = describeNetHealth([{ host: "shared.example.org", label: "Service" }], "fr");
  assert.equal(v.lines[0].state, "rate");
  N.resetSharedNet();
});

test("le bloc « netHealth » n'est rendu que dans le panneau d'admin (jamais sur le site public)", () => {
  const src = fs.readFileSync("src/components/site/Blocks.tsx", "utf8");
  const at = src.indexOf('case "netHealth"');
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 400), /if \(!adminInstanceId\) break;/);
});

test("ctx.api.net : budget de la page exposé, et le délai suit le temps restant d'une page publique", async () => {
  const api = fs.readFileSync("src/core/modules/api.ts", "utf8");
  assert.match(api, /remainingBudgetMs\(\)/);
  assert.match(api, /budgetMs: remainingBudgetMs/);
  const { boxed, remainingBudgetMs, resetStallState } = await import("@/core/modules/budget");
  resetStallState();
  assert.equal(remainingBudgetMs(), null, "hors page publique : null");
  const inside = await boxed({ kind: "section", moduleId: "probe", instanceKey: "probe", name: "x" }, () => remainingBudgetMs());
  assert.ok(typeof inside === "number" && inside > 0 && inside <= 8000, String(inside));
  resetStallState();
});

test("faux contexte du kit : ctx.api.net est le vrai client (pause après 429 : 0 appel au second tour), noté dans ctx.calls", async () => {
  const ctx = fakeCtx({ moduleId: "jeu" });
  await withFakeFetch({ "*": netReplies.rateLimited(120) }, async (f) => {
    assert.equal((await ctx.api.net.request({ url: "https://api.example.org/a" })).error, "rate");
    assert.equal((await ctx.api.net.request({ url: "https://api.example.org/a" })).error, "rate");
    assert.equal(f.calls.length, 1);
  });
  assert.equal(ctx.calls.net.length, 2);
  assert.match(ctx.calls.netLog[0], /^\[net\] jeu api\.example\.org GET \/a 429 /);
  assert.equal((await ctx.api.net.health())[0].state, "rate");
  assert.equal(ctx.api.net.budgetMs(), null);
  const page = fakeCtx({ netBudgetMs: 100 });
  const t = Date.now();
  await withFakeFetch({ "*": netReplies.silence() }, async () => assert.equal((await page.api.net.request({ url: "https://x.example.org/" })).error, "timeout"));
  assert.ok(Date.now() - t < 600);
  assert.equal(fakeCtx().api.net === fakeCtx().api.net, false, "un état neuf par faux contexte");
});

test("fakeFetch : « * » répond à toutes les adresses ; le signal d'annulation est respecté (trou noir annulé = AbortError)", async () => {
  const { fakeFetch } = await import("../../testsupport/fakeNet.mjs");
  const f = fakeFetch({ "https://known.example.org/": { json: { a: 1 } }, "*": netReplies.silence() });
  assert.deepEqual(await (await f("https://known.example.org/x")).json(), { a: 1 });
  const ctrl = new AbortController();
  const p = f("https://other.example.org/", { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === "AbortError");
  await assert.rejects(f("https://x.example.org/", { signal: AbortSignal.abort() }), (e) => e.name === "AbortError");
  await assert.rejects(fakeFetch({ "*": netReplies.down() })("https://x.example.org/"), TypeError);
  assert.equal((await fakeFetch({ "*": netReplies.quotaExceeded() })("https://x.example.org/")).status, 403);
  const slow = Date.now();
  assert.equal((await fakeFetch({ "*": netReplies.slow(50, { status: 204 }) })("https://x.example.org/")).status, 204);
  assert.ok(Date.now() - slow >= 45);
});

test("règle de kit net.bounded : repère un fetch sans délai, accepte signal / AbortSignal.timeout / ctx.api.net, ignore les définitions", async () => {
  const { REQUIREMENTS } = await import("../../testsupport/requirements/index.mjs");
  const rule = REQUIREMENTS.find((r) => r.id === "net.bounded");
  const run = (text) => rule.run({ sources: [{ file: "index.mjs", text }] });
  assert.equal(run('const r = await fetch("https://a.example.org/x");').length, 1);
  assert.equal(run('await globalThis.fetch(url, { method: "POST" });').length, 1);
  assert.match(run('\n\nawait fetch(url);')[0], /^index\.mjs:3 : fetch\(url\) n'a pas de délai/);
  assert.deepEqual(run('await fetch(url, { signal: AbortSignal.timeout(5000) });'), []);
  assert.deepEqual(run('const init = { signal: AbortSignal.timeout(5000) };\nawait fetch(url, init);'), []);
  assert.deepEqual(run('const c = new AbortController();\nawait fetch(url, { headers: h, signal: c.signal });'), []);
  assert.deepEqual(run('const r = await ctx.api.net.request({ url });'), []);
  assert.deepEqual(run('const o = { fetch(url) { return 1; } };\nasync function fetch(x) {}\nconst y = client.fetch(url);'), []);
  assert.deepEqual(run('// fetch(url) dans un commentaire\nconst s = "x";'), []);
  const timer = REQUIREMENTS.find((r) => r.id === "net.noIdleTimer");
  assert.equal(timer.run({ sources: [{ file: "a.mjs", text: "setInterval(poll, 1000);" }] }).length, 1);
  assert.deepEqual(timer.run({ sources: [{ file: "a.mjs", text: "setTimeout(done, 10);" }] }), []);
  assert.equal(rule.level, "advice", "conseil dans 0.2.0 (décision 7) ; obligatoire au tag « Contacts 2.0 »");
});
