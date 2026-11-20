/**
 * THE CEILING OF A PERSONAL AI (core 0.46.0). Pure logic, no dependency: it decides, on every request, whether an AI that BELONGS to a user may see and call a tool.
 *
 *   a personal AI can do a tool only if the OWNER may do what the tool does, RIGHT NOW  (and the ordinary rules of the access still hold: scope and grants)
 *
 * Every tool says what it needs from its owner (`requires`):
 *   - a core tool: the table `CORE_REQUIREMENTS` below (a catalogue test fails when a core tool is missing from it);
 *   - a content tool of an instance: declared where the tool is built (content/mcp.ts);
 *   - a module tool: the optional manifest key `mcp[].right`, a LOCAL right id of that module (validated by `actionRight`, so a module cannot name another module's right).
 * A tool with NO requirement is HIDDEN from personal AIs (fail closed): a module that has not declared `right` yet is invisible to them, never open to them.
 * Independent accesses (no owner) never come through here: their behaviour is exactly the one of access.ts.
 */
/** The levels of the team (the same as auth/rights.ts; copied here because the MCP mechanism imports nothing of the auth code). */
type Level = "owner" | "coordinator" | "admin" | "editor" | "none";

export type Tier = "editor" | "admin" | "owner";
/** What a tool needs from the person who owns the AI. `none`: nothing (the tool only describes the AI itself). Several keys: all must hold. */
export type ToolRequirement = { none?: true; right?: string; tier?: Tier };

/** Why a personal AI answers nothing (the reason is told to its owner and to the journal, never more than that). */
export type InertReason = "policy_off" | "not_allowed" | "paused" | "owner_missing" | "owner_locked" | "unavailable";

/**
 * The owner of a personal AI, as seen NOW (resolved on each request by the composition, see src/core/personalAi/owner.ts).
 * `active` false: the AI is inert, whatever its grants (`inert` says why). `tier`: the effective level (like `effectiveLevel` of the pages). `rights`: empty when the owner is locked.
 */
export type OwnerState = {
  ownerId: string;
  active: boolean;
  inert?: InertReason;
  tier: Level;
  rights: ReadonlySet<string>;
  /** A short fingerprint of what the owner can do now (tier + rights + policy): part of the access revision, so that a demotion makes `reconnectNeeded` true. */
  fingerprint: string;
};

/** The state used when nothing could be resolved: inert, no rights. */
export const INERT_STATE = (ownerId: string, inert: InertReason): OwnerState => ({ ownerId, active: false, inert, tier: "none", rights: new Set(), fingerprint: `inert:${inert}` });

const TIER_RANK: Record<Level, number> = { none: 0, editor: 1, admin: 2, coordinator: 3, owner: 4 };
const NEED_RANK: Record<Tier, number> = { editor: 1, admin: 2, owner: 4 };

/** Does the owner hold this right? The owner level holds every right (like `can`); everyone else needs it in their set. Never true for an inert state. */
export function ownerHolds(owner: OwnerState, right: string): boolean {
  if (!owner.active || typeof right !== "string" || right.length === 0) return false;
  return owner.tier === "owner" || owner.rights.has(right);
}

export function ownerHasTier(owner: OwnerState, tier: Tier): boolean {
  return owner.active && (TIER_RANK[owner.tier] ?? 0) >= NEED_RANK[tier];
}

/** The requirement is met by this owner? An empty requirement (`{}`) is NOT "no requirement": it never passes (fail closed). */
export function requirementMet(req: ToolRequirement | undefined, owner: OwnerState): boolean {
  if (!req || !owner.active) return false;
  // (0.46.1) `none` alone is open; combined with another key it does NOT open anything: all the keys present must hold.
  if (!req.right && !req.tier) return req.none === true;
  if (req.right && !ownerHolds(owner, req.right)) return false;
  if (req.tier && !ownerHasTier(owner, req.tier)) return false;
  return true;
}

const EDIT = { right: "core:entries.edit" } as const;
const PUBLISH = { right: "core:entries.publish" } as const;
const EDITOR = { tier: "editor" } as const;
const ADMIN = { tier: "admin" } as const;
const UPDATES = { right: "core:updates" } as const;
const BACKUP = { right: "core:backup" } as const;
const INSTALL = { right: "core:modules.install" } as const;
const NONE = { none: true } as const;

/**
 * The requirement of every CORE tool (not bound to a module instance), by name. It mirrors the gate of the admin page that does the same thing:
 * the editor tier for content, short links and images; the admin tier for the site's look, menu, home page, settings and what is installed; the reserved
 * rights (`core:updates`, `core:backup`, `core:modules.install`) for upkeep, which an administrator does not hold. A test fails for a core tool missing here.
 */
