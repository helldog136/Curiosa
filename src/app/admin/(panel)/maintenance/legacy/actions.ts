"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { runLegacySweep } from "@/core/modules/legacySweep";
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
