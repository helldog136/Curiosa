import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { clientIp, normalizeIp } = await import("@/core/auth/clientIp");
const L = await import("@/core/auth/lockout");

beforeEach(() => db.reset());
after(() => db.close());

const H = 3_600_000;
const T0 = new Date("2026-10-09T10:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const fail = (ip, email, now) => L.recordFailure(ip, email, now);
async function failTimes(n, ip, email, start = T0) { let last; for (let i = 0; i < n; i++) last = await fail(ip, email, new Date(start.getTime() + i * 1000)); return last; }
const user = (email = "o@example.org") => db.prisma.user.create({ data: { email, name: "O", role: "owner", passwordHash: "x" } });

test("adresse du visiteur : l'entrée AJOUTÉE par le proxy (la dernière), jamais la première que le visiteur peut inventer", () => {
  const h = (o) => (n) => o[n] ?? null;
  assert.equal(clientIp(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })), "203.0.113.7", "la fausse adresse en tête est ignorée");
  assert.equal(clientIp(h({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }), 2), "2.2.2.2", "deux proxys : l'avant-dernière");
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIp(h({})), "local");
  assert.equal(clientIp(h({ "x-forwarded-for": "pas une adresse" })), "inconnue");
  assert.equal(normalizeIp("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64", "un visiteur IPv6 = son réseau /64, pas une adresse parmi des milliards");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8:0:0::/64");
});

test("blocages : 5 erreurs → 1 h, 5 de plus → 3 h, puis 5, 8, 13, 21, 34, 55, 89 h (plafond) — jamais définitif", async () => {
  assert.deepEqual(L.LOCK_HOURS, [1, 3, 5, 8, 13, 21, 34, 55, 89]);
  let now = T0;
  for (const hours of L.LOCK_HOURS.concat([89, 89])) {
    assert.equal((await L.checkLogin("1.2.3.4", "a@x.org", now)).locked, false, "libre avant la série");
    const r = await failTimes(L.MAX_FAILURES, "1.2.3.4", "a@x.org", now);
    const until = new Date(now.getTime() + (L.MAX_FAILURES - 1) * 1000 + hours * H);
    assert.equal(r.lockedUntil.getTime(), until.getTime(), `${hours} h`);
    const state = await L.checkLogin("1.2.3.4", "a@x.org", at(now.getTime() - T0.getTime() + 60_000));
    assert.equal(state.locked, true);
    now = new Date(until.getTime() + 1000);                       // on revient juste après la fin du blocage
  }
});

test("4 erreurs ne bloquent pas ; deux erreurs espacées de plus d'une heure ne comptent pas ensemble ; pendant un blocage rien ne s'ajoute", async () => {
  await failTimes(4, "1.1.1.1", "a@x.org");
  assert.equal((await L.checkLogin("1.1.1.1", "a@x.org", at(5000))).locked, false);
  await fail("1.1.1.1", "a@x.org", at(2 * H));                    // plus d'une heure après : nouvelle série (1/5)
  assert.equal((await L.checkLogin("1.1.1.1", "a@x.org", at(2 * H + 1000))).locked, false);
  await failTimes(4, "1.1.1.1", "a@x.org", at(2 * H + 2000));     // 1 + 4 = 5 : bloqué
  const s = await L.checkLogin("1.1.1.1", "a@x.org", at(2 * H + 10_000));
  assert.equal(s.locked, true);
  assert.equal(s.until.getTime() - (2 * H + 2000 + 3000) - T0.getTime(), H, "1 h, pas plus");
});

test("une connexion réussie remet les compteurs à zéro ; sans erreur pendant 7 jours, les paliers retombent", async () => {
  const u = await user();
  await failTimes(5, "1.1.1.1", "o@example.org");                 // palier 1 h
  await L.recordSuccess("1.1.1.1", u.id, "o@example.org", at(2 * H));
  assert.equal(await db.prisma.authLock.count(), 0, "adresse et e-mail remis à zéro");
  await failTimes(5, "1.1.1.1", "o@example.org", at(3 * H));
  const s = await L.checkLogin("1.1.1.1", "o@example.org", at(3 * H + 10_000));
  assert.equal(s.until.getTime() - (3 * H + 4000) - T0.getTime(), H, "retour au palier 1 h après un succès");
  // jamais d'erreur pendant 7 jours : les paliers sont oubliés
  await db.prisma.authLock.deleteMany();
  await failTimes(5, "5.5.5.5", "b@x.org");                       // 1 h
  await failTimes(5, "5.5.5.5", "b@x.org", at(2 * H));            // 3 h
  const later = at(8 * 24 * H);
  await failTimes(5, "5.5.5.5", "b@x.org", later);
  const s2 = await L.checkLogin("5.5.5.5", "b@x.org", new Date(later.getTime() + 10_000));
  assert.equal(s2.until.getTime() - later.getTime() - 4000, H, "7 jours calmes : on repart à 1 h");
});

