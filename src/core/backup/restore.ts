import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { UPLOADS_DIR } from "@/core/config";
import { prisma } from "@/core/db";
import { migrateAllInstances, type MigrationOutcome } from "@/core/modules/dataMigrations";
import { installFromMarketplace, installModule, type InstallResult } from "@/core/modules/installer";
import { getMarketplace } from "@/core/modules/marketplace";
import { resetModuleRegistry } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { UPLOAD_NAME_RE } from "@/core/services/uploads";
import { decryptBackup } from "./crypto";
import { applyUpgrades, currentSchemaVersion, isNewerSchema, pickKnownColumns } from "./schema";
import { safetyCopy } from "./files";
import { DATA_FILES, FORMAT, FORMAT_VERSION, sha256, type BackupManifest, type BackupModule } from "./format";
import { readTarGz } from "./tar";

type Row = Record<string, unknown>;
export type ParsedBackup = {
  manifest: BackupManifest;
  data: { users: Row[]; settings: Row[]; modules: BackupModule[]; instances: Row[]; instanceTranslations: Row[]; entries: Row[]; entryTranslations: Row[]; redirects: Row[]; records: Row[] };
  uploads: { name: string; content: Buffer }[];
};
export type ParseError = "not-a-backup" | "wrong-password" | "corrupt" | "tampered" | "newer-format" | "newer-schema" | "no-owner";

/** Une sauvegarde faite par un schéma de base PLUS RÉCENT que le nôtre ne peut pas être lue : il faut d'abord mettre le framework à jour. */
export async function checkSchema(manifest: BackupManifest): Promise<"ok" | "newer-schema"> {
  return isNewerSchema(manifest.schemaVersion, await currentSchemaVersion()) ? "newer-schema" : "ok";
}

/** Déchiffre puis valide une sauvegarde : format, version, empreintes de TOUS les fichiers, présence d'un propriétaire. */
export function openBackup(file: Buffer, password: string, iterations?: number): { ok: true; backup: ParsedBackup; plain: Buffer } | { ok: false; error: ParseError } {
  const dec = decryptBackup(file, password, iterations);
  if (!dec.ok) return dec;
  const parsed = parseBackup(dec.plain);
  return parsed.ok ? { ok: true, backup: parsed.backup, plain: dec.plain } : parsed;
}

export function parseBackup(plain: Buffer): { ok: true; backup: ParsedBackup } | { ok: false; error: ParseError } {
  let files;
  try { files = new Map(readTarGz(plain).map((f) => [f.path, f.content])); } catch { return { ok: false, error: "corrupt" }; }
  let manifest: BackupManifest;
  try { manifest = JSON.parse(files.get("backup.json")?.toString("utf8") ?? ""); } catch { return { ok: false, error: "not-a-backup" }; }
  if (manifest?.format !== FORMAT || !Array.isArray(manifest.files) || !Array.isArray(manifest.modules)) return { ok: false, error: "not-a-backup" };
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) return { ok: false, error: "newer-format" };

  // Chaque fichier annoncé existe et a la bonne empreinte ; aucun fichier n'est ajouté en douce.
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const content = files.get(f.path);
    if (!content || sha256(content) !== f.sha256) return { ok: false, error: "tampered" };
  }
  for (const p of files.keys()) if (p !== "backup.json" && p !== "README.txt" && !listed.has(p)) return { ok: false, error: "tampered" };

  const list = (p: string): Row[] | null => {
    try { const v = JSON.parse(files.get(p)?.toString("utf8") ?? ""); return Array.isArray(v) ? v : null; } catch { return null; }
  };
  const data = {
    users: list(DATA_FILES.users), settings: list(DATA_FILES.settings), instances: list(DATA_FILES.instances), instanceTranslations: list(DATA_FILES.instanceTranslations),
    entries: list(DATA_FILES.entries), entryTranslations: list(DATA_FILES.entryTranslations), redirects: list(DATA_FILES.redirects), records: list(DATA_FILES.records),
  };
  if (Object.values(data).some((v) => v === null)) return { ok: false, error: "corrupt" };
  const modules = manifest.modules;
  const d = data as Record<keyof typeof data, Row[]>;
  if (!d.users.some((u) => u.role === "owner" && typeof u.email === "string" && typeof u.passwordHash === "string")) return { ok: false, error: "no-owner" };
  const uploads = [...files.entries()].filter(([p]) => p.startsWith("uploads/") && UPLOAD_NAME_RE.test(p.slice(8))).map(([p, content]) => ({ name: p.slice(8), content }));
  return { ok: true, backup: { manifest, data: { ...d, modules }, uploads } };
}

