import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const P = await import("@/core/auth/passwordPolicy");
const A = await import("@/core/auth/access");
const T = await import("@/core/auth/teamPassword");
const { setMailTransportFactory, resetMailLimits } = await import("@/core/services/mail");
const { setSetting } = await import("@/core/settings");

const outbox = [];
beforeEach(async () => { await db.reset(); T.resetTeamPasswordLimits(); resetMailLimits(); outbox.length = 0; setMailTransportFactory(() => ({ sendMail: async (m) => { outbox.push(m); } })); });
after(async () => { setMailTransportFactory(); await db.close(); });

const hash = (p) => bcrypt.hashSync(p, 4);
async function team() {
  const owner = await db.prisma.user.create({ data: { email: "o@x.org", name: "Olive", role: "owner", passwordHash: hash("owner-password-1") } });
  const admin = await db.prisma.user.create({ data: { email: "a@x.org", name: "Adam", role: "admin", passwordHash: hash("admin-password-1") } });
  const editor = await db.prisma.user.create({ data: { email: "e@x.org", name: "Emma", role: "editor", passwordHash: hash("editor-password-1") } });
  return { owner, admin, editor };
}
const setMail = () => setSetting("mail.host", "smtp.test").then(() => setSetting("mail.from", "site@x.org"));

test("mot de passe généré : 16 caractères lisibles, sans caractères ambigus, tirages différents", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = P.generateTemporaryPassword();
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p));
    assert.equal(P.passwordProblem(p), null);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
  assert.equal(P.passwordProblem("123456789"), "short");
  assert.equal(P.passwordProblem("1234567890"), null);
});

test("seul le propriétaire : administrateur et éditeur sont refusés côté serveur, rien ne change", async () => {
  const { admin, editor } = await team();
  for (const actor of [admin, editor]) {
    const r = await T.resetMemberPassword({ actorId: actor.id, targetId: actor.id === admin.id ? editor.id : admin.id, mode: "generate" });
    assert.deepEqual(r, { ok: false, reason: "denied" });
  }
  assert.deepEqual(await T.resetMemberPassword({ actorId: "inconnu", targetId: editor.id, mode: "generate" }), { ok: false, reason: "denied" });
  const e = await db.prisma.user.findUnique({ where: { id: editor.id } });
  assert.equal(e.mustChangePassword, false);
  assert.equal(e.sessionVersion, 0);
  assert.ok(await bcrypt.compare("editor-password-1", e.passwordHash));
  assert.equal(await db.prisma.auditLog.count(), 0);
});

test("jamais sur soi-même ni sur un autre propriétaire ; cible inconnue", async () => {
  const { owner, editor } = await team();
  const second = await db.prisma.user.create({ data: { email: "o2@x.org", name: "O2", role: "owner", passwordHash: hash("owner2-password") } });
  assert.deepEqual(await T.resetMemberPassword({ actorId: owner.id, targetId: owner.id, mode: "generate" }), { ok: false, reason: "self" });
  assert.deepEqual(await T.resetMemberPassword({ actorId: owner.id, targetId: second.id, mode: "generate" }), { ok: false, reason: "owner" });
  assert.deepEqual(await T.resetMemberPassword({ actorId: owner.id, targetId: "nope", mode: "generate" }), { ok: false, reason: "missing" });
  assert.equal((await db.prisma.user.findUnique({ where: { id: second.id } })).mustChangePassword, false);
  void editor;
});

test("mode généré : hash changé, drapeau posé, sessions coupées, mot de passe renvoyé une fois et jamais stocké ni journalisé", async () => {
  const { owner, editor } = await team();
  const r = await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" });
  assert.equal(r.ok, true);
  assert.equal(r.mailed, false, "pas d'e-mail réglé : rien, sans erreur");
  const e = await db.prisma.user.findUnique({ where: { id: editor.id } });
  assert.equal(e.mustChangePassword, true);
  assert.equal(e.sessionVersion, 1);
  assert.ok(await bcrypt.compare(r.password, e.passwordHash));
  assert.ok(!(await bcrypt.compare("editor-password-1", e.passwordHash)));
  assert.match(e.passwordHash, /^\$2[aby]\$12\$/, "même algorithme et même coût que le reste");
  const everything = JSON.stringify({ audit: await db.prisma.auditLog.findMany(), users: await db.prisma.user.findMany({ select: { name: true, email: true, locale: true, totpSecret: true } }), settings: await db.prisma.setting.findMany() });
  assert.ok(!everything.includes(r.password), "le mot de passe n'est ni dans le journal ni en clair en base");
  const log = await db.prisma.auditLog.findMany();
  assert.equal(log.length, 1);
  assert.deepEqual({ actor: log[0].actor, action: log[0].action, target: log[0].target }, { actor: "o@x.org", action: "user.password.reset", target: "e@x.org" });
});

