import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const L = await import("@/core/auth/lockout");
const bcrypt = (await import("bcryptjs")).default;
const { recover, loadEnv } = await import("../../scripts/auth-recover.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const run = async (...args) => { const lines = []; const code = await recover(args, { prisma: db.prisma, bcrypt, out: (l) => lines.push(l) }); return { code, text: lines.join("\n") }; };
const owner = () => db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "ancien" } });
const editor = () => db.prisma.user.create({ data: { email: "e@example.org", name: "E", role: "editor", passwordHash: "ancien" } });
async function lock(ip, email) { for (let i = 0; i < 5; i++) await L.recordFailure(ip, email); }

test("secours SSH : « status » montre ce qui est bloqué, « unlock » lève tout, ou une adresse, ou l'e-mail du propriétaire", async () => {
  await owner(); await lock("1.2.3.4", "o@example.org");
  assert.match((await run()).text, /ip:1\.2\.3\.4[\s\S]*email:o@example\.org[\s\S]*Propriétaire\(s\) : o@example\.org/);
  await run("unlock", "1.2.3.4");
  assert.ok(await L.isEmailLocked("o@example.org"), "l'e-mail reste bloqué : seule l'adresse a été levée");
  assert.equal((await L.checkLogin("1.2.3.4", "libre@x.org")).locked, false, "l'adresse est libre");
  assert.equal((await L.checkLogin("9.9.9.9", "o@example.org")).locked, true, "l'e-mail l'est encore");
  await run("unlock", "O@example.org");
  assert.equal((await L.checkLogin("9.9.9.9", "o@example.org")).locked, false);
  await lock("5.5.5.5", "x@x.org");
  const all = await run("unlock");
  assert.match(all.text, /blocage\(s\) levé\(s\)/);
  assert.equal(await db.prisma.authLock.count(), 0);
  assert.match((await run()).text, /Rien n'est bloqué/);
});

test("secours SSH : réservé au propriétaire — jamais le compte d'un autre, jamais un compte inexistant", async () => {
  await owner(); const e = await editor(); await lock("1.2.3.4", "e@example.org");
  const r = await run("unlock", "e@example.org");
  assert.equal(r.code, 1); assert.match(r.text, /pas le propriétaire/);
  assert.ok(await L.isEmailLocked("e@example.org"), "l'éditeur reste bloqué : c'est au propriétaire de le débloquer depuis l'admin");
  const p = await run("reset-password", "e@example.org");
  assert.equal(p.code, 1);
  assert.equal((await db.prisma.user.findUnique({ where: { id: e.id } })).passwordHash, "ancien", "mot de passe de l'éditeur intact");
  assert.equal((await run("reset-password", "personne@x.org")).code, 1);
});

test("secours SSH : « reset-password » donne un mot de passe neuf (affiché une fois, qui marche), lève le blocage de l'e-mail et le journalise", async () => {
  const o = await owner(); await lock("1.2.3.4", "o@example.org");
  const r = await run("reset-password", "o@example.org");
  assert.equal(r.code, 0);
  const pwd = /\n\s{2}(\S{16})\n/.exec(r.text)?.[1];
  assert.ok(pwd, "mot de passe de 16 caractères affiché");
  const row = await db.prisma.user.findUnique({ where: { id: o.id } });
  assert.ok(await bcrypt.compare(pwd, row.passwordHash), "il fonctionne");
  assert.equal(row.sessionVersion, 1, "les sessions ouvertes avec l'ancien mot de passe sont coupées");
  assert.equal(await L.isEmailLocked("o@example.org"), null);
  const logs = await db.prisma.auditLog.findMany({ where: { actor: "ssh" } });
  assert.deepEqual(logs.map((l) => l.action).sort(), ["recovery.password"]);
  assert.ok(!JSON.stringify(logs).includes(pwd), "le mot de passe n'est jamais journalisé");
});

test("secours SSH : le script se lance tout seul depuis l'application (lit .env, base de données du service), sans TypeScript", async () => {
  await owner(); await lock("1.2.3.4", "o@example.org");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-recover-"));
  fs.writeFileSync(path.join(dir, ".env"), `# commentaire\nDATABASE_URL="${process.env.DATABASE_URL}"\nAUTRE='valeur'\n`);
  const env = { ...process.env }; delete env.DATABASE_URL;
  const out = execFileSync(process.execPath, [path.resolve("scripts/auth-recover.mjs"), "status"], { cwd: dir, env: { ...env, NODE_PATH: path.resolve("node_modules") }, encoding: "utf8" });
  assert.match(out, /ip:1\.2\.3\.4/);
  assert.match(execFileSync(process.execPath, [path.resolve("scripts/auth-recover.mjs"), "unlock"], { cwd: dir, env, encoding: "utf8" }), /levé\(s\)/);
  assert.equal(await db.prisma.authLock.count(), 0);
  const e = { ...env }; loadEnv(dir); assert.equal(process.env.AUTRE, "valeur"); delete process.env.AUTRE; void e;
  const src = fs.readFileSync("scripts/auth-recover.mjs", "utf8");
  assert.ok(!/from "@\/|\.ts"/.test(src), "aucune importation du code TypeScript du cœur");
  assert.match(fs.readFileSync("scripts/release-pack.mjs", "utf8"), /"scripts"/, "le script est dans l'archive de production");
});

test("secours SSH : « reset-2fa » retire la double vérification du propriétaire (secret, codes de secours), coupe ses sessions, et ne touche personne d'autre", async () => {
  const T = await import("@/core/auth/totp");
  const F = await import("@/core/auth/twoFactor");
  const o = await owner(); const e = await editor();
  for (const u of [o, e]) { const b = await F.beginEnroll(u.id, "S"); await F.confirmEnroll(u.id, T.codeAt(b.secret, T.stepOf(Date.now()))); }
  assert.match((await run()).text, /o@example\.org \(double vérification activée\)/);
  assert.equal((await run("reset-2fa", "e@example.org")).code, 1, "pas le propriétaire : refusé");
  assert.ok((await db.prisma.user.findUnique({ where: { id: e.id } })).totpEnabledAt, "celui de l'éditeur est intact");
  const r = await run("reset-2fa", "o@example.org");
  assert.equal(r.code, 0);
  const row = await db.prisma.user.findUnique({ where: { id: o.id } });
  assert.deepEqual([row.totpSecret, row.totpEnabledAt, row.sessionVersion], [null, null, 1], "secret retiré ; sessions coupées");
  assert.equal(await db.prisma.recoveryCode.count({ where: { userId: o.id } }), 0);
  assert.deepEqual((await db.prisma.auditLog.findMany({ where: { actor: "ssh" } })).map((l) => l.action), ["recovery.2fa"]);
});
