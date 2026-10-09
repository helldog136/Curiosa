"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { unlockEmail } from "@/core/auth/lockout";
import { revokeSessions } from "@/core/auth/sessions";
import { disableTwoFactor } from "@/core/auth/twoFactor";
import { getSetting, setSetting } from "@/core/settings";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role"));
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: t("error.generic") };
  if (password.length < 10) return { error: t("setup.error.password") };
  // Seul le propriétaire crée des admins ; un admin ne crée que des éditeurs.
  if (role !== "editor" && !(role === "admin" && user.role === "owner")) return { error: t("error.denied") };
  if (await prisma.user.findUnique({ where: { email } })) return { error: t("users.exists") };
  await prisma.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(password, 12) } });
  await audit(user.email, "user.create", email);
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

export async function setUserRole(id: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const role = String(formData.get("role"));
  if (!["admin", "editor"].includes(role)) return;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.role === "owner") return;
  await prisma.user.update({ where: { id }, data: { role } });
  await audit(user.email, "user.role", `${target.email}:${role}`);
  revalidatePath("/admin/users");
}

export async function deleteUser(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.role === "owner" || target.id === user.id) return;
  if (target.role === "admin" && user.role !== "owner") return;
  await prisma.user.delete({ where: { id } });
  await audit(user.email, "user.delete", target.email);
  revalidatePath("/admin/users");
}

/** Le propriétaire débloque quelqu'un qui a trop essayé de se connecter (son e-mail redevient libre tout de suite). */
export async function unlockUser(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;
  await unlockEmail(target.email);
  await audit(user.email, "user.unlock", target.email);
  revalidatePath("/admin/users");
}

/** Le propriétaire coupe toutes les sessions ouvertes de quelqu'un (appareil perdu, compte douteux). */
export async function revokeUserSessions(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.id === user.id) return;
  await revokeSessions(target.id);
  await audit(user.email, "user.sessions.revoke", target.email);
  revalidatePath("/admin/users");
}

/** Le propriétaire réinitialise la double vérification de quelqu'un qui a perdu son téléphone et ses codes de secours (ses sessions ouvertes sont coupées). */
export async function resetUserTwoFactor(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.id === user.id || !target.totpEnabledAt) return;
  await disableTwoFactor(target.id);
  await audit(user.email, "user.2fa.reset", target.email);
  revalidatePath("/admin/users");
}

/** Exiger la double vérification de toute l'équipe — seulement si le propriétaire l'a lui-même activée (sinon il s'enfermerait dehors). */
export async function setRequireTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const on = formData.get("require") === "on";
  const me = await prisma.user.findUnique({ where: { id: user.id } });
  if (on && !me?.totpEnabledAt) return { error: t("users.require2faNeedsYou") };
  if (((await getSetting<boolean>("security.require2fa")) === true) !== on) {
    await setSetting("security.require2fa", on);
    await audit(user.email, on ? "security.2fa.require" : "security.2fa.optional");
  }
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}
