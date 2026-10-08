import fs from "node:fs";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { prisma } from "@/core/db";
import { getCatalogue, moduleOrigin } from "@/core/modules/catalogue";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances, listModuleRows, loadModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { UPLOAD_NAME_RE } from "@/core/services/uploads";
import { getSiteConfig } from "@/core/settings";
import { readVersion } from "@/core/updates/service";
import { encryptBackup } from "./crypto";
import { backupFilename, DATA_FILES, FORMAT, FORMAT_VERSION, fileOf, jsonFile, sha256, type BackupManifest, type BackupModule } from "./format";
import { readmeText } from "./readme";
import { currentSchemaVersion } from "./schema";
import { createTarGz, isSafeArchivePath, type TarFile } from "./tar";

/** Réglages qui n'ont aucun sens après une restauration (état de la dernière vérification de version). */
const VOLATILE_SETTINGS = new Set(["updates.latest", "updates.checkedAt", "updates.error"]);
const MAX_MODULE_FILE = 5 * 1024 * 1024;
const MAX_MODULE_FILES = 50;
const safeSegment = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "x";

const q = (v: unknown) => JSON.stringify(String(v ?? "")); // chaîne JSON = chaîne YAML valide

/** Une entrée, en Markdown avec un en-tête (« front matter ») : lisible dans n'importe quel éditeur. */
export function entryMarkdown(e: { status: string; publishedAt: Date | null; expiresAt: Date | null; cover: string | null; url: string | null; code: string | null; tags: string; featured: boolean; fields: string; sourceLocale: string }, t: { locale: string; slug: string; title: string; summary: string; body: string }): string {
  const parse = (raw: string, fallback: unknown) => { try { return JSON.parse(raw); } catch { return fallback; } };
  const head = [
    `title: ${q(t.title)}`, `language: ${q(t.locale)}`, `slug: ${q(t.slug)}`, `status: ${q(e.status)}`,
    `published: ${e.publishedAt ? q(e.publishedAt.toISOString()) : "null"}`, e.expiresAt ? `expires: ${q(e.expiresAt.toISOString())}` : null,
    e.url ? `link: ${q(e.url)}` : null, e.code ? `code: ${q(e.code)}` : null, e.cover ? `image: ${q(e.cover)}` : null,
    `tags: ${JSON.stringify(parse(e.tags, []))}`, e.featured ? "featured: true" : null,
    Object.keys(parse(e.fields, {}) as object).length ? `fields: ${JSON.stringify(parse(e.fields, {}))}` : null,
    t.summary ? `summary: ${q(t.summary)}` : null,
  ].filter(Boolean);
  return `---\n${head.join("\n")}\n---\n\n${t.body}\n`;
}

export type BackupResult = { buffer: Buffer; filename: string; manifest: BackupManifest; plain: Buffer };

/**
 * Crée la sauvegarde complète : le cœur (utilisateurs, réglages, instances, entrées, redirections, images) ET les données de
 * tous les modules installés (leur stockage, leurs réglages, leurs fichiers lisibles). Chiffrée par le mot de passe donné.
 */
