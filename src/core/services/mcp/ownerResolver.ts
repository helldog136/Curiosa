import { INERT_STATE, type OwnerState } from "./ownerCeiling";

/**
 * How the MCP mechanism learns who owns a personal AI and what that person can do NOW. The mechanism knows nothing of users, roles or modules (architecture test):
 * the composition (src/core/platform.ts) registers the resolver, exactly like it registers the tool providers. Stored on `globalThis` so that every bundle of the
 * server shares one. NO resolver registered, or one that fails: the AI is inert (fail closed), never treated as independent.
 */
export type OwnerResolver = (ownerId: string) => Promise<OwnerState>;
const g = globalThis as unknown as { curiosaOwnerResolver?: OwnerResolver };

export function registerOwnerResolver(resolver: OwnerResolver): void { g.curiosaOwnerResolver = resolver; }

export async function resolveOwner(ownerId: string): Promise<OwnerState> {
  const resolver = g.curiosaOwnerResolver;
  if (!resolver) return INERT_STATE(ownerId, "unavailable");
  try { return await resolver(ownerId); } catch { return INERT_STATE(ownerId, "unavailable"); }
}