test("mode choisi : règle de solidité commune, le mot de passe choisi n'est pas renvoyé", async () => {
  const { owner, editor } = await team();
  assert.deepEqual(await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "custom", password: "court" }), { ok: false, reason: "weak" });
  assert.equal((await db.prisma.user.findUnique({ where: { id: editor.id } })).mustChangePassword, false);
  const r = await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "custom", password: "mot-de-passe-du-patron" });
  assert.equal(r.ok, true);
  assert.equal(r.password, undefined);
  const e = await db.prisma.user.findUnique({ where: { id: editor.id } });
  assert.ok(await bcrypt.compare("mot-de-passe-du-patron", e.passwordHash));
  assert.ok(!JSON.stringify(await db.prisma.auditLog.findMany()).includes("mot-de-passe-du-patron"));
});

test("courrier : envoyé si l'e-mail du site est réglé, sans le mot de passe ; en cas d'échec d'envoi, l'action réussit quand même", async () => {
  const { owner, editor } = await team();
  await setMail();
  const r = await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" });
  assert.equal(r.ok && r.mailed, true);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "e@x.org");
  assert.ok(!JSON.stringify(outbox[0]).includes(r.password));
  assert.match(outbox[0].text, /prochaine connexion|next time you sign in/);
  setMailTransportFactory(() => ({ sendMail: async () => { throw new Error("smtp down"); } }));
  const again = await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" });
  assert.equal(again.ok && again.mailed, false);
});

test("la double vérification et les clés d'accès restent en place", async () => {
  const { owner, editor } = await team();
  await db.prisma.user.update({ where: { id: editor.id }, data: { totpSecret: "SECRET", totpEnabledAt: new Date() } });
  await db.prisma.recoveryCode.create({ data: { userId: editor.id, codeHash: "h" } });
  await db.prisma.passkey.create({ data: { userId: editor.id, credentialId: "c1", publicKey: Buffer.from("k"), counter: 0, transports: "", name: "Clé" } });
  await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" });
  const e = await db.prisma.user.findUnique({ where: { id: editor.id } });
  assert.equal(e.totpSecret, "SECRET");
  assert.ok(e.totpEnabledAt);
  assert.equal(await db.prisma.recoveryCode.count({ where: { userId: editor.id } }), 1);
  assert.equal(await db.prisma.passkey.count({ where: { userId: editor.id } }), 1);
  // Quel que soit le moyen de connexion (la session est créée par le même billet), le drapeau est relu en base : la session est « forcée ».
  const u = await A.loadAdminUser(editor.id, 1);
  assert.equal(u.mustChangePassword, true);
  assert.equal(u.totp, true);
  assert.equal(u.passkeys, 1);
});

