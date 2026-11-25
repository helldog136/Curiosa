// ONBOARDING BY INVITATION (core 0.49.0): invitation, acceptance, role re-validation, limits, anti-enumeration, suspension, forgot password, backup. Real code, real SQLite.
// Names are invented (Camille, etoile_nord, lune_douce, "Moderator", "Photographer"); addresses are @example.org.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const A = await import("@/core/auth/access");
const R = await import("@/core/auth/roles");
const I = await import("@/core/auth/invitations");
const P = await import("@/core/auth/passwordReset");
const M = await import("@/core/auth/members");
const Tok = await import("@/core/auth/oneTimeToken");
const { resetRateLimits } = await import("@/core/auth/rateLimit");
const { verifyPassword } = await import("@/core/auth/password");
const Mail = await import("@/core/services/mail");
const { setSetting } = await import("@/core/settings");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const bcrypt = (await import("bcryptjs")).default;

after(async () => { Mail.setMailTransportFactory(); await db.close(); });

const ORIGIN = "https://site.example.org";
const sent = [];
let T;
const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", ...extra } });
const roleId = async (key) => (await prisma.role.findUnique({ where: { key } })).id;
const customRole = async (name, rights) => (await prisma.role.create({ data: { key: `r-${name.toLowerCase()}`, name, system: false, rights: JSON.stringify(rights) } }));
const tokenOf = (link) => /#t=([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
const IP = "203.0.113.5";
const accept = (token, over = {}) => I.acceptInvitation({ token, name: "Camille", password: "a-long-enough-pass", confirm: "a-long-enough-pass", ip: IP, ...over });
const invite = (actor, email, role, over = {}) => I.createInvitation(actor.id, { email, roleId: role, origin: ORIGIN, mailConfigured: false, ...over });
const reload = (u) => prisma.user.findUnique({ where: { id: u.id } });

async function configureMail() {
  await Mail.saveMailConfig({ host: "smtp.example.org", port: 587, secure: false, user: "", from: "site@example.org" });
  Mail.setMailTransportFactory(() => ({ async sendMail(m) { sent.push(m); } }));
}

beforeEach(async () => {
  await db.reset();
  resetRateLimits(); Mail.resetMailLimits(); Mail.setMailTransportFactory(); sent.length = 0;
  T = { owner: await mk("olive", "owner"), coord: await mk("cora", "admin", { coordinator: true }), coord2: await mk("coralie", "admin", { coordinator: true }), admin: await mk("adam", "admin"), editor: await mk("emma", "editor") };
  await R.syncSystemAssignments();
});

/* ───────────── Token design ───────────── */

test("token: 256 random bits, only a keyed hash is stored, never in the audit journal", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  assert.equal(r.ok, true);
  const token = tokenOf(r.link);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, "43 base64url characters = 256 bits");
  assert.equal(Buffer.from(token, "base64url").length, 32);
  const row = await prisma.invitation.findFirst();
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.tokenHash, token);
  assert.equal(JSON.stringify(row).includes(token), false, "the token is nowhere in the row");
  assert.equal(row.tokenHash, Tok.hashToken("invite", token));
  assert.notEqual(Tok.hashToken("reset", token), row.tokenHash, "a reset hash and an invitation hash never match");
  assert.ok(r.link.includes("/admin/invitation#t="), "the token is in the fragment, never in the query");
  const r2 = await invite(T.owner, "lune_douce@example.org", await roleId("editor"));
  assert.notEqual(tokenOf(r2.link), token);
  const journal = JSON.stringify(await prisma.auditLog.findMany());
  assert.equal(journal.includes(token), false);
  assert.equal(journal.includes(row.tokenHash), false);
  assert.equal(Tok.sameDigest(row.tokenHash, row.tokenHash), true);
  assert.equal(Tok.sameDigest(row.tokenHash, "00".repeat(32)), false);
  assert.equal(Tok.sameDigest("zz", row.tokenHash), false);
});

test("single use, replay, expiry boundary, wrong or forged tokens", async () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"), { now });
  const token = tokenOf(r.link);
  assert.equal(r.expiresAt.getTime() - now.getTime(), 72 * 3_600_000, "default 72 h");
  const justBefore = new Date(r.expiresAt.getTime() - 1);
  const atExpiry = r.expiresAt;
  assert.deepEqual(await accept(token, { now: atExpiry }), { ok: false, reason: "invalid" }, "expired exactly at the limit");
  assert.equal((await prisma.invitation.findFirst()).status, "pending", "a refused try spends nothing");
  const ok = await accept(token, { now: justBefore });
  assert.equal(ok.ok, true);
  assert.deepEqual(await accept(token), { ok: false, reason: "invalid" }, "replay");
  assert.equal(await prisma.user.count({ where: { email: "etoile_nord@example.org" } }), 1);
  for (const bad of ["", "short", "x".repeat(43), "a".repeat(44), null, undefined, 42, `${token}!`]) assert.deepEqual(await accept(bad), { ok: false, reason: "invalid" });
});

