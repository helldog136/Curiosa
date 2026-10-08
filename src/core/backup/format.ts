import crypto from "node:crypto";
import type { TarFile } from "./tar";

/**
 * Contenu d'une sauvegarde (voir docs/BACKUP.md). Tout est du TEXTE lisible, sauf les images envoyées :
 *
 *   README.txt                  comment relire cette sauvegarde sans le framework
 *   backup.json                 inventaire : version, date, modules, empreintes SHA-256 de tous les autres fichiers
 *   data/*.json                 les données brutes (c'est ce que la restauration relit)
 *   readable/…                  les mêmes données, mises en forme pour un humain (Markdown, JSON, CSV…)
 *   uploads/…                   les images et fichiers envoyés
 */
export const FORMAT = "curiosa-backup";
/** Ancien nom du format (le projet s'est appelé autrement avant sa première release) : toujours accepté à la lecture. */
export const LEGACY_FORMATS: readonly string[] = ["vitrine-backup"];
export const FORMAT_VERSION = 1;

export const DATA_FILES = {
  users: "data/users.json",
  settings: "data/settings.json",
  modules: "data/modules.json",
  instances: "data/instances.json",
  instanceTranslations: "data/instance-translations.json",
  entries: "data/entries.json",
  entryTranslations: "data/entry-translations.json",
  redirects: "data/redirects.json",
  records: "data/module-records.json",
} as const;

export type BackupModule = {
  id: string;
  source: "builtin" | "bundled" | "git";
  version: string;
  enabled: boolean;
  repoUrl: string | null;
  ref: string | null;
  /** Dossier du module dans le dépôt (dépôt regroupant plusieurs modules). */
  subdir?: string | null;
  commit: string | null;
  /** « catalogue » : livré ou dépôt reconnu — « custom » : dépôt personnel non vérifié — « builtin » : sauvegardes d'avant la 0.1.3, quand le cœur « intégrait » des modules (lecture seule). */
  origin: "builtin" | "catalogue" | "custom";
  name: string;
};

export type BackupManifest = {
  format: typeof FORMAT;
  formatVersion: number;
  createdAt: string;
  frameworkVersion: string;
  /** Dernière migration de base appliquée au moment de la sauvegarde (voir schema.ts). */
  schemaVersion?: string;
  site: { name: string; defaultLocale: string; locales: string[] };
  counts: Record<string, number>;
  modules: BackupModule[];
  /** Empreinte de chaque fichier (sauf README.txt et backup.json) : une sauvegarde altérée ou tronquée est détectée. */
  files: { path: string; sha256: string; bytes: number }[];
};

export const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export const fileOf = (path: string, text: string | Buffer): TarFile => ({ path, content: Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8") });

export function jsonFile(path: string, value: unknown): TarFile {
  return fileOf(path, JSON.stringify(value, null, 2) + "\n");
}

/** Nom de fichier de sauvegarde : jamais de caractère dangereux, même si le nom du site en contient. */
export function backupFilename(siteName: string, at: Date): string {
  const slug = siteName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  return `backup-${slug}-${at.toISOString().slice(0, 10)}.tar.gz.enc`;
}