test("limitation de débit : par propriétaire et par cible, sans effet sur les refus de droits", async () => {
  const { owner, editor, admin } = await team();
  let last;
  for (let i = 0; i < 5; i++) last = await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate", now: 1000 + i });
  assert.equal(last.ok, true);
  assert.deepEqual(await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate", now: 2000 }), { ok: false, reason: "limited" });
  assert.equal((await T.resetMemberPassword({ actorId: owner.id, targetId: admin.id, mode: "generate", now: 2000 })).ok, true, "une autre personne n'est pas bloquée");
  assert.equal((await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate", now: 2000 + 61 * 60_000 })).ok, true, "la fenêtre se vide");
});

test("session forcée : relue en base, coupée par l'ancien numéro de session, et la règle d'accès n'ouvre RIEN d'autre que la page de choix", async () => {
  const { owner, editor, admin } = await team();
  await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" });
  assert.equal(await A.loadAdminUser(editor.id, 0), null, "la session ouverte avant est coupée");
  const forced = await A.loadAdminUser(editor.id, 1);
  assert.equal(forced.mustChangePassword, true);
  for (const min of ["editor", "admin", "owner"]) for (const opts of [{}, { allowUnenrolled: true }]) assert.equal(A.accessGate(forced, min, opts), "password", `${min} ${JSON.stringify(opts)}`);
  assert.equal(A.accessGate(forced, "editor", { allowForced: true, allowUnenrolled: true }), "ok");
  assert.equal(A.accessGate(forced, "admin", { allowForced: true }), "denied");
  assert.equal(A.accessGate(null, "editor", { allowForced: true }), "login");
  const free = await A.loadAdminUser(admin.id, 0);
  assert.equal(A.accessGate(free, "editor"), "ok");
  assert.equal(A.accessGate(free, "owner"), "denied");
  assert.equal(A.GATE_PATH.password, "/admin/choose-password");
});

test("choix du mot de passe personnel : identique au temporaire, trop court ou non confirmé refusés ; succès = drapeau levé, autres sessions coupées, audit sans secret", async () => {
  const { owner, editor } = await team();
  assert.deepEqual(await T.chooseOwnPassword(editor.id, "nouveau-mot-de-passe", "nouveau-mot-de-passe"), { ok: false, reason: "notRequired" }, "pas de drapeau : rien à faire");
  const temp = (await T.resetMemberPassword({ actorId: owner.id, targetId: editor.id, mode: "generate" })).password;
  assert.deepEqual(await T.chooseOwnPassword(editor.id, temp, temp), { ok: false, reason: "same" });
  assert.deepEqual(await T.chooseOwnPassword(editor.id, "court", "court"), { ok: false, reason: "weak" });
  assert.deepEqual(await T.chooseOwnPassword(editor.id, "nouveau-mot-de-passe", "autre-chose-vraiment"), { ok: false, reason: "mismatch" });
  assert.equal((await db.prisma.user.findUnique({ where: { id: editor.id } })).mustChangePassword, true);
  assert.deepEqual(await T.chooseOwnPassword(editor.id, "nouveau-mot-de-passe", "nouveau-mot-de-passe"), { ok: true });
  const e = await db.prisma.user.findUnique({ where: { id: editor.id } });
  assert.equal(e.mustChangePassword, false);
  assert.equal(e.sessionVersion, 2, "les autres sessions sont coupées");
  assert.ok(await bcrypt.compare("nouveau-mot-de-passe", e.passwordHash));
  assert.ok(!(await bcrypt.compare(temp, e.passwordHash)), "le temporaire ne vaut plus rien");
  const log = await db.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(log.map((l) => l.action), ["user.password.reset", "user.password.chosen"]);
  assert.ok(!JSON.stringify(log).includes("nouveau-mot-de-passe") && !JSON.stringify(log).includes(temp));
  const free = await A.loadAdminUser(editor.id, 2);
  assert.equal(free.mustChangePassword, false);
  assert.equal(A.accessGate(free, "editor"), "ok");
  assert.deepEqual(await T.chooseOwnPassword(editor.id, "encore-un-autre-mdp", "encore-un-autre-mdp"), { ok: false, reason: "notRequired" }, "un second onglet ne refait rien");
});

test("branchements : actions et routes d'admin fermées aux sessions forcées, déconnexion et MCP", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  const perms = read("src/core/permissions.ts");
  assert.match(perms, /if \(user\?\.mustChangePassword && !opts\.allowForced\) return null;/, "currentUser (routes d'API) : null par défaut pour une session forcée");
  assert.match(perms, /accessGate\(user, min, opts\)/, "requireRole (pages et actions) passe par la règle d'accès");
  // Seules la page de choix et son action ouvrent l'accès aux sessions forcées.
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /allowForced/.test(read(p))) out.push(p); } };
  walk("src");
  assert.deepEqual(out.sort(), ["src/app/admin/(auth)/choose-password/actions.ts", "src/app/admin/(auth)/choose-password/page.tsx", "src/app/admin/(auth)/login/page.tsx", "src/app/admin/(auth)/no-access/page.tsx", "src/app/admin/layout.tsx", "src/core/admin.ts", "src/core/auth/access.ts", "src/core/permissions.ts"]);
  for (const f of ["src/app/api/admin/upload/route.ts", "src/app/api/admin/backup/route.ts", "src/app/api/admin/backup/restore/apply/route.ts", "src/app/admin/bug-report/route.ts", "src/core/backup/guard.ts"]) assert.doesNotMatch(read(f), /allowForced/, f);
  // Déconnexion toujours possible depuis la page de choix.
  assert.match(read("src/app/admin/(auth)/choose-password/actions.ts"), /export async function signOutForced[\s\S]*signOut\(/);
  // Les jetons MCP appartiennent au site (hash en base), jamais à la session de la personne : aucune route MCP ne lit la session.
  for (const f of ["src/app/api/mcp/route.ts", "src/app/api/mcp/[token]/route.ts", "src/core/services/mcp/tokens.ts", "src/core/services/mcp/server.ts"]) assert.doesNotMatch(read(f), /@\/auth|permissions|currentUser/, f);
  // L'action du propriétaire : rôle exigé côté serveur, arguments dans le corps de la requête.
  assert.match(read("src/app/admin/(panel)/users/actions.ts"), /export async function setTemporaryPassword[\s\S]*adminCtx\(\{ right: "core:[a-z.]+" \}\)[\s\S]*resetMemberPassword/);
  // Le mot de passe n'est jamais dans l'adresse ni stocké par le navigateur.
  const ui = read("src/components/admin/TemporaryPasswordButton.tsx");
  assert.doesNotMatch(ui, /localStorage|sessionStorage|document\.cookie|router\.|searchParams|location\./);
});

test("textes : mail sans mot de passe, FR et EN, clés d'audit", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const d of [fr, en]) assert.doesNotMatch(d["users.tempMail.body"], /\{password\}|\{pass/);
  for (const k of ["audit.action.user.password.reset", "audit.action.user.password.chosen", "users.temp.denied", "choosePassword.title"]) assert.ok(fr[k] && en[k], k);
});
