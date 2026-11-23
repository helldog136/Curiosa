// Automatic backup by e-mail (docs/BACKUP.md): schedule, passphrase, sealed storage, encrypted file, size limit, failures, privacy, disabling, read-only report.
// A fake mail transport replaces the network. Every address is an example.org one; the passphrase and the SMTP password below are fixtures, not real secrets.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const S = await import("@/core/backup/auto/schedule");
const C = await import("@/core/backup/auto/config");
const Run = await import("@/core/backup/auto/run");
const Store = await import("@/core/backup/auto/store");
const View = await import("@/core/backup/auto/view");
const Msg = await import("@/core/backup/auto/message");
const Rs = await import("@/core/backup/restore");
const Mail = await import("@/core/services/mail");
const { setSetting, getSetting, deleteSetting } = await import("@/core/settings");
const { UPLOADS_DIR, DATA_DIR } = await import("@/core/config");
const { safetyCopy } = await import("@/core/backup/files");
const { readTarGz } = await import("@/core/backup/tar");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const SMTP_PASS = "smtp-fixture-0001";
let sent;       // messages given to the fake transport
let failWith;   // an error to throw from the fake transport
let logs;       // everything printed during a test
const realLog = { log: console.log, error: console.error, warn: console.warn, info: console.info };

async function seed() {
  const owner = await db.prisma.user.create({ data: { email: "owner@example.org", name: "Camille", role: "owner", passwordHash: "x", locale: "en" } });
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en", "fr"]); await setSetting("setup.completed", true);
  await setSetting("site.name", "Site d'essai", "en");
  await Mail.saveMailConfig({ host: "smtp.example.org", port: 587, secure: false, user: "mailer", pass: SMTP_PASS, from: "site@example.org" });
  return owner;
}
beforeEach(async () => {
  await db.reset();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  Store.clearCopies();
  sent = []; failWith = null; logs = [];
  globalThis.curiosaAutoBackupRunning = false;
  Mail.resetMailLimits();
  Mail.setMailTransportFactory(() => ({ async sendMail(message) { if (failWith) throw failWith; sent.push(message); } }));
  for (const k of Object.keys(realLog)) console[k] = (...a) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
});
after(async () => { Object.assign(console, realLog); Mail.setMailTransportFactory(); await db.close(); });
const restoreConsole = () => Object.assign(console, realLog);

/* ───────────── pure schedule ───────────── */

test("schedule: the minute is a stable hash of the site name, 0 to 59, and the slot is 03:MM on the site clock", () => {
  const m = S.jitterMinute("Site d'essai");
  assert.equal(S.jitterMinute("  SITE D'ESSAI "), m, "case and spaces do not change it");
  assert.ok(m >= 0 && m <= 59);
  const minutes = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((n) => S.jitterMinute(`site ${n}`)));
  assert.ok(minutes.size > 4, "sites do not all share a minute");
  for (const tz of ["Europe/Brussels", "America/Montreal", "UTC", "Pacific/Auckland"]) {
    const slot = S.slotOfDay("2026-11-23", "daily", "Site d'essai", tz);
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(slot);
    assert.equal(local, `03:${String(m).padStart(2, "0")}`, tz);
  }
});

test("schedule: daily, weekly (Sunday) and monthly (the 1st) slots; latest and next are consistent", () => {
  const tz = "Europe/Brussels", name = "Site d'essai";
  const day = (iso) => new Date(iso);
  // Monday 2026-11-23 12:00 UTC
  const now = day("2026-11-23T12:00:00Z");
  assert.equal(S.latestSlot(now, "daily", name, tz).toISOString().slice(0, 10), "2026-11-23");
  assert.equal(S.latestSlot(now, "weekly", name, tz).toISOString().slice(0, 10), "2026-11-22", "Sunday before");
  assert.equal(S.latestSlot(now, "monthly", name, tz).toISOString().slice(0, 10), "2026-11-01");
  assert.equal(S.nextSlot(now, "daily", name, tz).toISOString().slice(0, 10), "2026-11-24");
  assert.equal(S.nextSlot(now, "weekly", name, tz).toISOString().slice(0, 10), "2026-11-29");
  assert.equal(S.nextSlot(now, "monthly", name, tz).toISOString().slice(0, 10), "2026-12-01");
  // before the slot of the day: still yesterday's
  const early = day("2026-11-23T01:00:00Z");
  assert.equal(S.latestSlot(early, "daily", name, tz).toISOString().slice(0, 10), "2026-11-22");
  // daylight saving: the spring jump of 2026-03-29 in Brussels does not move the wall-clock hour
  const jump = S.slotOfDay("2026-03-29", "weekly", name, tz);
  assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(jump), "03");
});

