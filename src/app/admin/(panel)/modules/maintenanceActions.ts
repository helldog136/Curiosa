"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { describeReinstall, diagnoseModule, reinstallAuditTarget, reinstallModule } from "@/core/modules/reinstall";

// Maintenance d'un module (réinstallation, comparaison avec la source) : réservé au propriétaire, comme toute action qui touche au code exécuté.

export type MaintenanceResult = { ok: boolean; lines: string[] };

/** Remet le code du module à neuf depuis sa source (réglages, instances et données conservés). Renvoie le bilan déjà rédigé. */
export async function reinstallModuleAction(id: string): Promise<MaintenanceResult> {
  const { user, t } = await adminCtx("owner");
  const result = await reinstallModule(id);
  if (result.ok) await audit(user.email, "module.reinstall", reinstallAuditTarget(result));
  revalidatePath("/", "layout");
  return describeReinstall(result, t);
}

/** « Comparer avec la source » : appel réseau explicite pour un module git ; le contenu installé est-il identique à celui de la source ? */
export async function compareSourceAction(id: string): Promise<MaintenanceResult & { state: "identical" | "different" | "unavailable"; sourceVersion?: string }> {
  await adminCtx("owner");
  const d = await diagnoseModule(id, { compare: "network" });
  const c = d?.comparison;
  return { ok: !!c && c.state !== "unavailable", lines: [], state: c?.state ?? "unavailable", sourceVersion: c?.sourceVersion };
}
