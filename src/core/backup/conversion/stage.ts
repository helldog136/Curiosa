import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma, sqliteAdapter } from "@/core/db";
import { FULL_POWERS_KEY } from "@/core/services/mcp/fullPowers";
import { isSystemKey } from "@/core/auth/rights";
import { levelOf } from "@/core/auth/access";
import { UPLOAD_NAME_RE } from "@/core/services/uploads";
import { UPLOAD_NAME_RE as FONT_NAME_RE } from "@/core/fonts/registry";
import { fromBackupRows } from "@/core/overlays/backup";
import { sqliteFile } from "@/core/dbFile";
import { pickKnownColumns } from "../schema";
import { tick } from "../steps";
import type { ReportItem, Row } from "./types";

/**
 * STAGING, VALIDATION AND SWAP of a restore (docs/BACKUP.md).
 *
 *   1. a complete rollback snapshot of the live site: database, uploads, fonts and installed modules (`data/backups/pre-restore-<time>/`);
 *   2. the converted data is written into a STAGING COPY of the database (a consistent copy of the live file) and checked there: an owner account, the counts, every
 *      claimed upload file present, every stored record readable. A problem stops here: the live site was never touched;
 *   3. the files are staged beside the live folders, then swapped in; the database is replaced in ONE transaction that checks the counts again before it commits.
 *      If the transaction fails, the folders go back from the snapshot and the database is untouched (the transaction rolled back).
 */

export type Data = {
  users: Row[]; settings: Row[]; instances: Row[]; instanceTranslations: Row[]; entries: Row[]; entryTranslations: Row[]; redirects: Row[]; records: Row[];
  retired?: Row[]; roles?: Row[]; userRoles?: Row[]; uploadFiles?: Row[]; overlayPages?: Row[];
};
type Db = Prisma.TransactionClient;

export const MODEL_BY_FILE = { users: "User", settings: "Setting", instances: "ModuleInstance", instanceTranslations: "InstanceTranslation", entries: "Entry", entryTranslations: "EntryTranslation", redirects: "Redirect", records: "ModuleRecord" } as const;

function rightsList(v: unknown): string[] {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
}

/** The `coordinator` flag of a backup only counts on an "admin" account (otherwise it is cleared); absent from an older backup = false. Never believed on its word. */
export function sanitizeUserLevel(row: Row): Row { return { ...row, coordinator: levelOf(row) === "coordinator" }; }

/** Roles of a backup: known columns, dates read back, rights as JSON text, `system` recomputed from the key (never believed on its word). */
export function restorableRoles(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const raw of rows) {
    const r = reviveDates("Role", pickKnownColumns("roles", raw));
    if (typeof r.id !== "string" || typeof r.key !== "string" || typeof r.name !== "string" || seen.has(r.key) || seen.has(`id:${r.id}`)) continue;
    seen.add(r.key); seen.add(`id:${r.id}`);
    out.push({ ...r, system: isSystemKey(r.key), rights: isSystemKey(r.key) ? "[]" : JSON.stringify(rightsList(r.rights)) });
  }
  return out;
}

/** The DateTime columns of a model, read from the schema: the JSON of the backup carries them as ISO text. */
export function reviveDates(model: string, row: Row): Row {
  const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? [];
  const out: Row = { ...row };
  for (const f of fields) if (f.type === "DateTime" && typeof out[f.name] === "string") out[f.name] = new Date(out[f.name] as string);
  return out;
}

