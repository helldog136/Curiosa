"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { listMcpToolCatalogue } from "@/core/platform";
import { setGrant, withinCeiling, type Grants } from "@/core/services/mcp/access";
import { createToken, getTokenGrants, revokeToken, saveTokenGrants, type TokenScope } from "@/core/services/mcp/tokens";
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

/**
 * Accorde ou retire UNE action à UN jeton. Effet immédiat : le serveur relit les accès à chaque
 * requête, le jeton n'a pas à être regénéré ni le site redéployé.
 */
export async function setGrantAction(tokenId: string, toolName: string, enabled: boolean): Promise<{ ok: boolean }> {
  const { user } = await adminCtx("owner");
  const [token, catalogue] = await Promise.all([getTokenGrants(tokenId), listMcpToolCatalogue()]);
  const tool = catalogue.find((t) => t.name === toolName);
  if (!token || !tool) return { ok: false };
  // Plafond : on n'accorde pas une action qui écrit à un jeton « lecture seule ».
  if (enabled && !withinCeiling(tool, token.scope)) return { ok: false };
  await saveTokenGrants(tokenId, setGrant(token.grants, tool, enabled));
  await audit(user.email, `mcp.grant.${enabled ? "on" : "off"}`, `${tokenId}:${toolName}`);
  revalidatePath(`/admin/mcp/${tokenId}`);
  return { ok: true };
}

/** Remet les actions d'une instance (ou de tout le jeton) aux défauts de leurs modules, ou les retire toutes. */
export async function resetGrantsAction(tokenId: string, instanceKey: string | null, mode: "defaults" | "none"): Promise<void> {
  const { user } = await adminCtx("owner");
  const [token, catalogue] = await Promise.all([getTokenGrants(tokenId), listMcpToolCatalogue()]);
  if (!token) return;
  let grants: Grants = token.grants;
  for (const tool of catalogue.filter((t) => instanceKey === null || t.source === instanceKey)) grants = setGrant(grants, tool, mode === "defaults" ? tool.default : false);
  await saveTokenGrants(tokenId, grants);
  await audit(user.email, `mcp.grants.${mode}`, `${tokenId}:${instanceKey ?? "all"}`);
  revalidatePath(`/admin/mcp/${tokenId}`);
}

