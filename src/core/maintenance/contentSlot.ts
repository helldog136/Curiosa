import { McpToolError } from "@/core/services/mcp/validate";
import { deps } from "./deps";

/**
 * Rate limit of the "content" class of actions (menu and home page changes made by an AI). It is NOT the 12-per-hour counter of the risky actions
 * (updates, installs, uninstalls): editing the structure of a site while building it takes many more calls.
 *
 * THIS FILE IS THE ONE PLACE TO SWITCH when the shared limiter (`slots.ts` of the branch feat/mcp-media-and-site-settings: `takeSlot(tokenId, "content")`,
 * `remainingSlots`, `resetSlots`) is in origin/dev: make `takeContentSlot` call `takeSlot(tokenId, "content")` (it is async there), delete the local map and
 * `resetContentSlots`, and use `resetAllSlots` in the tests. Until then the content class has its own small counter here, so that it never uses up
 * (and is never blocked by) the risky counter. Same default: 120 per hour per access.
 */
export const MAX_CONTENT_ACTIONS_PER_HOUR = 120;

const g = globalThis as unknown as { curiosaContentHits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.curiosaContentHits ??= new Map<string, number[]>());

/** Tests: empties the counter. */
export function resetContentSlots(): void { hits.clear(); }

export function takeContentSlot(tokenId: string | undefined): void {
  const key = tokenId ?? "unknown";
  const now = deps.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_CONTENT_ACTIONS_PER_HOUR) { hits.set(key, recent); throw new McpToolError(`Too many menu or home page changes from this token in the last hour (limit ${MAX_CONTENT_ACTIONS_PER_HOUR}). Wait before trying again.`); }
  recent.push(now);
  hits.set(key, recent);
}
