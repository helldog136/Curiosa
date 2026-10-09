// Commande de secours EN SSH, réservée au PROPRIÉTAIRE du serveur (celui qui a accès à la machine) : débloquer une connexion, remettre un mot de passe.
// Elle ne change jamais un autre compte que celui d'un propriétaire (les autres se gèrent depuis l'admin, page Utilisateurs). Chaque action est notée dans le journal.
//
//   node scripts/auth-recover.mjs                         état : adresses et e-mails bloqués, comptes propriétaires
//   node scripts/auth-recover.mjs unlock                  débloque TOUT (adresses et e-mails)
//   node scripts/auth-recover.mjs unlock <adresse IP>     débloque une adresse
//   node scripts/auth-recover.mjs unlock <e-mail>         débloque l'e-mail d'un propriétaire
//   node scripts/auth-recover.mjs reset-password <e-mail> nouveau mot de passe généré (affiché une seule fois), anciennes sessions coupées
//
// Lancer depuis le dossier de l'application (celui de .env), avec le même utilisateur que le service. Aucune dépendance à TypeScript : fonctionne dans l'archive de production.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Charge `.env` (sans écraser ce qui est déjà défini) : le service systemd le lit de la même façon. */
export function loadEnv(dir = process.cwd()) {
  let text = "";
  try { text = fs.readFileSync(path.join(dir, ".env"), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#") || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const isIp = (v) => /^[0-9a-f:.]+(::\/64)?$/i.test(v) && !v.includes("@");

export async function recover(args, { prisma, bcrypt, out = console.log }) {
  const [cmd = "status", target] = args;
  const now = new Date();
  const owner = async (email) => {
    const user = await prisma.user.findUnique({ where: { email: String(email ?? "").trim().toLowerCase() } });
    if (!user) { out(`Aucun compte « ${email} ».`); return null; }
    if (user.role !== "owner") { out(`« ${user.email} » n'est pas le propriétaire : cette commande de secours ne concerne que lui. Pour un autre compte, utilisez Utilisateurs dans l'admin.`); return null; }
    return user;
  };
  const note = (action, targetText) => prisma.auditLog.create({ data: { actor: "ssh", action, target: targetText } });

  if (cmd === "status") {
    const locks = await prisma.authLock.findMany({ where: { lockedUntil: { gt: now } }, orderBy: { lockedUntil: "asc" } });
    out(locks.length ? "Bloqués en ce moment :" : "Rien n'est bloqué en ce moment.");
    for (const l of locks) out(`  ${l.key.padEnd(40)} jusqu'à ${l.lockedUntil.toISOString().replace("T", " ").slice(0, 16)} UTC`);
    const owners = await prisma.user.findMany({ where: { role: "owner" }, select: { email: true } });
    out(`Propriétaire(s) : ${owners.map((o) => o.email).join(", ") || "aucun"}`);
    return 0;
  }
  if (cmd === "unlock") {
    if (!target) {
      const r = await prisma.authLock.deleteMany({});
      await note("recovery.unlock", "tout");
      out(`${r.count} blocage(s) levé(s) : adresses et e-mails sont libres.`);
      return 0;
    }
    if (isIp(target)) {
      const r = await prisma.authLock.deleteMany({ where: { key: `ip:${target.toLowerCase()}` } });
      await note("recovery.unlock", `ip:${target}`);
      out(r.count ? `L'adresse ${target} est débloquée.` : `L'adresse ${target} n'était pas bloquée (pour un réseau IPv6, indiquez-le comme dans « status »).`);
      return 0;
    }
    const user = await owner(target);
    if (!user) return 1;
    await prisma.authLock.deleteMany({ where: { key: `email:${user.email}` } });
    await note("recovery.unlock", user.email);
    out(`L'e-mail ${user.email} est débloqué. Si c'est l'adresse IP qui est bloquée, lancez « unlock » avec cette adresse (ou sans rien pour tout débloquer).`);
    return 0;
  }
  if (cmd === "reset-password") {
    const user = await owner(target);
    if (!user) return 1;
    const password = crypto.randomBytes(12).toString("base64url");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12), sessionVersion: { increment: 1 } } });
    await prisma.authLock.deleteMany({ where: { key: `email:${user.email}` } });
    await note("recovery.password", user.email);
    out(`Nouveau mot de passe de ${user.email} (affiché une seule fois, changez-le dès la connexion) :\n\n  ${password}\n`);
    return 0;
  }
  out("Commandes : status | unlock [adresse IP | e-mail du propriétaire] | reset-password <e-mail du propriétaire>");
  return cmd === "help" || cmd === "--help" ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadEnv();
  const { PrismaClient } = await import("@prisma/client");
  const bcrypt = (await import("bcryptjs")).default;
  const prisma = new PrismaClient();
  try { process.exitCode = await recover(process.argv.slice(2), { prisma, bcrypt }); }
  catch (e) { console.error("Échec :", e?.message ?? e); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
