import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const M = await import("@/core/services/mail");
const { setSetting } = await import("@/core/settings");

let outbox;
beforeEach(async () => {
  await db.reset();
  M.resetMailLimits();
  outbox = [];
  M.setMailTransportFactory((config) => ({ sendMail: async (msg) => { outbox.push({ config, msg }); } }));
});
after(() => { M.setMailTransportFactory(); return db.close(); });

const configure = (over = {}) => M.saveMailConfig({ host: "smtp.example.com", port: 587, secure: false, user: "u", pass: "secret-pass", from: "Mon site <contact@monsite.be>", ...over });
const owner = (email = "proprio@monsite.be") => db.prisma.user.create({ data: { email, name: "P", role: "owner", passwordHash: "x" } });

test("configuration : absente → non configuré ; enregistrée → relue ; mot de passe vide conserve l'ancien", async () => {
  assert.equal(await M.isMailConfigured(), false);
  await configure();
  assert.equal(await M.isMailConfigured(), true);
  let c = await M.getMailConfig();
  assert.deepEqual([c.host, c.port, c.secure, c.user, c.pass, c.from], ["smtp.example.com", 587, false, "u", "secret-pass", "Mon site <contact@monsite.be>"]);
  await configure({ host: "autre.example.com", pass: "" });
  c = await M.getMailConfig();
  assert.equal(c.host, "autre.example.com");
  assert.equal(c.pass, "secret-pass");
});

test("configuration : adresse d'expédition invalide ou serveur vide → non configuré ; port 465 → connexion sécurisée par défaut", async () => {
  await configure({ from: "pas une adresse" });
  assert.equal(await M.isMailConfigured(), false);
  await configure({ from: "a@b.be", host: "" });
  assert.equal(await M.isMailConfigured(), false);
  await db.reset();
  await M.saveMailConfig({ host: "h", port: 465, secure: true, user: "", pass: "", from: "a@b.be" });
  assert.equal((await M.getMailConfig()).secure, true);
  await configure({ port: 99999 });
  assert.equal((await M.getMailConfig()).port, 65535, "port borné");
});

test("envoi : non configuré → raison claire, rien n'est envoyé", async () => {
  assert.deepEqual(await M.sendMail({ to: "a@b.be", subject: "S", text: "T" }, "x"), { ok: false, reason: "not_configured" });
  assert.equal(outbox.length, 0);
});

test("envoi : l'expéditeur est celui du site et les identifiants viennent du cœur", async () => {
  await configure();
  assert.deepEqual(await M.sendMail({ to: "client@example.org", subject: "Salut", text: "Corps", replyTo: "visiteur@example.org" }, "contact"), { ok: true });
  const { config, msg } = outbox[0];
  assert.equal(msg.from, "Mon site <contact@monsite.be>");
  assert.equal(msg.to, "client@example.org");
  assert.equal(msg.replyTo, "visiteur@example.org");
  assert.equal(msg.subject, "Salut");
  assert.equal(config.pass, "secret-pass");
  assert.ok(!("html" in msg), "texte brut uniquement");
});

test("envoi : un module ne peut pas imposer l'expéditeur ni ajouter de destinataires", async () => {
  await configure();
  await M.sendMail({ to: "a@b.be", subject: "S", text: "T", from: "pdg@banque.be", cc: "x@y.be", bcc: "z@y.be", html: "<b>x</b>" }, "x");
  const { msg } = outbox[0];
  assert.equal(msg.from, "Mon site <contact@monsite.be>");
  assert.deepEqual(Object.keys(msg).sort(), ["from", "subject", "text", "to"]);
});

test("envoi : destinataire « owner » → contact du site, sinon propriétaire ; aucun → no_recipient", async () => {
  await configure();
  assert.deepEqual(await M.sendMail({ to: "owner", subject: "S", text: "T" }, "x"), { ok: false, reason: "no_recipient" });
  await owner();
  assert.equal((await M.sendMail({ to: "owner", subject: "S", text: "T" }, "x")).ok, true);
  assert.equal(outbox.at(-1).msg.to, "proprio@monsite.be");
  await setSetting("site.contactEmail", "contact@monsite.be");
  await M.sendMail({ to: "owner", subject: "S", text: "T" }, "x");
  assert.equal(outbox.at(-1).msg.to, "contact@monsite.be");
});

