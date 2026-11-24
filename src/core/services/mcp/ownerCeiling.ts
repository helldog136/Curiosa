/**
 * THE CEILING OF A PERSONAL AI (core 0.46.0). Pure logic, no dependency (its only import is the pure list of core tools, coreTools.ts): it decides, on every request, whether an AI that BELONGS to a user may see and call a tool.
 *
 *   a personal AI can do a tool only if the OWNER may do what the tool does, RIGHT NOW  (and the ordinary rules of the access still hold: scope and grants)
 *
 * Every tool says what it needs from its owner (`requires`):
 *   - a core tool: the table `CORE_REQUIREMENTS` below (derived from the list in coreTools.ts; a catalogue test fails when a core tool is missing from it);
 *   - a content tool of an instance: declared where the tool is built (content/mcp.ts);
 *   - a module tool: the optional manifest key `mcp[].right`, a LOCAL right id of that module (validated by `actionRight`, so a module cannot name another module's right).
 * A tool with NO requirement is HIDDEN from personal AIs (fail closed): a module that has not declared `right` yet is invisible to them, never open to them.
 * Independent accesses (no owner) never come through here: their behaviour is exactly the one of access.ts.
 */
import { CORE_TOOL_ROWS, EDIT, PUBLISH, requirementOfAction } from "./coreTools";

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

/**
 * The requirement of every CORE tool (not bound to a module instance), by name: derived from the one list of core tools (coreTools.ts), where each row also says its
 * profile and its level 3 action. A test fails for a core tool missing from that list.
 */
export const CORE_REQUIREMENTS: Record<string, ToolRequirement> = Object.fromEntries(CORE_TOOL_ROWS.map((r) => [r.name, r.requires]));

/** The content tools of an instance (content/mcp.ts) declare their requirement where they are built; these are the two they use. */
export const CONTENT_EDIT: ToolRequirement = EDIT;
export const CONTENT_PUBLISH: ToolRequirement = PUBLISH;

/** The requirement of a LEVEL 3 request when it runs (re-checked at execution): the row of the tool that asked for it (coreTools.ts; `entry_*` is publishing). */
export { requirementOfAction };

/** What a tool needs, or `undefined` for a tool nobody classified (hidden from personal AIs). Only a tool that belongs to no instance and no module can use the core table. */
export function requirementOf(tool: { name: string; requires?: ToolRequirement; instanceId?: string; moduleId?: string }): ToolRequirement | undefined {
  if (tool.requires !== undefined) return tool.requires;
  if (tool.instanceId !== undefined || tool.moduleId !== undefined || tool.name.includes("__")) return undefined;
  return Object.hasOwn(CORE_REQUIREMENTS, tool.name) ? CORE_REQUIREMENTS[tool.name] : undefined;
}

/**
 * COARSE FALLBACK (0.47.0), for an access that existed before every access had to belong to a person (`ApiToken.coarseCeiling`).
 * A module tool that declares no `right` was callable by such an access before, so hiding it would be an outage. Its requirement becomes the admin tier: the level of the people who
 * could create those accesses (holders of `core:mcp.tokens`). An owner who is an administrator or above keeps every such tool; an editor does not. Tools with a declared
 * requirement and every core tool keep their documented requirement. A NEW access never gets the fallback: an undeclared tool stays hidden from it (fail closed).
 */
export const COARSE_FALLBACK: ToolRequirement = { tier: "admin" };

/** The ceiling: may an AI whose owner is in this state see and call this tool? (the other rules of the access are checked by `canUse`) `coarse`: the fallback above applies to undeclared tools. */
export function ownerCeilingAllows(tool: { name: string; requires?: ToolRequirement; instanceId?: string; moduleId?: string }, owner: OwnerState, opts: { coarse?: boolean } = {}): boolean {
  const req = requirementOf(tool) ?? (opts.coarse ? COARSE_FALLBACK : undefined);
  return owner.active && requirementMet(req, owner);
}

/** The requirement a module declares with `mcp[].right`: a local id (or `<module>:<id>` of THIS module) turned into a full right; anything else gives `undefined` (the tool stays hidden). */
export function declaredRequirement(moduleId: string, right: unknown, toRight: (moduleId: string, right: unknown) => string | null): ToolRequirement | undefined {
  if (right === undefined) return undefined;
  const full = toRight(moduleId, right);
  // An invalid declaration is NOT "no requirement": it is a requirement nobody meets.
  return full ? { right: full } : { right: "" };
}