test("schedule: due, catch-up (once), already handled, switched on after the slot, waiting for a retry", () => {
  const tz = "UTC", name = "Site d'essai", now = new Date("2026-11-23T12:00:00Z");
  const config = { frequency: "daily", since: "2026-11-01T00:00:00Z" };
  const slot = S.latestSlot(now, "daily", name, tz);
  assert.equal(S.dueSlot(now, config, {}, name, tz).getTime(), slot.getTime(), "never run: due");
  assert.equal(S.dueSlot(now, config, { lastSlot: slot.toISOString() }, name, tz), null, "this slot was handled");
  // the server was off for a week: ONE run, for the latest slot, then nothing more
  const old = new Date(slot.getTime() - 7 * 86_400_000).toISOString();
  assert.equal(S.dueSlot(now, config, { lastSlot: old }, name, tz).getTime(), slot.getTime());
  // switched on after the slot of the day: the first run is the next slot
  assert.equal(S.dueSlot(now, { ...config, since: "2026-11-23T10:00:00Z" }, {}, name, tz), null);
  // a retry is waiting
  assert.equal(S.dueSlot(now, config, { retryAt: "2026-11-23T12:30:00Z" }, name, tz), null);
  assert.ok(S.dueSlot(now, config, { retryAt: "2026-11-23T11:30:00Z" }, name, tz), "the wait is over");
});

test("schedule: retries are limited and the waits grow (15 min, 1 h, 4 h, then the next slot)", () => {
  assert.deepEqual([1, 2, 3].map(S.retryDelay), [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]);
  assert.equal(S.retryDelay(4), null);
  assert.equal(S.retryDelay(0), null);
  assert.equal(S.MAX_ATTEMPTS, 4);
});

/* ───────────── passphrase and sealed storage ───────────── */

test("passphrase: 25 random symbols in five groups from a safe alphabet, never twice the same", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = C.generatePassphrase();
    assert.match(p, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){4}$/);
    assert.ok(p.replace(/-/g, "").length >= 24);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test("switching on: the passphrase is sealed at rest, openable by this server only, and returned once", async () => {
  await seed();
  const { passphrase, config } = await C.switchOn({});
  assert.ok(config.enabled && config.frequency === "weekly" && config.maxMb === 20 && config.recipient.kind === "owner");
  const row = await db.prisma.setting.findFirst({ where: { key: C.SECRET_KEY } });
  assert.ok(row, "stored");
  assert.ok(!row.value.includes(passphrase), "not in clear");
  assert.match(JSON.parse(row.value), /^[\w-]+\.[\w-]+\.[\w-]+$/, "iv.tag.body");
  assert.equal(await C.openPassphrase(), passphrase);
  // no other setting holds it
  for (const s of await db.prisma.setting.findMany()) assert.ok(!s.value.includes(passphrase), s.key);
  // another site secret cannot open it (a restore on another server)
  const { unseal } = await import("@/core/seal");
  assert.equal(unseal("another-purpose", JSON.parse(row.value)), null);
});

test("the settings of the feature stay out of a backup", async () => {
  await seed();
  await C.switchOn({});
  const { createBackup } = await import("@/core/backup/export");
  const b = await createBackup("mot-de-passe-de-test", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content.toString("utf8")]));
  assert.ok(!/autobackup/.test(files["data/settings.json"]) && !/autobackup/.test(files["readable/site.txt"]));
});

/* ───────────── a run: encrypted file, mail, kept copy ───────────── */

const PW_FIXTURE_PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(n)]);

