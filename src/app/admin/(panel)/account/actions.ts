"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { isKnownLocale } from "@/core/i18n/locales";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor");
  const name = String(formData.get("name") ?? "").trim();
  const locale = String(formData.get("locale") ?? "");
  if (!name || (locale && !isKnownLocale(locale))) return { error: t("error.generic") };
  await prisma.user.update({ where: { id: user.id }, data: { name, locale: locale || null } });
  revalidatePath("/admin", "layout");
  return { ok: t("action.saved") };
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor");
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) return { error: t("account.wrongPassword") };
  if (next.length < 10) return { error: t("setup.error.password") };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  await audit(user.email, "user.password");
  return { ok: t("action.saved") };
}
