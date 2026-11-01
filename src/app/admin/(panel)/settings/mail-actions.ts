"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { getMailConfig, saveMailConfig, sendMail } from "@/core/services/mail";
import type { ActionState } from "@/components/admin/ActionForm";

const FROM_RE = /^(?:[^<>@\r\n]*<)?[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+>?$/;

export async function saveMail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const host = str("mailHost");
  const from = str("mailFrom");
  if (!host || /[\s/]/.test(host) || !FROM_RE.test(from)) return { error: t("settings.mailInvalid") };
  await saveMailConfig({
    host,
    port: Number(str("mailPort")) || 587,
    secure: formData.get("mailSecure") === "on",
    user: str("mailUser"),
    pass: String(formData.get("mailPass") ?? ""),
    from,
  });
  await audit(user.email, "settings.mail");
  revalidatePath("/admin/settings");
  return { ok: t("action.saved") };
}

/** Envoie un e-mail de test à l'adresse de la personne connectée. */
export async function sendTestMail(): Promise<ActionState> {
  const { user, t, config } = await adminCtx("owner");
  if (!(await getMailConfig())) return { error: t("settings.mailStatusOff") };
  const result = await sendMail({ to: user.email, subject: t("settings.mailTestSubject", { site: config.name }), text: t("settings.mailTestBody") }, "core");
  return result.ok ? { ok: t("settings.mailTestOk", { email: user.email }) } : { error: t("settings.mailTestFail") };
}