test("a run e-mails the standard encrypted file: it opens with the passphrase, with the restore code and with OpenSSL", async () => {
  const owner = await seed();
  const { passphrase } = await C.switchOn({});
  const out = await Run.runAutoBackup("manual", new Date("2026-11-23T12:00:00Z"));
  assert.equal(out.ok, true);
  assert.equal(out.attached, true);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, owner.email);
  assert.equal(mail.from, "site@example.org");
  assert.match(mail.subject, /Site d'essai/);
  assert.match(mail.subject, /2026-11-23/);
  assert.equal(mail.attachments.length, 1);
  const att = mail.attachments[0];
  assert.match(att.filename, /^backup-site-d-essai-2026-11-23\.tar\.gz\.enc$/);
  assert.ok(!att.filename.includes(passphrase));
  // 1. the existing restore code opens it
  const opened = Rs.openBackup(att.content, passphrase);
  assert.ok(opened.ok, "openBackup");
  assert.equal(Rs.openBackup(att.content, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE").ok, false);
  // 2. the documented OpenSSL command opens it (standard format, 600000 iterations)
  const dir = makeTempDir("autobackup-openssl-");
  fs.writeFileSync(path.join(dir, "b.enc"), att.content);
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256", "-in", path.join(dir, "b.enc"), "-out", path.join(dir, "b.tar.gz"), "-pass", `pass:${passphrase}`]);
  const listing = execFileSync("tar", ["tzf", path.join(dir, "b.tar.gz")]).toString();
  assert.match(listing, /backup\.json/);
  assert.match(listing, /readable\/site\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
  // the mail text
  assert.match(mail.text, /encrypted/);
  assert.match(mail.text, /passphrase/);
  assert.match(mail.text, /Restore a backup/);
  assert.ok(!mail.text.includes(passphrase));
  assert.ok(!mail.text.includes("@"), "no address in the text");
  // the kept copy is the same file; state and audit
  const kept = Store.readLatestCopy();
  assert.ok(kept.content.equals(att.content));
  const state = await C.readState();
  assert.equal(state.ok, true); assert.equal(state.attached, true); assert.equal(state.failures, 0);
  const row = await db.prisma.auditLog.findFirst({ where: { action: "autobackup.sent" } });
  assert.equal(row.target, "manual attached");
});

test("the e-mailed file restores a site through the existing restore flow, and the feature is off afterwards", async () => {
  await seed();
  const { passphrase } = await C.switchOn({});
  await Run.runAutoBackup("manual");
  const file = sent[0].attachments[0].content;
  await db.reset();
  await db.prisma.user.create({ data: { email: "intrus@example.org", name: "X", role: "owner", passwordHash: "x" } });
  const opened = Rs.openBackup(file, passphrase);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  assert.deepEqual((await db.prisma.user.findMany()).map((u) => u.email), ["owner@example.org"]);
  assert.equal(await getSetting(C.SECRET_KEY), undefined, "the passphrase did not travel in the backup");
  assert.equal((await View.autoBackupStatus()).enabled, false);
});

test("size limit: over the limit the mail has no attachment, says so, and the file stays on the server", async () => {
  await seed();
  await C.switchOn({});
  await C.saveOptions({ maxMb: 1 });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"), PW_FIXTURE_PNG(1_300_000));
  const out = await Run.runAutoBackup("manual");
  assert.equal(out.ok, true); assert.equal(out.attached, false); assert.equal(out.kept, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].attachments, undefined, "no attachment");
  assert.match(sent[0].text, /not attached/);
  assert.match(sent[0].text, /kept on the server/);
  assert.match(sent[0].text, /Backup in the admin area/);
  assert.match(sent[0].text, /1 MB/);
  assert.match(sent[0].subject, /not attached/);
  assert.ok(Store.readLatestCopy().bytes > 1_000_000);
  const status = await View.autoBackupStatus();
  assert.equal(status.state, "degraded"); assert.equal(status.reason, "too_big");
  // raising the limit and sending again gives an attachment and a configured state
  await C.saveOptions({ maxMb: 25 });
  const again = await Run.runAutoBackup("manual");
  assert.equal(again.attached, true);
  assert.equal((await View.autoBackupStatus()).state, "configured");
});

test("size limit: over the limit and no room to keep a copy is a failure, never a notice that lies", async () => {
  await seed();
  await C.switchOn({});
  await C.saveOptions({ maxMb: 1 });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"), PW_FIXTURE_PNG(1_300_000));
  fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "backups", "auto"), "a file where the folder should be");   // the folder cannot be made
  const out = await Run.runAutoBackup("manual");
  assert.deepEqual(out, { ok: false, reason: "disk_full" });
  assert.equal(sent.length, 0);
  fs.rmSync(path.join(DATA_DIR, "backups", "auto"), { force: true });
});

