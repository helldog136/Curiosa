"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { approveRequest, denyRequestBy } from "@/core/maintenance/actions";
import { setApprovalMode, setNotifyMode, type ApprovalMode } from "@/core/maintenance/settings";
import { audit } from "@/core/permissions";
import { prisma } from "@/core/db";

const PAGE = "/admin/maintenance-ia";

/** Le propriétaire approuve : la demande s'exécute (une seule fois), avec les mêmes vérifications que si l'IA l'avait faite directement. */
export async function approveRequestAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await approveRequest(String(id), { email: user.email, role: user.role });
  revalidatePath(PAGE);
  revalidatePath("/admin", "layout");
  if (!result.ok && (result.reason === "busy" || result.reason === "expired" || result.reason === "not-pending" || result.reason === "unknown" || result.reason === "forbidden")) redirect(`${PAGE}?notice=${result.reason}`);
}

export async function denyRequestAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await denyRequestBy(String(id), { email: user.email, role: user.role });
  revalidatePath(PAGE);
  revalidatePath("/admin", "layout");
  if (!result.ok && result.reason) redirect(`${PAGE}?notice=${result.reason}`);
}

/** Validation humaine (défaut) ou exécution directe, pour un jeton. Le journal garde le nom du jeton, jamais le jeton. */
export async function setApprovalAction(tokenId: string, mode: ApprovalMode): Promise<void> {
  const { user } = await adminCtx("owner");
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId) } });
  if (!row || row.revokedAt) return;
  const next: ApprovalMode = mode === "direct" ? "direct" : "human";
  await setApprovalMode(row.id, next);
  await audit(user.email, "mcp.maintenance.mode", `${row.name}: ${next}`);
  revalidatePath(PAGE);
  revalidatePath(`/admin/mcp/${row.id}`);
}

export async function saveNotifyAction(formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const mode = formData.get("notify") === "email" ? "email" : "admin";
  await setNotifyMode(mode);
  await audit(user.email, "mcp.maintenance.notify", mode);
  revalidatePath(PAGE);
}
