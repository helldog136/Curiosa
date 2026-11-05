export const UPGRADE_FILE: string;
export function compareVersions(a: string, b: string): number;
export function assetUrl(repo: string, tag: string, name: string): string;
export function planUpdate(o: { current: string; target: string; repo: string; fetchText: (url: string) => Promise<string | null> }): Promise<string[]>;
export function fetchTextHttps(url: string): Promise<string | null>;
export function readFloor(appDir: string): string | null;
export function resolveSqlitePath(databaseUrl: string | undefined, appDir: string): string | null;
export function backupDatabase(o: { dbFile: string | null; dataDir: string; label: string; now?: () => number; keep?: number; beforeCopy?: () => void; log?: (line: string) => void }): string | null;
export function restoreBackup(dbBackup: string, dbFile: string): void;
export function applyMigrations(run: (cmd: string, args: string[]) => Promise<unknown>, o?: { prismaBin?: string }): Promise<unknown>;
export function readDataVersion(dataDir: string): string | null;
export function writeDataVersion(dataDir: string, version: string, now?: () => number): boolean;
export type DataVersionCheck =
  | { ok: true; marker: string | null; unknown: boolean }
  | { ok: false; code: "below-floor" | "newer-than-image"; marker: string; floor: string | null; message: string };
export function checkDataVersion(o: { dataDir: string; version: string; floor: string | null; hasData?: boolean }): DataVersionCheck;
export function makeLog(dataDir: string, now?: () => number, echo?: (line: string) => void): (line: string) => void;
export type StartupResult =
  | { ok: true; backup: string | null; marker: string | null }
  | { ok: false; error: "below-floor" | "newer-than-image" | "backup-failed" | "migrate-failed"; message: string; backup?: string | null; restored?: boolean };
export function runStartup(o: { appDir: string; dataDir: string; version: string; databaseUrl?: string; exec: (cmd: string, args: string[], opts?: object) => Promise<{ stdout?: string }>; prismaBin?: string; now?: () => number; log?: (line: string) => void }): Promise<StartupResult>;
