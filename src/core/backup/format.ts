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
  /** Données gardées d'instances retirées (voir modules/retired.ts). Absent des sauvegardes d'avant la 0.1.20 : lu comme « aucune ». */
  retired: "data/retired-instances.json",
  /** Rôles et affectations (0.2.0). Absents d'une sauvegarde plus ancienne : la restauration recrée les rôles prédéfinis et l'affectation depuis `User.role`. */
  roles: "data/roles.json",
  userRoles: "data/user-roles.json",
  /** Propriétaire des fichiers revendiqués par des modules (0.2.13, voir services/files.ts). Absent d'une sauvegarde plus ancienne : aucun fichier n'a de propriétaire (ils restent au cœur). */
  uploadFiles: "data/upload-files.json",
} as const;

export type BackupModule = {
  id: string;
  // « builtin » et « bundled » : sauvegardes et lignes d'anciens sites (compatibilité, à retirer en phase 3 d'entretien) ; le cœur n'embarque plus aucun module.
  source: "builtin" | "bundled" | "git";
  version: string;
  /** Toujours true à l'écriture (plus d'état « éteint » depuis la 0.1.20) ; lu pour les sauvegardes plus anciennes, dont les modules éteints sont désinstallés en gardant leurs données. */
  enabled: boolean;
  repoUrl: string | null;
  ref: string | null;
  /** Dossier du module dans le dépôt (dépôt regroupant plusieurs modules). */
  subdir?: string | null;
  commit: string | null;
  /** « catalogue » : dépôt reconnu — « custom » : dépôt personnel non vérifié — « builtin » : sauvegardes d'avant la 0.1.3, quand le cœur « intégrait » des modules (lecture seule). */
  origin: "builtin" | "catalogue" | "custom";
  name: string;
};

/** Un skin installé au moment de la sauvegarde (facultatif dans `backup.json` : absent des sauvegardes d'avant les skins). Les fichiers ne sont pas sauvegardés : ils sont réinstallés depuis le dépôt. */
export type { BackupSkin } from "@/core/skins/restore";

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
  /** Skins installés (dépôt, étiquette, commit) : réinstallés à la restauration, comme les modules. Absent des sauvegardes d'avant les skins. */
  skins?: import("@/core/skins/restore").BackupSkin[];
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
