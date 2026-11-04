"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { approveRequest, denyRequestBy } from "@/core/maintenance/actions";
import { setApprovalMode, setNotifyMode, type ApprovalMode } from "@/core/maintenance/settings";
import { audit } from "@/core/permissions";
import { prisma } from "@/core/db";
import { DEFAULT_LIMITS, LIMIT_BOUNDS, resetSlots, setLimits } from "@/core/maintenance/slots";
import type { ActionState } from "@/components/admin/ActionForm";
import { accessHref, assistantsTabHref, ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";


/** Le propriétaire approuve : la demande s'exécute (une seule fois), avec les mêmes vérifications que si l'IA l'avait faite directement. */
export async function approveRequestAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const result = await approveRequest(String(id), { email: user.email, owner: can(user, "core:mcp.tokens") });
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath("/admin", "layout");
  if (!result.ok && (result.reason === "busy" || result.reason === "expired" || result.reason === "not-pending" || result.reason === "unknown" || result.reason === "forbidden")) redirect(assistantsTabHref("requests", { notice: result.reason }));
}

export async function denyRequestAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const result = await denyRequestBy(String(id), { email: user.email, owner: can(user, "core:mcp.tokens") });
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath("/admin", "layout");
  if (!result.ok && result.reason) redirect(assistantsTabHref("requests", { notice: result.reason }));
}

/** Validation humaine (défaut) ou exécution directe, pour un jeton. Le journal garde le nom du jeton, jamais le jeton. */
export async function setApprovalAction(tokenId: string, mode: ApprovalMode): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId) } });
  if (!row || row.revokedAt) throw new Error("unknown access");
  const next: ApprovalMode = mode === "direct" ? "direct" : "human";
  await setApprovalMode(row.id, next);
  await audit(user.email, "mcp.maintenance.mode", `${row.name}: ${next}`);
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(accessHref(row.id));
}

export async function saveNotifyAction(formData: FormData): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const mode = formData.get("notify") === "email" ? "email" : "admin";
  await setNotifyMode(mode);
  await audit(user.email, "mcp.maintenance.notify", mode);
  revalidatePath(ASSISTANTS_HREF);
}

/** Starts the hourly counters of an access again from zero (both classes). One click, journalled; the right is the one that manages the accesses. */
export async function resetLimitsAction(tokenId: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:mcp.tokens" });
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId) } });
  if (!row || row.revokedAt) throw new Error("unknown access");
  resetSlots(row.id);
  await audit(user.email, "mcp.limits.reset", row.name);
  revalidatePath(accessHref(row.id));
}

/** The two hourly limits of an access (advanced mode), bounded; an error shows under the field with an example. */
export async function saveLimitsAction(tokenId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:mcp.tokens" });
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId) } });
  if (!row || row.revokedAt) return { error: t("error.generic") };
  const errors: Record<string, string> = {};
  const values: { risky?: number; content?: number } = {};
  for (const cls of ["risky", "content"] as const) {
    const raw = String(formData.get(cls) ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    const [lo, hi] = LIMIT_BOUNDS[cls];
    if (!Number.isInteger(n) || n < lo || n > hi) errors[cls] = t("aim.limits.error", { min: lo, max: hi, example: DEFAULT_LIMITS[cls] });
    else values[cls] = n;
  }
  if (Object.keys(errors).length) return { errors };
  // An empty field puts the default back.
  const before = await setLimits(row.id, { risky: values.risky ?? DEFAULT_LIMITS.risky, content: values.content ?? DEFAULT_LIMITS.content });
  await audit(user.email, "mcp.limits.set", `${row.name}: risky ${before.risky}, content ${before.content}`);
  revalidatePath(accessHref(row.id));
  return { ok: t("action.saved") };
}
