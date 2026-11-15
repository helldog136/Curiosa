import { audit } from "../permissions";
import type { InstallResult } from "./installer";

/** Journal d'une installation réussie, au même endroit pour tous les chemins d'admin : les modules apportés, le module et sa première instance (les données retrouvées sont journalisées par l'appelant qui les annonce). */
export async function auditInstall(actor: string, id: string, result: Extract<InstallResult, { ok: true }>, action = "module.install"): Promise<void> {
  for (const provided of result.provided ?? []) await audit(actor, "module.install.auto", provided);
  await audit(actor, action, id);
  if (result.instance) await audit(actor, "instance.create", result.instance.key, { module: id, instance: result.instance.key });
}
