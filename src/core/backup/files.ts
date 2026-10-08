import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/core/config";

/** Fichier SQLite de DATABASE_URL (relatif = relatif au dossier prisma/, comme Prisma). */
export function sqliteFile(url = process.env.DATABASE_URL, appDir = process.cwd()): string | null {
  const m = /^file:(.+)$/.exec(String(url ?? ""));
  if (!m) return null;
  const p = m[1]!.split("?")[0]!;
  return path.isAbsolute(p) ? p : path.resolve(appDir, "prisma", p);
}

/** Copie de sécurité de la base avant une restauration (on garde les 5 dernières). Renvoie son chemin, ou null s'il n'y a pas de fichier. */
export function safetyCopy(label: string, dataDir = DATA_DIR, now = Date.now()): string | null {
  const db = sqliteFile();
  if (!db || !fs.existsSync(db)) return null;
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${label}-${now}.db`);
  fs.copyFileSync(db, target);
  for (const old of fs.readdirSync(dir).filter((f) => f.startsWith(`${label}-`)).sort().slice(0, -5)) fs.rmSync(path.join(dir, old), { force: true });
  return target;
}

/**
 * Mise de côté de l'archive déchiffrée entre l'aperçu et la confirmation d'une restauration (deux étapes : le propriétaire
 * doit pouvoir confirmer module par module). Fichier temporaire à nom aléatoire, supprimé après 30 minutes.
 */
const TOKEN_RE = /^[0-9a-f]{32}$/;
const TTL = 30 * 60_000;
const stashDir = (dataDir: string) => path.join(dataDir, "tmp", "restore");

export function purgeStash(dataDir = DATA_DIR, now = Date.now()): void {
  try {
    for (const f of fs.readdirSync(stashDir(dataDir))) {
      const full = path.join(stashDir(dataDir), f);
      if (now - fs.statSync(full).mtimeMs > TTL) fs.rmSync(full, { force: true });
    }
  } catch { /* rien à nettoyer */ }
}

export function stash(plain: Buffer, dataDir = DATA_DIR): string {
  purgeStash(dataDir);
  fs.mkdirSync(stashDir(dataDir), { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(stashDir(dataDir), token), plain, { mode: 0o600 });
  return token;
}

export function unstash(token: string, dataDir = DATA_DIR, now = Date.now()): Buffer | null {
  if (!TOKEN_RE.test(token)) return null;
  const file = path.join(stashDir(dataDir), token);
  try {
    if (now - fs.statSync(file).mtimeMs > TTL) { fs.rmSync(file, { force: true }); return null; }
    return fs.readFileSync(file);
  } catch { return null; }
}

export function dropStash(token: string, dataDir = DATA_DIR): void {
  if (TOKEN_RE.test(token)) fs.rmSync(path.join(stashDir(dataDir), token), { force: true });
}
