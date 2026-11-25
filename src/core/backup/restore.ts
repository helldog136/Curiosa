import fs from "node:fs";
import path from "node:path";
import { FONTS_DIR, UPLOADS_DIR } from "@/core/config";
import { DATA_DIR, MODULES_DIR } from "@/core/config";
import { emptyReport, type BackupData, type ConversionReport, type ReportItem } from "./conversion/types";
import { freezePlacements, rawgCarryOver, runCoreConversions } from "./conversion/coreConversions";
import { applyRawgHandover } from "./conversion/rawgApply";
import { buildConversionPlan, planModuleSteps, type ConversionPlan } from "./conversion/plan";
import { installFirstRelease, walkRemaining, type ModuleChain } from "./conversion/moduleChain";
import { checkWritten, isFontName, isUploadName, replaceData, restoreDirFrom, sanitizeUserLevel, stageDir, swapDir, takeSnapshot, validateOnStagingCopy } from "./conversion/stage";

import { UPLOAD_NAME_RE as FONT_NAME_RE } from "@/core/fonts/registry";
import { reconcileUploads } from "@/core/fonts/uploads";
import { prisma } from "@/core/db";
import { migrateModuleInstances, type MigrationOutcome } from "@/core/modules/dataMigrations";
import { installFromCatalogue, installModule, purgeModule, type InstallResult } from "@/core/modules/installer";
import { listModuleRows, readGitManifest } from "@/core/modules/registry";
import { getCatalogue } from "@/core/modules/catalogue";
import { resetModuleRegistry } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { fullPowersIds } from "@/core/services/mcp/fullPowers";
import { levelOf } from "@/core/auth/access";
import { syncSystemAssignments } from "@/core/auth/roles";
import { withdrawAllLinks } from "@/core/auth/invitations";
import { sweepOrphanedAccesses } from "@/core/personalAi/lifecycle";
import { UPLOAD_NAME_RE } from "@/core/services/uploads";
import { decryptBackup, decryptBackupAsync } from "./crypto";
import { runAsync, runSync, sha256Steps, tick, type Steps } from "./steps";
import { applyUpgrades, currentSchemaVersion, isNewerSchema, pickKnownColumns } from "./schema";
import { bumpGenerations, readGenerations } from "@/core/services/store";
import { DATA_FILES, FORMAT, FORMAT_VERSION, LEGACY_FORMATS, type BackupManifest, type BackupModule } from "./format";
import { readTarGz, readTarGzAsync, type TarFile } from "./tar";
import { linksFor, orderByDependencies, previewMissing, settleRestored, type DependencyIssue } from "./restoreDeps";
import type { Missing } from "@/core/modules/dependencyInstaller";
import { opStep } from "../operations/tracker";
import { planSkins, restoreSkins, skinsBeforeRestore, skinsOfBackup, type SkinOutcome, type SkinPlan } from "@/core/skins/restore";

type Row = Record<string, unknown>;
export type ParsedBackup = {
  manifest: BackupManifest;
  data: { users: Row[]; settings: Row[]; modules: BackupModule[]; instances: Row[]; instanceTranslations: Row[]; entries: Row[]; entryTranslations: Row[]; redirects: Row[]; records: Row[]; /** Données gardées de modules retirés (absent des sauvegardes d'avant la 0.1.20). */ retired?: Row[]; /** Rôles et affectations (absents avant la 0.2.0 : recréés depuis `User.role`). */ roles?: Row[]; userRoles?: Row[]; /** Propriétaires des fichiers revendiqués (0.2.13 ; absent avant : aucun). */ uploadFiles?: Row[]; /** Pages d'overlay (0.5.0 ; absent avant : aucune). */ overlayPages?: Row[] };
  uploads: { name: string; content: Buffer }[];
  /** Polices envoyées (0.7.0 ; absent avant : aucune). */
  fonts?: { name: string; content: Buffer }[];
};
export type ParseError = "not-a-backup" | "wrong-password" | "corrupt" | "tampered" | "newer-format" | "newer-schema" | "no-owner";

