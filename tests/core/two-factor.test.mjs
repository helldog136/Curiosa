import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const T = await import("@/core/auth/totp");
const F = await import("@/core/auth/twoFactor");

beforeEach(() => db.reset());
after(() => db.close());

const user = (over = {}) => db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "hash", ...over } });
const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);

test("TOTP : les vecteurs de test officiels (RFC 6238, SHA-1) donnent les bons codes à 6 chiffres", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [time, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]]) {
    assert.equal(T.hotp(secret, Math.floor(time / 30)), code, `t=${time}`);
  }
  assert.equal(T.base32Encode(secret), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(T.base32Decode("gezd gnbv-GY3TQOJQGEZDGNBVGY3TQOJQ"), secret, "casse, espaces et tirets tolérés");
  assert.throws(() => T.base32Decode("0189"), /base32/);
  assert.match(T.generateSecret(), /^[A-Z2-7]{32}$/);
});

test("TOTP : un pas d'avance ou de retard toléré, pas plus ; un code ne sert qu'une fois ; format strict", () => {
  const secret = T.generateSecret();
  const step = T.stepOf(NOW);
  const at = (s) => T.codeAt(secret, s);
  assert.equal(T.verifyTotp(secret, at(step), { now: NOW }), step);
  assert.equal(T.verifyTotp(secret, at(step - 1), { now: NOW }), step - 1, "horloge du téléphone en retard de 30 s");
  assert.equal(T.verifyTotp(secret, at(step + 1), { now: NOW }), step + 1, "…en avance");
  assert.equal(T.verifyTotp(secret, at(step - 2), { now: NOW }), null);
  assert.equal(T.verifyTotp(secret, at(step + 2), { now: NOW }), null);
  assert.equal(T.verifyTotp(secret, at(step), { now: NOW, afterStep: step }), null, "même pas déjà accepté : refusé");
  assert.equal(T.verifyTotp(secret, at(step + 1), { now: NOW, afterStep: step }), step + 1, "le pas suivant passe");
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5a"]) assert.equal(T.verifyTotp(secret, bad, { now: NOW }), null, bad);
  assert.equal(T.verifyTotp(secret, ` ${at(step).slice(0, 3)} ${at(step).slice(3)} `, { now: NOW }), step, "espaces tolérés");
  assert.match(T.otpauthUri({ issuer: "Mon site", account: "a@b.org", secret }), /^otpauth:\/\/totp\/Mon%20site%3Aa%40b\.org\?secret=[A-Z2-7]{32}&issuer=Mon%20site&algorithm=SHA1&digits=6&period=30$/);
});