test("blocage par adresse : tous les comptes depuis cette adresse ; par e-mail : même un e-mail qui n'existe pas (rien n'est révélé)", async () => {
  await failTimes(5, "7.7.7.7", "inconnu@x.org");
  const byIp = await L.checkLogin("7.7.7.7", "autre@x.org", at(10_000));
  assert.deepEqual([byIp.locked, byIp.scope], [true, "ip"]);
  const byEmail = await L.checkLogin("8.8.8.8", "inconnu@x.org", at(10_000));
  assert.deepEqual([byEmail.locked, byEmail.scope], [true, "email"], "même réponse pour un compte qui n'existe pas");
  assert.equal((await L.checkLogin("8.8.8.8", "quelquun@x.org", at(10_000))).locked, false);
});

test("un inconnu ne peut pas enfermer le propriétaire dehors : son e-mail bloqué reste utilisable depuis une adresse où il s'est déjà connecté", async () => {
  const u = await user();
  await L.recordSuccess("10.0.0.1", u.id, "o@example.org", T0);   // le propriétaire se connecte de chez lui
  for (const ip of ["6.6.6.1", "6.6.6.2", "6.6.6.3", "6.6.6.4", "6.6.6.5"]) await fail(ip, "o@example.org", at(1000)); // un inconnu, depuis 5 adresses
  const lockedEmail = await L.isEmailLocked("o@example.org", at(5000));
  assert.ok(lockedEmail, "l'e-mail est bloqué pour les inconnus");
  assert.equal((await L.checkLogin("10.0.0.1", "o@example.org", at(5000))).locked, false, "…pas depuis l'adresse connue du propriétaire");
  assert.equal((await L.checkLogin("6.6.6.9", "o@example.org", at(5000))).locked, true, "…mais bien depuis une adresse inconnue");
  // la confiance expire après 30 jours sans connexion
  assert.equal((await L.checkLogin("10.0.0.1", "o@example.org", at(31 * 24 * H))).locked, false, "(le blocage lui-même a expiré)");
  await db.prisma.authLock.update({ where: { key: "email:o@example.org" }, data: { lockedUntil: at(40 * 24 * H) } });
  assert.equal((await L.checkLogin("10.0.0.1", "o@example.org", at(31 * 24 * H))).locked, true, "adresse plus vue depuis 30 jours : plus de passe-droit");
  // et une adresse bloquée l'est pour tout le monde, même connue
  await failTimes(5, "10.0.0.1", "zzz@x.org", at(2000));
  assert.equal((await L.checkLogin("10.0.0.1", "o@example.org", at(10_000))).scope, "ip");
});

test("le propriétaire débloque un e-mail ; l'état est en base (survit à un redémarrage) ; le blocage est journalisé", async () => {
  await failTimes(5, "3.3.3.3", "c@x.org");
  assert.ok(await db.prisma.authLock.findUnique({ where: { key: "email:c@x.org" } }), "ligne en base");
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "login.locked" } })).length, 1, "un blocage = une ligne de journal");
  await L.unlockEmail("C@x.org");
  assert.equal(await L.isEmailLocked("c@x.org", at(10_000)), null);
  assert.equal((await L.checkLogin("4.4.4.4", "c@x.org", at(10_000))).locked, false);
  assert.equal((await L.checkLogin("3.3.3.3", "c@x.org", at(10_000))).scope, "ip", "l'adresse reste bloquée");
});

test("branchements : mot de passe jamais regardé quand c'est bloqué, comparaison faite même si le compte n'existe pas, message avec l'heure, bouton réservé au propriétaire", () => {
  const auth = fs.readFileSync("src/auth.ts", "utf8");
  assert.ok(auth.indexOf("checkLogin") < auth.indexOf("bcrypt.compare(password"), "blocage vérifié avant le mot de passe");
  assert.match(auth, /DUMMY_HASH/);
  assert.match(auth, /recordFailure/); assert.match(auth, /recordSuccess/);
  assert.ok(!/x-forwarded-for/i.test(auth), "l'adresse vient de clientIp, jamais de la première entrée d'un en-tête");
  const action = fs.readFileSync("src/app/admin/(auth)/login/actions.ts", "utf8");
  assert.match(action, /login\.locked/); assert.match(action, /formatUntil/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/users/actions.ts", "utf8"), /unlockUser[\s\S]*adminCtx\("owner"\)/);
  assert.match(fs.readFileSync("src/locales/fr.json", "utf8"), /"login\.locked": "Trop d'essais/);
});
