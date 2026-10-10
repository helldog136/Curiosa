"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { defaultPlacement, parsePlacement, placementSettingKey } from "@/core/modules/menuPlacement";
import { getModule } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";

/** Épingle une instance au menu ou la range dans Intégrations. Le choix est mémorisé avec l'instance ; revenir à la règle par défaut l'efface. */
export async function setPlacementAction(instanceId: string, placement: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const chosen = parsePlacement(placement);
  const instance = await prisma.moduleInstance.findUnique({ where: { id: instanceId } });
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!chosen || !instance || !mod) return;
  if (chosen === defaultPlacement(mod.manifest)) await deleteSetting(placementSettingKey(instanceId));
  else await setSetting(placementSettingKey(instanceId), chosen);
  await audit(user.email, "instance.update", instance.key);
  revalidatePath("/", "layout");
}

/** Active ou désactive une instance (l'interrupteur d'une carte Intégrations). */
export async function toggleInstanceAction(instanceId: string, enabled: boolean): Promise<void> {
  const { user } = await adminCtx("admin");
  const instance = await prisma.moduleInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return;
  await prisma.moduleInstance.update({ where: { id: instanceId }, data: { enabled } });
  await audit(user.email, "instance.update", instance.key);
  revalidatePath("/", "layout");
}
