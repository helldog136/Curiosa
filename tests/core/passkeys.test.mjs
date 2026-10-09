import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeAuthenticator, otherKey } from "../helpers/softAuthenticator.mjs";

const db = await useTestDb();
const P = await import("@/core/auth/passkeys");

beforeEach(() => db.reset());
after(() => db.close());

const rp = P.relyingParty("https://site.example", "Mon site");
const user = (email = "o@example.org") => db.prisma.user.create({ data: { email, name: "Emma", role: "owner", passwordHash: "x" } });
const auth = () => makeAuthenticator({ rpID: rp.rpID, origin: rp.origin });

async function register(u, a = auth(), o = {}) {
  const started = await P.startRegistration(u.id, rp);
  const done = await P.finishRegistration(u.id, o.challengeId ?? started.challengeId, a.register(o.challenge ?? started.options.challenge, o.auth ?? {}), "Mon téléphone", rp);
  return { a, started, done };
}

test("domaine : SITE_URL fait foi ; en local, l'adresse de la requête ; la clé n'est valable que pour CE domaine", () => {
  assert.deepEqual(P.relyingParty("https://site.example/", "S"), { rpID: "site.example", origin: "https://site.example", rpName: "S" });
  assert.deepEqual(P.relyingParty("https://site.example", "S", "https://autre.example"), { rpID: "site.example", origin: "https://site.example", rpName: "S" }, "une adresse de requête ne l'emporte jamais sur SITE_URL");
  assert.equal(P.relyingParty("http://localhost:3000", "S", "http://localhost:3172").origin, "http://localhost:3172", "en développement : l'adresse réellement utilisée");
  assert.equal(P.relyingParty("https://site.example", "").rpName, "Curiosa");
});

test("enregistrement : une vraie réponse d'authentificateur est acceptée, seule la clé PUBLIQUE est gardée, le défi ne sert qu'une fois", async () => {
  const u = await user();
  const { started, done, a } = await register(u);
  assert.equal(done.ok, true);
  assert.equal(started.options.authenticatorSelection.userVerification, "required", "la vérification de l'utilisateur est exigée");
  assert.equal(started.options.authenticatorSelection.residentKey, "required");
  const row = await db.prisma.passkey.findFirst({ where: { userId: u.id } });
  assert.equal(row.credentialId, a.credentialId);
  assert.equal(row.name, "Mon téléphone");
  assert.ok(row.publicKey.length > 30, "clé publique");
  assert.ok(!JSON.stringify(row).includes("PRIVATE"), "aucune clé privée");
  // même défi rejoué : refusé (et il est détruit)
  const again = await P.finishRegistration(u.id, started.challengeId, a.register(started.options.challenge), "Doublon", rp);
  assert.equal(again.ok, false);
  assert.equal(await db.prisma.passkey.count(), 1);
  assert.equal(await db.prisma.passkeyChallenge.count(), 0, "défi consommé");
  // une clé déjà enregistrée est exclue des propositions suivantes
  const next = await P.startRegistration(u.id, rp);
  assert.deepEqual(next.options.excludeCredentials.map((c) => c.id), [a.credentialId]);
});

