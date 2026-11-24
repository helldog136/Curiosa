import { McpToolError } from "@/core/services/mcp/validate";

/* Sentences shared by the maintenance actions (the level 2 ones in actions.ts and the level 3 ones of coreUpdates.ts). */

export const REASONS: Record<string, string> = {
  "modules.error.notfound": "unknown module", "modules.error.requiredBy": "other modules need it", "modules.error.core": "it needs a newer core version",
  "modules.error.catalogue": "the module catalogue is unreachable", "modules.error.clone": "the module source could not be downloaded", "modules.error.uptodate": "already up to date",
  "modules.error.pinned": "it is pinned to a fixed commit", "modules.error.reinstallBusy": "an update or reinstall is already running", "modules.error.reinstallNoSource": "it was installed by hand: there is no source to reinstall from",
  "modules.error.reinstallPerms": "the new version asks for new permissions: only a human can accept that", "modules.error.migration": "its data conversion failed", "modules.error.requires": "it lacks a module it needs",
  "modules.error.nomanifest": "the new version has no valid description file", "modules.error.size": "the new version is too large", "modules.error.unknownSource": "its source is unknown", "modules.error.incompatible": "it is not compatible with this version",
  "modules.error.noSpace": "not enough disk space for a safety copy of the database (nothing was updated)", "modules.error.copyFailed": "the safety copy of the database failed (nothing was updated)",
  "modules.error.exists": "it is already installed", "modules.error.nomain": "its main file is missing", "modules.error.idmismatch": "the repository serves another module than announced",
  "modules.error.loadCheck": "the new code does not load on this site, so it was refused before being put in place (the previous version stays in service and nothing changed; maintenance_diagnose gives the reason)",
  "error.generic": "the action failed",
};
export const reason = (code: string | undefined) => (code && REASONS[code]) || (code && /^[\w.-]{1,60}$/.test(code) ? `failed (${code})` : "the action failed");

export const moduleId = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) throw new McpToolError('argument "module" must be a module identifier (see maintenance_modules)');
  return v;
};
