"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { listMcpToolCatalogue } from "@/core/platform";
import { DEFAULT_PROFILE, isAccessProfile, type AccessProfile } from "@/core/services/mcp/profiles";
import { createProfileAccess } from "@/core/mcpAccess";
import { ASSISTANTS_HREF, TEAM_HREF } from "@/core/services/mcp/assistantsLinks";
import type { FieldErrorMap } from "@/core/fieldErrors";

/** The clear text of the access code exists only in this result, sent to the page that asked. It is never stored, logged or sent anywhere else. */
export type AssistantStepState = { error?: string; errors?: FieldErrorMap; created?: { id: string | null; name: string; token: string; profile: AccessProfile } } | null;

export async function createSetupAccessAction(_prev: AssistantStepState, formData: FormData): Promise<AssistantStepState> {
  const { user, t } = await adminCtx({ right: "core:mcp.tokens" });
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const raw = formData.get("profile");
  const profile = isAccessProfile(raw) ? raw : DEFAULT_PROFILE;
  if (!name) return { errors: { name: t("setup.ai.error.name") } };
  try {
    const { token, id } = await createProfileAccess({ name, profile, actorEmail: user.email, catalogue: await listMcpToolCatalogue() });
    revalidatePath(ASSISTANTS_HREF);
    revalidatePath(TEAM_HREF);
    return { created: { id, name, token, profile } };
  } catch {
    return { error: t("setup.ai.error.generic") };
  }
}