test("kept copies: the 5 most recent, in their own count, never evicting or evicted by the other copies", async () => {
  await seed();
  const dir = DATA_DIR;
  for (let i = 1; i <= 7; i++) assert.ok(Store.keepCopy(Buffer.from(`copy ${i}`), 1_700_000_000_000 + i, dir, 1e12));
  assert.equal(Store.listCopies(dir).length, 5);
  assert.equal(Store.listCopies(dir)[0].at, 1_700_000_000_007);
  for (let i = 1; i <= 7; i++) safetyCopy("maintenance", dir, 1_800_000_000_000 + i);
  assert.equal(fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith("maintenance-")).length, 5);
  assert.equal(Store.listCopies(dir).length, 5, "the database copies did not touch them");
  Store.keepCopy(Buffer.from("copy 8"), 1_700_000_000_008, dir, 1e12);
  assert.equal(fs.readdirSync(path.join(dir, "backups")).filter((f) => f.startsWith("maintenance-")).length, 5, "and they did not touch the database copies");
  assert.equal(Store.keepCopy(Buffer.from("x"), 1, dir, 100), false, "no room: false, nothing written");
});

/* ───────────── failures, degraded, retries ───────────── */

test("a failed run is recorded in plain words, retried with growing waits, then waits for the next slot; success resets it", async () => {
  await seed();
  const t0 = new Date("2026-11-23T12:00:00Z");
  await C.switchOn({}, new Date("2026-11-01T00:00:00Z"));
  failWith = Object.assign(new Error("535 5.7.8 Authentication failed for mailer@smtp.example.org"), { code: "EAUTH", responseCode: 535 });
  const waits = [];
  let now = t0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const out = await Run.runDueAutoBackup(now);
    assert.deepEqual(out, { ok: false, reason: "mail_login" }, `attempt ${attempt}`);
    const st = await C.readState();
    assert.equal(st.failures, attempt); assert.equal(st.ok, false);
    if (attempt < 4) { waits.push(Date.parse(st.retryAt) - now.getTime()); assert.equal(await Run.runDueAutoBackup(new Date(now.getTime() + 60_000)), null, "not before the wait is over"); now = new Date(Date.parse(st.retryAt) + 1000); }
    else { assert.equal(st.retryAt, undefined, "no more attempts for this slot"); assert.ok(st.lastSlot); }
  }
  assert.deepEqual(waits, [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]);
  assert.equal(await Run.runDueAutoBackup(new Date(now.getTime() + 86_400_000 / 2)), null, "waits for the next slot");
  const status = await View.autoBackupStatus(now);
  assert.equal(status.state, "degraded"); assert.equal(status.reason, "mail_login");
  assert.equal(status.last.ok, false);
  // audit: a word, not the server's text
  const rows = await db.prisma.auditLog.findMany({ where: { action: "autobackup.failed" } });
  assert.equal(rows.length, 4);
  for (const r of rows) { assert.equal(r.target, "schedule mail_login"); assert.ok(!/smtp|mailer|535|Authentication/i.test(r.target)); }
  // the next slot works again: configured, counter reset
  failWith = null;
  const next = new Date("2026-11-30T12:00:00Z");
  const ok = await Run.runDueAutoBackup(next);
  assert.equal(ok.ok, true);
  assert.equal((await View.autoBackupStatus(next)).state, "configured");
  assert.equal((await C.readState()).failures, 0);
});

test("causes: the mail server's own words never reach the result", () => {
  assert.equal(Mail.mailCause({ code: "EAUTH" }), "login");
  assert.equal(Mail.mailCause({ code: "ETIMEDOUT" }), "unreachable");
  assert.equal(Mail.mailCause({ code: "ECONNECTION" }), "unreachable");
  assert.equal(Mail.mailCause({ code: "EMESSAGE", responseCode: 552 }), "refused");
  assert.equal(Mail.mailCause(new Error("anything")), "unknown");
});

test("mail not set up: the state says so, a run fails with that reason and sends nothing", async () => {
  await seed();
  await C.switchOn({});
  await deleteSetting("mail.host"); await deleteSetting("mail.from");
  const status = await View.autoBackupStatus();
  assert.equal(status.mailConfigured, false);
  assert.equal(status.state, "degraded"); assert.equal(status.reason, "mail_not_configured");
  assert.deepEqual(await Run.runAutoBackup("manual"), { ok: false, reason: "mail_not_configured" });
  assert.equal(sent.length, 0);
});

