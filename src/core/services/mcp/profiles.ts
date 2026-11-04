/**
 * Starting profiles for an AI access: ONE definition, used by the setup step ("Connect your AI assistant") and by the rights page
 * (Admin > AI assistants > an assistant). A profile is a preset of the same per-tool rights the rights page edits; it adds nothing the page cannot show.
 *
 *   read       the AI looks and advises (reads only)
 *   assistant  + prepares drafts and adjusts installed modules (safe, reversible actions)
 *   full       + asks to install modules (one or several at once) and skins, add instances, change colours, fonts and skin, and publishes drafts (`<instance>__publish`,
 *              `__unpublish`): requests the owner approves, or done at once when the owner chose "act without asking" for that access (installs and new instances
 *              always wait for the owner)
 *
 * Each profile includes the ones before it. A tool is either assigned to the profile that first allows it, or explicitly EXCLUDED (never part of a preset:
 * the owner ticks it one by one). A test compares this file with the real tool catalogue: a new core tool must be assigned or excluded here.
 * Never in a profile: anything that reads or writes a secret (no such tool exists), deletions, uninstalling, updating the core.
 */
import { setGrant, withinCeiling, type Grants, type Scope, type ToolAccessInfo } from "./access";

export const ACCESS_PROFILES = ["read", "assistant", "full"] as const;
export type AccessProfile = (typeof ACCESS_PROFILES)[number];
/** The safest one: the default everywhere. */
export const DEFAULT_PROFILE: AccessProfile = "read";

export const isAccessProfile = (v: unknown): v is AccessProfile => ACCESS_PROFILES.includes(v as AccessProfile);

/** Core tools (not bound to a module instance), by the profile that first allows them. */
export const PROFILE_TOOLS: Record<AccessProfile, readonly string[]> = {
  read: [
    "site_info",
    "maintenance_status", "maintenance_health", "maintenance_modules", "maintenance_updates", "maintenance_diagnose", "maintenance_audit",
    "maintenance_request_status", "maintenance_legacy", "maintenance_catalog_list", "maintenance_catalog_get", "maintenance_skin_status",
    "maintenance_skin_list", "maintenance_content_check", "maintenance_my_access", "maintenance_catalog_plan",
    "redirects_list", "redirects_stats", "redirects_summary",
    "media_list", "site_settings_get",
  ],
  assistant: [
    "maintenance_check_updates", "maintenance_backup_run", "maintenance_module_reinstall", "maintenance_module_restart", "maintenance_content_check_run",
    "maintenance_module_settings", "maintenance_module_configure",
    "redirects_create", "redirects_update",
    "media_upload", "media_set_alt", "site_settings_set",
  ],
  full: ["maintenance_module_install", "maintenance_instance_add", "maintenance_skin_install", "maintenance_skin_activate", "maintenance_font_set", "maintenance_skin_set_options"],
};

/** Core tools that no profile allows, each with the reason. They stay one-by-one choices (the risky ones behind a confirmation). */
export const PROFILE_EXCLUDED: Record<string, string> = {
  log_list: "The site journal can show names and addresses of people: granted knowingly.",
  maintenance_module_configure_advanced: "Technical settings: only for an AI the owner trusts with them.",
  maintenance_skin_remove: "Removes files: a deliberate choice.",
  maintenance_module_update: "Updating is upkeep, not setup.",
  maintenance_modules_update_all: "Updating is upkeep, not setup.",
  maintenance_core_update: "Updating the core is upkeep, not setup.",
  maintenance_module_uninstall: "Uninstalling can lose data.",
  redirects_delete: "Deletes short links.",
};

export type ProfileTool = Pick<ToolAccessInfo, "name" | "readOnly" | "default"> & { destructive: boolean; instanceId?: string };

/** `unassigned` only happens for a core tool nobody classified: the catalogue test fails on it. */
export type Placement = AccessProfile | "excluded" | "unassigned";

const RANK: Record<AccessProfile, number> = { read: 0, assistant: 1, full: 2 };

/**
 * Where a tool belongs. Core tools are listed above. Tools of a module instance are classified by what they declare: content reads and reads the module
 * grants by default are `read`; content drafts are `assistant`; everything else a module offers (other writes, destructive actions, sensitive reads) is excluded.
 */
export function placementOf(tool: ProfileTool): Placement {
  for (const p of ACCESS_PROFILES) if (PROFILE_TOOLS[p].includes(tool.name)) return p;
  if (tool.name in PROFILE_EXCLUDED) return "excluded";
  if (!tool.instanceId) return "unassigned";
  // Publishing a draft is a separate right of every content instance, part of the "full" preset (it follows the access's approval setting). Checked before `destructive`.
  if (/__(publish|unpublish)$/.test(tool.name) && !tool.destructive) return "full";
  if (tool.destructive) return "excluded";
  if (/__(create_draft|update_draft)$/.test(tool.name)) return "assistant";
  return tool.readOnly && tool.default ? "read" : "excluded";
}

/** Does this profile allow the tool? */
export function profileAllows(profile: AccessProfile, tool: ProfileTool): boolean {
  const p = placementOf(tool);
  return (p === "read" || p === "assistant" || p === "full") && RANK[p] <= RANK[profile];
}

/**
 * The grants a profile gives: for every tool the access can hold, "on" if the profile allows it, else "off" (a plain preset, the rest of `base` is kept).
 * Tools above the access ceiling are never granted; they are returned in `blocked` so the page can say why.
 */
export function applyProfile(profile: AccessProfile, tools: (ProfileTool & ToolAccessInfo)[], base: Grants, scope: Scope): { grants: Grants; blocked: string[] } {
  let grants = base;
  const blocked: string[] = [];
  for (const tool of tools) {
    const wanted = profileAllows(profile, tool);
    if (wanted && !withinCeiling(tool, scope)) { blocked.push(tool.name); continue; }
    grants = setGrant(grants, tool, wanted);
  }
  return { grants, blocked };
}

/** Which profile, if any, exactly matches this state (tool name -> on/off) over these tools. Ignores tools the ceiling blocks. */
export function matchingProfile(state: Record<string, boolean>, tools: ProfileTool[], scope: Scope): AccessProfile | null {
  return ACCESS_PROFILES.find((p) => tools.every((t) => (!withinCeiling(t, scope) && profileAllows(p, t) ? true : (state[t.name] ?? false) === profileAllows(p, t)))) ?? null;
}

