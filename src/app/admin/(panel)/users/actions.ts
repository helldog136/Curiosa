"use server";
import { USERS_HREF } from "@/core/adminLinks";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { createMember, deleteMember, resetMemberTwoFactor, revokeMemberSessions, unlockMember, type MemberFailure } from "@/core/auth/members";
import { resetMemberPassword } from "@/core/auth/teamPassword";
import { generateTemporaryPassword } from "@/core/auth/passwordPolicy";
import { nameFromEmail } from "@/core/auth/memberName";
import { getSetting, setSetting } from "@/core/settings";
import { audit } from "@/core/permissions";
import { createRole, deleteRole, setUserRoles, updateRole, type RoleFailure } from "@/core/auth/roles";
import { createInvitation, resendInvitation, revokeInvitation, type InvitationCreated, type InviteFailure, MAX_PENDING } from "@/core/auth/invitations";
import { reactivateMember, suspendMember } from "@/core/auth/members";
import { isMailConfigured } from "@/core/services/mail";
import { siteUrl } from "@/core/config";
import type { ActionState } from "@/components/admin/ActionForm";

/** Where an account error shows: UNDER the field concerned (with an example), except for a general refusal. */
const memberErrors = (reason: MemberFailure, t: (key: string) => string): ActionState => {
  if (reason === "password") return { errors: { password: t("setup.error.password") } };
  if (reason === "exists") return { errors: { email: t("users.exists") } };
  if (reason === "invalid") return { errors: { email: t("users.error.invalid") } };
  if (reason === "level") return { errors: { role: t("users.error.level") } };
  return { error: t("error.denied") };
};

/**
 * New account WITH a first password (the older way, now under "More options" of the Team page: the default way to add a person is the invitation, `inviteAction`).
 * The rules (who may grant which level) are in `core/auth/members.ts` and `team.ts`, which re-read the actor from the database: only the text of the form comes from the browser.
 * The form asks for the e-mail and the role only: without a name, the start of the e-mail is used; without a first password, the site creates one and the person must choose their own
 * at first sign-in. That password is returned ONCE, in `secret` (never in the `ok` text, which the page keeps displayed): the database keeps only its hash.
 */
export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const typed = String(formData.get("password") ?? "");
  const generated = typed === "";
  const password = generated ? generateTemporaryPassword() : typed;
  const name = String(formData.get("name") ?? "").trim() || nameFromEmail(email);
  const r = await createMember(user.id, { name, email, password, role: formData.get("role"), mustChangePassword: generated });
  if (!r.ok) return memberErrors(r.reason, t);
  revalidatePath(USERS_HREF);
  if (!generated) return { ok: t("users.added", { name }) };
  return {
    ok: t("users.added.generated", { name }),
    secret: {
      value: password, title: t("users.secret.title", { name }),
      notes: [t("users.secret.once"), t("users.secret.mustChange", { name }), t("users.secret.handOver")],
      copy: t("users.temp.copy"), copied: t("users.temp.copied"), done: t("users.secret.done"),
    },
  };
}

/**
 * The roles of a person (stackable chips). Right `core:team`; every rule (owner untouchable, coordinator editable by the owner only, at least one role, `owner` never assigned,
 * anti-elevation, forged id refused) is in `core/auth/roles.ts`, which re-reads the actor from the database: only the target's id comes from the page.
 */
export async function setUserRolesAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:team" });
  const r = await setUserRoles(user.id, String(id ?? ""), formData.getAll("roleId").map(String));
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath(USERS_HREF);
  return { ok: t("action.saved") };
}

const roleError = (reason: RoleFailure): string => `roles.error.${reason}`;
const rightsOf = (formData: FormData) => formData.getAll("right").map(String);

/** New custom role (right `core:roles`; rights checked again on the server: none reserved, unknown, or that the actor does not hold). A preset only pre-fills this form: nothing here knows about presets. */
export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await createRole(user.id, { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath(USERS_HREF);
  return { ok: t("roles.created") };
}

export async function updateRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await updateRole(user.id, String(id ?? ""), { name: formData.get("name"), description: formData.get("description"), rights: rightsOf(formData) });
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath(USERS_HREF);
  return { ok: t("action.saved") };
}

/** Deletes a custom role; if it is in use, its members receive the chosen role (`replacement`). */
export async function deleteRoleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:roles" });
  const r = await deleteRole(user.id, String(id ?? ""), String(formData.get("replacement") ?? "") || null);
  if (!r.ok) return { error: t(roleError(r.reason)) };
  revalidatePath(USERS_HREF);
  return { ok: t("roles.deleted") };
}

/** Deletes an account (rules in `core/auth/members.ts`: owner untouchable, coordinator by the owner only, administrator: editors only). */
export async function deleteUser(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const r = await deleteMember(user.id, String(id ?? ""));
  if (r.ok) revalidatePath(USERS_HREF);
}

