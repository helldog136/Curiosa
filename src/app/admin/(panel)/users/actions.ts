"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { createMember, deleteMember, resetMemberTwoFactor, revokeMemberSessions, unlockMember, type MemberFailure } from "@/core/auth/members";
import { resetMemberPassword } from "@/core/auth/teamPassword";
import { getSetting, setSetting } from "@/core/settings";
import { audit } from "@/core/permissions";
import { createRole, deleteRole, setUserRoles, updateRole, type RoleFailure } from "@/core/auth/roles";
import type { ActionState } from "@/components/admin/ActionForm";

/** Où s'affiche l'erreur d'un compte : SOUS le champ concerné (avec un exemple), sauf refus général. */
const memberErrors = (reason: MemberFailure, t: (key: string) => string): ActionState => {
  if (reason === "password") return { errors: { password: t("setup.error.password") } };
  if (reason === "exists") return { errors: { email: t("users.exists") } };
  if (reason === "invalid") return { errors: { email: t("users.error.invalid") } };
  if (reason === "level") return { errors: { role: t("users.error.level") } };
  return { error: t("error.denied") };
};

/**
 * Nouveau compte. Les règles (qui peut attribuer quel niveau) sont dans `core/auth/members.ts` et `team.ts`, qui relisent l'acteur en base : seul le texte du
 * formulaire vient du navigateur. Un administrateur n'invite que des éditeurs ; un coordinateur, des administrateurs et des éditeurs ; le propriétaire seul nomme un coordinateur.
 */
export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const r = await createMember(user.id, { name: formData.get("name"), email: formData.get("email"), password: formData.get("password"), role: formData.get("role") });
  if (!r.ok) return memberErrors(r.reason, t);
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

/**
 * Les rôles d'une personne (puces cumulables). Droit `core:team` ; toutes les règles (propriétaire intouchable, coordinateur modifiable par le propriétaire seul, au moins un rôle,
 * `owner` jamais affecté, anti-élévation, identifiant forgé refusé) sont dans `core/auth/roles.ts`, qui relit l'acteur en base : seul l'identifiant de la cible vient de la page.
 */
export async function setUserRolesAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:team" });
  const r = await setUserRoles(user.id, String(id ?? ""), formData.getAll("roleId").map(String));
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

const roleError = (reason: RoleFailure): string => `roles.error.${reason}`;
const rightsOf = (formData: FormData) => formData.getAll("right").map(String);

/** Nouveau rôle personnalisé (propriétaire seulement ; droits revérifiés côté serveur : aucun droit réservé, inconnu, ou que l'acteur n'a pas). */
export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await createRole(user.id, { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("roles.created") };
}

export async function updateRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await updateRole(user.id, String(id ?? ""), { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("action.saved") };
}

/** Supprime un rôle personnalisé ; s'il est en usage, ses membres reçoivent le rôle choisi (`replacement`). */
export async function deleteRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await deleteRole(user.id, String(id ?? ""), String(formData.get("replacement") ?? "") || null);
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath("/admin/users");
  return { ok: t("roles.deleted") };
}

/** Supprime un compte (règles dans `core/auth/members.ts` : propriétaire intouchable, coordinateur par le propriétaire seul, administrateur : éditeurs seulement). */
export async function deleteUser(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const r = await deleteMember(user.id, String(id ?? ""));
  if (r.ok) revalidatePath("/admin/users");
}

/** Débloque quelqu'un qui a trop essayé de se connecter (son e-mail redevient libre tout de suite). Droit `core:team`. */
export async function unlockUser(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await unlockMember(user.id, String(id ?? ""))).ok) revalidatePath("/admin/users");
}

/** Coupe toutes les sessions ouvertes de quelqu'un (appareil perdu, compte douteux). Droit `core:team`. */
export async function revokeUserSessions(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await revokeMemberSessions(user.id, String(id ?? ""))).ok) revalidatePath("/admin/users");
}

/** Réinitialise la double vérification ET les clés d'accès de quelqu'un qui a perdu son téléphone et ses codes de secours (ses sessions ouvertes sont coupées). Droit `core:team`. */
export async function resetUserTwoFactor(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await resetMemberTwoFactor(user.id, String(id ?? ""))).ok) revalidatePath("/admin/users");
}

/** Exiger la double vérification de toute l'équipe — seulement si le propriétaire l'a lui-même activée (sinon il s'enfermerait dehors). */
export async function setRequireTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:security" });
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
 * Le propriétaire (ou le coordinateur technique) fixe un mot de passe temporaire à un membre de l'équipe (généré par le site, ou choisi par lui). Les règles sont dans `core/auth/teamPassword.ts` ;
 * le droit est vérifié ici (`adminCtx({ right: "core:team" })`) ET relu en base là-bas. Les arguments arrivent dans le corps de la requête, jamais dans l'adresse.
 */
export async function setTemporaryPassword(id: string, mode: string, password?: string): Promise<TemporaryPasswordState> {
  const { user, t } = await adminCtx({ right: "core:team" });
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
