"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { ADMIN_HREF } from "@/core/adminLinks";
import { acceptInvitation, peekInvitation } from "@/core/auth/invitations";
import { clientIp } from "@/core/auth/clientIp";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { signToken } from "@/core/auth/twoFactor";
import { getAdminTranslator } from "@/core/i18n/request";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Public. Reads the token only from the body of the request (never the address). Every refusal of the link itself is the same sentence: it never says whether an address has an account,
 * or whether the link was used, expired or withdrawn.
 */
export async function peekInvitationAction(token: string): Promise<{ ok: true; email: string; role: string } | { ok: false; reason: "invalid" | "rate" }> {
  const { t } = await getAdminTranslator();
  const h = await headers();
  const r = await peekInvitation(token, clientIp((n) => h.get(n)));
  if (!r.ok) return r;
  return { ok: true, email: r.email, role: r.customName || t(`role.${r.roleKey}`) };
}

export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getAdminTranslator();
  const h = await headers();
  const r = await acceptInvitation({ token: formData.get("token"), name: formData.get("name"), password: formData.get("password"), confirm: formData.get("confirm"), ip: clientIp((n) => h.get(n)) });
  if (!r.ok) {
    if (r.reason === "name") return { errors: { name: t("invite.accept.nameError") } };
    if (r.reason === "password") return { errors: { password: t("invite.accept.passwordError", { n: MIN_PASSWORD_LENGTH }) } };
    if (r.reason === "mismatch") return { errors: { confirm: t("invite.accept.mismatch") } };
    return { error: t(r.reason === "rate" ? "invite.accept.rate" : "invite.accept.invalid") };
  }
  // Signed in at once with a short signed ticket, like every other sign-in. If the team requires the second factor, the access gate sends the person to set it up first:
  // nothing of the administration opens before that.
  try {
    await signIn("credentials", { ticket: signToken("ticket", r.userId), redirectTo: ADMIN_HREF });
  } catch (error) {
    if (error instanceof AuthError) return { error: t("invite.accept.invalid") };
    throw error;
  }
  return null;
}