/** Une sauvegarde faite par un schéma de base PLUS RÉCENT que le nôtre ne peut pas être lue : il faut d'abord mettre le framework à jour. */
export async function checkSchema(manifest: BackupManifest): Promise<"ok" | "newer-schema"> {
  return isNewerSchema(manifest.schemaVersion, await currentSchemaVersion()) ? "newer-schema" : "ok";
}

type Parsed = { ok: true; backup: ParsedBackup } | { ok: false; error: ParseError };

/** Déchiffre puis valide une sauvegarde : format, version, empreintes de TOUS les fichiers, présence d'un propriétaire. */
export function openBackup(file: Buffer, password: string, iterations?: number): { ok: true; backup: ParsedBackup; plain: Buffer } | { ok: false; error: ParseError } {
  const dec = decryptBackup(file, password, iterations);
  if (!dec.ok) return dec;
  const parsed = parseBackup(dec.plain);
  return parsed.ok ? { ok: true, backup: parsed.backup, plain: dec.plain } : parsed;
}

/** Même chose sans jamais bloquer la boucle d'événements (dérivation de clé et décompression hors du fil principal, analyse par petits morceaux). */
export async function openBackupAsync(file: Buffer, password: string, iterations?: number): Promise<{ ok: true; backup: ParsedBackup; plain: Buffer } | { ok: false; error: ParseError }> {
  const dec = await decryptBackupAsync(file, password, iterations);
  if (!dec.ok) return dec;
  const parsed = await parseBackupAsync(dec.plain);
  return parsed.ok ? { ok: true, backup: parsed.backup, plain: dec.plain } : parsed;
}

export function parseBackup(plain: Buffer): Parsed {
  let tar: TarFile[];
  try { tar = readTarGz(plain); } catch { return { ok: false, error: "corrupt" }; }
  return runSync(checkFiles(tar));
}

export async function parseBackupAsync(plain: Buffer): Promise<Parsed> {
  let tar: TarFile[];
  try { tar = await readTarGzAsync(plain); } catch { return { ok: false, error: "corrupt" }; }
  return runAsync(checkFiles(tar));
}