test("enregistrement : mauvais site, mauvais domaine, mauvais défi, sans vérification de l'utilisateur, défi expiré ou d'un autre compte → refusé, rien d'enregistré", async () => {
  const u = await user(); const v = await user("v@example.org");
  assert.equal((await register(u, auth(), { auth: { origin: "https://faux-site.example" } })).done.ok, false, "hameçonnage : autre adresse");
  assert.equal((await register(u, auth(), { auth: { rpID: "faux-site.example" } })).done.ok, false, "autre domaine");
  assert.equal((await register(u, auth(), { challenge: "AAAAAAAAAAAAAAAAAAAAAA" })).done.ok, false, "mauvais défi");
  assert.equal((await register(u, auth(), { auth: { uv: false } })).done.ok, false, "pas de vérification de l'utilisateur (empreinte, code…)");
  const started = await P.startRegistration(u.id, rp);
  assert.equal((await P.finishRegistration(v.id, started.challengeId, auth().register(started.options.challenge), "x", rp)).ok, false, "le défi d'un autre compte");
  const s2 = await P.startRegistration(u.id, rp);
  await db.prisma.passkeyChallenge.update({ where: { id: s2.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await P.finishRegistration(u.id, s2.challengeId, auth().register(s2.options.challenge), "x", rp)).ok, false, "défi expiré");
  assert.equal((await P.finishRegistration(u.id, "inexistant", auth().register("x"), "x", rp)).ok, false);
  assert.equal(await db.prisma.passkey.count(), 0);
});

test("limite de 10 clés par compte ; un nom est nettoyé (pas de balise, 60 caractères)", async () => {
  const u = await user();
  for (let i = 0; i < P.MAX_PASSKEYS; i++) assert.equal((await register(u)).done.ok, true);
  assert.deepEqual(await P.startRegistration(u.id, rp), { error: "max" });
  const v = await user("v@example.org");
  const s = await P.startRegistration(v.id, rp);
  await P.finishRegistration(v.id, s.challengeId, auth().register(s.options.challenge), "<b>Ma clé</b>\u0007" + "x".repeat(100), rp);
  const name = (await db.prisma.passkey.findFirst({ where: { userId: v.id } })).name;
  assert.ok(!/[<>\u0007]/.test(name) && name.length <= 60, name);
});

async function login(a, o = {}) {
  const started = await P.startLogin(rp);
  const result = await P.finishLogin(o.challengeId ?? started.challengeId, a.assert(o.challenge ?? started.options.challenge, o.auth ?? {}), rp);
  return { started, result };
}

test("connexion : la clé d'accès signe le défi → le compte est reconnu sans e-mail ni mot de passe ; compteur et dernière utilisation mis à jour", async () => {
  const u = await user();
  const { a } = await register(u);
  const { started, result } = await login(a);
  assert.deepEqual(result, { userId: u.id, email: "o@example.org" });
  assert.equal(started.options.userVerification, "required");
  assert.deepEqual(started.options.allowCredentials ?? [], [], "aucune liste de clés : rien ne fuit sur les comptes existants");
  const row = await db.prisma.passkey.findFirst();
  assert.ok(row.counter >= 1 && row.lastUsedAt, "compteur et date mis à jour");
});

test("connexion : rejouer une réponse, mauvais défi, autre clé, autre site, sans vérification, clé inconnue ou retirée → refusé", async () => {
  const u = await user();
  const { a } = await register(u);
  const first = await P.startLogin(rp);
  const response = a.assert(first.options.challenge);
  assert.ok(await P.finishLogin(first.challengeId, response, rp));
  assert.equal(await P.finishLogin(first.challengeId, response, rp), null, "même réponse rejouée : le défi est consommé");
  const s2 = await P.startLogin(rp);
  assert.equal(await P.finishLogin(s2.challengeId, response, rp), null, "ancienne réponse sur un nouveau défi : mauvaise signature de défi");
  assert.equal((await login(a, { challenge: "AAAAAAAAAAAAAAAAAAAAAA" })).result, null, "mauvais défi");
  assert.equal((await login(a, { auth: { key: otherKey() } })).result, null, "signature d'une autre clé");
  assert.equal((await login(a, { auth: { origin: "https://faux-site.example" } })).result, null, "hameçonnage : autre adresse");
  assert.equal((await login(a, { auth: { rpID: "faux-site.example" } })).result, null, "autre domaine");
  assert.equal((await login(a, { auth: { uv: false } })).result, null, "sans empreinte / code : refusé");
  assert.equal((await login(auth())).result, null, "clé jamais enregistrée");
  assert.equal((await login(a, { auth: { counter: 1 } })).result, null, "compteur qui ne progresse pas : clé clonée ?");
  const good = await login(a, { auth: { counter: 500 } });
  assert.ok(good.result, "une clé légitime passe toujours");
  await P.deletePasskey(u.id, (await db.prisma.passkey.findFirst()).id);
  assert.equal((await login(a, { auth: { counter: 900 } })).result, null, "clé retirée : refusée");
  assert.equal(await P.finishLogin("inexistant", a.assert("x"), rp), null);
});

test("gérer ses clés : on ne retire ni ne renomme que les siennes", async () => {
  const u = await user(); const v = await user("v@example.org");
  await register(u);
  const id = (await db.prisma.passkey.findFirst()).id;
  assert.equal(await P.deletePasskey(v.id, id), false, "la clé d'un autre ne se retire pas");
  assert.equal(await P.renamePasskey(v.id, id, "pirate"), false);
  assert.equal(await P.renamePasskey(u.id, id, "  Mon ordinateur  "), true);
  assert.equal((await P.listPasskeys(u.id))[0].name, "Mon ordinateur");
  assert.equal(await P.countPasskeys(u.id), 1);
  assert.equal(await P.deletePasskey(u.id, id), true);
  assert.equal(await P.countPasskeys(u.id), 0);
  const w = await user("w@example.org"); await register(w);
  await db.prisma.user.delete({ where: { id: w.id } });
  assert.equal(await db.prisma.passkey.count(), 0, "un compte supprimé emporte ses clés");
});

test("branchements : une clé d'accès vaut les deux facteurs, billet signé pour entrer, mot de passe redemandé pour ajouter/retirer, verrouillage par adresse, bibliothèque de référence", () => {
  const login = fs.readFileSync("src/app/admin/(auth)/login/actions.ts", "utf8");
  assert.match(login, /passkeyLoginFinish[\s\S]*checkLogin\(ip, ""\)[\s\S]*finishLogin[\s\S]*recordSuccess[\s\S]*signToken\("ticket"/);
  assert.match(login, /recordFailure\(ip, ""\)/, "un échec de clé d'accès compte pour l'adresse");
  const account = fs.readFileSync("src/app/admin/(panel)/account/actions.ts", "utf8");
  assert.match(account, /startPasskeyRegistration[\s\S]*verifyPassword/);
  assert.match(account, /removeMyPasskey[\s\S]*verifyPassword/);
  const perms = fs.readFileSync("src/core/permissions.ts", "utf8");
  assert.match(perms, /twoFactor = totp \|\| passkeys > 0/);
  const lib = fs.readFileSync("src/core/auth/passkeys.ts", "utf8");
  assert.match(lib, /from "@simplewebauthn\/server"/);
  assert.ok(!/crypto\.(verify|createVerify)/.test(lib), "aucune cryptographie écrite à la main");
  assert.match(lib, /requireUserVerification: true/);
  assert.ok(fs.readFileSync("src/components/admin/webauthn.ts", "utf8").includes("navigator.credentials.create"));
});
