import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/core/config";

/**
 * The copies of automatic backups kept on the server: `data/backups/auto/auto-<time>.tar.gz.enc`, the same encrypted file that was e-mailed. The 5 most recent are kept.
 * This is its own folder and its own count: the database copies of the maintenance tools (`maintenance-<time>.db`, 5 kept), of a restore (`pre-restore-*`, 3 kept) and of a
 * bulk update (one) are other names in `data/backups/` and are never counted here, and these never count against them. The manual backup of Admin > Backup keeps no copy on the server.
 */
export const AUTO_KEEP = 5;
const NAME_RE = /^auto-(\d{10,})\.tar\.gz\.enc$/;
const dirOf = (dataDir: string) => path.join(dataDir, "backups", "auto");

export type KeptCopy = { name: string; at: number; bytes: number };

export function listCopies(dataDir = DATA_DIR): KeptCopy[] {
  try {
    return fs.readdirSync(dirOf(dataDir)).map((name) => ({ name, m: NAME_RE.exec(name) })).filter((x) => x.m)
      .map((x) => ({ name: x.name, at: Number(x.m![1]), bytes: fs.statSync(path.join(dirOf(dataDir), x.name)).size }))
      .sort((a, b) => b.at - a.at);
  } catch { return []; }
}

/** Keeps a copy; false when there is no room or the disk refuses (the caller says so). The free space needed is the file twice (the write, then the rename). */
export function keepCopy(content: Buffer, now = Date.now(), dataDir = DATA_DIR, freeBytes?: number): boolean {
  const dir = dirOf(dataDir);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const free = freeBytes ?? (() => { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); })();
    if (free < content.length * 2 + 16 * 1024 * 1024) return false;
    const final = path.join(dir, `auto-${now}.tar.gz.enc`);
    const part = `${final}.part`;
    fs.writeFileSync(part, content, { mode: 0o600 });
    fs.renameSync(part, final);
    for (const old of listCopies(dataDir).slice(AUTO_KEEP)) fs.rmSync(path.join(dir, old.name), { force: true });
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".part")) fs.rmSync(path.join(dir, f), { force: true });
    return true;
  } catch {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith(".part")) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* nothing to clean */ }
    return false;
  }
}

/** The most recent kept copy and its content, for the download; null when there is none. */
export function readLatestCopy(dataDir = DATA_DIR): (KeptCopy & { content: Buffer }) | null {
  const latest = listCopies(dataDir)[0];
  if (!latest) return null;
  try { return { ...latest, content: fs.readFileSync(path.join(dirOf(dataDir), latest.name)) }; } catch { return null; }
}

/** Removes every kept copy (not used by the product; for tests and a future "forget" action). */
export function clearCopies(dataDir = DATA_DIR): void { fs.rmSync(dirOf(dataDir), { recursive: true, force: true }); }
