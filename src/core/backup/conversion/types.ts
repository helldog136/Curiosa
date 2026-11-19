/**
 * Shared types of the backup conversion (docs/BACKUP.md, "Old backups").
 *
 * A conversion is a PURE function of the data read from a backup (no database, no network): the restore runs them on its own copy of the data, and the
 * result says what it did in `ReportItem`s. The report tells the owner, in plain words, what was converted, what was set aside and what failed, with the
 * exact place to look by hand inside the unpacked archive (`path`).
 */
export type Row = Record<string, unknown>;

export type BackupData = {
  users: Row[]; settings: Row[]; modules: Row[]; instances: Row[]; instanceTranslations: Row[]; entries: Row[]; entryTranslations: Row[]; redirects: Row[]; records: Row[];
  retired?: Row[]; roles?: Row[]; userRoles?: Row[]; uploadFiles?: Row[]; overlayPages?: Row[];
};

/** `note` is a key under `backup.report.` in the language files; `params` fill its `{}`. `path` is a file or folder of the UNPACKED archive. */
export type ReportItem = {
  /** Stable identifier: `core.<conversion>`, `module.<id>`, `skin.<id>`, `files`, `check.<name>`. */
  id: string;
  note: string;
  params?: Record<string, string | number>;
  path?: string;
};

export type ConversionReport = { converted: ReportItem[]; setAside: ReportItem[]; failed: ReportItem[] };
export const emptyReport = (): ConversionReport => ({ converted: [], setAside: [], failed: [] });

/** What a core conversion did to the data it was given. */
export type ConversionResult = { converted?: ReportItem[]; setAside?: ReportItem[] };
