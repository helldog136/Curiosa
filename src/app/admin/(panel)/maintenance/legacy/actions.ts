"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { runLegacySweep } from "@/core/modules/legacySweep";
import { dismissLegacyRow, undoDismissLegacyRow } from "@/core/modules/legacyDismiss";
import { legacyReport } from "@/core/modules/legacyReport";
import { uninstallModule } from "@/core/modules/installer";
import type { ActionState } from "@/components/admin/ActionForm";

/** « Relancer » : le même balayage qu'au démarrage (borné à 20 s, sans réseau). Réservé au propriétaire : il peut convertir des données de modules. */
export async function rerunLegacySweep(): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const r = await runLegacySweep();
  if (r.busy) return { error: t("legacy.rerun.busy") };
  await audit(user.email, "core.legacy.sweep", r.done ? "done" : r.timedOut ? "timeout" : "pending");
  revalidatePath("/admin", "layout");
  if (r.done) return { ok: t("legacy.rerun.done") };
  return r.timedOut ? { error: t("legacy.rerun.timeout") } : { error: t("legacy.rerun.pending") };
}

const PAGE = "/admin/maintenance/legacy";

/**
 * Un module copié par une très ancienne version, que le catalogue ne propose plus : « Le garder tel quel ». Il ne retient plus la mise à niveau
 * (règle dans legacyDismiss.ts). Refusé pour un module que le catalogue propose encore ou dont on ne sait rien : sa mise à jour le règle.
 */
export async function keepLegacyRowAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const row = (await legacyReport()).sourceRows.find((r) => r.id === id);
  if (row?.state === "absent") {
    await dismissLegacyRow(id);
    await audit(user.email, "core.legacy.keep", id);
    await runLegacySweep();
  }
  revalidatePath("/admin", "layout");
  redirect(`${PAGE}?done=${row?.state === "absent" ? "kept" : "refused"}`);
}

/** Annule « Le garder tel quel ». */
export async function undoKeepLegacyRowAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await undoDismissLegacyRow(id);
  await audit(user.email, "core.legacy.keep.undo", id);
  await runLegacySweep();
  revalidatePath("/admin", "layout");
  redirect(PAGE);
}

/** Retire un module hérité (les mêmes boutons que sur sa page, mais on revient ici). Réservé aux modules de la liste « ce qui reste ». */
export async function removeLegacyRowAction(id: string, keepData: boolean): Promise<void> {
  const { user } = await adminCtx("owner");
  const row = (await legacyReport()).sourceRows.find((r) => r.id === id);
  if (!row) redirect(`${PAGE}?done=refused`);
  const result = await uninstallModule(id, { keepData });
  if (result.ok) await audit(user.email, keepData ? "module.uninstall.keep" : "module.uninstall.erase", id);
  if (result.ok) await runLegacySweep();
  revalidatePath("/", "layout");
  redirect(`${PAGE}?done=${result.ok ? (keepData ? "removed" : "erased") : "refused"}`);
}
