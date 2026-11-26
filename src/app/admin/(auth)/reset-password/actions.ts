"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { LOGIN_HREF } from "@/core/adminLinks";
import { clientIp } from "@/core/auth/clientIp";
import { completePasswordReset, peekReset } from "@/core/auth/passwordReset";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { getAdminTranslator } from "@/core/i18n/request";
import type { ActionState } from "@/components/admin/ActionForm";

export async function peekLinkAction(token: string): Promise<{ ok: boolean; rate?: boolean }> {
  const h = await headers();
  const r = await peekReset(token, clientIp((n) => h.get(n)));
  return r === "rate" ? { ok: false, rate: true } : { ok: r === true };
}

/** Public. The token is read from the request body only. Success goes to the sign-in page (no automatic sign-in: the second factor, if any, is asked as usual). */
export async function saveNewPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getAdminTranslator();
  const h = await headers();
  const r = await completePasswordReset({ token: formData.get("token"), password: formData.get("password"), confirm: formData.get("confirm"), ip: clientIp((n) => h.get(n)) });
  if (!r.ok) {
    if (r.reason === "password") return { errors: { password: t("invite.accept.passwordError", { n: MIN_PASSWORD_LENGTH }) } };
    if (r.reason === "mismatch") return { errors: { confirm: t("invite.accept.mismatch") } };
    return { error: t(r.reason === "rate" ? "invite.accept.rate" : "reset.invalid") };
  }
  redirect(`${LOGIN_HREF}?changed=1`);
}
