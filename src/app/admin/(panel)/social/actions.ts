"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { installFromCatalogue, setModuleEnabled } from "@/core/modules/installer";
import { getModule } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { addInstance } from "../modules/actions";

/**
 * Ajoute un réseau social : installe son module s'il ne l'est pas encore (réservé au propriétaire : c'est du code exécuté sur le serveur),
 * l'active, puis en crée une instance — comme le bouton « Ajouter une instance » de la page Modules (surnoms demandés dès la deuxième).
 */
export async function addNetwork(moduleId: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  if (!(await getModule(moduleId))) {
    const installed = await installFromCatalogue(moduleId);
    if (!installed.ok) redirect(`/admin/social?error=${encodeURIComponent(installed.error)}`);
    await audit(user.email, "module.install", moduleId);
  }
  const enabled = await setModuleEnabled(moduleId, true);
  if (!enabled.ok) redirect(`/admin/social?error=${encodeURIComponent(enabled.error)}`);
  await addInstance(moduleId, formData);
}
