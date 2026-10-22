// ctx.api.visitor.fingerprint : empreinte salée du visiteur selon la règle de SECURITE.md (dernière entrée de confiance), cloisonnée, renouvelée chaque jour.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const { visitorFingerprint: fp, resetVisitorSalt } = await import("@/core/modules/visitorFingerprint");
beforeEach(() => resetVisitorSalt());
const req = (xff, extra = {}) => new Request("https://example.test/m/x/y", { method: "POST", headers: { ...(xff ? { "x-forwarded-for": xff } : {}), ...extra } });
const T0 = Date.UTC(2026, 5, 1, 12);

test("la même personne donne la même empreinte ; celle du proxy compte, pas ce que le visiteur a inventé au début de l'en-tête", () => {
  const a = fp("monsite", req("203.0.113.9"), "", T0);
  assert.equal(fp("monsite", req("1.2.3.4, 203.0.113.9"), "", T0), a, "un début inventé ne change rien");
  assert.equal(fp("monsite", req("9.9.9.9, 8.8.8.8, 203.0.113.9"), "", T0), a);
  assert.notEqual(fp("monsite", req("203.0.113.10"), "", T0), a, "un autre visiteur, une autre empreinte");
  assert.notEqual(fp("monsite", req("203.0.113.9, 1.2.3.4"), "", T0), a, "l'entrée de confiance est la DERNIÈRE");
});

test("forme : 22 caractères base64url, sans trace de l'adresse", () => {
  const f = fp("monsite", req("203.0.113.9"), "limite", T0);
  assert.match(f, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(!f.includes("203.0.113"));
});

test("cloisonnée : autre module ou autre portée = autre empreinte ; Headers accepté ; portée tronquée à 64", () => {
  const r = req("203.0.113.9");
  const base = fp("monsite", r, "a", T0);
  assert.notEqual(fp("autresite", r, "a", T0), base);
  assert.notEqual(fp("monsite", r, "b", T0), base);
  assert.equal(fp("monsite", new Headers({ "x-forwarded-for": "203.0.113.9" }), "a", T0), base);
  assert.equal(fp("monsite", r, "z".repeat(64), T0), fp("monsite", r, "z".repeat(500), T0));
});

test("sel : au hasard (deux sels = deux empreintes), renouvelé au changement de jour, oublié ensuite", () => {
  const r = req("203.0.113.9");
  const day1 = fp("monsite", r, "", T0);
  assert.equal(fp("monsite", r, "", T0 + 3_600_000), day1, "stable dans la journée");
  const day2 = fp("monsite", r, "", T0 + 86_400_000);
  assert.notEqual(day2, day1, "le lendemain, une autre empreinte");
  assert.notEqual(fp("monsite", r, "", T0), day1, "le sel d'hier est détruit : on ne retrouve pas l'ancienne empreinte");
  resetVisitorSalt();
  assert.notEqual(fp("monsite", r, "", T0 + 86_400_000), day2, "un sel neuf donne une autre empreinte");
});

test("IPv6 : tout un réseau /64 est un visiteur ; IPv4 mappée = IPv4 ; entrée invalide = « inconnue », sans erreur", () => {
  assert.equal(fp("m", req("2001:db8:1:2::1"), "", T0), fp("m", req("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "", T0));
  assert.notEqual(fp("m", req("2001:db8:1:3::1"), "", T0), fp("m", req("2001:db8:1:2::1"), "", T0));
  assert.equal(fp("m", req("::ffff:203.0.113.9"), "", T0), fp("m", req("203.0.113.9"), "", T0));
  for (const bad of [req("n'importe quoi"), req("x".repeat(5000)), null, undefined, 42, {}, { headers: 7 }]) assert.match(fp("m", bad, "", T0), /^[A-Za-z0-9_-]{22}$/);
});

test("sans X-Forwarded-For : X-Real-IP, sinon « local » (tous les visiteurs partagent alors une empreinte)", () => {
  assert.equal(fp("m", req(null, { "x-real-ip": "203.0.113.9" }), "", T0), fp("m", req("203.0.113.9"), "", T0));
  assert.equal(fp("m", req(null), "", T0), fp("m", req(null), "", T0));
});

test("le cœur ne garde rien par visiteur : seul le sel (32 octets) est en mémoire", () => {
  const before = Object.keys(globalThis).filter((k) => k.startsWith("curiosa")).sort();
  for (let i = 0; i < 5000; i++) fp("m", req(`203.0.${i % 250}.${i % 200}`), "", T0);
  assert.deepEqual(Object.keys(globalThis).filter((k) => k.startsWith("curiosa")).sort(), before.includes("curiosaVisitorSalt") ? before : [...before, "curiosaVisitorSalt"].sort());
  assert.equal(globalThis.curiosaVisitorSalt.salt.length, 32);
});

test("le comptage des visites utilise la même règle (plus la première entrée de X-Forwarded-For)", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/hit/route.ts", "utf8");
  assert.match(route, /clientIp\(/);
  assert.ok(!/split\(","\)\[0\]/.test(route), "la première entrée est inventée par le visiteur");
});