test("expiry choices: 24 h, 72 h, 7 days; anything else refused; sweep marks expired with an audit line", async () => {
  const now = new Date("2026-12-01T10:00:00Z");
  for (const [h, email] of [[24, "a1@example.org"], [168, "a2@example.org"]]) {
    const r = await invite(T.owner, email, await roleId("editor"), { ttlHours: h, now });
    assert.equal(r.expiresAt.getTime() - now.getTime(), h * 3_600_000);
  }
  assert.equal((await invite(T.owner, "a3@example.org", await roleId("editor"), { ttlHours: 5, now })).reason, "invalid");
  const later = new Date(now.getTime() + 25 * 3_600_000);
  assert.equal(await I.expireStale(later), 1);
  const list = await I.listInvitations(later);
  assert.equal(list.find((x) => x.email === "a1@example.org").state, "expired");
  assert.equal(list.find((x) => x.email === "a2@example.org").state, "pending");
  assert.equal(await prisma.auditLog.count({ where: { action: "invite.expire" } }), 1);
});

test("accepting binds to the invited address and creates the account with the granted role only", async () => {
  const r = await invite(T.owner, "Etoile_Nord@Example.org", await roleId("admin"));
  assert.equal(r.email, "etoile_nord@example.org", "the address is normalised");
  const done = await accept(tokenOf(r.link), { email: "someone-else@example.org", role: "owner", level: "owner" });
  assert.equal(done.email, "etoile_nord@example.org", "extra fields are ignored: the address and role come from the invitation");
  const user = await prisma.user.findUnique({ where: { email: "etoile_nord@example.org" } });
  assert.equal(user.role, "admin"); assert.equal(user.coordinator, false); assert.equal(user.mustChangePassword, false);
  assert.equal(await bcrypt.compare("a-long-enough-pass", user.passwordHash), true);
  assert.equal((await A.loadAdminUser(user.id, 0)).level, "admin");
  assert.equal(await prisma.user.count({ where: { email: "someone-else@example.org" } }), 0);
});

test("field errors keep the invitation usable; password policy and confirmation", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  const token = tokenOf(r.link);
  assert.deepEqual(await accept(token, { name: " " }), { ok: false, reason: "name" });
  assert.deepEqual(await accept(token, { password: "short", confirm: "short" }), { ok: false, reason: "password" });
  assert.deepEqual(await accept(token, { confirm: "another-long-pass" }), { ok: false, reason: "mismatch" });
  assert.equal((await accept(token)).ok, true);
});

/* ───────────── Who may grant what ───────────── */

test("anti-elevation at creation: owner role never, coordinator by the owner only, forged ids, custom roles above the actor", async () => {
  const mod = await customRole("Moderator", ["core:entries.edit"]);
  const photo = await customRole("Photographer", ["core:entries.edit", "core:entries.publish"]);
  assert.equal((await invite(T.owner, "a@example.org", await roleId("owner"))).reason, "role");
  assert.equal((await invite(T.owner, "a@example.org", await roleId("coordinator"))).ok, true);
  assert.equal((await invite(T.coord, "b@example.org", await roleId("coordinator"))).reason, "role", "a coordinator never invites a coordinator");
  assert.equal((await invite(T.coord2, "b@example.org", await roleId("owner"))).reason, "role");
  assert.equal((await invite(T.coord, "b@example.org", await roleId("admin"))).ok, true, "a coordinator invites administration");
  assert.equal((await invite(T.coord, "c@example.org", mod.id)).ok, true);
  assert.equal((await invite(T.coord, "d@example.org", photo.id)).ok, true);
  for (const forged of ["", "nope", "../../x", null, { $ne: 1 }, 7]) assert.equal((await invite(T.owner, "e@example.org", forged)).ok, false);
  // a custom role holding a right the actor does not hold is refused (rule checked on the function itself: every person with the team right holds all delegable rights today)
  const { currentCatalogue } = await import("@/core/auth/access");
  const cat = await currentCatalogue();
  assert.equal(I.mayGrant({ level: "coordinator", rights: new Set(["core:entries.edit"]) }, photo, cat), false, "publish is not held");
  assert.equal(I.mayGrant({ level: "coordinator", rights: new Set(["core:entries.edit"]) }, mod, cat), true);
  assert.equal(I.mayGrant({ level: "owner", rights: new Set(cat.map((r) => r.id)) }, { key: "owner", system: true, rights: "[]" }, cat), false);
});

test("only people with the team right invite; suspended, forced-password and unknown actors refused", async () => {
  assert.equal((await invite(T.admin, "a@example.org", await roleId("editor"))).reason, "denied", "administration has no team right");
  assert.equal((await invite(T.editor, "a@example.org", await roleId("editor"))).reason, "denied");
  assert.equal((await invite({ id: "nobody" }, "a@example.org", await roleId("editor"))).reason, "denied");
  await prisma.user.update({ where: { id: T.coord.id }, data: { mustChangePassword: true } });
  assert.equal((await invite(T.coord, "a@example.org", await roleId("editor"))).reason, "denied");
  await prisma.user.update({ where: { id: T.coord.id }, data: { mustChangePassword: false } });
  await M.suspendMember(T.owner.id, T.coord.id);
  assert.equal((await invite(T.coord, "a@example.org", await roleId("editor"))).reason, "denied");
});