function* checkFiles(tar: TarFile[]): Steps<Parsed> {
  const files = new Map(tar.map((f) => [f.path, f.content]));
  let manifest: BackupManifest;
  try { manifest = JSON.parse(files.get("backup.json")?.toString("utf8") ?? ""); } catch { return { ok: false, error: "not-a-backup" }; }
  if ((manifest?.format !== FORMAT && !LEGACY_FORMATS.includes(String(manifest?.format))) || !Array.isArray(manifest.files) || !Array.isArray(manifest.modules)) return { ok: false, error: "not-a-backup" };
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) return { ok: false, error: "newer-format" };

  // Chaque fichier annoncé existe et a la bonne empreinte ; aucun fichier n'est ajouté en douce.
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const content = files.get(f.path);
    if (!content || (yield* sha256Steps(content)) !== f.sha256) return { ok: false, error: "tampered" };
  }
  for (const p of files.keys()) if (p !== "backup.json" && p !== "README.txt" && !listed.has(p)) return { ok: false, error: "tampered" };

  const list = (p: string): Row[] | null => {
    try { const v = JSON.parse(files.get(p)?.toString("utf8") ?? ""); return Array.isArray(v) ? v : null; } catch { return null; }
  };
  const data: Record<string, Row[] | null> = {};
  for (const [name, file] of [["users", DATA_FILES.users], ["settings", DATA_FILES.settings], ["instances", DATA_FILES.instances], ["instanceTranslations", DATA_FILES.instanceTranslations], ["entries", DATA_FILES.entries], ["entryTranslations", DATA_FILES.entryTranslations], ["redirects", DATA_FILES.redirects], ["records", DATA_FILES.records]] as const) {
    data[name] = list(file);
    yield; // une lecture JSON à la fois : la boucle d'événements respire entre deux fichiers
  }
  if (Object.values(data).some((v) => v === null)) return { ok: false, error: "corrupt" };
  // Facultatif : une sauvegarde d'avant la 0.1.20 n'a pas ce fichier (= aucune donnée gardée) ; présent mais illisible = sauvegarde abîmée.
  const retired = files.has(DATA_FILES.retired) ? list(DATA_FILES.retired) : [];
  if (retired === null) return { ok: false, error: "corrupt" };
  // Rôles (0.2.0), facultatifs de la même façon : absents = sauvegarde plus ancienne, rôles prédéfinis recréés à la restauration.
  const roles = files.has(DATA_FILES.roles) ? list(DATA_FILES.roles) : [];
  const userRoles = files.has(DATA_FILES.userRoles) ? list(DATA_FILES.userRoles) : [];
  if (roles === null || userRoles === null) return { ok: false, error: "corrupt" };
  // Propriétaires des fichiers revendiqués (0.2.13), facultatifs : absents = aucun fichier n'a de propriétaire.
  const uploadFiles = files.has(DATA_FILES.uploadFiles) ? list(DATA_FILES.uploadFiles) : [];
  if (uploadFiles === null) return { ok: false, error: "corrupt" };
  // Pages d'overlay (0.5.0), facultatives de la même façon.
  const overlayPages = files.has(DATA_FILES.overlayPages) ? list(DATA_FILES.overlayPages) : [];
  if (overlayPages === null) return { ok: false, error: "corrupt" };
  const modules = manifest.modules;
  const d = data as Record<"users" | "settings" | "instances" | "instanceTranslations" | "entries" | "entryTranslations" | "redirects" | "records", Row[]>;
  if (!d.users.some((u) => levelOf(u) === "owner" && typeof u.email === "string" && typeof u.passwordHash === "string")) return { ok: false, error: "no-owner" };
  // A backup written before 0.1.20 can list switched-off items (`enabled: false`): they are converted by the restore (set aside, data kept), never refused (conversion/coreConversions.ts).
  const uploads = [...files.entries()].filter(([p]) => p.startsWith("uploads/") && UPLOAD_NAME_RE.test(p.slice(8))).map(([p, content]) => ({ name: p.slice(8), content }));
  const fonts = [...files.entries()].filter(([p]) => p.startsWith("fonts/") && FONT_NAME_RE.test(p.slice(6))).map(([p, content]) => ({ name: p.slice(6), content }));
  return { ok: true, backup: { manifest, data: { ...d, modules, retired, roles, userRoles, uploadFiles, overlayPages }, uploads, fonts } };
}

/* ───────────── Plan : que va-t-il se passer pour chaque module ? ───────────── */

export type ModulePlan = {
  id: string;
  name: string;
  version: string;
  /** installed : déjà installé · catalogue : sera réinstallé depuis le catalogue · custom : dépôt personnel, CONFIRMATION requise · unavailable : introuvable */
  status: "installed" | "catalogue" | "custom" | "unavailable";
  repoUrl: string | null;
  ref: string | null;
  subdir?: string | null;
  needsConfirmation: boolean;
  /** Le module demande ce cœur (ou plus) et celui-ci est trop ancien : il ne sera pas réinstallé (ses données sont gardées), à refaire après la mise à jour du site. */
  needsCore?: string;
  /** Module actif dont le fournisseur d'un service n'est ni dans la sauvegarde, ni installé, ni disponible : il sera restauré avec ses données, mais ne fonctionnera pas encore. */
  missing?: Missing[];
};

export async function planModules(modules: BackupModule[]): Promise<ModulePlan[]> {
  const plans = await planModulesBase(modules);
  const issues = await previewMissing(plans).catch((): DependencyIssue[] => []);
  return plans.map((p) => { const i = issues.find((x) => x.id === p.id); return i ? { ...p, missing: i.missing } : p; });
}

