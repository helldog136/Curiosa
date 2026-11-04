import { setGrant, withinCeiling, type Grants, type Scope, type ToolAccessInfo } from "./access";

export type GrantRejection = { name: string; reason: "unknown" | "ceiling" };

/**
 * Applies several on/off changes at once with the SAME rules as one single change (setGrantAction): an unknown tool is refused, and a tool that writes is
 * never granted to a read-only access (the ceiling). Nothing fails silently: every refused change is returned with its reason.
 */
export function applyGrantChanges(grants: Grants, scope: Scope, catalogue: ToolAccessInfo[], changes: Record<string, boolean>): { grants: Grants; applied: string[]; rejected: GrantRejection[] } {
  let next = grants;
  const applied: string[] = [];
  const rejected: GrantRejection[] = [];
  for (const [name, enabled] of Object.entries(changes)) {
    const tool = catalogue.find((t) => t.name === name);
    if (!tool || typeof enabled !== "boolean") { rejected.push({ name, reason: "unknown" }); continue; }
    if (enabled && !withinCeiling(tool, scope)) { rejected.push({ name, reason: "ceiling" }); continue; }
    next = setGrant(next, tool, enabled);
    applied.push(name);
  }
  return { grants: next, applied, rejected };
}
