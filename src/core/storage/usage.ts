/**
 * STORAGE — what the site itself takes, by category. Walks the data folder with a hard bound (entries and time) so a huge or slow disk never holds a request:
 * when a bound is hit the sizes are a lower bound and `partial` is true. Symbolic links are counted as links, never followed. Nothing here returns a path.
 */
import fsp from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";

export const USAGE_CATEGORIES = ["files", "database", "backups", "modules", "other"] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];
export type Usage = { totalBytes: number; categories: Record<UsageCategory, number>; partial: boolean };

/** Hard bounds of one measurement. */
export const MAX_ENTRIES = 200_000;
export const MAX_WALK_MS = 4_000;

export type UsageFs = {
  readdir(dir: string): Promise<Pick<Dirent, "name" | "isDirectory" | "isSymbolicLink">[]>;
  lstat(file: string): Promise<Pick<Stats, "size">>;
};
const realFs: UsageFs = {
  readdir: (dir) => fsp.readdir(dir, { withFileTypes: true }),
  lstat: (file) => fsp.lstat(file),
};

/** Which category a top-level entry of the data folder belongs to. Uploads and fonts are the owner's own files. */
export function categoryOf(name: string): UsageCategory {
  if (name === "uploads" || name === "fonts") return "files";
  if (name === "backups") return "backups";
  if (name === "modules" || name === "skins") return "modules";
  if (/\.db(-wal|-shm|-journal)?$/.test(name)) return "database";
  return "other";
}

export async function measureUsage(root: string, options: { fs?: UsageFs; maxEntries?: number; maxMs?: number; now?: () => number } = {}): Promise<Usage> {
  const io = options.fs ?? realFs;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxMs = options.maxMs ?? MAX_WALK_MS;
  const now = options.now ?? Date.now;
  const started = now();
  const categories: Record<UsageCategory, number> = { files: 0, database: 0, backups: 0, modules: 0, other: 0 };
  let seen = 0;
  let partial = false;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const stack: { dir: string; category: UsageCategory | null }[] = [{ dir: root, category: null }];
  while (stack.length > 0 && !partial) {
    const { dir, category } = stack.pop()!;
    let entries: Awaited<ReturnType<UsageFs["readdir"]>>;
    try { entries = await io.readdir(dir); } catch { continue; }
    for (const entry of entries) {
      if (++seen > maxEntries || now() - started > maxMs) { partial = true; break; }
      const full = `${dir.replace(/[\\/]+$/, "")}${sep}${entry.name}`;
      const where = category ?? categoryOf(entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) { stack.push({ dir: full, category: where }); continue; }
      try { categories[where] += (await io.lstat(full)).size; } catch { /* vanished while measuring */ }
    }
  }
  const totalBytes = USAGE_CATEGORIES.reduce((sum, key) => sum + categories[key], 0);
  return { totalBytes, categories, partial };
}