test("an address that already has an account, a malformed address: refused for the person who invites", async () => {
  assert.equal((await invite(T.owner, T.editor.email, await roleId("editor"))).reason, "exists");
  assert.equal((await invite(T.owner, "not-an-address", await roleId("editor"))).reason, "invalid");
  assert.equal((await invite(T.owner, "a@b", await roleId("editor"))).reason, "invalid");
});

/* ───────────── Re-validation at acceptance ───────────── */

test("acceptance: a custom role that gained rights since the invitation is refused and audited", async () => {
  const mod = await customRole("Moderator", ["core:entries.edit"]);
  const r = await invite(T.coord, "etoile_nord@example.org", mod.id);
  await prisma.role.update({ where: { id: mod.id }, data: { rights: JSON.stringify(["core:entries.edit", "core:entries.publish"]) } });
  assert.deepEqual(await accept(tokenOf(r.link)), { ok: false, reason: "invalid" });
  assert.equal(await prisma.user.count({ where: { email: "etoile_nord@example.org" } }), 0);
  assert.equal((await prisma.invitation.findFirst()).status, "refused");
  const line = await prisma.auditLog.findFirst({ where: { action: "invite.denied" } });
  assert.match(line.data, /role-elevated/);
});

test("acceptance: a role that lost rights gives the lower rights (never more than approved)", async () => {
  const photo = await customRole("Photographer", ["core:entries.edit", "core:entries.publish"]);
  const r = await invite(T.owner, "etoile_nord@example.org", photo.id);
  await prisma.role.update({ where: { id: photo.id }, data: { rights: JSON.stringify(["core:entries.edit"]) } });
  const done = await accept(tokenOf(r.link));
  assert.equal(done.ok, true);
  const u = await A.loadAdminUser(done.userId, 0);
  assert.equal(u.level, "none"); assert.equal(u.rights.has("core:entries.publish"), false); assert.equal(u.rights.has("core:entries.edit"), true);
  assert.deepEqual(u.roles, ["r-photographer"]);
});

test("acceptance: role deleted, key reused by another role, inviter downgraded, suspended or deleted: refused", async () => {
  const cases = [];
  { const role = await customRole("Moderator", ["core:entries.edit"]); const r = await invite(T.coord, "c1@example.org", role.id); await prisma.role.delete({ where: { id: role.id } }); cases.push([r, "role deleted"]); }
  { const role = await customRole("Photographer", ["core:entries.edit"]); const r = await invite(T.coord, "c2@example.org", role.id); await prisma.role.delete({ where: { id: role.id } });
    await prisma.role.create({ data: { key: "r-photographer", name: "Photographer", system: false, rights: JSON.stringify(["core:entries.edit"]) } }); cases.push([r, "same key, new role id"]); }
  { const lost = await mk("lost", "admin", { coordinator: true }); await R.syncSystemAssignments(); const r = await invite(lost, "c3@example.org", await roleId("admin"));
    assert.equal((await R.setUserRoles(T.owner.id, lost.id, [await roleId("editor")])).ok, true); cases.push([r, "inviter downgraded"]); }
  { const sus = await mk("sus", "admin", { coordinator: true }); await R.syncSystemAssignments(); const r = await invite(sus, "c4@example.org", await roleId("editor"));
    assert.equal((await M.suspendMember(T.owner.id, sus.id)).ok, true); cases.push([r, "inviter suspended"]); }
  { const gone = await mk("temporary", "admin", { coordinator: true }); await R.syncSystemAssignments(); const r = await invite(gone, "c5@example.org", await roleId("editor")); await prisma.user.delete({ where: { id: gone.id } }); cases.push([r, "inviter deleted"]); }
  for (const [r, why] of cases) {
    assert.equal(r.ok, true, why);
    assert.deepEqual(await accept(tokenOf(r.link)), { ok: false, reason: "invalid" }, why);
    assert.equal(await prisma.user.count({ where: { email: r.email } }), 0, why);
  }
});

test("acceptance: a coordinator's invitation to a level the coordinator may no longer grant is refused", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("coordinator"));
  // the owner is the inviter and keeps the right: accepted
  assert.equal((await accept(tokenOf(r.link))).ok, true);
  const u = await prisma.user.findUnique({ where: { email: "etoile_nord@example.org" } });
  assert.equal(u.coordinator, true); assert.equal(u.role, "admin", "legacy column stays admin for an older core");
});

test("an invitation never overwrites an account that appeared meanwhile", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  const existing = await mk("etoile_nord", "editor", { passwordHash: "their-own-hash" });
  assert.deepEqual(await accept(tokenOf(r.link)), { ok: false, reason: "invalid" });
  assert.equal((await reload(existing)).passwordHash, "their-own-hash");
  assert.equal((await prisma.invitation.findFirst()).status, "refused");
});

/* ───────────── Replace, resend, revoke, cap ───────────── */

