"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { checkForUpdate, setModuleEnabled, uninstallModule, updateModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import { getModule } from "@/core/modules/registry";
import { prisma } from "@/core/db";
import { createInstance, defaultNames } from "@/core/instanceService";
import { checkNickname } from "@/core/instanceLabel";

// Installer ou mettre à jour du code exécuté côté serveur est réservé au propriétaire.

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

/**
 * Ajoute une instance d'un module avec ses réglages par défaut. La première n'a besoin d'aucun surnom ; dès la
 * deuxième, il faut pouvoir les distinguer : on demande un surnom pour la nouvelle (et pour l'existante, si elle
 * n'en a pas encore). L'identifiant technique en est dérivé (« Chaîne 2 » → chaine-2).
 */
export async function addInstance(moduleId: string, formData: FormData): Promise<void> {
  const { user, config } = await adminCtx("admin");
  const mod = await getModule(moduleId);
  if (!mod || !mod.row.enabled) redirect("/admin/modules?error=modules.error.load");
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId } });
  if (mod.manifest.instances === "single" && existing.length > 0) redirect("/admin/modules?error=instances.error.single");

  let nickname: string | undefined;
  if (existing.length > 0) {
    // Surnoms déjà pris + ceux qu'on s'apprête à attribuer aux instances qui n'en ont pas.
    const assigned = new Map<string, string>();
    for (const e of existing) {
      const given = e.nickname ?? String(formData.get(`nickname_${e.id}`) ?? "");
      assigned.set(e.id, given);
    }
    const check = (value: string, others: string[]) => checkNickname(value, others);
    for (const e of existing) {
      if (e.nickname) continue;
      const others = [...assigned.entries()].filter(([id]) => id !== e.id).map(([, v]) => v);
      const res = check(assigned.get(e.id) ?? "", others);
      if (!res.ok) redirect(`/admin/modules?error=instances.error.nickname.${res.reason}`);
      assigned.set(e.id, res.value);
    }
    const res = check(String(formData.get("nickname") ?? ""), [...assigned.values()]);
    if (!res.ok) redirect(`/admin/modules?error=instances.error.nickname.${res.reason}`);
    nickname = res.value;
    for (const e of existing) if (!e.nickname) await prisma.moduleInstance.update({ where: { id: e.id }, data: { nickname: assigned.get(e.id) } });
  }

  const created = await createInstance(prisma, { manifest: mod.manifest, nickname, names: nickname ? defaultNames(mod.manifest, config.locales, nickname) : defaultNames(mod.manifest, config.locales) });
  await audit(user.email, "instance.create", created.key);
  revalidatePath("/", "layout");
  redirect(`/admin/instances/${created.id}`);
}
