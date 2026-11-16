"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";
import { LIFT_MINUTES, liftLimits, resetDailyQuota, stopLift } from "@/core/services/mcp/uploadLift";
import { siteTimezone, timeKey } from "@/core/siteTime";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Upload limits of the AI assistants (core 0.28.0, services/mcp/uploadLift.ts): OWNER only (owner's decision: not the technical coordination, which otherwise
 * holds core:mcp.tokens), never an assistant (no MCP tool reaches these settings). Kept in this file so that actions.ts stays on core:mcp.tokens.
 * Lift for 10, 30 or 60 minutes; stop at once; start the daily count over (nothing in the journal is deleted). Each action is journalled with the owner as actor.
 */
export async function liftUploadLimitsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const minutes = Number(formData.get("minutes"));
  if (!(LIFT_MINUTES as readonly number[]).includes(minutes)) return { errors: { minutes: t("uploadLimits.err.minutes") } };
  const until = await liftLimits(minutes);
  await audit(user.email, "mcp.limits.lift", `${minutes} min, until ${new Date(until).toISOString()}`);
  revalidatePath(ASSISTANTS_HREF);
  return { ok: t("uploadLimits.lifted", { time: timeKey(new Date(until), await siteTimezone()) }) };
}

export async function stopUploadLiftAction(): Promise<void> {
  const { user } = await adminCtx("owner");
  if (await stopLift()) await audit(user.email, "mcp.limits.lift.stop", "stopped by the owner");
  revalidatePath(ASSISTANTS_HREF);
}

export async function resetDailyQuotaAction(): Promise<void> {
  const { user } = await adminCtx("owner");
  const from = await resetDailyQuota();
  await audit(user.email, "mcp.media.quota.reset", `counted from ${new Date(from).toISOString()}`);
  revalidatePath(ASSISTANTS_HREF);
}