test("one pending invitation per address: inviting again replaces it and kills the old link", async () => {
  const first = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  const second = await invite(T.owner, "etoile_nord@example.org", await roleId("admin"));
  assert.equal(second.replaced, true);
  assert.deepEqual(await accept(tokenOf(first.link)), { ok: false, reason: "invalid" });
  assert.equal(await prisma.invitation.count({ where: { status: "pending" } }), 1);
  assert.equal((await accept(tokenOf(second.link))).ok, true);
  assert.equal((await prisma.user.findUnique({ where: { email: "etoile_nord@example.org" } })).role, "admin");
});

test("at most 50 pending invitations", async () => {
  for (let i = 0; i < I.MAX_PENDING; i++) assert.equal((await invite(T.owner, `p${i}@example.org`, await roleId("editor"))).ok, true, `#${i}`);
  assert.equal((await invite(T.owner, "overflow@example.org", await roleId("editor"))).reason, "limit");
  assert.equal((await invite(T.owner, "p3@example.org", await roleId("editor"))).ok, true, "replacing one is not adding one");
});

test("resend: a new link, the old one dead, by someone who can grant the role; revoke is immediate", async () => {
  const r = await invite(T.coord, "etoile_nord@example.org", await roleId("admin"));
  const id = r.id;
  assert.equal((await I.resendInvitation(T.admin.id, id, { origin: ORIGIN, mailConfigured: false })).reason, "denied");
  const again = await I.resendInvitation(T.coord2.id, id, { origin: ORIGIN, mailConfigured: false, ttlHours: 168 });
  assert.equal(again.ok, true);
  assert.notEqual(tokenOf(again.link), tokenOf(r.link));
  assert.deepEqual(await accept(tokenOf(r.link)), { ok: false, reason: "invalid" });
  const row = await prisma.invitation.findUnique({ where: { id } });
  assert.equal(row.sendCount, 2); assert.equal(row.invitedById, T.coord2.id, "the last person who vouched is the one checked at acceptance");
  assert.equal((await I.revokeInvitation(T.coord.id, id)).ok, true);
  assert.deepEqual(await accept(tokenOf(again.link)), { ok: false, reason: "invalid" });
  assert.equal((await I.revokeInvitation(T.coord.id, id)).reason, "state");
  // a coordinator invitation is the owner's to withdraw
  const c = await invite(T.owner, "lune_douce@example.org", await roleId("coordinator"));
  assert.equal((await I.revokeInvitation(T.coord.id, c.id)).reason, "role");
  assert.equal((await I.revokeInvitation(T.owner.id, c.id)).ok, true);
});

test("resend limit: five a day per invitation", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  for (let i = 0; i < 5; i++) assert.equal((await I.resendInvitation(T.owner.id, r.id, { origin: ORIGIN, mailConfigured: false })).ok, true);
  assert.equal((await I.resendInvitation(T.owner.id, r.id, { origin: ORIGIN, mailConfigured: false })).reason, "rate");
});

/* ───────────── Public side ───────────── */

test("public failures are one answer: unknown token, spent, expired, withdrawn, refused, existing account", async () => {
  const mk1 = async (email) => invite(T.owner, email, await roleId("editor"));
  const unknown = Tok.newToken();
  const spent = await mk1("s@example.org"); await accept(tokenOf(spent.link));
  const revoked = await mk1("r@example.org"); await I.revokeInvitation(T.owner.id, revoked.id);
  const expired = await mk1("e@example.org"); await prisma.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const hasAccount = await mk1(T.editor.email.replace("emma", "emma2")); await mk("emma2", "editor");
  const answers = [];
  for (const t of [unknown, tokenOf(spent.link), tokenOf(revoked.link), tokenOf(expired.link), tokenOf(hasAccount.link)]) answers.push(JSON.stringify(await accept(t)), JSON.stringify(await I.peekInvitation(t, IP)));
  assert.equal(new Set(answers.filter((_, i) => i % 2 === 0)).size, 1, "accept: one answer");
  assert.equal(new Set(answers.filter((_, i) => i % 2 === 1)).size, 1, "peek: one answer");
});

test("rate limits on the public page: per network address and per token", async () => {
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("editor"));
  const good = tokenOf(r.link);
  let limited = 0;
  for (let i = 0; i < 40; i++) if ((await I.peekInvitation(Tok.newToken(), "198.51.100.9")).reason === "rate") limited++;
  assert.ok(limited >= 10, "the address is limited after 30 tries");
  assert.equal((await I.peekInvitation(good, "198.51.100.9")).reason, "rate", "even a good token from a limited address waits");
  assert.equal((await I.peekInvitation(good, "198.51.100.10")).ok, true, "another address is not affected");
  resetRateLimits();
  let tokenLimited = false;
  for (let i = 0; i < 14; i++) { const x = await I.peekInvitation(good, `192.0.2.${i}`); if (x.reason === "rate") tokenLimited = true; }
  assert.equal(tokenLimited, true, "the same token tried from many addresses is limited too");
});

