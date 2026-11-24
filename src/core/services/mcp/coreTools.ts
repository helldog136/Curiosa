/**
 * THE RIGHTS OF EVERY CORE TOOL, in ONE list (pure data, no dependency: it is read by `ownerCeiling.ts` and `profiles.ts`, which stay pure).
 *
 * A core tool is a tool that belongs to no module instance (`maintenance_*`, `navigation_*`, `redirects_*`...). For each one this list says, once:
 *  - `requires`: what a PERSONAL AI needs from the person who owns it (ownerCeiling.ts derives `CORE_REQUIREMENTS` from it). It mirrors the gate of the admin page that
 *    does the same thing: the editor tier for content, short links and images; the admin tier for the site's look, menu, home page, settings and what is installed;
 *    the reserved rights (`core:updates`, `core:backup`, `core:modules.install`) for upkeep, which an administrator does not hold;
 *  - `profile`: the starting profile that first allows it, or `excluded` with the reason (profiles.ts derives `PROFILE_TOOLS` and `PROFILE_EXCLUDED` from it; the order of
 *    the rows is the order of the profile lists);
 *  - `level3`: the level 3 action (a request the owner approves, see maintenance/level3.ts) that the tool asks for, if it is one.
 *
 * Adding a core tool: one row here (a catalogue test fails for a tool that has none). Adding a level 3 action: one row here, then its definition (maintenance/level3Registry.ts
 * does not compile until it exists, and a test compares the two).
 * Never in a profile: anything that reads or writes a secret (no such tool exists), deletions, uninstalling, updating the core.
 */
import type { ToolRequirement } from "./ownerCeiling";

export type AccessProfileName = "read" | "assistant" | "full";
type Placement = { profile: AccessProfileName; excluded?: never } | { excluded: string; profile?: never };

export type CoreToolRight = { name: string; requires: ToolRequirement; level3?: string } & Placement;
/** A level 3 action whose tool is not a core tool (the tool of a content instance, built by the content engine). */
export type ActionRight = { level3: string; requires: ToolRequirement };

/** Keeps the literal types of the row (the names of the level 3 actions are read from them). */
export const defineCoreTool = <const R extends CoreToolRight>(row: R): R => row;
export const defineAction = <const R extends ActionRight>(row: R): R => row;

export const EDIT = { right: "core:entries.edit" } as const;
export const PUBLISH = { right: "core:entries.publish" } as const;
const EDITOR = { tier: "editor" } as const;
const ADMIN = { tier: "admin" } as const;
const UPDATES = { right: "core:updates" } as const;
const BACKUP = { right: "core:backup" } as const;
const INSTALL = { right: "core:modules.install" } as const;
/** `none`: nothing (the tool only describes the AI itself). */
const NONE = { none: true } as const;

