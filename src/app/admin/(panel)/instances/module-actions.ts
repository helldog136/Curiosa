"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { buildContext, forViewer } from "@/core/modules/context";
import { getActiveInstances, type ActiveInstance } from "@/core/modules/registry";
import { audit, auditDenied, type AdminUser } from "@/core/permissions";
import { decideAdminAction } from "@/core/modules/adminActionAccess";
import type { AdminActionHandler } from "@/core/modules/types";
import type { ActionState } from "@/components/admin/ActionForm";
import { sanitizeFieldErrors } from "@/core/fieldErrors";
import { parseGeneratedGrid, type GridData } from "@/core/gridEditor";

/** Le gestionnaire d'une `adminAction` SI cette personne peut l'exécuter (voir `decideAdminAction`), sinon null (refus noté au journal) ; `undefined` : pas d'action de ce nom. */
async function allowedHandler(user: AdminUser, active: ActiveInstance | undefined, action: string): Promise<AdminActionHandler | null | undefined> {
  if (!active) return undefined;
  const decision = decideAdminAction(user, active.mod.manifest.id, active.mod.def.adminActions, action);
  if (!decision) return undefined;
  if ("handler" in decision) return decision.handler;
  await auditDenied(user, decision.denied);
  return null;
}

/**
 * Exécute une `adminAction` d'un module (formulaire ou bouton de ligne de son panneau d'admin).
 * Forme fonction : administrateurs ; forme objet : le droit déclaré (voir `allowedHandler`). Le module ne fait jamais lui-même le contrôle d'accès.
 */
export async function runModuleAdminAction(instanceId: string, action: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("member");
  const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
  const handler = await allowedHandler(user, active, action);
  if (!active || !handler) return { error: t(handler === null && active?.mod.def.adminActions?.[action] ? "error.denied" : "error.generic") };

  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) values[k] = v.slice(0, 20000);

  let result;
  try {
    result = await handler(forViewer(await buildContext(active.mod, active.instance, locale), user), values);
  } catch (error) {
    console.error(`[modules] ${active.instance.key} adminAction ${action} failed:`, error);
    return { error: t("error.generic") };
  }
  await audit(user.email, `module.${active.instance.key}.${action}`);
  revalidatePath("/admin", "layout");
  if (result.redirect) {
    // Un module ne peut rediriger que dans l'admin : "?x=y" reste sur la page de l'instance, "/admin/…" va ailleurs dans l'admin.
    const to = result.redirect.startsWith("?") ? `/admin/instances/${instanceId}${result.redirect === "?" ? "" : result.redirect}` : result.redirect;
    if (to.startsWith("/admin/") && !to.startsWith("//")) redirect(to);
  }
  return { ok: result.ok, error: result.error, errors: sanitizeFieldErrors(result.errors) };
}

/**
 * « Générer » d'un bloc `gridEditor` : exécute l'adminAction `generateAction` du module et renvoie le tracé proposé SANS rien enregistrer
 * (le module ne doit pas persister ; l'enregistrement reste le rôle de l'action de sauvegarde). Mêmes contrôles d'accès que
 * `runModuleAdminAction`. Une réponse mal formée (taille, contenu) est refusée.
 */
export async function runModuleGridGenerate(instanceId: string, action: string): Promise<{ grid?: GridData; error?: string }> {
  const { user, t, locale } = await adminCtx("member");
  const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
  const handler = await allowedHandler(user, active, action);
  if (!active || !handler) return { error: t(handler === null && active?.mod.def.adminActions?.[action] ? "error.denied" : "error.generic") };
  let result;
  try {
    result = await handler(forViewer(await buildContext(active.mod, active.instance, locale), user), {});
  } catch (error) {
    console.error(`[modules] ${active.instance.key} adminAction ${action} (génération) failed:`, error);
    return { error: t("error.generic") };
  }
  if (result.error) return { error: result.error };
  const grid = parseGeneratedGrid(result.grid);
  return grid ? { grid } : { error: t("error.generic") };
}