test("envoi : adresses, sujet et texte invalides refusés ; injection d'en-têtes impossible", async () => {
  await configure();
  for (const to of ["pas une adresse", "a@b.be, c@d.be", "a@b.be\nBcc: x@y.be", "<a@b.be>", "", "a b@c.be"]) {
    assert.deepEqual(await M.sendMail({ to, subject: "S", text: "T" }, "x"), { ok: false, reason: "invalid" }, JSON.stringify(to));
  }
  assert.equal((await M.sendMail({ to: "a@b.be", subject: "", text: "T" }, "x")).ok, false);
  assert.equal((await M.sendMail({ to: "a@b.be", subject: "S", text: "   " }, "x")).ok, false);
  assert.equal((await M.sendMail({ to: "a@b.be", subject: "S", text: "T", replyTo: "mauvais" }, "x")).ok, false);
  assert.equal(outbox.length, 0);
  await M.sendMail({ to: "a@b.be", subject: "Sujet\r\nBcc: pirate@x.be", text: "T" }, "x");
  assert.ok(!/[\r\n]/.test(outbox[0].msg.subject));
  assert.equal(outbox[0].msg.subject, "Sujet Bcc: pirate@x.be");
  await M.sendMail({ to: "a@b.be", subject: "x".repeat(500), text: "y".repeat(50_000) }, "x");
  assert.equal(outbox[1].msg.subject.length, 150);
  assert.equal(outbox[1].msg.text.length, 20_000);
});

test("envoi : débit limité par instance (10/h) et pour tout le site (40/h)", async () => {
  await configure();
  const send = (actor) => M.sendMail({ to: "a@b.be", subject: "S", text: "T" }, actor);
  for (let i = 0; i < 10; i++) assert.equal((await send("a")).ok, true);
  assert.deepEqual(await send("a"), { ok: false, reason: "rate_limited" });
  assert.equal((await send("b")).ok, true, "une autre instance n'est pas bloquée");
  M.resetMailLimits();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 10; j++) assert.equal((await send(`i${i}`)).ok, true);
  assert.deepEqual(await send("autre"), { ok: false, reason: "rate_limited" }, "plafond global");
});

test("envoi : une panne SMTP ne lève jamais et ne révèle aucun détail", async () => {
  await configure();
  M.setMailTransportFactory(() => ({ sendMail: async () => { throw new Error("535 auth failed for user u password secret-pass at smtp.example.com"); } }));
  const log = console.error; console.error = () => {};
  try {
    const r = await M.sendMail({ to: "a@b.be", subject: "S", text: "T" }, "x");
    assert.deepEqual(r, { ok: false, reason: "failed" });
    assert.ok(!JSON.stringify(r).includes("secret-pass"));
  } finally { console.error = log; }
});

test("audit : chaque envoi est consigné sans son contenu", async () => {
  await configure();
  await M.sendMail({ to: "a@b.be", subject: "Confidentiel", text: "Très secret" }, "contact");
  const rows = await db.prisma.auditLog.findMany();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].actor, rows[0].action, rows[0].target], ["module:contact", "mail.sent", "address"]);
  assert.ok(!JSON.stringify(rows).includes("Confidentiel") && !JSON.stringify(rows).includes("a@b.be"));
});

test("module : ctx.api.mail du contexte réel envoie au nom de l'instance", async () => {
  await configure();
  const { makeApi } = await import("@/core/modules/api");
  const api = makeApi({ id: "i1", key: "contact", moduleId: "contact-form", names: {} }, "fr");
  assert.equal(await api.mail.configured(), true);
  assert.equal((await api.mail.send({ to: "a@b.be", subject: "S", text: "T" })).ok, true);
  assert.equal((await db.prisma.auditLog.findFirst()).actor, "module:contact");
});