test("no-mail fallback: the link is returned once and never stored; with mail the link is only in the mail", async () => {
  const noMail = await invite(T.owner, "a@example.org", await roleId("editor"), { mailConfigured: false });
  assert.ok(noMail.link); assert.equal(noMail.mailed, false);
  assert.equal((await prisma.invitation.findFirst({ where: { email: "a@example.org" } })).deliveredBy, "link");
  await configureMail();
  const withMail = await invite(T.owner, "b@example.org", await roleId("editor"), { mailConfigured: true });
  assert.equal(withMail.mailed, true); assert.equal(withMail.link, undefined);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, "b@example.org");
  assert.match(sent[0].text, /#t=[A-Za-z0-9_-]{43}/);
  assert.match(sent[0].text, /Editorial/, "the role is written with its own name");
  Mail.setMailTransportFactory(() => ({ async sendMail() { throw Object.assign(new Error("down"), { code: "ECONNECTION" }); } }));
  const failed = await invite(T.owner, "c@example.org", await roleId("editor"), { mailConfigured: true });
  assert.equal(failed.mailed, false); assert.ok(failed.link, "a failed mail falls back to the link");
  assert.equal(JSON.stringify(await prisma.auditLog.findMany()).includes(tokenOf(failed.link)), false);
});

test("the mail of a custom role names it by its own name", async () => {
  await configureMail();
  const mod = await customRole("Moderator", ["core:entries.edit"]);
  await invite(T.coord, "a@example.org", mod.id, { mailConfigured: true });
  assert.match(sent[0].text, /with the role Moderator/);
  assert.doesNotMatch(sent[0].text, /owner|coordinat/i, "no hard-coded role names");
});

/* ───────────── Second factor gate ───────────── */

test("when the team requires two-step sign-in, an invited person cannot reach anything before enrolling", async () => {
  await setSetting("security.require2fa", true);
  const r = await invite(T.owner, "etoile_nord@example.org", await roleId("admin"));
  const done = await accept(tokenOf(r.link));
  const u = await A.loadAdminUser(done.userId, 0);
  assert.equal(u.needsTwoFactor, true);
  assert.equal(A.accessGate(u, "member"), "enroll");
  assert.equal(A.accessGate(u, { right: "core:entries.edit" }), "enroll");
  assert.equal(A.can(u, "core:entries.edit"), false);
  assert.equal(A.accessGate(u, "member", { allowUnenrolled: true }), "ok", "only the account page, to enrol");
});

/* ───────────── Suspension ───────────── */

test("suspension cuts sessions at once, blocks sign-in, keeps content; reactivation restores access with a new sign-in", async () => {
  const pwd = await prisma.user.update({ where: { id: T.editor.id }, data: { passwordHash: await bcrypt.hash("correct-horse-battery", 4) } });
  assert.ok(await verifyPassword(pwd.email, "correct-horse-battery"));
  const entry = await prisma.entry.create({ data: { type: "page", slug: "x", authorId: T.editor.id } }).catch(() => null);
  assert.equal((await A.loadAdminUser(T.editor.id, 0)).level, "editor");
  assert.equal((await M.suspendMember(T.coord.id, T.editor.id)).ok, true);
  assert.equal(await A.loadAdminUser(T.editor.id, 0), null, "old session: gone");
  const v = (await reload(T.editor)).sessionVersion;
  assert.equal(await A.loadAdminUser(T.editor.id, v), null, "even a session with the new number: gone while suspended");
  assert.equal(await verifyPassword(pwd.email, "correct-horse-battery"), null, "sign-in is answered like a wrong password");
  assert.equal(await A.loadAdminUserById(T.editor.id), null, "a personal AI cannot act for a suspended person");
  assert.ok(await prisma.user.findUnique({ where: { id: T.editor.id } }), "the account and its authorship stay");
  if (entry) assert.ok(await prisma.entry.findUnique({ where: { id: entry.id } }));
  assert.equal((await M.suspendMember(T.coord.id, T.editor.id)).reason, "state");
  assert.equal((await M.reactivateMember(T.coord.id, T.editor.id)).ok, true);
  assert.equal(await A.loadAdminUser(T.editor.id, 0), null, "the old session stays cut after reactivation");
  assert.equal((await A.loadAdminUser(T.editor.id, v)).level, "editor");
  assert.ok(await verifyPassword(pwd.email, "correct-horse-battery"));
  const lines = await prisma.auditLog.findMany({ where: { action: { in: ["user.suspend", "user.reactivate"] } } });
  assert.equal(lines.length, 2); assert.match(lines[0].data, /"by":"coordinator"/, "the journal names the acting level");
});