export async function createBackup(password: string, opts: { now?: Date; iterations?: number } = {}): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  const config = await getSiteConfig();
  const [users, settings, moduleRows, instances, instanceTranslations, entries, entryTranslations, redirects, records] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.setting.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] }),
    listModuleRows(),
    prisma.moduleInstance.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.instanceTranslation.findMany({ orderBy: [{ instanceId: "asc" }, { locale: "asc" }] }),
    prisma.entry.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.entryTranslation.findMany({ orderBy: [{ entryId: "asc" }, { locale: "asc" }] }),
    prisma.redirect.findMany({ orderBy: { path: "asc" } }),
    prisma.moduleRecord.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const market = await getCatalogue().catch(() => []);
  const modules: BackupModule[] = [];
  for (const row of moduleRows) {
    const loaded = await loadModule(row);
    modules.push({
      id: row.id, source: row.source as BackupModule["source"], version: row.version, enabled: row.enabled, repoUrl: row.repoUrl, ref: row.ref, subdir: row.subdir, commit: row.commit,
      origin: moduleOrigin(row, market), name: loaded ? localized(loaded.manifest.name, "en", "en") : row.id,
    });
  }

  const files: TarFile[] = [
    jsonFile(DATA_FILES.users, users),
    jsonFile(DATA_FILES.settings, settings.filter((s) => !VOLATILE_SETTINGS.has(s.key)).map((s) => ({ ...s, value: safeParse(s.value) }))),
    jsonFile(DATA_FILES.modules, modules),
    jsonFile(DATA_FILES.instances, instances),
    jsonFile(DATA_FILES.instanceTranslations, instanceTranslations),
    jsonFile(DATA_FILES.entries, entries),
    jsonFile(DATA_FILES.entryTranslations, entryTranslations),
    jsonFile(DATA_FILES.redirects, redirects),
    jsonFile(DATA_FILES.records, records.map((r) => ({ ...r, data: safeParse(r.data) }))),
  ];

  // ── Copie lisible ───────────────────────────────────────────────────────────
  const keyOf = new Map(instances.map((i) => [i.id, i.key]));
  const viewByKey = new Map((await getActiveInstances()).map((a) => [a.instance.key, a]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const t of entryTranslations) {
    const e = entryById.get(t.entryId);
    const key = keyOf.get(t.instanceId);
    if (!e || !key) continue;
    files.push(fileOf(`readable/${safeSegment(key)}/${safeSegment(t.slug)}.${safeSegment(t.locale)}.md`, entryMarkdown(e, t)));
  }
  const byCollection = new Map<string, typeof records>();
  for (const r of records) {
    const key = keyOf.get(r.instanceId) ?? "unknown";
    byCollection.set(`${key}\u0000${r.collection}`, [...(byCollection.get(`${key}\u0000${r.collection}`) ?? []), r]);
  }
  for (const [id, rows] of byCollection) {
    const [key, collection] = id.split("\u0000");
    files.push(jsonFile(`readable/modules/${safeSegment(key!)}/records-${safeSegment(collection!)}.json`, rows.map((r) => ({ id: r.id, createdAt: r.createdAt, ...(typeof safeParse(r.data) === "object" ? (safeParse(r.data) as object) : { value: safeParse(r.data) }) }))));
  }
  for (const [key, { instance, mod }] of viewByKey) {
    const hook = mod.def.backup?.readable;
    if (!hook) continue;
    try {
      const extra = await hook(await buildContext(mod, instance, config.defaultLocale));
      for (const f of extra.slice(0, MAX_MODULE_FILES)) {
        const p = `readable/modules/${safeSegment(key)}/${f.path}`;
        if (!isSafeArchivePath(p) || typeof f.content !== "string" || Buffer.byteLength(f.content) > MAX_MODULE_FILE || files.some((x) => x.path === p)) continue;
        files.push(fileOf(p, f.content));
      }
    } catch (error) {
      console.error(`[backup] ${key} readable export failed:`, error);
    }
  }
  const secretKeys = (key: string) => /(^|\.)(pass|password|secret|token|key)/i.test(key);
  files.push(fileOf("readable/site.txt", [
    `${config.name}`, "=".repeat(Math.max(3, config.name.length)), `Langue par défaut / default language : ${config.defaultLocale}`, `Langues / languages : ${config.locales.join(", ")}`, "",
    "Modules / instances :", ...instances.map((i) => `- ${i.nickname ?? i.moduleId} (module ${i.moduleId}, id ${i.key})`), "",
    `Entrées / entries : ${entries.length}`, `Utilisateurs / users : ${users.length}`, `Redirections : ${redirects.length}`, "",
    "Réglages / settings (valeurs secrètes masquées / secret values hidden) :",
    ...settings.filter((s) => !VOLATILE_SETTINGS.has(s.key) && !s.key.startsWith("instance.")).map((s) => `- ${s.key}${s.locale ? `[${s.locale}]` : ""} = ${secretKeys(s.key) ? "••••" : s.value.slice(0, 300)}`), "",
  ].join("\n")));

  // ── Images et fichiers envoyés ──────────────────────────────────────────────
  let uploadCount = 0;
  try {
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
      if (!UPLOAD_NAME_RE.test(name)) continue;
      files.push(fileOf(`uploads/${name}`, fs.readFileSync(path.join(UPLOADS_DIR, name))));
      uploadCount++;
    }
  } catch { /* pas encore d'envois */ }

  const manifest: BackupManifest = {
    format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: now.toISOString(), frameworkVersion: readVersion(), schemaVersion: await currentSchemaVersion(),
    site: { name: config.name, defaultLocale: config.defaultLocale, locales: config.locales },
    counts: { users: users.length, instances: instances.length, entries: entries.length, translations: entryTranslations.length, records: records.length, redirects: redirects.length, modules: modules.length, uploads: uploadCount },
    modules,
    files: files.map((f) => ({ path: f.path, sha256: sha256(f.content), bytes: f.content.length })),
  };
  const archive: TarFile[] = [
    fileOf("README.txt", readmeText({ siteName: config.name, createdAt: manifest.createdAt, frameworkVersion: manifest.frameworkVersion })),
    jsonFile("backup.json", manifest),
    ...files,
  ];
  const plain = createTarGz(archive, Math.floor(now.getTime() / 1000));
  return { buffer: encryptBackup(plain, password, opts.iterations), filename: backupFilename(config.name, now), manifest, plain };
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}
