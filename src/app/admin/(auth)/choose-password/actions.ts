"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { chooseOwnPassword } from "@/core/auth/teamPassword";
import { signToken } from "@/core/auth/twoFactor";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * « Choisissez votre mot de passe » : la seule action permise à une session dont le mot de passe est temporaire (`allowForced`).
 * La personne est déjà authentifiée : le mot de passe temporaire n'est pas redemandé. Le mot de passe n'est ni journalisé ni renvoyé.
 */
export async function choosePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor", { allowForced: true, allowUnenrolled: true });
  // Déjà fait (autre onglet, lien direct) : rien à choisir, on va au tableau de bord.
  if (!user.mustChangePassword) redirect("/admin");
  const r = await chooseOwnPassword(user.id, String(formData.get("next") ?? ""), String(formData.get("confirm") ?? ""));
  if (!r.ok) {
    if (r.reason === "notRequired") redirect("/admin");
    return { error: r.reason === "weak" ? t("choosePassword.weak") : r.reason === "mismatch" ? t("choosePassword.mismatch") : t("choosePassword.same") };
  }
  // Les AUTRES sessions sont coupées (numéro de session augmenté) ; celle-ci est remplacée par une session neuve au bon numéro, sans redemander quoi que ce soit.
  try {
    await signIn("credentials", { ticket: signToken("ticket", user.id), redirectTo: "/admin" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/admin/login?changed=1");
    throw error; // la redirection de signIn est une exception à laisser passer
  }
  return null;
}

/** Se déconnecter reste toujours possible, même avec un mot de passe temporaire à remplacer (aucun droit particulier nécessaire pour fermer sa propre session). */
export async function signOutForced(): Promise<void> {
  await signOut({ redirectTo: "/admin/login" });
}
