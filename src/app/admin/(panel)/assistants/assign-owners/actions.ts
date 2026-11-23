"use server";

// TEMPORARY (SUNSET 0.49.0): deleted with the folder assign-owners/.
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { assignAllWithoutOwner } from "@/core/personalAi/owners";
import { ASSISTANTS_HREF, TEAM_HREF } from "@/core/services/mcp/assistantsLinks";

/** One person for every access that has no owner. Only `core:mcp.tokens`; the person must be allowed to own an access (checked in the service). */
export async function assignAllAction(ownerId: string): Promise<{ ok: boolean; changed: number }> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const r = await assignAllWithoutOwner(String(ownerId), user.email, user.id);
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
  return { ok: r.ok, changed: r.changed };
}
