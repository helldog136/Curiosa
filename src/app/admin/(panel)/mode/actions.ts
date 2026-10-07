"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";

/** Bascule entre l'admin simplifiée et l'admin avancée (préférence de chaque utilisateur). */
export async function setAdminMode(advanced: boolean): Promise<void> {
  const { user } = await adminCtx("editor");
  await prisma.user.update({ where: { id: user.id }, data: { advanced } });
  revalidatePath("/admin", "layout");
}