test("activation : une clé en attente, confirmée par un vrai code ; un mauvais code n'active rien ; huit codes de secours donnés une fois, stockés sous forme d'empreintes", async () => {
  const u = await user();
  const begun = await F.beginEnroll(u.id, "Mon site");
  assert.match(begun.uri, /^otpauth:\/\/totp\//);
  assert.equal((await db.prisma.user.findUnique({ where: { id: u.id } })).totpEnabledAt, null, "pas actif avant confirmation");
  assert.equal((await F.confirmEnroll(u.id, "000000", NOW)).ok, false);
  assert.equal((await db.prisma.user.findUnique({ where: { id: u.id } })).totpEnabledAt, null);
  const done = await F.confirmEnroll(u.id, T.codeAt(begun.secret, T.stepOf(NOW)), NOW);
  assert.equal(done.ok, true);
  assert.equal(done.recoveryCodes.length, 8);
  assert.equal(new Set(done.recoveryCodes).size, 8);
  for (const c of done.recoveryCodes) assert.match(c, /^[2-9a-hjkmnp-z]{5}-[2-9a-hjkmnp-z]{5}$/);
  const row = await db.prisma.user.findUnique({ where: { id: u.id } });
  assert.deepEqual([!!row.totpEnabledAt, row.totpSecret === begun.secret, row.totpPending], [true, true, null]);
  const stored = await db.prisma.recoveryCode.findMany({ where: { userId: u.id } });
  assert.equal(stored.length, 8);
  assert.ok(stored.every((r) => !done.recoveryCodes.some((c) => r.codeHash.includes(c.replace("-", "")))), "jamais en clair en base");
  assert.equal(await F.beginEnroll(u.id, "x"), null, "déjà activée : pas de nouvelle clé sans désactiver");
  assert.equal(await F.remainingRecoveryCodes(u.id), 8);
});

async function enrolled() {
  const u = await user();
  const begun = await F.beginEnroll(u.id, "S");
  const done = await F.confirmEnroll(u.id, T.codeAt(begun.secret, T.stepOf(NOW)), NOW);
  return { u, secret: begun.secret, codes: done.recoveryCodes };
}

test("connexion : le code de l'application passe UNE fois (même dans sa fenêtre de validité), un autre code du pas suivant passe, un faux est refusé", async () => {
  const { u, secret } = await enrolled();
  const s = T.stepOf(NOW);
  assert.equal((await F.verifySecondFactor(u.id, T.codeAt(secret, s + 1), NOW)).ok, true);
  assert.equal((await F.verifySecondFactor(u.id, T.codeAt(secret, s + 1), NOW)).ok, false, "même code rejoué : refusé");
  assert.equal((await F.verifySecondFactor(u.id, T.codeAt(secret, s), NOW)).ok, false, "un code plus ancien que le dernier accepté : refusé");
  assert.equal((await F.verifySecondFactor(u.id, T.codeAt(secret, s + 2), NOW + 30_000)).ok, true);
  assert.equal((await F.verifySecondFactor(u.id, "123456", NOW)).ok, false);
  assert.equal((await F.verifySecondFactor(u.id, "", NOW)).ok, false);
  const sans = await user({ email: "s@x.org" });
  assert.equal((await F.verifySecondFactor(sans.id, "123456", NOW)).ok, false, "compte sans double vérification : jamais accepté");
});

test("codes de secours : chacun sert une fois, saisis avec ou sans tiret, majuscules ou espaces ; régénérer remplace tout", async () => {
  const { u, codes } = await enrolled();
  const r1 = await F.verifySecondFactor(u.id, codes[0].toUpperCase(), NOW);
  assert.deepEqual([r1.ok, r1.kind], [true, "recovery"]);
  assert.equal((await F.verifySecondFactor(u.id, codes[0], NOW)).ok, false, "déjà utilisé");
  assert.equal((await F.verifySecondFactor(u.id, codes[1].replace("-", " "), NOW)).ok, true, "sans tiret");
  assert.equal((await F.verifySecondFactor(u.id, "aaaaa-bbbbb", NOW)).ok, false);
  assert.equal(await F.remainingRecoveryCodes(u.id), 6);
  const fresh = await F.regenerateRecoveryCodes(u.id);
  assert.equal(fresh.length, 8);
  assert.equal((await F.verifySecondFactor(u.id, codes[2], NOW)).ok, false, "les anciens codes ne valent plus rien");
  assert.equal((await F.verifySecondFactor(u.id, fresh[0], NOW)).ok, true);
  const other = await user({ email: "autre@x.org" });
  assert.equal((await F.verifySecondFactor(other.id, fresh[1], NOW)).ok, false, "le code d'un autre compte ne marche pas");
});

test("désactivation / réinitialisation : secret, codes de secours et sessions ouvertes disparaissent", async () => {
  const { u } = await enrolled();
  await F.disableTwoFactor(u.id);
  const row = await db.prisma.user.findUnique({ where: { id: u.id } });
  assert.deepEqual([row.totpSecret, row.totpEnabledAt, row.totpPending, row.totpLastStep], [null, null, null, null]);
  assert.equal(row.sessionVersion, 1, "sessions ouvertes coupées");
  assert.equal(await db.prisma.recoveryCode.count(), 0);
  assert.equal((await F.beginEnroll(u.id, "S")) !== null, true, "on peut recommencer");
});

test("jetons signés : étape « mot de passe » (5 min) et billet de connexion (60 s) — usage, durée, liaison au mot de passe, falsification", () => {
  const now = 1_000_000;
  const pwd = F.signToken("pwd", "u1", F.passwordBinding("hash-a"), now);
  assert.equal(F.readToken("pwd", pwd, F.passwordBinding("hash-a"), now + 4 * 60_000), "u1");
  assert.equal(F.readToken("pwd", pwd, F.passwordBinding("hash-a"), now + 5 * 60_000 + 1), null, "expiré après 5 minutes");
  assert.equal(F.readToken("pwd", pwd, F.passwordBinding("hash-b"), now + 1000), null, "mot de passe changé entre-temps : plus valable");
  assert.equal(F.readToken("ticket", pwd, F.passwordBinding("hash-a"), now + 1000), null, "un jeton d'étape ne sert pas de billet");
  const ticket = F.signToken("ticket", "u1", "", now);
  assert.equal(F.readToken("ticket", ticket, "", now + 59_000), "u1");
  assert.equal(F.readToken("ticket", ticket, "", now + 61_000), null, "billet expiré après 60 s");
  assert.equal(F.readToken("pwd", ticket, "", now + 1000), null);
  const [payload, sig] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ p: "ticket", u: "admin", b: "", e: now + 99_999_999, n: "x" })).toString("base64url");
  assert.equal(F.readToken("ticket", `${forged}.${sig}`, "", now + 1000), null, "charge modifiée, signature d'avant");
  assert.equal(F.readToken("ticket", `${payload}.${sig.slice(0, -2)}aa`, "", now + 1000), null);
  for (const junk of ["", "abc", "a.b", undefined, null]) assert.equal(F.readToken("ticket", junk, "", now), null);
  assert.equal(F.peekToken(pwd), "u1");
  assert.equal(F.peekToken("n'importe quoi"), null);
  assert.notEqual(F.signToken("ticket", "u1", "", now), ticket, "chaque billet est unique");
});

