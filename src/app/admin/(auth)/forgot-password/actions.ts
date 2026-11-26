"use server";

import { headers } from "next/headers";
import { clientIp } from "@/core/auth/clientIp";
import { requestPasswordReset } from "@/core/auth/passwordReset";
import { isMailConfigured } from "@/core/services/mail";
import { siteUrl } from "@/core/config";
import { getAdminTranslator } from "@/core/i18n/request";
import type { ActionState } from "@/components/admin/ActionForm";

/** Public. The answer is the same sentence for every address (an account, none, suspended, the owner's), and takes the same time. */
export async function askLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getAdminTranslator();
  const h = await headers();
  const mailConfigured = await isMailConfigured().catch(() => false);
  await requestPasswordReset({ email: formData.get("email"), ip: clientIp((n) => h.get(n)), origin: siteUrl, mailConfigured });
  return { ok: t("forgot.sent") };
}
