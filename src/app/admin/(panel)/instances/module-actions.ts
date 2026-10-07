"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Exécute une `adminAction` d'un module (formulaire ou bouton de ligne de son panneau d'admin).
 * Réservé aux administrateurs ; le module ne fait jamais lui-même le contrôle d'accès.
 */
export async function runModuleAdminAction(instanceId: string, action: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("admin");
  const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
  const handler = active?.mod.def.adminActions?.[action];
  if (!active || !handler) return { error: t("error.generic") };

  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) values[k] = v.slice(0, 20000);

  let result;
  try {
    result = await handler(await buildContext(active.mod, active.instance, locale), values);
  } catch (error) {
    console.error(`[modules] ${active.instance.key} adminAction ${action} failed:`, error);
    return { error: t("error.generic") };
  }
  await audit(user.email, `module.${active.instance.key}.${action}`);
  revalidatePath("/admin", "layout");
  if (result.redirect) redirect(result.redirect);
  return { ok: result.ok, error: result.error };
}