/* ───────────── Plan : que va-t-il se passer pour chaque module ? ───────────── */

export type ModulePlan = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** builtin : déjà là · installed : déjà installé · marketplace : sera réinstallé depuis la marketplace · custom : dépôt personnel, CONFIRMATION requise · unavailable : introuvable */
  status: "builtin" | "installed" | "marketplace" | "custom" | "unavailable";
  repoUrl: string | null;
  ref: string | null;
  needsConfirmation: boolean;
};

export async function planModules(modules: BackupModule[]): Promise<ModulePlan[]> {
  const market = await getMarketplace().catch(() => []);
  const installed = new Set((await prisma.module.findMany({ select: { id: true } })).map((m) => m.id));
  return modules.map((m): ModulePlan => {
    const base = { id: m.id, name: m.name, version: m.version, enabled: m.enabled, repoUrl: m.repoUrl, ref: m.ref };
    if (m.source === "builtin" || m.origin === "builtin") return { ...base, status: "builtin", needsConfirmation: false };
    if (installed.has(m.id)) return { ...base, status: "installed", needsConfirmation: false };
    const entry = market.find((e) => e.id === m.id);
    if (m.origin === "marketplace" && entry?.compatible) return { ...base, status: "marketplace", needsConfirmation: false };
    if (m.repoUrl) return { ...base, status: "custom", needsConfirmation: true };
    return { ...base, status: "unavailable", needsConfirmation: false };
  });
}

/* ───────────── Application ───────────── */

export type ModuleOutcome = { id: string; outcome: "kept" | "installed" | "skipped" | "failed" | "unavailable"; error?: string };
export type RestoreReport = { ok: false; error: "newer-schema"; modules: ModuleOutcome[] } | { ok: true; modules: ModuleOutcome[]; migrations: MigrationOutcome[]; counts: Record<string, number>; safetyCopy: string | null } | { ok: false; error: "invalid" | "failed"; modules: ModuleOutcome[] };

type Installers = { fromMarketplace: (id: string) => Promise<InstallResult>; fromRepo: (url: string) => Promise<InstallResult> };
const realInstallers: Installers = { fromMarketplace: installFromMarketplace, fromRepo: (url) => installModule(url) };

const MODEL_BY_FILE = { users: "User", settings: "Setting", instances: "ModuleInstance", instanceTranslations: "InstanceTranslation", entries: "Entry", entryTranslations: "EntryTranslation", redirects: "Redirect", records: "ModuleRecord" } as const;

/** Les colonnes DateTime d'un modèle, lues dans le schéma : le JSON de la sauvegarde les porte en texte ISO. */
function reviveDates(model: string, row: Row): Row {
  const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? [];
  const out: Row = { ...row };
  for (const f of fields) if (f.type === "DateTime" && typeof out[f.name] === "string") out[f.name] = new Date(out[f.name] as string);
  return out;
}