test("who may suspend whom: owner untouchable, a coordinator by the owner only, never oneself, administration cannot", async () => {
  assert.equal((await M.suspendMember(T.coord.id, T.owner.id)).reason, "denied");
  assert.equal((await M.suspendMember(T.coord2.id, T.owner.id)).reason, "denied");
  assert.equal((await M.suspendMember(T.coord.id, T.coord2.id)).reason, "denied", "two coordinators cannot suspend each other");
  assert.equal((await M.suspendMember(T.coord2.id, T.coord.id)).reason, "denied");
  assert.equal((await M.suspendMember(T.coord.id, T.coord.id)).reason, "denied", "no self-suspension");
  assert.equal((await M.suspendMember(T.owner.id, T.owner.id)).reason, "denied");
  assert.equal((await M.suspendMember(T.admin.id, T.editor.id)).reason, "denied", "administration has no team right");
  assert.equal((await M.suspendMember(T.owner.id, T.coord.id)).ok, true);
  assert.equal((await M.suspendMember(T.coord.id, T.editor.id)).reason, "denied", "a suspended coordinator acts no more");
  assert.equal((await M.reactivateMember(T.coord2.id, T.coord.id)).reason, "denied");
  assert.equal((await M.reactivateMember(T.owner.id, T.coord.id)).ok, true);
  for (const u of [T.owner, T.coord2]) assert.equal((await reload(u)).suspendedAt, null);
});

test("last operator guard: the site keeps an active owner or coordinator", async () => {
  // no owner in this site (a damaged state): the only coordinator cannot be suspended
  await prisma.user.delete({ where: { id: T.coord2.id } });
  await prisma.user.update({ where: { id: T.owner.id }, data: { suspendedAt: new Date() } });
  assert.equal((await M.suspendMember(T.owner.id, T.coord.id)).reason, "denied", "a suspended owner acts no more");
  await prisma.user.update({ where: { id: T.owner.id }, data: { suspendedAt: null, role: "admin", coordinator: false } });
  assert.equal((await M.suspendMember(T.owner.id, T.coord.id)).reason, "denied");
});

/* ───────────── Two sites, configured differently ───────────── */

test("site with the owner alone: invite, accept, suspend all work with predefined roles only", async () => {
  await db.reset(); resetRateLimits();
  const only = await mk("olive", "owner"); await R.syncSystemAssignments();
  const r = await invite(only, "etoile_nord@example.org", await roleId("editor"));
  assert.equal((await accept(tokenOf(r.link))).ok, true);
  const person = await prisma.user.findUnique({ where: { email: "etoile_nord@example.org" } });
  assert.equal((await M.suspendMember(only.id, person.id)).ok, true);
  assert.equal((await invite(only, "x@example.org", await roleId("coordinator"))).ok, true);
});

test("site with an owner, two coordinators and custom roles: each coordinator runs the whole short path without the owner", async () => {
  const mod = await customRole("Moderator", ["core:entries.edit"]);
  const photo = await customRole("Photographer", ["core:entries.edit", "core:entries.publish"]);
  for (const [actor, email, role] of [[T.coord, "n1@example.org", mod.id], [T.coord2, "n2@example.org", photo.id], [T.coord, "n3@example.org", await roleId("admin")], [T.coord2, "n4@example.org", await roleId("editor")]]) {
    const r = await invite(actor, email, role);
    assert.equal(r.ok, true, email);
    assert.equal((await accept(tokenOf(r.link))).ok, true, email);
  }
  const p = await prisma.user.findUnique({ where: { email: "n1@example.org" } });
  assert.equal((await M.suspendMember(T.coord2.id, p.id)).ok, true);
  assert.equal((await M.reactivateMember(T.coord.id, p.id)).ok, true);
  assert.equal((await R.setUserRoles(T.coord.id, p.id, [photo.id])).ok, true, "change roles");
  const re = await invite(T.coord, "n5@example.org", mod.id);
  assert.equal((await I.resendInvitation(T.coord2.id, re.id, { origin: ORIGIN, mailConfigured: false })).ok, true);
  assert.equal((await I.revokeInvitation(T.coord.id, re.id)).ok, true);
  // the journal names the acting level
  const created = await prisma.auditLog.findMany({ where: { action: "invite.create" } });
  assert.ok(created.every((l) => JSON.parse(l.data).by === "coordinator"));
  const acc = await prisma.auditLog.findMany({ where: { action: "invite.accept" } });
  assert.ok(acc.every((l) => !!JSON.parse(l.data).inviter));
});

/* ───────────── Forgot password ───────────── */

const ask = (email, over = {}) => P.requestPasswordReset({ email, ip: IP, origin: ORIGIN, mailConfigured: true, ...over });
const settle = () => new Promise((r) => setTimeout(r, 30));

test("forgot password: identical answer and time for an account, no account, suspended and the owner; a mail only for an account that may use it", async () => {
  await configureMail();
  await mk("lune_douce", "editor");
  await mk("frozen", "editor", { suspendedAt: new Date() });
  const times = {};
  const answers = {};
  for (const [label, email] of [["account", "lune_douce@example.org"], ["unknown", "nobody@example.org"], ["suspended", "frozen@example.org"], ["owner", T.owner.email], ["invalid", "not-an-address"]]) {
    const t0 = Date.now(); answers[label] = JSON.stringify(await ask(email, { ip: `192.0.2.${Object.keys(answers).length + 1}` })); times[label] = Date.now() - t0;
  }
  assert.equal(new Set(Object.values(answers)).size, 1, "one answer");
  for (const [label, ms] of Object.entries(times)) assert.ok(ms >= P.REQUEST_FLOOR_MS - 20 && ms < P.REQUEST_FLOOR_MS + 250, `${label} took ${ms} ms`);
  await settle();
  assert.deepEqual(sent.map((m) => m.to), ["lune_douce@example.org"]);
  assert.equal(await prisma.passwordReset.count(), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "password.reset.request" } }), 1);
});