const chunks = <T,>(list: T[], n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

/** The expected row counts after the data is written (what the checks compare against). */
export function expectedCounts(d: Data): Record<string, number> {
  return { users: d.users.length, instances: d.instances.length, entries: d.entries.length, entryTranslations: d.entryTranslations.length, records: d.records.length, redirects: d.redirects.length, retired: (d.retired ?? []).length };
}

/** Replaces the data of the database behind `tx` with `d`. Used on the staging copy first, then on the live database. */
export async function replaceData(tx: Db, d: Data, uploadNames: ReadonlySet<string>): Promise<void> {
  await tx.moduleRecord.deleteMany(); await tx.entryTranslation.deleteMany(); await tx.entry.deleteMany();
  await tx.instanceTranslation.deleteMany(); await tx.moduleInstance.deleteMany(); await tx.redirect.deleteMany();
  await tx.userRole.deleteMany(); await tx.role.deleteMany();
  await tx.setting.deleteMany(); await tx.user.deleteMany(); await tx.retiredInstance.deleteMany(); await tx.uploadFile.deleteMany(); await tx.overlayPage.deleteMany();

  for (const c of chunks(d.users)) await tx.user.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.users, r)) as never });
  for (const c of chunks(d.settings.filter((r) => String(r.key) !== FULL_POWERS_KEY))) await tx.setting.createMany({ data: c.map((r) => ({ key: String(r.key), locale: String(r.locale ?? ""), value: JSON.stringify(r.value) })) });
  for (const c of chunks(d.instances)) await tx.moduleInstance.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.instances, r)) as never });
  for (const c of chunks(d.instanceTranslations)) await tx.instanceTranslation.createMany({ data: c as never });
  for (const c of chunks(d.entries)) await tx.entry.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.entries, r)) as never });
  for (const c of chunks(d.entryTranslations)) await tx.entryTranslation.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.entryTranslations, r)) as never });
  for (const c of chunks(d.redirects)) await tx.redirect.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.redirects, r)) as never });
  for (const c of chunks(d.records)) await tx.moduleRecord.createMany({ data: c.map((r) => ({ ...reviveDates(MODEL_BY_FILE.records, r), data: JSON.stringify(r.data) })) as never });
  // Roles: a role is "predefined" only by its key (owner, admin, editor); an assignment to a missing person or role is ignored.
  const roles = restorableRoles(d.roles ?? []);
  for (const c of chunks(roles)) await tx.role.createMany({ data: c as never });
  const userIds = new Set(d.users.map((u) => String(u.id)));
  const roleIds = new Set(roles.map((r) => String(r.id)));
  const links = (d.userRoles ?? []).filter((r) => userIds.has(String(r.userId)) && roleIds.has(String(r.roleId))).map((r) => ({ userId: String(r.userId), roleId: String(r.roleId) }));
  for (const c of chunks([...new Map(links.map((l) => [`${l.userId}|${l.roleId}`, l])).values()])) await tx.userRole.createMany({ data: c });
  for (const c of chunks(d.retired ?? [])) await tx.retiredInstance.createMany({ data: c.map((r) => ({ ...reviveDates("RetiredInstance", pickKnownColumns("retired", r)), payload: JSON.stringify(r.payload) })) as never });

  // Owners of claimed files: only for the files this backup holds (otherwise the row would have nothing to point at).
  const owned = (d.uploadFiles ?? []).filter((r) => typeof r.name === "string" && uploadNames.has(r.name) && typeof r.ownerInstance === "string" && typeof r.ownerModule === "string");
  for (const c of chunks(owned)) await tx.uploadFile.createMany({ data: c.map((r) => ({
    name: String(r.name), uploaderId: typeof r.uploaderId === "string" ? r.uploaderId : null, bytes: Number.isFinite(Number(r.bytes)) ? Math.max(0, Math.trunc(Number(r.bytes))) : 0,
    createdAt: new Date(String(r.createdAt)), ownerModule: String(r.ownerModule), ownerInstance: String(r.ownerInstance), claimedAt: typeof r.claimedAt === "string" ? new Date(r.claimedAt) : null,
  })).map((r) => (Number.isNaN(r.createdAt.getTime()) ? { ...r, createdAt: new Date() } : r)) });

  // Overlay pages: same secret addresses as before (OBS keeps working), hard limits applied again.
  for (const c of chunks(fromBackupRows(d.overlayPages))) await tx.overlayPage.createMany({ data: c });
}

/** What the database holds after `replaceData`, compared with what was meant: problems as report items (empty = sound). */
export async function checkWritten(db: Db, d: Data, uploadNames: ReadonlySet<string>): Promise<ReportItem[]> {
  const problems: ReportItem[] = [];
  const want = expectedCounts(d);
  const have: Record<string, number> = {
    users: await db.user.count(), instances: await db.moduleInstance.count(), entries: await db.entry.count(), entryTranslations: await db.entryTranslation.count(),
    records: await db.moduleRecord.count(), redirects: await db.redirect.count(), retired: await db.retiredInstance.count(),
  };
  for (const k of Object.keys(want)) if (want[k] !== have[k]) problems.push({ id: `check.count.${k}`, note: "checkCount", params: { what: k, expected: want[k]!, found: have[k]! } });
  const owner = (await db.user.findMany()).some((u) => levelOf(u as unknown as Row) === "owner" && !!u.email && !!u.passwordHash);
  if (!owner) problems.push({ id: "check.owner", note: "checkOwner" });
  const missing = (await db.uploadFile.findMany({ select: { name: true } })).filter((f) => !uploadNames.has(f.name));
  if (missing.length) problems.push({ id: "check.uploads", note: "checkUploads", params: { count: missing.length } });
  let unreadable = 0;
  // By pages, letting the event loop breathe between two pages (20 000 stored items must not freeze the site).
  for (let after: string | undefined; ;) {
    const page = await db.moduleRecord.findMany({ select: { id: true, data: true }, orderBy: { id: "asc" }, take: 2000, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
    for (const r of page) { try { JSON.parse(r.data); } catch { unreadable++; } }
    if (page.length < 2000) break;
    after = page[page.length - 1]!.id;
    await tick();
  }
  if (unreadable) problems.push({ id: "check.records", note: "checkRecords", params: { count: unreadable } });
  return problems;
}

/** Runs the whole data replacement on a staging copy of the live database file and checks it. Returns the problems (empty = the live replacement can go ahead). */
export async function validateOnStagingCopy(d: Data, uploadNames: ReadonlySet<string>, dataDir: string): Promise<ReportItem[]> {
  const live = sqliteFile();
  if (!live || !fs.existsSync(live)) return [];   // another database: the live transaction does the same checks before it commits
  const dir = path.join(dataDir, "tmp", "restore-staging");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `staging-${process.pid}-${Date.now()}.db`);
  let client: PrismaClient | null = null;
  try {
    if (file.includes("'") || file.includes("\0")) throw new Error("unsafe path");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file}'`);
    client = new PrismaClient({ adapter: sqliteAdapter(`file:${file}`) });
    return await client.$transaction(async (tx) => {
      await replaceData(tx, d, uploadNames);
      return checkWritten(tx, d, uploadNames);
    }, { timeout: 120_000, maxWait: 10_000 }).then((r) => r, (e: Error) => [{ id: "check.write", note: "checkWrite", params: { error: String(e?.message ?? e).slice(0, 160) } }]);
  } catch (e) {
    return [{ id: "check.write", note: "checkWrite", params: { error: String((e as Error)?.message ?? e).slice(0, 160) } }];
  } finally {
    await client?.$disconnect().catch(() => {});
    for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }
}

