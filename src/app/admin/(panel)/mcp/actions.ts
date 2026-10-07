"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { createToken, revokeToken, type TokenScope } from "@/core/services/mcp/tokens";
import { audit } from "@/core/permissions";
import { setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  const { user } = await adminCtx("owner");
  await setSetting("mcp.enabled", enabled);
  await audit(user.email, enabled ? "mcp.enable" : "mcp.disable");
  revalidatePath("/admin/mcp");
}

export async function createTokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const name = String(formData.get("name") ?? "").trim();
  const scope: TokenScope = formData.get("scope") === "write" ? "write" : "read";
  if (!name) return { error: t("error.generic") };
  const token = await createToken(name, scope, user.email);
  await audit(user.email, "mcp.token.create", name);
  revalidatePath("/admin/mcp");
  return { ok: `${t("mcp.tokenCreated")} ${token}` };
}

export async function revokeTokenAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await revokeToken(id);
  await audit(user.email, "mcp.token.revoke", id);
  revalidatePath("/admin/mcp");
}
