import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const S = await import("@/core/auth/sessions");

beforeEach(() => db.reset());
after(() => db.close());

test("sessions révocables : le numéro de session de la base coupe tous les jetons plus anciens ; un jeton d'avant la fonction vaut 0", async () => {
  const u = await db.prisma.user.create({ data: { email: "u@x.org", name: "U", role: "editor", passwordHash: "x" } });
  assert.equal(u.sessionVersion, 0, "comptes existants : 0, donc les sessions ouvertes à la mise à jour restent valables");
  assert.equal(S.sessionIsCurrent(undefined, 0), true, "jeton sans numéro = 0");
  assert.equal(S.sessionIsCurrent(0, 0), true);
  await S.revokeSessions(u.id);
  const after = await db.prisma.user.findUnique({ where: { id: u.id } });
  assert.equal(after.sessionVersion, 1);
  assert.equal(S.sessionIsCurrent(0, after.sessionVersion), false, "l'ancien jeton est coupé");
  assert.equal(S.sessionIsCurrent(undefined, after.sessionVersion), false);
  assert.equal(S.sessionIsCurrent(1, after.sessionVersion), true, "une nouvelle connexion repart du bon numéro");
  assert.equal(S.sessionIsCurrent("1", 1), false, "un numéro qui n'est pas un nombre ne vaut rien");
  await S.revokeSessions("inexistant"); // ne lève jamais
});

test("branchements : le numéro est dans le jeton, relu à chaque page d'admin, coupé par changement de mot de passe, bouton « déconnecter partout », bouton propriétaire, durée limitée", () => {
  const auth = fs.readFileSync("src/auth.ts", "utf8");
  assert.match(auth, /token\.sv = user\.sessionVersion/);
  assert.match(auth, /maxAge: 14 \* 24 \* 60 \* 60/);
  assert.match(fs.readFileSync("src/core/permissions.ts", "utf8"), /sessionIsCurrent\(session\?\.user\?\.sv, user\.sessionVersion\)/);
  const account = fs.readFileSync("src/app/admin/(panel)/account/actions.ts", "utf8");
  assert.match(account, /revokeSessions\(user\.id\);\s*await signOut\(\{ redirectTo: "\/admin\/login\?changed=1"/, "mot de passe changé : sessions coupées, reconnexion demandée");
  assert.match(account, /export async function signOutEverywhere/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/users/actions.ts", "utf8"), /revokeUserSessions[\s\S]*adminCtx\("owner"\)/);
  assert.match(fs.readFileSync("scripts/auth-recover.mjs", "utf8"), /sessionVersion: \{ increment: 1 \}/, "la commande de secours coupe aussi les sessions");
});