export const CORE_REQUIREMENTS: Record<string, ToolRequirement> = {
  // describe the AI itself
  site_info: NONE, maintenance_my_access: NONE, maintenance_request_status: NONE,
  // reads of the site's state: the admin tier
  maintenance_status: ADMIN, maintenance_health: ADMIN, maintenance_modules: ADMIN, maintenance_updates: ADMIN, maintenance_diagnose: ADMIN, maintenance_audit: ADMIN,
  maintenance_legacy: ADMIN, maintenance_skin_status: ADMIN, maintenance_skin_list: ADMIN, maintenance_places: ADMIN, maintenance_content_check: ADMIN, maintenance_content_check_run: ADMIN,
  log_list: ADMIN,
  // settings of installed modules and places
  maintenance_module_settings: ADMIN, maintenance_place_settings: ADMIN, maintenance_module_configure: ADMIN, maintenance_module_configure_advanced: ADMIN,
  // updates, backup, installation: the reserved rights
  maintenance_check_updates: UPDATES, maintenance_core_update: UPDATES, maintenance_module_update: UPDATES, maintenance_modules_update_all: UPDATES,
  maintenance_backup_run: BACKUP,
  maintenance_module_install: INSTALL, maintenance_module_uninstall: INSTALL, maintenance_module_reinstall: INSTALL, maintenance_module_restart: INSTALL, maintenance_instance_add: INSTALL,
  maintenance_skin_install: INSTALL, maintenance_skin_remove: INSTALL, maintenance_skin_activate: INSTALL,
  maintenance_catalog_list: INSTALL, maintenance_catalog_get: INSTALL, maintenance_catalog_plan: INSTALL,
  // appearance, menu, home page, site settings: the admin tier
  maintenance_font_set: ADMIN, maintenance_skin_set_options: ADMIN, maintenance_skin_customize: ADMIN,
  navigation_get: ADMIN, navigation_set: ADMIN, home_sections_list: ADMIN, home_sections_set: ADMIN, site_settings_get: ADMIN, site_settings_set: ADMIN,
  overlay_skins_list: ADMIN, overlay_skin_rules_list: ADMIN, overlay_skin_rules_create: ADMIN, overlay_skin_rules_update: ADMIN,
  // short links and images: the editor tier (like their admin pages)
  redirects_list: EDITOR, redirects_stats: EDITOR, redirects_summary: EDITOR, redirects_create: EDITOR, redirects_update: EDITOR, redirects_delete: EDITOR,
  media_list: EDITOR, media_upload: EDITOR, media_import: EDITOR, media_set_alt: EDITOR,
};

/** The content tools of an instance (content/mcp.ts) declare their requirement where they are built; these are the two they use. */
export const CONTENT_EDIT: ToolRequirement = EDIT;
export const CONTENT_PUBLISH: ToolRequirement = PUBLISH;

/** The requirement of a LEVEL 3 request when it runs (re-checked at execution): `entry_*` is publishing, the rest is the table (bare tools keep their name, the others are `maintenance_<action>`). */
export function requirementOfAction(action: string): ToolRequirement | undefined {
  if (action === "entry_publish" || action === "entry_unpublish") return PUBLISH;
  const bare = action === "navigation_set" || action === "home_sections_set" || action === "site_settings_set";
  return CORE_REQUIREMENTS[bare ? action : `maintenance_${action}`];
}

/** What a tool needs, or `undefined` for a tool nobody classified (hidden from personal AIs). Only a tool that belongs to no instance and no module can use the core table. */
export function requirementOf(tool: { name: string; requires?: ToolRequirement; instanceId?: string; moduleId?: string }): ToolRequirement | undefined {
  if (tool.requires !== undefined) return tool.requires;
  if (tool.instanceId !== undefined || tool.moduleId !== undefined || tool.name.includes("__")) return undefined;
  return Object.hasOwn(CORE_REQUIREMENTS, tool.name) ? CORE_REQUIREMENTS[tool.name] : undefined;
}

/** The ceiling: may a personal AI whose owner is in this state see and call this tool? (the other rules of the access are checked by `canUse`) */
export function ownerCeilingAllows(tool: { name: string; requires?: ToolRequirement; instanceId?: string; moduleId?: string }, owner: OwnerState): boolean {
  return owner.active && requirementMet(requirementOf(tool), owner);
}

/** The requirement a module declares with `mcp[].right`: a local id (or `<module>:<id>` of THIS module) turned into a full right; anything else gives `undefined` (the tool stays hidden). */
export function declaredRequirement(moduleId: string, right: unknown, toRight: (moduleId: string, right: unknown) => string | null): ToolRequirement | undefined {
  if (right === undefined) return undefined;
  const full = toRight(moduleId, right);
  // An invalid declaration is NOT "no requirement": it is a requirement nobody meets.
  return full ? { right: full } : { right: "" };
}
