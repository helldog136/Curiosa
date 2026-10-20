import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/core/config";
import { prisma } from "@/core/db";

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

/** Étiquette de la copie prise avant une mise à jour groupée de modules. Une SEULE copie est gardée (disque contraint), hors de la rotation de `safetyCopy`. */
export const BULK_LABEL = "pre-bulk-update";
/** Pendant ce délai après une copie de lot, les copies « pre-migration » sont sautées (la copie de lot couvre déjà le même état). */
export const BULK_RECENT_MS = 60 * 60_000;
const BULK_FILE_RE = /^pre-bulk-update-(\d{4}-\d{2}-\d{2})-(\d+)\.db$/;

export type BulkCopyResult = { ok: true; path: string | null; method: "vacuum" | "copy" | "none" } | { ok: false; error: "no-space" | "failed" };

/** Copie de lot encore récente (moins d'une heure) ? Lecture seule, ne lève jamais. */
export function hasRecentBulkCopy(dataDir = DATA_DIR, now = Date.now()): boolean {
  try {
    return fs.readdirSync(path.join(dataDir, "backups")).some((f) => { const m = BULK_FILE_RE.exec(f); return !!m && now - Number(m[2]) >= 0 && now - Number(m[2]) < BULK_RECENT_MS; });
  } catch { return false; }
}

/**
 * Copie de sécurité unique avant une mise à jour groupée : `pre-bulk-update-<AAAA-MM-JJ>-<ts>.db`.
 * - Cohérente : `VACUUM INTO` (la base reste utilisable, la copie n'est jamais « déchirée » par une écriture en cours) ; repli sur la copie du fichier si l'instruction échoue.
 * - Place : il faut 1,2 × la taille de la base de libre (la copie précédente, qui sera remplacée, ne compte pas) ; sinon `no-space` et RIEN n'est copié.
 * - Rétention : UNE seule copie. L'ancienne n'est supprimée qu'une fois la nouvelle écrite ; un échec laisse l'ancienne en place.
 * - Hors rotation de `safetyCopy` (autre étiquette) : six copies « pre-migration » n'y touchent pas.
 * Sans fichier SQLite (autre base) : `{ ok: true, path: null }`.
 */
export async function bulkUpdateCopy(dataDir = DATA_DIR, now = Date.now(), opts: { freeBytes?: number } = {}): Promise<BulkCopyResult> {
  const db = sqliteFile();
  if (!db || !fs.existsSync(db)) return { ok: true, path: null, method: "none" };
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const previous = fs.readdirSync(dir).filter((f) => BULK_FILE_RE.test(f));
  try {
    const need = Math.ceil(fs.statSync(db).size * 1.2);
    const stat = fs.statfsSync(dir);
    const free = opts.freeBytes ?? Number(stat.bavail) * Number(stat.bsize);
    const reclaimable = previous.reduce((n, f) => n + (fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.size ?? 0), 0);
    if (free + reclaimable < need) return { ok: false, error: "no-space" };
  } catch { /* espace inconnu : la copie décidera */ }

  const target = path.join(dir, `${BULK_LABEL}-${new Date(now).toISOString().slice(0, 10)}-${now}.db`);
  let method: "vacuum" | "copy" = "vacuum";
  try {
    // Le chemin est construit ici (dossier du site + nom fixe) ; une apostrophe ne pourrait venir que d'un dossier de données exotique : on passe alors à la copie du fichier.
    if (target.includes("'") || target.includes("\0")) throw new Error("unsafe path");
    fs.rmSync(target, { force: true });
    await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) throw new Error("empty copy");
  } catch {
    method = "copy";
    try { fs.rmSync(target, { force: true }); fs.copyFileSync(db, target); } catch { fs.rmSync(target, { force: true }); return { ok: false, error: "failed" }; }
  }
  for (const old of previous) if (path.join(dir, old) !== target) fs.rmSync(path.join(dir, old), { force: true });
  return { ok: true, path: target, method };
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