/** Unlocks someone who tried to sign in too often (their address is free at once). Right `core:team`. */
export async function unlockUser(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await unlockMember(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}

/** Cuts every open session of someone (lost device, doubtful account). Right `core:team`. */
export async function revokeUserSessions(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await revokeMemberSessions(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}

/** Resets the second factor AND the passkeys of someone who lost their phone and recovery codes (their open sessions are cut). Right `core:team`. */
export async function resetUserTwoFactor(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await resetMemberTwoFactor(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}

/** Require the second factor for the whole team, only if the person asking has it themselves (otherwise they would lock themselves out). */
export async function setRequireTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:security" });
  const on = formData.get("require") === "on";
  const me = await prisma.user.findUnique({ where: { id: user.id } });
  if (on && !me?.totpEnabledAt) return { error: t("users.require2faNeedsYou") };
  if (((await getSetting<boolean>("security.require2fa")) === true) !== on) {
    await setSetting("security.require2fa", on);
    await audit(user.email, on ? "security.2fa.require" : "security.2fa.optional");
  }
  revalidatePath(USERS_HREF);
  return { ok: t("action.saved") };
}

/** What the "temporary password" box receives. `password` is returned only in the "generated" mode, this one time: no address, cookie or page keeps it. */
export type TemporaryPasswordState = { error?: string; password?: string; mailed?: boolean; name?: string; chosen?: boolean };

/**
 * The owner (or a technical coordinator) sets a temporary password for a team member (generated by the site, or chosen). Rules are in `core/auth/teamPassword.ts`; the right is checked here
 * (`adminCtx({ right: "core:team" })`) AND re-read from the database there. Arguments arrive in the request body, never in the address.
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
  revalidatePath(USERS_HREF);
  return { name: r.name, mailed: r.mailed, ...(r.password ? { password: r.password } : { chosen: true }) };
}

/* ───────────── Invitations (core 0.49.0) ───────────── */

const inviteErrors = (reason: InviteFailure, t: (key: string, params?: Record<string, string | number>) => string): ActionState => {
  if (reason === "invalid") return { errors: { email: t("invite.error.email") } };
  if (reason === "exists") return { errors: { email: t("invite.error.exists") } };
  if (reason === "pending") return { errors: { email: t("invite.error.pending") } };
  if (reason === "role") return { errors: { roleId: t("invite.error.role") } };
  if (reason === "limit") return { error: t("invite.error.limit", { n: MAX_PENDING }) };
  if (reason === "rate") return { error: t("invite.error.rate") };
  if (reason === "state" || reason === "missing") return { error: t("invite.error.state") };
  return { error: t("error.denied") };
};

/** What the person who invites sees: sent, or (when no e-mail left) the link, shown ONCE, with the plain reason. */
function inviteResult(r: InvitationCreated, t: (key: string, params?: Record<string, string | number>) => string, locale: string, mailConfigured: boolean): ActionState {
  const until = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(r.expiresAt);
  if (r.mailed) return { ok: t("invite.sent", { email: r.email, until }) };
  return {
    ok: t("invite.created", { email: r.email }),
    secret: {
      value: r.link!, title: t("invite.secret.title", { email: r.email }),
      notes: [t("invite.secret.once"), t(mailConfigured ? "invite.secret.mailFailed" : "invite.secret.noMail"), t("invite.secret.until", { until })],
      copy: t("invite.copy"), copied: t("invite.copied"), done: t("invite.secret.done"),
    },
  };
}

/**
 * Invite a person: e-mail and ONE role (predefined or custom). Right `core:team`; everything (who may grant which role, address, limits) is in `core/auth/invitations.ts`, which re-reads
 * the actor from the database. The role is an id from the page, checked again there (forged id, owner role, role above the actor: refused).
 */
export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:team" });
  const mailConfigured = await isMailConfigured().catch(() => false);
  const r = await createInvitation(user.id, { email: formData.get("email"), roleId: formData.get("roleId"), ttlHours: formData.get("ttl") || undefined, origin: siteUrl, mailConfigured });
  if (!r.ok) return inviteErrors(r.reason, t);
  revalidatePath(USERS_HREF);
  return inviteResult(r, t, locale, mailConfigured);
}

/** Send an invitation again: a NEW link and a new expiry; the old link stops working at once. */
export async function resendInvitationAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:team" });
  const mailConfigured = await isMailConfigured().catch(() => false);
  const r = await resendInvitation(user.id, String(id ?? ""), { origin: siteUrl, mailConfigured, ttlHours: formData.get("ttl") || undefined });
  if (!r.ok) return inviteErrors(r.reason, t);
  revalidatePath(USERS_HREF);
  return inviteResult(r, t, locale, mailConfigured);
}

/** Withdraw an invitation: its link stops working at once. */
export async function revokeInvitationAction(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await revokeInvitation(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}

/** Suspend a person (reversible; sessions cut at once; content kept). Right `core:team`, rules in `core/auth/members.ts`. */
export async function suspendUser(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await suspendMember(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}

export async function reactivateUser(id: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:team" });
  if ((await reactivateMember(user.id, String(id ?? ""))).ok) revalidatePath(USERS_HREF);
}