async function planModulesBase(modules: BackupModule[]): Promise<ModulePlan[]> {
  const market = await getCatalogue().catch(() => []);
  const installed = new Set((await prisma.module.findMany({ select: { id: true } })).map((m) => m.id));
  return modules.map((m): ModulePlan => {
    const base = { id: m.id, name: m.name, version: m.version, repoUrl: m.repoUrl, ref: m.ref, subdir: m.subdir ?? null };
    if (installed.has(m.id)) return { ...base, status: "installed", needsConfirmation: false };
    const entry = market.find((e) => e.id === m.id);
    // Une sauvegarde d'une version où les modules de base étaient « intégrés » les nomme « builtin » : ce sont aujourd'hui des modules du catalogue.
    // Whatever origin the backup claims, a module of a personal catalogue (or of an unverified index) is never reinstalled without the owner confirming it, module by module.
    if ((m.origin === "catalogue" || m.origin === "builtin") && entry?.compatible && !entry.personal && entry.origin !== "extra") return { ...base, status: "catalogue", needsConfirmation: false, ...(entry.needsNewerCore ? { needsCore: entry.needsNewerCore } : {}) };
    if (m.repoUrl) return { ...base, status: "custom", needsConfirmation: true };
    return { ...base, status: "unavailable", needsConfirmation: false };
  });
}


/* ───────────── Application ───────────── */

export type ModuleOutcome = { id: string; outcome: "kept" | "installed" | "skipped" | "failed" | "unavailable"; error?: string; /** Avec l'erreur « modules.error.core » : cœur demandé par le module. */ needsCore?: string };
/** Skins d'une sauvegarde, avec ce qui va se passer pour chacun. */
export async function planBackupSkins(backup: ParsedBackup): Promise<SkinPlan[]> {
  return planSkins(skinsOfBackup(backup.manifest.skins, backup.data.settings));
}

/** What the preview shows: the module plans, the skins and the conversion plan (version gap, core conversions, module paths). Nothing is written. */
export async function previewRestore(backup: ParsedBackup): Promise<{ modules: ModulePlan[]; skins: SkinPlan[]; conversion: ConversionPlan | null }> {
  const data = backup.data as unknown as BackupData;
  const modules = await planModules(backup.data.modules);
  const market = await getCatalogue().catch(() => []);
  const conversion = await buildConversionPlan({ data, frameworkVersion: backup.manifest.frameworkVersion, createdAt: backup.manifest.createdAt, modules: modules.map((m) => ({ id: m.id, status: m.status, entry: market.find((e) => e.id === m.id) })) }).catch(() => null);
  return { modules, skins: await planBackupSkins(backup).catch(() => []), conversion };
}

type Failure = { ok: false; error: "newer-schema" | "invalid" | "failed"; modules: ModuleOutcome[]; report: ConversionReport; safetyCopy?: string | null };
export type RestoreReport = Failure | { ok: true; modules: ModuleOutcome[]; /** Skins réinstallés depuis leur dépôt (basic s'applique tant qu'un skin manque). */ skins: SkinOutcome[]; migrations: MigrationOutcome[]; /** Modules actifs restaurés auxquels il manque encore un fournisseur (restaurés avec leurs données, à compléter). */ dependencies: DependencyIssue[]; /** Fournisseurs installés d'office pour eux. */ provided: string[]; counts: Record<string, number>; safetyCopy: string | null; /** Converted, set aside and failed items, with where to look by hand in the unpacked archive. */ report: ConversionReport };

type Installers = { fromCatalogue: (id: string) => Promise<InstallResult>; fromRepo: (url: string) => Promise<InstallResult>; firstRelease?: (id: string, chain: ModuleChain) => Promise<InstallResult> };
// Sans cascade ici : l'ordre et la vérification des dépendances se font pour toute la sauvegarde (restoreDeps.ts).
// `confirmExtra` : restaurer remet un module que le propriétaire avait déjà installé (et il confirme la restauration) ; ce n'est pas une installation d'office.
const realInstallers: Installers = { fromCatalogue: (id) => installFromCatalogue(id, { dependencies: false, restoreKept: false, confirmExtra: true }), fromRepo: (url) => installModule(url, { dependencies: false, restoreKept: false }), firstRelease: (id, chain) => installFirstRelease(id, chain) };

const SLICE_ROWS = 2000;
/** `structuredClone` de la sauvegarde lue, mais tableau par tableau et par tranches : la boucle d'événements respire entre deux tranches. */
async function cloneInSlices(data: ParsedBackup["data"]): Promise<ParsedBackup["data"]> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) { out[key] = structuredClone(value); continue; }
    const rows: unknown[] = [];
    for (let i = 0; i < value.length; i += SLICE_ROWS) { rows.push(...structuredClone(value.slice(i, i + SLICE_ROWS))); await tick(); }
    out[key] = rows;
  }
  return out as ParsedBackup["data"];
}

