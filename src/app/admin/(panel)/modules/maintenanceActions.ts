"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { opIdOf, trackOperation } from "@/core/operations/run";
import { describeReinstall, diagnoseModule, reinstallAuditTarget, reinstallModule } from "@/core/modules/reinstall";

// Maintenance d'un module (réinstallation, comparaison avec la source) : réservé au propriétaire, comme toute action qui touche au code exécuté.

export type MaintenanceResult = { ok: boolean; lines: string[] };

/** Remet le code du module à neuf depuis sa source (réglages, instances et données conservés). Renvoie le bilan déjà rédigé. */
export async function reinstallModuleAction(id: string, opId?: string): Promise<MaintenanceResult> {
  const { user, t } = await adminCtx("owner");
  // Suivi d'opération : un second clic (autre onglet) rejoint la réinstallation en cours au lieu d'en lancer une autre.
  const run = await trackOperation(user, { kind: "module-reinstall", key: `module-reinstall:${String(id).slice(0, 60)}`, opId: opIdOf(opId) }, async () => {
    const result = await reinstallModule(id);
    if (result.ok) await audit(user.email, "module.reinstall", reinstallAuditTarget(result));
    revalidatePath("/", "layout");
    return describeReinstall(result, t);
  }, (r) => ({ ok: r.ok, error: r.lines.join(" ") }));
  return run.busy ? { ok: false, lines: [t("progress.busy")] } : run.result;
}

/** « Comparer avec la source » : appel réseau explicite pour un module git ; le contenu installé est-il identique à celui de la source ? */
export async function compareSourceAction(id: string): Promise<MaintenanceResult & { state: "identical" | "different" | "unavailable"; sourceVersion?: string }> {
  await adminCtx("owner");
  const d = await diagnoseModule(id, { compare: "network" });
  const c = d?.comparison;
  return { ok: !!c && c.state !== "unavailable", lines: [], state: c?.state ?? "unavailable", sourceVersion: c?.sourceVersion };
}
