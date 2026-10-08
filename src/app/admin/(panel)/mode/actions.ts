"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { cookies } from "next/headers";
import { prisma } from "@/core/db";
import { ADMIN_THEME_COOKIE, parseAdminTheme } from "@/core/adminTheme";

/** Bascule entre l'admin simplifiée et l'admin avancée (préférence de chaque utilisateur). */
export async function setAdminMode(advanced: boolean): Promise<void> {
  const { user } = await adminCtx("editor");
  await prisma.user.update({ where: { id: user.id }, data: { advanced } });
  revalidatePath("/admin", "layout");
}

/** Thème de l'admin : auto (suit le système), clair ou sombre. Mémorisé dans un cookie, un an. */
export async function setAdminTheme(theme: string): Promise<void> {
  await adminCtx("editor");
  (await cookies()).set(ADMIN_THEME_COOKIE, parseAdminTheme(theme), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/admin", "layout");
}
