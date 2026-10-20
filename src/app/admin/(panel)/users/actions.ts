"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { unlockEmail } from "@/core/auth/lockout";
import { revokeSessions } from "@/core/auth/sessions";
import { disableTwoFactor } from "@/core/auth/twoFactor";
import { resetMemberPassword } from "@/core/auth/teamPassword";
import { passwordProblem } from "@/core/auth/passwordPolicy";
import { getSetting, setSetting } from "@/core/settings";
import { audit } from "@/core/permissions";
import { isOwner, levelOf } from "@/core/auth/access";
import { assignInitialRole, createRole, deleteRole, setUserRoles, updateRole, type RoleFailure } from "@/core/auth/roles";
import type { ActionState } from "@/components/admin/ActionForm";

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role"));
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: t("error.generic") };
  if (passwordProblem(password)) return { error: t("setup.error.password") };
  // Seul le propriétaire crée des admins ; un admin ne crée que des éditeurs (jamais un propriétaire, jamais « none » : un rôle personnalisé s'affecte ensuite).
  if (role !== "editor" && !(role === "admin" && isOwner(user))) return { error: t("error.denied") };
  if (await prisma.user.findUnique({ where: { email } })) return { error: t("users.exists") };
  const created = await prisma.user.create({ data: { email, name, role, passwordHash: await bcrypt.hash(password, 12) } });
  await assignInitialRole(created.id);
  await audit(user.email, "user.create", email);
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

/**
 * Les rôles d'une personne (puces cumulables). Propriétaire seulement ; toutes les règles (propriétaire intouchable, au moins un rôle, `owner` jamais affecté,
 * identifiant forgé refusé) sont dans `core/auth/roles.ts`, qui relit l'acteur en base : seul l'identifiant de la cible vient de la page.
 */
export async function setUserRolesAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const r = await setUserRoles(user.id, String(id ?? ""), formData.getAll("roleId").map(String));
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

const roleError = (reason: RoleFailure): string => `roles.error.${reason}`;
const rightsOf = (formData: FormData) => formData.getAll("right").map(String);

/** Nouveau rôle personnalisé (propriétaire seulement ; droits revérifiés côté serveur : aucun droit réservé, inconnu, ou que le propriétaire n'a pas). */
export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const r = await createRole(user.id, { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("roles.created") };
}

export async function updateRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const r = await updateRole(user.id, String(id ?? ""), { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

/** Supprime un rôle personnalisé ; s'il est en usage, ses membres reçoivent le rôle choisi (`replacement`). */
export async function deleteRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const r = await deleteRole(user.id, String(id ?? ""), String(formData.get("replacement") ?? "") || null);
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("roles.deleted") };
}

export async function deleteUser(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || levelOf(target) === "owner" || target.id === user.id) return;
  // Un administrateur ne supprime qu'un éditeur (comme avant) ; un compte d'un autre niveau ou à rôle personnalisé : le propriétaire seulement.
  if (!isOwner(user) && levelOf(target) !== "editor") return;
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

/** Le propriétaire réinitialise la double vérification ET les clés d'accès de quelqu'un qui a perdu son téléphone et ses codes de secours (ses sessions ouvertes sont coupées). */
export async function resetUserTwoFactor(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.id === user.id) return;
  await disableTwoFactor(target.id);
  await prisma.passkey.deleteMany({ where: { userId: target.id } });
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

/** Ce que la boîte « mot de passe temporaire » reçoit. `password` n'est renvoyé que dans le mode « généré », cette seule fois : ni l'adresse, ni un cookie, ni la page ne le retiennent. */
export type TemporaryPasswordState = { error?: string; password?: string; mailed?: boolean; name?: string; chosen?: boolean };

/**
 * Le propriétaire fixe un mot de passe temporaire à un membre de l'équipe (généré par le site, ou choisi par lui). Les règles sont dans `core/auth/teamPassword.ts` ;
 * le rôle est vérifié ici (`adminCtx("owner")`) ET relu en base là-bas. Les arguments arrivent dans le corps de la requête, jamais dans l'adresse.
 */
export async function setTemporaryPassword(id: string, mode: string, password?: string): Promise<TemporaryPasswordState> {
  const { user, t } = await adminCtx("owner");
  const custom = mode === "custom";
  const r = await resetMemberPassword({ actorId: user.id, targetId: String(id ?? ""), mode: custom ? "custom" : "generate", password: custom ? String(password ?? "") : undefined });
  if (!r.ok) {
    const error = r.reason === "weak" ? t("users.temp.weak")
      : r.reason === "limited" ? t("users.temp.limited")
      : r.reason === "missing" ? t("users.temp.failed")
      : t("users.temp.denied");
    return { error };
  }
  revalidatePath("/admin/users");
  return { name: r.name, mailed: r.mailed, ...(r.password ? { password: r.password } : { chosen: true }) };
}
