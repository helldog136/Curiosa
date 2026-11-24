import { revokeToken } from "@/core/services/mcp/tokens";
import { expirePendingOfToken } from "@/core/maintenance/requests";

/**
 * THE way to remove an AI access (core 0.47.0): revokes it and expires ITS pending requests, so that a removed access never has a request that can still run.
 * A core service cannot import the maintenance queue, so the two steps live here, and a test fails if any other file calls `revokeToken` (screens, removal of a user, the person's own page).
 */
export async function revokeAccess(tokenId: string): Promise<void> {
  // Requests first: if a step fails, the access is still live (or already revoked with nothing pending), never revoked with requests that can still run, and a retry finishes the job.
  await expirePendingOfToken(tokenId);
  await revokeToken(tokenId);
  await expirePendingOfToken(tokenId); // a request created between the two steps
}