test("a passphrase this server cannot open is a degraded state with its own reason", async () => {
  await seed();
  await C.switchOn({});
  await setSetting(C.SECRET_KEY, "bm90.bm90.bm90");
  assert.equal((await View.autoBackupStatus()).reason, "passphrase_unreadable");
  assert.deepEqual(await Run.runAutoBackup("manual"), { ok: false, reason: "passphrase_unreadable" });
});

test("a run that cannot start never throws, and two runs never overlap", async () => {
  await seed();
  assert.deepEqual(await Run.runAutoBackup("manual"), { ok: false, skipped: "off" });
  await C.switchOn({});
  globalThis.curiosaAutoBackupRunning = true;
  assert.deepEqual(await Run.runAutoBackup("manual"), { ok: false, skipped: "busy" });
  globalThis.curiosaAutoBackupRunning = false;
});

/* ───────────── recipient ───────────── */

test("recipient: owner by default, another administrator, or one typed address; anything else is refused", async () => {
  const owner = await seed();
  const admin = await db.prisma.user.create({ data: { email: "lune_douce@example.org", name: "Lune", role: "admin", passwordHash: "x" } });
  const editor = await db.prisma.user.create({ data: { email: "etoile_nord@example.org", name: "Etoile", role: "editor", passwordHash: "x" } });
  assert.equal(await C.resolveRecipient({ kind: "owner" }), owner.email);
  assert.equal(await C.resolveRecipient({ kind: "user", userId: admin.id }), admin.email);
  assert.equal(await C.resolveRecipient({ kind: "user", userId: editor.id }), null, "an editor is not an administrator");
  assert.equal(await C.resolveRecipient({ kind: "address", address: "backup@example.org" }), "backup@example.org");
  assert.equal(C.normalizeRecipient({ kind: "address", address: "not an address" }), null);
  assert.equal(C.normalizeRecipient({ kind: "address", address: "a@b" }), null);
  assert.equal(C.normalizeRecipient({ kind: "address", address: "x@example.org\r\nBcc: y@example.org" }), null);
  assert.deepEqual((await C.administratorAccounts()).map((a) => a.name), ["Camille", "Lune"]);
  assert.equal(C.maskEmail("lune_douce@example.org"), "l***@example.org");
  await C.switchOn({ recipient: { kind: "user", userId: admin.id } });
  await Run.runAutoBackup("manual");
  assert.equal(sent[0].to, admin.email);
  assert.equal((await View.autoBackupStatus()).recipient, "l***@example.org");
});

/* ───────────── privacy ───────────── */

test("the passphrase appears nowhere: logs, audit, mail, state, kept files, report for assistants", async () => {
  await seed();
  const { passphrase } = await C.switchOn({});
  failWith = Object.assign(new Error("connection refused"), { code: "ECONNECTION" });
  await Run.runAutoBackup("schedule");
  failWith = null;
  await Run.runAutoBackup("manual");
  await C.regeneratePassphrase();
  const everything = [
    logs.join("\n"),
    JSON.stringify(await db.prisma.auditLog.findMany()),
    JSON.stringify(sent.map((m) => ({ ...m, attachments: (m.attachments ?? []).map((a) => a.filename) }))),
    JSON.stringify(await View.autoBackupStatus()),
    JSON.stringify(await getSetting(C.CONFIG_KEY)), JSON.stringify(await getSetting(C.STATE_KEY)),
    fs.readdirSync(path.join(DATA_DIR, "backups", "auto")).join("\n"),
  ].join("\n");
  assert.ok(!everything.includes(passphrase), "old passphrase");
  assert.ok(!everything.includes(passphrase.replace(/-/g, "")), "old passphrase without dashes");
  const fresh = await C.openPassphrase();
  assert.notEqual(fresh, passphrase, "regenerated");
  assert.ok(!everything.includes(fresh), "new passphrase");
  // the report an assistant reads
  const { health } = await import("@/core/maintenance/inspect");
  restoreConsole();
  const report = JSON.stringify((await health()).autoBackup);
  assert.ok(!report.includes(fresh) && !report.includes(passphrase));
  const auto = JSON.parse(report);
  assert.deepEqual(Object.keys(auto).sort(), ["enabled", "frequency", "lastResult", "maxMb", "nextAt", "reason", "recipient", "state"]);
  assert.equal(auto.recipient, "o***@example.org");
  assert.ok(!report.includes("owner@example.org"), "the address is masked");
});

