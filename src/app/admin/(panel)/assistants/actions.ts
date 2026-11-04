"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { listMcpToolCatalogue } from "@/core/platform";
import { defaultFor, MAINTENANCE_PROFILE, setGrant, withinCeiling, type Grants } from "@/core/services/mcp/access";
import { applyGrantChanges, type GrantRejection } from "@/core/services/mcp/grantChanges";
import { createAccess } from "@/core/mcpAccess";
import { findTokenId, getTokenGrants, revokeToken, saveTokenGrants, setUrlAccess, type TokenScope } from "@/core/services/mcp/tokens";
import { audit } from "@/core/permissions";
import { setApprovalMode, setNotifyMode } from "@/core/maintenance/settings";
import { setSetting } from "@/core/settings";
import { prisma } from "@/core/db";
import { accessHref, ASSISTANTS_HREF, TEAM_HREF } from "@/core/services/mcp/assistantsLinks";

/** Résultat de la création d'un jeton : le seul moment où le texte en clair (et l'adresse secrète) existe. Jamais relu depuis la base. */
export type CreateTokenState = { error?: string; created?: { name: string; token: string; byUrl: boolean } } | null;

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  await setSetting("mcp.enabled", enabled);
  await audit(user.email, enabled ? "mcp.enable" : "mcp.disable");
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
}

export async function createTokenAction(_prev: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  const { user, t } = await adminCtx({ right: "core:mcp.tokens" });
  const name = String(formData.get("name") ?? "").trim();
  const maintenance = formData.get("profile") === "maintenance";
  // Profil « Maintenance » : le plafond est « écriture » (sinon on ne pourrait jamais accorder une action sans risque), mais SEULS les outils de maintenance
  // sont proposés, et seule la lecture est active ; le reste se coche plus tard, action par action (voir access.ts, MAINTENANCE_PROFILE).
  const scope: TokenScope = maintenance || formData.get("scope") === "write" ? "write" : "read";
  const byUrl = formData.get("byUrl") === "on";
  if (!name) return { error: t("assistants.error.name") };
  const { token } = await createAccess({ name, scope, actorEmail: user.email, byUrl, grants: maintenance ? { [MAINTENANCE_PROFILE]: true } : undefined, note: maintenance ? "maintenance" : undefined });
  if (maintenance) {
    const id = await findTokenId(token);
    // Validation humaine par défaut ; l'exécution directe doit être choisie explicitement.
    if (id && formData.get("approval") === "direct") { await setApprovalMode(id, "direct"); await audit(user.email, "mcp.maintenance.mode", `${name}: direct`); }
    const notify = formData.get("notify") === "email" ? "email" : "admin";
    await setNotifyMode(notify);
    await audit(user.email, "mcp.maintenance.notify", notify);
  }
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
  return { created: { name, token, byUrl } };
}

/** Autorise ou retire la connexion par adresse secrète d'un jeton existant (propriétaire seulement). Le journal ne garde jamais l'adresse ni le jeton. */
export async function setUrlAccessAction(tokenId: string, enabled: boolean): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const row = await prisma.apiToken.findUnique({ where: { id: tokenId } });
  if (!row || row.revokedAt) return;
  await setUrlAccess(tokenId, enabled);
  if (enabled) await audit(user.email, "mcp.token.url.on", row.name);
  else await audit(user.email, "mcp.token.url.off", row.name);
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
  revalidatePath(accessHref(tokenId));
  revalidatePath(TEAM_HREF);
}

export async function revokeTokenAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  await revokeToken(id);
  await audit(user.email, "mcp.token.revoke", id);
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
  revalidatePath(accessHref(id));
  revalidatePath(TEAM_HREF);
}

/**
 * Accorde ou retire UNE action à UN jeton. Effet immédiat : le serveur relit les accès à chaque
 * requête, le jeton n'a pas à être regénéré ni le site redéployé.
 */
export async function setGrantAction(tokenId: string, toolName: string, enabled: boolean): Promise<{ ok: boolean }> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const [token, catalogue] = await Promise.all([getTokenGrants(tokenId), listMcpToolCatalogue()]);
  const tool = catalogue.find((t) => t.name === toolName);
  if (!token || !tool) return { ok: false };
  // Plafond : on n'accorde pas une action qui écrit à un jeton « lecture seule ».
  if (enabled && !withinCeiling(tool, token.scope)) return { ok: false };
  await saveTokenGrants(tokenId, setGrant(token.grants, tool, enabled));
  await audit(user.email, `mcp.grant.${enabled ? "on" : "off"}`, `${tokenId}:${toolName}`);
  revalidatePath(accessHref(tokenId));
  revalidatePath(TEAM_HREF);
  return { ok: true };
}

/**
 * Applies the changes made on the rights page in one go (after the owner reviewed the summary). Same rules as one single change; refused changes
 * come back with their reason. The journal gets one line with the counts and the names of the tools, never a value.
 */
export async function applyGrantsAction(tokenId: string, changes: Record<string, boolean>): Promise<{ ok: boolean; applied: string[]; rejected: GrantRejection[] }> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const [token, catalogue] = await Promise.all([getTokenGrants(tokenId), listMcpToolCatalogue()]);
  if (!token) return { ok: false, applied: [], rejected: [] };
  const clean = Object.fromEntries(Object.entries(changes ?? {}).slice(0, 500).filter(([, v]) => typeof v === "boolean"));
  const result = applyGrantChanges(token.grants, token.scope, catalogue, clean);
  if (result.applied.length) {
    await saveTokenGrants(tokenId, result.grants);
    const on = result.applied.filter((n) => clean[n]);
    const off = result.applied.filter((n) => !clean[n]);
    await audit(user.email, "mcp.grants.apply", `${tokenId}: +${on.length} -${off.length} (${result.applied.slice(0, 20).join(", ")})`);
  }
  revalidatePath(accessHref(tokenId));
  revalidatePath(TEAM_HREF);
  return { ok: result.rejected.length === 0, applied: result.applied, rejected: result.rejected };
}

/** Remet les actions d'une instance (ou de tout le jeton) aux défauts de leurs modules, ou les retire toutes. */
export async function resetGrantsAction(tokenId: string, instanceKey: string | null, mode: "defaults" | "none"): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const [token, catalogue] = await Promise.all([getTokenGrants(tokenId), listMcpToolCatalogue()]);
  if (!token) return;
  let grants: Grants = token.grants;
  for (const tool of catalogue.filter((t) => instanceKey === null || t.source === instanceKey)) grants = setGrant(grants, tool, mode === "defaults" ? defaultFor(tool, grants) : false);
  await saveTokenGrants(tokenId, grants);
  await audit(user.email, `mcp.grants.${mode}`, `${tokenId}:${instanceKey ?? "all"}`);
  revalidatePath(accessHref(tokenId));
  revalidatePath(TEAM_HREF);
}