const pathOfInstances = (d: { instances: Row[] }, moduleId: string): string => {
  const keys = d.instances.filter((i) => i.moduleId === moduleId).map((i) => String(i.key)).filter(Boolean);
  return keys.length ? keys.map((k) => `readable/modules/${k}/`).join(", ") : "data/module-records.json";
};

/** What the data conversion of a module says, as report items (nothing is swallowed: every failed or set-aside instance is named). */
function migrationItems(outcomes: MigrationOutcome[], moduleId: string, path: string, rep: ConversionReport): void {
  const done = outcomes.filter((m) => m.status === "ok");
  if (done.length) rep.converted.push({ id: `module.${moduleId}`, note: "moduleData", params: { module: moduleId, from: Math.min(...done.map((m) => m.from)), to: Math.max(...done.map((m) => m.to)) } });
  for (const m of outcomes) {
    if (m.status === "failed" && m.error?.startsWith("floor")) rep.setAside.push({ id: `module.${moduleId}.${m.key}`, note: "moduleFloor", params: { module: moduleId, key: m.key, from: m.from }, path });
    else if (m.status === "failed") rep.failed.push({ id: `module.${moduleId}.${m.key}`, note: "moduleMigration", params: { module: moduleId, key: m.key, error: String(m.error ?? "").slice(0, 160) }, path });
    else if (m.status === "newer") rep.setAside.push({ id: `module.${moduleId}.${m.key}`, note: "moduleNewer", params: { module: moduleId, key: m.key }, path });
  }
}

/**
 * Restaure une sauvegarde, au mieux (docs/BACKUP.md, « Anciennes sauvegardes »). Rien n'est installé avant les contrôles de format et de schéma. Les données sont converties
 * (conversions du cœur, fonctions pures), les modules réinstallés (catalogue ; dépôts personnels SEULEMENT si confirmés ; chaîne de versions quand les données sont plus
 * anciennes que ce que la version actuelle convertit), l'ensemble est écrit dans une COPIE de la base et vérifié, puis échangé : dossiers (images, polices) et base dans UNE
 * transaction qui revérifie les comptes avant de valider. Un cliché complet (base, images, polices, modules) est gardé avant. Ce qui ne marche pas n'arrête pas le reste :
 * c'est dit dans le bilan (`report`), avec le chemin exact du fichier lisible. Les modules présents ici mais absents de la sauvegarde restent installés.
 */