test("regenerating: the next backups use the new passphrase, the old e-mailed ones keep the old one", async () => {
  await seed();
  const first = (await C.switchOn({})).passphrase;
  await Run.runAutoBackup("manual");
  const second = await C.regeneratePassphrase();
  await Run.runAutoBackup("manual");
  assert.notEqual(first, second);
  assert.ok(Rs.openBackup(sent[0].attachments[0].content, first).ok);
  assert.equal(Rs.openBackup(sent[0].attachments[0].content, second).ok, false);
  assert.ok(Rs.openBackup(sent[1].attachments[0].content, second).ok);
  assert.equal(Rs.openBackup(sent[1].attachments[0].content, first).ok, false);
});

/* ───────────── disabling, report, tools ───────────── */

test("switching off deletes the sealed passphrase and the result, and stops the schedule", async () => {
  await seed();
  await C.switchOn({}, new Date("2026-11-01T00:00:00Z"));
  await Run.runAutoBackup("manual");
  await C.switchOff();
  assert.equal(await db.prisma.setting.count({ where: { key: { in: [C.SECRET_KEY, C.STATE_KEY] } } }), 0);
  assert.equal(await C.openPassphrase(), null);
  assert.equal(await Run.runDueAutoBackup(new Date("2026-12-30T12:00:00Z")), null);
  const status = await View.autoBackupStatus();
  assert.equal(status.state, "notConfigured"); assert.equal(status.enabled, false); assert.equal(status.recipient, null);
  // switching on again makes a NEW passphrase
  assert.ok((await C.switchOn({})).passphrase);
});

test("catch-up through the scheduler entry: a slot missed while the server was off runs once at the next look", async () => {
  await seed();
  await C.switchOn({ frequency: "daily" }, new Date("2026-11-01T00:00:00Z"));
  const monday = new Date("2026-11-23T12:00:00Z");
  assert.equal((await Run.runDueAutoBackup(monday)).ok, true);
  assert.equal(await Run.runDueAutoBackup(monday), null, "not twice");
  assert.equal(await Run.runDueAutoBackup(new Date("2026-11-23T20:00:00Z")), null, "same slot");
  assert.equal((await Run.runDueAutoBackup(new Date("2026-11-27T12:00:00Z"))).ok, true, "four days later: once");
  assert.equal(sent.length, 2);
});

test("no maintenance tool can switch the feature on, change the recipient or read the passphrase", async () => {
  const { MAINTENANCE_TOOLS } = await import("@/core/maintenance/tools");
  assert.ok(!MAINTENANCE_TOOLS.some((t) => /auto.?backup|passphrase|recipient/i.test(t.name)));
  const src = fs.readdirSync("src/core/maintenance").filter((f) => f.endsWith(".ts")).map((f) => fs.readFileSync(path.join("src/core/maintenance", f), "utf8")).join("\n");
  assert.ok(!/switchOn|regeneratePassphrase|openPassphrase|saveOptions/.test(src), "the maintenance code only reads the status");
});

test("the mail texts are in the language of the admin and neutral", () => {
  const fr = Msg.backupMail(makeTranslator("fr"), { site: "Site d'essai", day: "2026-11-23", filename: "backup-x.tar.gz.enc", sizeBytes: 4_200_000, limitMb: 20, attached: true, kept: true });
  assert.match(fr.subject, /Site d'essai : sauvegarde du 2026-11-23/);
  assert.match(fr.text, /4\.2 Mo/);
  assert.match(fr.text, /phrase secrète/);
  const en = Msg.backupMail(makeTranslator("en"), { site: "Site d'essai", day: "2026-11-23", filename: "backup-x.tar.gz.enc", sizeBytes: 4_200_000, limitMb: 20, attached: true, kept: true });
  assert.match(en.text, /4\.2 MB/);
  for (const text of [fr.text, en.text]) assert.ok(!/!/.test(text) && !/veuillez/i.test(text));
});
