"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { checkForUpdate, installModule, setModuleEnabled, uninstallModule, updateModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import { getModule } from "@/core/modules/registry";
import { prisma } from "@/core/db";
import { createInstance, defaultNames } from "@/core/instanceService";
import type { ActionState } from "@/components/admin/ActionForm";

// Installer ou mettre à jour du code exécuté côté serveur est réservé au propriétaire.

export async function installModuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const result = await installModule(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.install", result.id);
  redirect("/admin/modules");
}

export async function installFromCatalogue(repo: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await installModule(repo);
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  await audit(user.email, "module.install", result.id);
  redirect("/admin/modules");
}

export async function toggleModule(id: string, enabled: boolean): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await setModuleEnabled(id, enabled);
  await audit(user.email, enabled ? "module.enable" : "module.disable", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  redirect("/admin/modules");
}

export async function checkUpdateAction(id: string): Promise<void> {
  await adminCtx("owner");
  const { available } = await checkForUpdate(id);
  redirect(`/admin/modules?update=${available ? "yes" : "no"}`);
}

export async function updateModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await updateModule(id);
  await audit(user.email, "module.update", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  redirect("/admin/modules");
}

export async function uninstallModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await uninstallModule(id);
  await audit(user.email, "module.uninstall", id);
  revalidatePath("/", "layout");
  redirect("/admin/modules");
}

/** Ajoute une instance d'un module (un nouveau blog, une nouvelle liste de liens…) avec ses réglages par défaut. */
export async function addInstance(moduleId: string): Promise<void> {
  const { user, config } = await adminCtx("admin");
  const mod = await getModule(moduleId);
  if (!mod || !mod.row.enabled) redirect("/admin/modules?error=modules.error.load");
  if (mod.manifest.instances === "single" && (await prisma.moduleInstance.count({ where: { moduleId } })) > 0) {
    redirect("/admin/modules?error=instances.error.single");
  }
  const created = await createInstance(prisma, { manifest: mod.manifest, names: defaultNames(mod.manifest, config.locales) });
  await audit(user.email, "instance.create", created.key);
  revalidatePath("/", "layout");
  redirect(`/admin/instances/${created.id}`);
}
