"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { runLegacySweep } from "@/core/modules/legacySweep";
import { dismissLegacyRow, undoDismissLegacyRow } from "@/core/modules/legacyDismiss";
import { legacyReport } from "@/core/modules/legacyReport";
import { forgetUpkeepSummary } from "@/core/modules/legacyUpkeep";
import { deleteInertCollection } from "@/core/modules/legacyCollections";
import { uninstallModule } from "@/core/modules/installer";
import type { ActionState } from "@/components/admin/ActionForm";

/** « Relancer » : le même balayage qu'au démarrage (borné à 20 s, sans réseau). Réservé au propriétaire : il peut convertir des données de modules. */
export async function rerunLegacySweep(): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:updates" });
  const r = await runLegacySweep();
  if (r.busy) return { error: t("legacy.rerun.busy") };
  await audit(user.email, "core.legacy.sweep", r.done ? "done" : r.timedOut ? "timeout" : "pending");
  forgetUpkeepSummary();
  revalidatePath("/admin", "layout");
  if (r.done) return { ok: t("legacy.rerun.done") };
  return r.timedOut ? { error: t("legacy.rerun.timeout") } : { error: t("legacy.rerun.pending") };
}

const PAGE = "/admin/maintenance/legacy";

/** Un module copié par une très ancienne version : « Le garder tel quel ». Il ne retient plus la mise à niveau (règle dans legacyDismiss.ts). Refusé s'il n'est plus dans la liste. */
export async function keepLegacyRowAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:updates" });
  const row = (await legacyReport()).sourceRows.find((r) => r.id === id);
  if (row) {
    await dismissLegacyRow(id);
    await audit(user.email, "core.legacy.keep", id);
    await runLegacySweep();
  }
  forgetUpkeepSummary();
  revalidatePath("/admin", "layout");
  redirect(`${PAGE}?done=${row ? "kept" : "refused"}`);
}

/** Annule « Le garder tel quel ». */
export async function undoKeepLegacyRowAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:updates" });
  await undoDismissLegacyRow(id);
  await audit(user.email, "core.legacy.keep.undo", id);
  await runLegacySweep();
  forgetUpkeepSummary();
  revalidatePath("/admin", "layout");
  redirect(PAGE);
}

/** Retire un module hérité (les mêmes boutons que sur sa page, mais on revient ici). Réservé aux modules de la liste « ce qui reste ». */
export async function removeLegacyRowAction(id: string, keepData: boolean): Promise<void> {
  const { user } = await adminCtx({ right: "core:updates" });
  const row = (await legacyReport()).sourceRows.find((r) => r.id === id);
  if (!row) redirect(`${PAGE}?done=refused`);
  const result = await uninstallModule(id, { keepData });
  if (result.ok) await audit(user.email, keepData ? "module.uninstall.keep" : "module.uninstall.erase", id);
  if (result.ok) await runLegacySweep();
  forgetUpkeepSummary();
  revalidatePath("/", "layout");
  redirect(`${PAGE}?done=${result.ok ? (keepData ? "removed" : "erased") : "refused"}`);
}

/**
 * « Supprimer cette copie » : une copie de sécurité que son extension a déclarée INERTE (`inertLegacyCollections`). Réservé au mode avancé (contrôlé ICI, pas seulement caché dans la page),
 * au droit `core:updates`, à une collection de la liste « ce qui reste ». Le cœur relit le manifeste au moment du clic et refuse tout le reste (voir legacyCollections.ts).
 * Le journal garde le nom de l'extension, de l'instance et de la collection et un nombre, jamais un contenu.
 */
export async function deleteInertCopyAction(instanceKey: string, collection: string): Promise<void> {
  const { user, advanced } = await adminCtx({ right: "core:updates" });
  const listed = advanced && (await legacyReport()).collections.some((c) => c.key === instanceKey && c.collection === collection && c.inert);
  const r = listed ? await deleteInertCollection(instanceKey, collection) : null;
  if (!r || !r.ok) {
    await audit(user.email, "core.legacy.copy.refused", `${instanceKey}/${collection}`.slice(0, 200), { level: "warn" });
    redirect(`${PAGE}?done=copyRefused`);
  }
  await audit(user.email, "core.legacy.copy.delete", `${collection} · ${r.deleted}`.slice(0, 200), { module: r.moduleId, instance: instanceKey, level: "warn" });
  forgetUpkeepSummary();
  revalidatePath("/admin", "layout");
  redirect(`${PAGE}?done=${r.remaining > 0 ? "copyPartial" : "copyDeleted"}`);
}