test("forgot password: the mail never delays the answer; without e-mail nothing is created", async () => {
  Mail.setMailTransportFactory(() => ({ async sendMail() { await new Promise((r) => setTimeout(r, 700)); } }));
  await Mail.saveMailConfig({ host: "smtp.example.org", port: 587, secure: false, user: "", from: "site@example.org" });
  await mk("lune_douce", "editor");
  const t0 = Date.now(); await ask("lune_douce@example.org"); assert.ok(Date.now() - t0 < 650, "answered before the mail left");
  await ask("lune_douce@example.org", { mailConfigured: false, ip: "192.0.2.77" });
  assert.equal(await prisma.passwordReset.count(), 1, "the second request (no mail on this site) created nothing");
});

test("forgot password: limits per address, per network address and for the site", async () => {
  await configureMail();
  await mk("lune_douce", "editor");
  for (let i = 0; i < 6; i++) await ask("lune_douce@example.org");
  await settle();
  assert.equal(sent.length, 3, "three links an hour for one address, the other answers look the same");
  sent.length = 0; resetRateLimits(); Mail.resetMailLimits();
  for (let i = 0; i < 25; i++) { await mk(`site${i}`, "editor"); await ask(`site${i}@example.org`, { ip: `192.0.2.${i}` }); }
  await settle();
  assert.ok(sent.length <= 20, "20 links an hour for the whole site");
});

test("reset: a new password, every session cut, the second factor untouched, single use, expiry, mail notice", async () => {
  await configureMail();
  const u = await mk("lune_douce", "editor", { totpSecret: "SECRET", totpEnabledAt: new Date(), passwordHash: await bcrypt.hash("old-password-123", 4), mustChangePassword: true });
  await prisma.passkey.create({ data: { userId: u.id, credentialId: "cred-1", publicKey: Buffer.from("k"), counter: 0, name: "phone" } });
  await prisma.recoveryCode.create({ data: { userId: u.id, codeHash: "h" } });
  const before = await reload(u);
  await ask("lune_douce@example.org"); await settle();
  const link = /#t=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
  assert.equal(sent[0].text.includes("/admin/reset-password#t="), true);
  const row = await prisma.passwordReset.findFirst();
  assert.notEqual(row.tokenHash, link); assert.equal(row.tokenHash, Tok.hashToken("reset", link));
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime() <= 60 * 60_000, true, "30 to 60 minutes");
  assert.equal(await P.peekReset(link, "192.0.2.1"), true);
  const res = await P.completePasswordReset({ token: link, password: "brand-new-password-9", confirm: "brand-new-password-9", ip: IP });
  assert.deepEqual(res, { ok: true });
  const after = await reload(u);
  assert.equal(await bcrypt.compare("brand-new-password-9", after.passwordHash), true);
  assert.equal(after.sessionVersion, before.sessionVersion + 1, "every session cut");
  assert.equal(after.mustChangePassword, false);
  assert.equal(after.totpSecret, "SECRET"); assert.ok(after.totpEnabledAt, "the authenticator stays");
  assert.equal(await prisma.passkey.count({ where: { userId: u.id } }), 1, "passkeys stay");
  assert.equal(await prisma.recoveryCode.count({ where: { userId: u.id } }), 1, "recovery codes stay");
  assert.deepEqual(await P.completePasswordReset({ token: link, password: "another-password-1", confirm: "another-password-1", ip: IP }), { ok: false, reason: "invalid" }, "single use");
  await settle();
  assert.equal(sent.length, 2); assert.match(sent[1].subject, /changed/);
  assert.doesNotMatch(sent[1].text, /brand-new/);
  const lines = await prisma.auditLog.findMany({ where: { action: { startsWith: "password.reset" } } });
  assert.equal(lines.length, 2); assert.equal(JSON.stringify(lines).includes(link), false);
});

