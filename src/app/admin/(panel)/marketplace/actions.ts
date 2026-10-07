"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { revalidatePath } from "next/cache";
import { clearCatalogueCache } from "@/core/modules/catalogue";
import { installFromMarketplace, installModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

// Installer du code exécuté côté serveur est réservé au propriétaire.

export async function installFromMarketplaceAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await installFromMarketplace(id);
  if (!result.ok) redirect(`/admin/marketplace?error=${encodeURIComponent(result.error)}`);
  await audit(user.email, "module.install", id);
  redirect("/admin/modules");
}

/** Dépôt git personnel : jamais vérifié. L'installation exige que l'utilisateur ait coché qu'il l'a compris. */
export async function installCustomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  if (formData.get("trust") !== "on") return { error: t("marketplace.trustRequired") };
  const result = await installModule(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.install.custom", result.id);
  redirect("/admin/modules");
}

/** Relit tout de suite la liste des modules reconnus (sinon elle est relue au plus toutes les 15 minutes). */
export async function refreshMarketplaceAction(): Promise<void> {
  await adminCtx("owner");
  clearCatalogueCache();
  revalidatePath("/admin/marketplace");
}
