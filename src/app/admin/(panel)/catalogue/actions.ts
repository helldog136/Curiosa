"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { revalidatePath } from "next/cache";
import { clearRecognizedCache } from "@/core/modules/recognized";
import { installFromCatalogue, installModule } from "@/core/modules/installer";
import { addSource, clearSourcesCache, removeSource } from "@/core/modules/sources";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

// Installer du code exécuté côté serveur est réservé au propriétaire.

export async function installFromCatalogueAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await installFromCatalogue(id);
  if (!result.ok) redirect(`/admin/catalogue?error=${encodeURIComponent(result.error)}`);
  await audit(user.email, "module.install", id);
  redirect("/admin/modules");
}

/** Dépôt git personnel : jamais vérifié. L'installation exige que l'utilisateur ait coché qu'il l'a compris. */
export async function installCustomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  if (formData.get("trust") !== "on") return { error: t("catalogue.trustRequired") };
  const result = await installModule(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.install.custom", result.id);
  redirect("/admin/modules");
}

/** Relit tout de suite la liste des modules reconnus (sinon elle est relue au plus toutes les 15 minutes). */
export async function refreshCatalogueAction(): Promise<void> {
  await adminCtx("owner");
  clearRecognizedCache();
  revalidatePath("/admin/catalogue");
}

/** Ajoute un dépôt de modules personnel (propriétaire seulement) : il doit contenir au moins un module. */
export async function addSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const result = await addSource(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.source.add", String(formData.get("repo") ?? "").slice(0, 200));
  revalidatePath("/admin/catalogue");
  return { ok: t("catalogue.sources.added", { count: String(result.modules.length) }) };
}

export async function removeSourceAction(url: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await removeSource(url);
  await audit(user.email, "module.source.remove", url.slice(0, 200));
  revalidatePath("/admin/catalogue");
}

/** Relit tout de suite les modules des dépôts personnels (sinon relus au plus toutes les 10 minutes). */
export async function refreshSourcesAction(): Promise<void> {
  await adminCtx("owner");
  clearSourcesCache();
  revalidatePath("/admin/catalogue");
}