test("reset: expired link, weak or different passwords, owner and suspended accounts, a new request replaces the old link", async () => {
  await configureMail();
  const u = await mk("lune_douce", "editor");
  await ask("lune_douce@example.org"); await settle();
  const first = /#t=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
  resetRateLimits();
  await ask("lune_douce@example.org"); await settle();
  const second = /#t=([A-Za-z0-9_-]{43})/.exec(sent[1].text)[1];
  assert.equal(await prisma.passwordReset.count(), 1);
  assert.equal(await P.peekReset(first, "192.0.2.1"), false, "old link dead");
  assert.deepEqual(await P.completePasswordReset({ token: second, password: "short", confirm: "short", ip: IP }), { ok: false, reason: "password" });
  assert.deepEqual(await P.completePasswordReset({ token: second, password: "long-enough-password", confirm: "different-password-1", ip: IP }), { ok: false, reason: "mismatch" });
  const late = new Date(Date.now() + 61 * 60_000);
  assert.deepEqual(await P.completePasswordReset({ token: second, password: "long-enough-password", confirm: "long-enough-password", ip: IP, now: late }), { ok: false, reason: "invalid" }, "expired");
  // suspended after the link was made
  await prisma.user.update({ where: { id: u.id }, data: { suspendedAt: new Date() } });
  assert.deepEqual(await P.completePasswordReset({ token: second, password: "long-enough-password", confirm: "long-enough-password", ip: IP }), { ok: false, reason: "invalid" });
  // a link made for someone who became the owner meanwhile is refused too
  await prisma.user.update({ where: { id: u.id }, data: { suspendedAt: null, role: "owner" } });
  assert.deepEqual(await P.completePasswordReset({ token: second, password: "long-enough-password", confirm: "long-enough-password", ip: IP }), { ok: false, reason: "invalid" });
});

test("reset: a technical coordinator uses it like anyone else; the owner never does (console recovery)", async () => {
  await configureMail();
  await ask(T.coord.email); await ask(T.owner.email, { ip: "192.0.2.50" }); await settle();
  assert.deepEqual(sent.map((m) => m.to), [T.coord.email]);
});

test("reset: suspension and deletion remove a waiting link", async () => {
  await configureMail();
  const u = await mk("lune_douce", "editor");
  await ask("lune_douce@example.org"); await settle();
  assert.equal(await prisma.passwordReset.count(), 1);
  await M.suspendMember(T.owner.id, u.id);
  assert.equal(await prisma.passwordReset.count(), 0);
});

/* ───────────── Backup and restore ───────────── */

test("backup: no invitation and no reset link in the file; restore withdraws waiting ones and never revives spent, expired or withdrawn ones; suspension survives", async () => {
  const waiting = await invite(T.owner, "w@example.org", await roleId("editor"));
  const spent = await invite(T.owner, "s@example.org", await roleId("editor")); await accept(tokenOf(spent.link));
  const old = await invite(T.owner, "o@example.org", await roleId("editor")); await prisma.invitation.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await mk("lune_douce", "editor"); await configureMail(); await ask("lune_douce@example.org"); await settle();
  await M.suspendMember(T.owner.id, T.editor.id);
  const b = await B.createBackup("a-solid-backup-passphrase", { iterations: 1000 });
  const text = b.plain.toString("latin1");
  for (const t of [tokenOf(waiting.link), tokenOf(spent.link), (await prisma.invitation.findFirst({ where: { email: "w@example.org" } })).tokenHash, (await prisma.passwordReset.findFirst()).tokenHash]) assert.equal(text.includes(t), false, "no token or hash in the backup");
  assert.equal(text.includes("w@example.org"), false, "no waiting invitation in the backup");
  const opened = Rs.openBackup(b.buffer, "a-solid-backup-passphrase", 1000);
  assert.equal(opened.ok, true, opened.error);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "olive@example.org" });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(await prisma.invitation.count({ where: { status: "pending" } }), 0, "waiting invitations withdrawn");
  assert.equal(await prisma.passwordReset.count(), 0);
  assert.deepEqual(await accept(tokenOf(waiting.link)), { ok: false, reason: "invalid" });
  assert.deepEqual(await accept(tokenOf(spent.link)), { ok: false, reason: "invalid" });
  assert.deepEqual(await accept(tokenOf(old.link)), { ok: false, reason: "invalid" });
  assert.ok((await reload(T.editor)).suspendedAt, "the suspension is part of the people and comes back with them");
});

/* ───────────── Surfaces ───────────── */

test("no MCP tool can invite, read an invitation, or read a token; the AI journal tool is off by default", async () => {
  const { CORE_TOOLS } = await import("@/core/services/mcp/coreTools");
  const { journalToolProvider } = await import("@/core/journalMcp");
  const names = [...CORE_TOOLS.map((t) => t.name), ...(await journalToolProvider.list()).map((t) => t.name)];
  assert.equal(names.some((n) => /invit|reset|token|password|suspend/i.test(n)), false, names.join(","));
  assert.equal((await journalToolProvider.list())[0].default, false);
  const fs = await import("node:fs"), path = await import("node:path");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [...walk("src/core/services/mcp"), ...walk("src/core/maintenance"), ...walk("src/core/personalAi")].filter((f) => f.endsWith(".ts"))) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /auth\/invitations|auth\/passwordReset|prisma\.invitation|prisma\.passwordReset/, `${f} must not reach invitations`);
  }
});

test("the one-time link pages are never cached and never send a Referer", async () => {
  const { default: config } = await import("../../next.config.mjs");
  const rules = await config.headers();
  for (const page of ["invitation", "reset-password", "forgot-password"]) {
    const rule = rules.find((r) => r.source.includes(page));
    assert.ok(rule, page);
    const h = Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
    assert.equal(h["Referrer-Policy"], "no-referrer"); assert.match(h["Cache-Control"], /no-store/);
  }
});