export const CORE_TOOLS = [
  // ── "read": the AI looks and advises
  defineCoreTool({ name: "site_info", requires: NONE, profile: "read" }),
  defineCoreTool({ name: "maintenance_status", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_health", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_modules", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_updates", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_diagnose", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_audit", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_request_status", requires: NONE, profile: "read" }),
  defineCoreTool({ name: "maintenance_legacy", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_catalog_list", requires: INSTALL, profile: "read" }),
  defineCoreTool({ name: "maintenance_catalog_get", requires: INSTALL, profile: "read" }),
  defineCoreTool({ name: "maintenance_skin_status", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_skin_list", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_content_check", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "maintenance_my_access", requires: NONE, profile: "read" }),
  defineCoreTool({ name: "maintenance_available_operations", requires: NONE, profile: "read" }),
  defineCoreTool({ name: "maintenance_catalog_plan", requires: INSTALL, profile: "read" }),
  defineCoreTool({ name: "maintenance_places", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "navigation_get", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "home_sections_list", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "redirects_list", requires: EDITOR, profile: "read" }),
  defineCoreTool({ name: "redirects_stats", requires: EDITOR, profile: "read" }),
  defineCoreTool({ name: "redirects_summary", requires: EDITOR, profile: "read" }),
  defineCoreTool({ name: "media_list", requires: EDITOR, profile: "read" }),
  defineCoreTool({ name: "site_settings_get", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "overlay_skins_list", requires: ADMIN, profile: "read" }),
  defineCoreTool({ name: "overlay_skin_rules_list", requires: ADMIN, profile: "read" }),

  // ── "assistant": + drafts and adjusting installed modules (safe, reversible actions), images, site identity, menu and home page
  defineCoreTool({ name: "maintenance_check_updates", requires: UPDATES, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_backup_run", requires: BACKUP, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_module_reinstall", requires: INSTALL, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_module_restart", requires: INSTALL, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_content_check_run", requires: ADMIN, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_module_settings", requires: ADMIN, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_place_settings", requires: ADMIN, profile: "assistant" }),
  defineCoreTool({ name: "maintenance_module_configure", requires: ADMIN, profile: "assistant" }),
  defineCoreTool({ name: "navigation_set", requires: ADMIN, profile: "assistant", level3: "navigation_set" }),
  defineCoreTool({ name: "home_sections_set", requires: ADMIN, profile: "assistant", level3: "home_sections_set" }),
  defineCoreTool({ name: "redirects_create", requires: EDITOR, profile: "assistant" }),
  defineCoreTool({ name: "redirects_update", requires: EDITOR, profile: "assistant" }),
  defineCoreTool({ name: "media_upload", requires: EDITOR, profile: "assistant" }),
  defineCoreTool({ name: "media_set_alt", requires: EDITOR, profile: "assistant" }),
  defineCoreTool({ name: "site_settings_set", requires: ADMIN, profile: "assistant", level3: "site_settings_set" }),

  // ── "full": + asks to install modules and skins, add instances, change colours, fonts and skin (requests the owner approves)
  defineCoreTool({ name: "overlay_skin_rules_create", requires: ADMIN, profile: "full" }),
  defineCoreTool({ name: "overlay_skin_rules_update", requires: ADMIN, profile: "full" }),
  defineCoreTool({ name: "media_import", requires: EDITOR, profile: "full" }),
  defineCoreTool({ name: "maintenance_module_install", requires: INSTALL, profile: "full", level3: "module_install" }),
  defineCoreTool({ name: "maintenance_instance_add", requires: INSTALL, profile: "full", level3: "instance_add" }),
  defineCoreTool({ name: "maintenance_skin_install", requires: INSTALL, profile: "full", level3: "skin_install" }),
  defineCoreTool({ name: "maintenance_skin_activate", requires: INSTALL, profile: "full", level3: "skin_activate" }),
  defineCoreTool({ name: "maintenance_font_set", requires: ADMIN, profile: "full", level3: "font_set" }),
  defineCoreTool({ name: "maintenance_skin_set_options", requires: ADMIN, profile: "full", level3: "skin_set_options" }),
  defineCoreTool({ name: "maintenance_skin_customize", requires: ADMIN, profile: "full", level3: "skin_customize" }),

  // ── in no profile: one-by-one choices (the risky ones behind a confirmation), each with the reason
  defineCoreTool({ name: "log_list", requires: ADMIN, excluded: "The site journal can show names and addresses of people: granted knowingly." }),
  defineCoreTool({ name: "maintenance_module_configure_advanced", requires: ADMIN, excluded: "Technical settings: only for an AI the owner trusts with them." }),
  defineCoreTool({ name: "maintenance_skin_remove", requires: INSTALL, excluded: "Removes files: a deliberate choice.", level3: "skin_remove" }),
  defineCoreTool({ name: "maintenance_module_update", requires: UPDATES, excluded: "Updating is upkeep, not setup.", level3: "module_update" }),
  defineCoreTool({ name: "maintenance_modules_update_all", requires: UPDATES, excluded: "Updating is upkeep, not setup.", level3: "modules_update_all" }),
  defineCoreTool({ name: "maintenance_core_update", requires: UPDATES, excluded: "Updating the core is upkeep, not setup.", level3: "core_update" }),
  defineCoreTool({ name: "maintenance_module_uninstall", requires: INSTALL, excluded: "Uninstalling can lose data.", level3: "module_uninstall" }),
  defineCoreTool({ name: "redirects_delete", requires: EDITOR, excluded: "Deletes short links." }),
] as const;

/** Level 3 actions whose tool is built per content instance (`<instance>__publish`, `<instance>__unpublish`, content/mcp.ts): publishing is a right of its own. */
export const CONTENT_ACTIONS = [
  defineAction({ level3: "entry_publish", requires: PUBLISH }),
  defineAction({ level3: "entry_unpublish", requires: PUBLISH }),
] as const;

/** The same rows, with the general type (for the code that reads them all). */
export const CORE_TOOL_ROWS: readonly CoreToolRight[] = CORE_TOOLS;

type CoreRow = (typeof CORE_TOOLS)[number];
/** The names of the level 3 actions: the only list. */
export type Level3Action = Extract<CoreRow, { level3: string }>["level3"] | (typeof CONTENT_ACTIONS)[number]["level3"];
export const LEVEL3_ACTIONS: readonly Level3Action[] = [...CORE_TOOLS.flatMap((r) => ("level3" in r ? [r.level3 as Level3Action] : [])), ...CONTENT_ACTIONS.map((r) => r.level3)];

/** The tool that asks for a level 3 action (its name), when it is a core tool. */
export const toolOfAction = (action: string): string | undefined => CORE_TOOL_ROWS.find((r) => r.level3 === action)?.name;

/** What an action needs from the owner of the AI when it runs (re-checked at execution): the same row as the tool that asked for it. */
export function requirementOfAction(action: string): ToolRequirement | undefined {
  const row: { requires: ToolRequirement } | undefined = CORE_TOOL_ROWS.find((r) => r.level3 === action) ?? CONTENT_ACTIONS.find((r) => r.level3 === action);
  return row?.requires;
}
