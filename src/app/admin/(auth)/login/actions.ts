"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { clientIp } from "@/core/auth/clientIp";
import { checkLogin, formatUntil } from "@/core/auth/lockout";
import { getAdminTranslator } from "@/core/i18n/request";
import type { ActionState } from "@/components/admin/ActionForm";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, locale } = await getAdminTranslator();
  const email = String(formData.get("email") ?? "");
  const h = await headers();
  const ip = clientIp((name) => h.get(name));
  // Trop d'essais : on le dit tout de suite, avec l'heure à laquelle on peut revenir (jamais un blocage définitif).
  const blocked = async () => {
    const lock = await checkLogin(ip, email);
    return lock.locked ? { error: t("login.locked", { time: formatUntil(lock.until, locale) }) } : null;
  };
  const before = await blocked();
  if (before) return before;
  try {
    await signIn("credentials", { email, password: String(formData.get("password") ?? ""), redirectTo: "/admin" });
  } catch (error) {
    if (error instanceof AuthError) return (await blocked()) ?? { error: t("login.invalid") };
    throw error; // la redirection de signIn est une exception à laisser passer
  }
  return null;
}