test("branchements : le mot de passe seul n'ouvre jamais un compte protégé (ni par /api/auth), billet pour entrer, exigence d'équipe, réservé au propriétaire", () => {
  const auth = fs.readFileSync("src/auth.ts", "utf8");
  assert.match(auth, /ticket: \{\}/);
  assert.match(auth, /if \(user\.totpEnabledAt\) return null;/, "authorize refuse le mot de passe seul si la double vérification est active");
  const login = fs.readFileSync("src/app/admin/(auth)/login/actions.ts", "utf8");
  assert.match(login, /if \(user\.totpEnabledAt\) return \{ step: "code"/);
  assert.match(login, /verifySecondFactor[\s\S]*recordFailure[\s\S]*recordSuccess/, "un mauvais code compte comme un essai raté (mêmes blocages)");
  assert.match(login, /signToken\("ticket"/);
  const perms = fs.readFileSync("src/core/permissions.ts", "utf8");
  assert.match(perms, /needsTwoFactor && !opts\.allowUnenrolled\) redirect\("\/admin\/account\?need2fa=1"\)/);
  const users = fs.readFileSync("src/app/admin/(panel)/users/actions.ts", "utf8");
  assert.match(users, /resetUserTwoFactor[\s\S]*adminCtx\("owner"\)/);
  assert.match(users, /setRequireTwoFactor[\s\S]*adminCtx\("owner"\)[\s\S]*users\.require2faNeedsYou/, "le propriétaire ne peut pas l'exiger sans l'avoir activée");
  const account = fs.readFileSync("src/app/admin/(panel)/account/actions.ts", "utf8");
  assert.match(account, /disableMyTwoFactor[\s\S]*security\.require2fa[\s\S]*verifyPassword[\s\S]*verifySecondFactor/, "désactiver : refusé si exigé, sinon mot de passe ET code");
  assert.match(fs.readFileSync("scripts/auth-recover.mjs", "utf8"), /reset-2fa/);
});
