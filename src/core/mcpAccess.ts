import { audit } from "@/core/permissions";
import { createToken, findTokenId, type TokenScope } from "@/core/services/mcp/tokens";
import { applyProfile, type AccessProfile, type ProfileTool } from "@/core/services/mcp/profiles";
import type { Grants, ToolAccessInfo } from "@/core/services/mcp/access";

/**
 * The one way an AI access is created (used by the team page form and by the setup step). The clear text of the access code exists only in the
 * return value; the journal gets the access NAME and the profile, never the code or the secret address.
 */
export async function createAccess(input: {
  name: string; scope: TokenScope; actorEmail: string; byUrl?: boolean; grants?: Grants; /** Extra note after the name in the journal line (a profile name…). */ note?: string;
}): Promise<{ token: string; id: string | null }> {
  const token = await createToken(input.name, input.scope, input.actorEmail, { byUrl: !!input.byUrl, ...(input.grants ? { grants: input.grants } : {}) });
  await audit(input.actorEmail, "mcp.token.create", input.note ? `${input.name} (${input.note})` : input.name);
  if (input.byUrl) await audit(input.actorEmail, "mcp.token.url.on", input.name);
  return { token, id: await findTokenId(token) };
}

/** An access that starts from a profile: "read" is capped at reading (a second lock); the others can write, within the grants the profile gives. */
export async function createProfileAccess(input: { name: string; profile: AccessProfile; actorEmail: string; catalogue: (ProfileTool & ToolAccessInfo)[] }) {
  const scope: TokenScope = input.profile === "read" ? "read" : "write";
  const { grants } = applyProfile(input.profile, input.catalogue, {}, scope);
  return createAccess({ name: input.name, scope, actorEmail: input.actorEmail, grants, note: `profile ${input.profile}` });
}