export async function applyRestore(backup: ParsedBackup, opts: { confirmCustom: string[]; actor: string; installers?: Installers; dataDir?: string }): Promise<RestoreReport> {
  const rep = emptyReport();
  // Contrôles d'abord : un schéma plus récent est refusé AVANT que quoi que ce soit soit installé.
  if ((await checkSchema(backup.manifest)) === "newer-schema") return { ok: false, error: "newer-schema", modules: [], report: rep };

  const dataDir = opts.dataDir ?? DATA_DIR;
  const installers = opts.installers ?? realInstallers;
  const confirmed = new Set(opts.confirmCustom);

  // Données : copie, transformations explicites du schéma, conversions du cœur, puis seules les colonnes encore connues (les nouvelles prennent leur défaut).
  const d = await cloneInSlices(backup.data);
  applyUpgrades(d, backup.manifest.schemaVersion);
  const core = runCoreConversions(d as unknown as BackupData, new Date(backup.manifest.createdAt));
  rep.converted.push(...core.converted); rep.setAside.push(...core.setAside);
  const rawg = rawgCarryOver(d as unknown as BackupData);
  for (const key of ["users", "instances", "instanceTranslations", "entries", "entryTranslations", "redirects", "records"] as const) {
    const rows: Row[] = [];
    for (let i = 0; i < d[key].length; i += SLICE_ROWS) { rows.push(...d[key].slice(i, i + SLICE_ROWS).map((r) => (key === "users" ? sanitizeUserLevel(pickKnownColumns(key, r)) : pickKnownColumns(key, r)))); await tick(); }
    d[key] = rows;
  }

  // Modules.
  opStep("modules");
  const planned = await planModulesBase(d.modules);
  const links = await linksFor(planned.map((p) => p.id));
  const plan = orderByDependencies(planned, (id) => links.get(id));
  const market = await getCatalogue().catch(() => []);
  const { chains } = await planModuleSteps(d as unknown as BackupData, plan.map((m) => ({ id: m.id, status: m.status, entry: market.find((e) => e.id === m.id) }))).catch(() => ({ chains: new Map<string, ModuleChain>() }));
  const outcomes: ModuleOutcome[] = [];
  const installedNow: string[] = [];
  const walk = new Map<string, ModuleChain>();

  for (const m of plan) {
    const path = pathOfInstances(d, m.id);
    if (m.status === "installed") { outcomes.push({ id: m.id, outcome: "kept" }); continue; }
    if (m.status === "unavailable") { outcomes.push({ id: m.id, outcome: "unavailable" }); rep.setAside.push({ id: `module.${m.id}`, note: "moduleMissing", params: { module: m.id }, path }); continue; }
    if (m.status === "custom" && !confirmed.has(m.id)) { outcomes.push({ id: m.id, outcome: "skipped" }); rep.setAside.push({ id: `module.${m.id}`, note: "moduleSkipped", params: { module: m.id }, path }); continue; }
    if (m.needsCore) { outcomes.push({ id: m.id, outcome: "failed", error: "modules.error.core", needsCore: m.needsCore }); rep.failed.push({ id: `module.${m.id}`, note: "moduleNeedsCore", params: { module: m.id, core: m.needsCore }, path }); continue; }
    const chain = chains.get(m.id);
    let result: InstallResult | null = null;
    if (chain?.tags.length && installers.firstRelease) {
      result = await installers.firstRelease(m.id, chain);
      if (result.ok) walk.set(m.id, chain);
      else rep.failed.push({ id: `module.${m.id}.chain`, note: "moduleChainInstall", params: { module: m.id, tag: chain.tags[0]! }, path });
    } else if (chain?.blocked) {
      rep.setAside.push({ id: `module.${m.id}.chain`, note: "moduleNoRelease", params: { module: m.id, from: chain.dataVersion }, path });
    }
    if (!result?.ok) result = m.status === "catalogue" ? await installers.fromCatalogue(m.id) : await installers.fromRepo(`${m.repoUrl}${m.ref || m.subdir ? `#${m.ref ?? ""}${m.subdir ? `:${m.subdir}` : ""}` : ""}`);
    if (result.ok) installedNow.push(m.id);
    outcomes.push(result.ok ? { id: m.id, outcome: "installed" } : { id: m.id, outcome: "failed", error: result.error, ...(result.needsCore ? { needsCore: result.needsCore } : {}) });
    if (!result.ok) rep.failed.push({ id: `module.${m.id}`, note: result.error === "modules.error.access" ? "moduleAccess" : "moduleInstall", params: { module: m.id }, path });   // a private repository: the sealed access code of a backup cannot be read on another server, so it asks for it again
  }
  const undoModules = async () => { for (const id of installedNow) await purgeModule(id).catch(() => {}); };

  // Placement of overlay modules (before 0.2.6): needs the manifests, so it runs once the modules are back.
  const placed = freezePlacements(d as unknown as BackupData, (id) => readGitManifest(id), backup.manifest.frameworkVersion);
  rep.converted.push(...(placed.converted ?? []));

  const skinsBefore = await skinsBeforeRestore();

  // Cliché complet avant toute écriture : base, images, polices, modules.
  opStep("safety");
  let snap: Awaited<ReturnType<typeof takeSnapshot>> | null = null;
  try { snap = await takeSnapshot(dataDir, { uploads: UPLOADS_DIR, fonts: FONTS_DIR, modules: MODULES_DIR }); } catch (e) { console.error("[backup] snapshot failed:", (e as Error)?.message); }
  if (!snap) { await undoModules(); rep.failed.push({ id: "check.snapshot", note: "checkSnapshot" }); return { ok: false, error: "failed", modules: outcomes, report: rep }; }
  const copy = snap.dir;

  // Copie de travail : les données sont écrites et vérifiées ici d'abord. Un problème s'arrête là : le site n'a pas été touché.
  opStep("replace");
  const uploadNames = new Set(backup.uploads.map((u) => u.name));
  const problems = await validateOnStagingCopy(d, uploadNames, dataDir);
  if (problems.length) { await undoModules(); rep.failed.push(...problems); return { ok: false, error: "invalid", modules: outcomes, report: rep, safetyCopy: copy }; }

  // Compteurs de génération du stockage d'AVANT : la restauration remet ceux de la sauvegarde, mais un compteur ne recule jamais.
  // Full powers (0.35.0) never come back from a backup: the settings are replaced and the key is not restored, so every access is off afterwards. The journal says so.
  const hadFullPowers = (await fullPowersIds().catch(() => [])).length > 0;
  const generationsBefore = await readGenerations().catch(() => new Map<string, number>());

  // Échange : dossiers d'abord (renommage quand c'est possible), puis la base en UNE transaction qui revérifie les comptes ; au moindre échec, tout revient du cliché.
  const stageRoot = path.join(dataDir, "tmp", "restore-staging");
  const asideRoot = path.join(dataDir, "tmp", "restore-aside");
  fs.mkdirSync(stageRoot, { recursive: true }); fs.mkdirSync(asideRoot, { recursive: true });
  const rollbackFiles = () => { restoreDirFrom(UPLOADS_DIR, path.join(snap!.dir, "uploads")); restoreDirFrom(FONTS_DIR, path.join(snap!.dir, "fonts")); };
  try {
    opStep("files");
    fs.mkdirSync(UPLOADS_DIR, { recursive: true }); fs.mkdirSync(FONTS_DIR, { recursive: true });
    const stagedUploads = stageDir(UPLOADS_DIR, stageRoot, "uploads", backup.uploads, isUploadName);
    const stagedFonts = stageDir(FONTS_DIR, stageRoot, "fonts", backup.fonts ?? [], isFontName);
    swapDir(UPLOADS_DIR, stagedUploads, path.join(asideRoot, "uploads"), (n) => !isUploadName(n));
    swapDir(FONTS_DIR, stagedFonts, path.join(asideRoot, "fonts"), (n) => !isFontName(n));
  } catch (error) {
    console.error("[backup] file swap failed:", (error as Error)?.message);
    try { rollbackFiles(); } catch (e) { console.error("[backup] file rollback failed:", (e as Error)?.message); }
    await undoModules();
    rep.failed.push({ id: "check.files", note: "checkFiles", params: { error: String((error as Error)?.message ?? error).slice(0, 160) } });
    return { ok: false, error: "failed", modules: outcomes, report: rep, safetyCopy: copy };
  }
  try {
    await prisma.$transaction(async (tx) => {
      await replaceData(tx, d, uploadNames);
      const bad = await checkWritten(tx, d, uploadNames);
      if (bad.length) throw Object.assign(new Error("checks failed"), { items: bad });
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) {
    console.error("[backup] restore failed:", (error as Error)?.message);
    try { rollbackFiles(); } catch (e) { console.error("[backup] file rollback failed:", (e as Error)?.message); }
    await undoModules();
    const items = (error as { items?: ReportItem[] }).items;
    rep.failed.push(...(items ?? [{ id: "check.write", note: "checkWrite", params: { error: String((error as Error)?.message ?? error).slice(0, 160) } }]));
    return { ok: false, error: "failed", modules: outcomes, report: rep, safetyCopy: copy };
  }
  fs.rmSync(asideRoot, { recursive: true, force: true });

  // Toutes les instances restaurées (et celles qui existaient avant) ont un stockage remplacé de l'extérieur : leur génération augmente.
  await bumpGenerations([...new Set([...d.instances.map((r) => String(r.id)), ...generationsBefore.keys()])], generationsBefore)
    .catch((e) => console.error("[backup] store generation bump failed:", (e as Error)?.message));
  // La liste des polices (restaurée avec les réglages) et les fichiers sont remis d'accord (un fichier qui n'est pas une vraie police est écarté).
  await reconcileUploads(FONTS_DIR).catch((e) => console.error("[backup] fonts reconcile failed:", (e as Error)?.message));

  resetModuleRegistry();
  opStep("finish");
  await syncSystemAssignments().catch((e) => console.error("[backup] roles sync failed:", (e as Error)?.message));
  // Invitations and reset links are never in a backup (they hold secrets); the ones still waiting belong to the timeline that was just replaced: withdraw them all.
  await withdrawAllLinks(opts.actor).catch((e) => console.error("[backup] withdrawing links failed:", (e as Error)?.message));
  // AI accesses are not part of a backup but their owners are people, and the people were just replaced: an access whose owner is not in this backup is revoked (the owner of an access is
  // permanent, nobody takes it over), one journal line each, and the report says how many. Never fails the restore.
  try {
    const revoked = await sweepOrphanedAccesses(opts.actor);
    if (revoked.length) rep.converted.push({ id: "core.aiAccessesRevoked", note: "aiAccessesRevoked", params: { count: revoked.length } });
  } catch (e) { console.error("[backup] AI access sweep failed:", (e as Error)?.message); }

  // Données des modules : chacun converti avec le code de sa version ; les erreurs sont toutes dans le bilan.
  const migrations: MigrationOutcome[] = [];
  for (const row of await listModuleRows().catch(() => [])) {
    const path = pathOfInstances(d, row.id);
    try {
      const out = (await migrateModuleInstances(row.id)).filter((m) => m.status !== "none");
      migrations.push(...out);
      migrationItems(out, row.id, path, rep);
    } catch (e) { rep.failed.push({ id: `module.${row.id}`, note: "moduleMigration", params: { module: row.id, key: row.id, error: String((e as Error)?.message ?? e).slice(0, 160) }, path }); }
    const chain = walk.get(row.id);
    if (chain) {
      const steps = await walkRemaining(row.id, chain).catch((e) => [{ step: "?", ok: false, error: String((e as Error)?.message ?? e) }]);
      const bad = steps.find((s) => !s.ok);
      if (bad) rep.failed.push({ id: `module.${row.id}.chain`, note: "moduleStep", params: { module: row.id, step: bad.step, error: String(bad.error ?? "").slice(0, 160) }, path });
      else rep.converted.push({ id: `module.${row.id}.chain`, note: "moduleChain", params: { module: row.id, steps: chain.tags.length } });
    }
  }
  // RAWG : repris par le module « Jaquettes de jeux » une fois le module en place.
  if (rawg) {
    const r = await applyRawgHandover(rawg, opts.actor);
    if (r.converted) rep.converted.push(r.converted);
    if (r.failed) rep.failed.push(r.failed);
  }
  // Les modules actifs retrouvent ce dont ils ont besoin (fournisseur disponible installé avec son instance) ; sinon le bilan le dit.
  const active = d.modules.filter((m) => !["skipped", "failed", "unavailable"].includes(outcomes.find((o) => o.id === m.id)?.outcome ?? "")).map((m) => m.id);
  // Skins : réinstallés depuis leur dépôt (les réglages ont été restaurés d'un bloc avec les autres) ; sinon basic s'applique en attendant, sans rien perdre.
  const skins = await restoreSkins({ before: skinsBefore, confirmCustom: opts.confirmCustom, actor: opts.actor });
  const settled = await settleRestored(active).catch(() => ({ issues: [] as DependencyIssue[], provided: [] as string[] }));
  await audit(opts.actor, "backup.restore", backup.manifest.createdAt);
  if (hadFullPowers) await audit(opts.actor, "mcp.fullpowers.cleared", "restore");
  return { ok: true, modules: outcomes, skins, migrations, dependencies: settled.issues, provided: settled.provided, safetyCopy: copy, report: rep, counts: { users: d.users.length, entries: d.entries.length, instances: d.instances.length, records: d.records.length, retired: (d.retired ?? []).length, uploads: backup.uploads.length } };
}