/* ───────────── snapshot and folder swap ───────────── */

const copyDir = (from: string, to: string) => { if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };

export type Snapshot = { dir: string; has: { db: boolean } };

/** Complete rollback snapshot: database (consistent copy), uploads, fonts, installed modules. Keeps the last three. */
export async function takeSnapshot(dataDir: string, dirs: { uploads: string; fonts: string; modules: string }, now = Date.now()): Promise<Snapshot> {
  const root = path.join(dataDir, "backups");
  const dir = path.join(root, `pre-restore-${now}`);
  fs.mkdirSync(dir, { recursive: true });
  const live = sqliteFile();
  let db = false;
  if (live && fs.existsSync(live)) {
    const target = path.join(dir, "database.db");
    try {
      if (target.includes("'") || target.includes("\0")) throw new Error("unsafe path");
      await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
    } catch { fs.rmSync(target, { force: true }); fs.copyFileSync(live, target); }
    db = true;
  }
  copyDir(dirs.uploads, path.join(dir, "uploads"));
  copyDir(dirs.fonts, path.join(dir, "fonts"));
  if (fs.existsSync(dirs.modules)) fs.cpSync(dirs.modules, path.join(dir, "modules"), { recursive: true, filter: (src) => !path.basename(src).startsWith(".incoming-") });
  for (const old of fs.readdirSync(root).filter((f) => /^pre-restore-\d+$/.test(f)).sort().slice(0, -3)) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return { dir, has: { db } };
}

/** Puts `source` in place of the folder `live`: renames when it can (the old folder is kept beside as `aside`), otherwise replaces the files one by one. */
export function swapDir(live: string, source: string, aside: string, keep: (name: string) => boolean): void {
  fs.rmSync(aside, { recursive: true, force: true });
  try {
    if (fs.existsSync(live)) fs.renameSync(live, aside);
    fs.renameSync(source, live);
    return;
  } catch {
    // A folder that cannot be renamed (a mounted volume): put back what was moved, then replace the files.
    if (fs.existsSync(aside) && !fs.existsSync(live)) fs.renameSync(aside, live);
  }
  fs.mkdirSync(live, { recursive: true });
  for (const f of fs.readdirSync(live)) if (!keep(f)) fs.rmSync(path.join(live, f), { recursive: true, force: true });
  for (const f of fs.readdirSync(source)) fs.cpSync(path.join(source, f), path.join(live, f), { recursive: true });
  fs.rmSync(source, { recursive: true, force: true });
}

/** Puts a folder back from the snapshot (empty folder when the snapshot had none). */
export function restoreDirFrom(live: string, saved: string): void {
  fs.rmSync(live, { recursive: true, force: true });
  if (fs.existsSync(saved)) fs.cpSync(saved, live, { recursive: true }); else fs.mkdirSync(live, { recursive: true });
}

export const isUploadName = (n: string) => UPLOAD_NAME_RE.test(n);
export const isFontName = (n: string) => FONT_NAME_RE.test(n);

/** Stages `files` next to `live` (non-matching files of the live folder are kept: they are not part of a backup). */
export function stageDir(live: string, stageRoot: string, name: string, files: { name: string; content: Buffer }[], matches: (n: string) => boolean): string {
  const dir = path.join(stageRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(live)) for (const f of fs.readdirSync(live)) if (!matches(f)) fs.cpSync(path.join(live, f), path.join(dir, f), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.content);
  return dir;
}
