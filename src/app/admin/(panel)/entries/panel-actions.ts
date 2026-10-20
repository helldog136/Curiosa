"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { buildContext, forViewer } from "@/core/modules/context";
import { panelValues } from "@/core/modules/entryPanels";
import { resolvePanelAction } from "@/core/modules/entryPanelsLoad";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Exécute une action d'une section qu'un module ajoute à l'éditeur d'une entrée (formulaire ou bouton de ligne de la section).
 * Mêmes droits que l'éditeur d'entrée (éditeur et plus) ; le cœur relit l'entrée et vérifie que la section s'applique bien à elle — le navigateur n'envoie que des identifiants.
 * Aucune redirection : la page reste où elle est (position de défilement, sections ouvertes ou fermées, saisie en cours), seule la section se met à jour et dit le résultat.
 */
export async function runEntryPanelAction(instanceId: string, panelId: string, entryId: string, action: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("editor");
  const found = await resolvePanelAction(instanceId, panelId, entryId);
  const handler = found?.panel.actions?.[action];
  if (!found || typeof handler !== "function") return { error: t("entries.panel.gone") };
  let result;
  try {
    result = await handler(forViewer(await buildContext(found.active.mod, found.active.instance, locale), user), found.target, panelValues(formData));
  } catch (error) {
    console.error(`[modules] ${found.active.instance.key} entryPanels.${panelId}.${action} failed:`, error);
    return { error: t("error.generic") };
  }
  await audit(user.email, `module.${found.active.instance.key}.entry.${panelId}.${action}`);
  if (!result?.error) revalidatePath(`/admin/entries/${entryId}`);
  return { ok: result?.ok, error: result?.error };
}