const chunks = <T,>(list: T[], n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

/**
 * Restaure une sauvegarde : réinstalle les modules (marketplace ; dépôts personnels SEULEMENT si confirmés un par un),
 * REMPLACE les données par celles de la sauvegarde dans une seule transaction (tout ou rien), puis les images.
 * Une copie de la base actuelle est gardée avant. Les modules présents ici mais absents de la sauvegarde restent installés.
 */
export async function applyRestore(backup: ParsedBackup, opts: { confirmCustom: string[]; actor: string; installers?: Installers; dataDir?: string }): Promise<RestoreReport> {
  const installers = opts.installers ?? realInstallers;
  const confirmed = new Set(opts.confirmCustom);
  const plan = await planModules(backup.data.modules);
  const outcomes: ModuleOutcome[] = [];

  for (const m of plan) {
    if (m.status === "builtin" || m.status === "installed") { outcomes.push({ id: m.id, outcome: "kept" }); continue; }
    if (m.status === "unavailable") { outcomes.push({ id: m.id, outcome: "unavailable" }); continue; }
    if (m.status === "custom" && !confirmed.has(m.id)) { outcomes.push({ id: m.id, outcome: "skipped" }); continue; }
    const result = m.status === "marketplace" ? await installers.fromMarketplace(m.id) : await installers.fromRepo(`${m.repoUrl}${m.ref ? `#${m.ref}` : ""}`);
    outcomes.push(result.ok ? { id: m.id, outcome: "installed" } : { id: m.id, outcome: "failed", error: result.error });
  }

  if ((await checkSchema(backup.manifest)) === "newer-schema") return { ok: false, error: "newer-schema", modules: [] };
  const copy = safetyCopy("pre-restore", opts.dataDir);
  // Sauvegarde d'un schéma plus ancien : transformations explicites, puis seules les colonnes encore connues (les nouvelles prennent leur défaut).
  const d = structuredClone(backup.data);
  applyUpgrades(d, backup.manifest.schemaVersion);
  for (const key of ["users", "instances", "instanceTranslations", "entries", "entryTranslations", "redirects", "records"] as const) d[key] = d[key].map((r) => pickKnownColumns(key, r));
  try {
    await prisma.$transaction(async (tx) => {
      await tx.moduleRecord.deleteMany(); await tx.entryTranslation.deleteMany(); await tx.entry.deleteMany();
      await tx.instanceTranslation.deleteMany(); await tx.moduleInstance.deleteMany(); await tx.redirect.deleteMany();
      await tx.setting.deleteMany(); await tx.user.deleteMany();

      for (const c of chunks(d.users)) await tx.user.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.users, r)) as never });
      for (const c of chunks(d.settings)) await tx.setting.createMany({ data: c.map((r) => ({ key: String(r.key), locale: String(r.locale ?? ""), value: JSON.stringify(r.value) })) });
      for (const c of chunks(d.instances)) await tx.moduleInstance.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.instances, r)) as never });
      for (const c of chunks(d.instanceTranslations)) await tx.instanceTranslation.createMany({ data: c as never });
      for (const c of chunks(d.entries)) await tx.entry.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.entries, r)) as never });
      for (const c of chunks(d.entryTranslations)) await tx.entryTranslation.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.entryTranslations, r)) as never });
      for (const c of chunks(d.redirects)) await tx.redirect.createMany({ data: c.map((r) => reviveDates(MODEL_BY_FILE.redirects, r)) as never });
      for (const c of chunks(d.records)) await tx.moduleRecord.createMany({ data: c.map((r) => ({ ...reviveDates(MODEL_BY_FILE.records, r), data: JSON.stringify(r.data) })) as never });

      // Modules : on remet « activé / désactivé » tel que sauvegardé (les lignes des modules de base sont créées si besoin).
      for (const m of d.modules) {
        const outcome = outcomes.find((o) => o.id === m.id)?.outcome;
        if (outcome === "skipped" || outcome === "failed" || outcome === "unavailable") continue;
        if (m.source === "builtin") await tx.module.upsert({ where: { id: m.id }, create: { id: m.id, source: "builtin", version: m.version, enabled: m.enabled }, update: { enabled: m.enabled } });
        else await tx.module.updateMany({ where: { id: m.id }, data: { enabled: m.enabled } });
      }
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) {
    console.error("[backup] restore failed:", (error as Error)?.message);
    return { ok: false, error: "failed", modules: outcomes };
  }

  // Images : on remplace celles du site par celles de la sauvegarde.
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const f of fs.readdirSync(UPLOADS_DIR)) if (UPLOAD_NAME_RE.test(f)) fs.rmSync(path.join(UPLOADS_DIR, f), { force: true });
  for (const u of backup.uploads) fs.writeFileSync(path.join(UPLOADS_DIR, u.name), u.content);

  resetModuleRegistry();
  // Les données restaurées peuvent être celles d'une ancienne version d'un module, réinstallée plus récente : on les met à niveau.
  const migrations = (await migrateAllInstances().catch(() => [])).filter((m) => m.status !== "none");
  await audit(opts.actor, "backup.restore", backup.manifest.createdAt);
  return { ok: true, modules: outcomes, migrations, safetyCopy: copy, counts: { users: d.users.length, entries: d.entries.length, instances: d.instances.length, records: d.records.length, uploads: backup.uploads.length } };
}
