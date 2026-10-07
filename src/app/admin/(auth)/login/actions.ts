"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getAdminTranslator } from "@/core/i18n/request";
import type { ActionState } from "@/components/admin/ActionForm";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getAdminTranslator();
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/admin",
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: t("login.invalid") };
    throw error; // la redirection de signIn est une exception à laisser passer
  }
  return null;
}
