"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { isKnownLocale } from "@/core/i18n/locales";
import { signOut } from "@/auth";
import { verifyPassword } from "@/core/auth/password";
import { beginEnroll, confirmEnroll, disableTwoFactor, regenerateRecoveryCodes, remainingRecoveryCodes, verifySecondFactor } from "@/core/auth/twoFactor";
import { countPasskeys, deletePasskey, finishRegistration, renamePasskey, startRegistration } from "@/core/auth/passkeys";
import { currentRelying } from "@/core/auth/relying";
import { qrSvg } from "@/core/services/qr";
import { getSetting } from "@/core/settings";
import { revokeSessions } from "@/core/auth/sessions";
import { audit } from "@/core/permissions";
import type { ActionState } from "@/components/admin/ActionForm";

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  const name = String(formData.get("name") ?? "").trim();
  const locale = String(formData.get("locale") ?? "");
  if (!name || (locale && !isKnownLocale(locale))) return { error: t("error.generic") };
  await prisma.user.update({ where: { id: user.id }, data: { name, locale: locale || null } });
  revalidatePath("/admin", "layout");
  return { ok: t("action.saved") };
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) return { error: t("account.wrongPassword") };
  if (next.length < 10) return { error: t("setup.error.password") };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  await audit(user.email, "user.password");
  // Un nouveau mot de passe coupe toutes les sessions ouvertes (la vôtre aussi : on se reconnecte avec le nouveau).
  await revokeSessions(user.id);
  await signOut({ redirectTo: "/admin/login?changed=1" });
  return { ok: t("action.saved") };
}

/** « Déconnecter tous mes appareils » : coupe toutes mes sessions ouvertes, celle-ci comprise. */
export async function signOutEverywhere(): Promise<void> {
  const { user } = await adminCtx("editor");
  await revokeSessions(user.id);
  await audit(user.email, "user.sessions.revoke");
  await signOut({ redirectTo: "/admin/login" });
}

/* ───────────── Double vérification ───────────── */

export type TwoFactorResult = { error?: string; qr?: string; secret?: string; codes?: string[]; remaining?: number };

/** Commence l'activation : une clé neuve, montrée en QR code (et en texte pour la saisir à la main). */
export async function startTwoFactor(): Promise<TwoFactorResult> {
  const { user, t, config } = await adminCtx("editor", { allowUnenrolled: true });
  const started = await beginEnroll(user.id, config.name || "Curiosa");
  if (!started) return { error: t("error.generic") };
  return { qr: await qrSvg(started.uri), secret: started.secret };
}

/** Le code saisi confirme que l'application est bien réglée : activé, et les codes de secours sont donnés (une seule fois). */
export async function confirmTwoFactor(code: string): Promise<TwoFactorResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  const r = await confirmEnroll(user.id, String(code ?? ""));
  if (!r.ok) return { error: t("account.twofa.wrongCode") };
  await audit(user.email, "user.2fa.enable");
  revalidatePath("/admin/account");
  return { codes: r.recoveryCodes, remaining: r.recoveryCodes.length };
}

/** Désactiver demande le mot de passe ET un code : une session laissée ouverte ne suffit pas. Impossible si le propriétaire l'exige de tous. */
export async function disableMyTwoFactor(password: string, code: string): Promise<TwoFactorResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  // Exigé par le propriétaire : on peut changer de facteur, pas rester sans (il faut au moins une clé d'accès pour désactiver le code).
  if ((await getSetting<boolean>("security.require2fa")) === true && (await countPasskeys(user.id)) === 0) return { error: t("account.twofa.required") };
  const ok = await verifyPassword(user.email, String(password ?? ""));
  if (!ok) return { error: t("account.wrongPassword") };
  if (!(await verifySecondFactor(user.id, String(code ?? ""))).ok) return { error: t("account.twofa.wrongCode") };
  await disableTwoFactor(user.id);
  await audit(user.email, "user.2fa.disable");
  await signOut({ redirectTo: "/admin/login" });
  return {};
}

/** De nouveaux codes de secours remplacent tous les anciens (mot de passe demandé). */
export async function regenerateMyRecoveryCodes(password: string): Promise<TwoFactorResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  if (!(await verifyPassword(user.email, String(password ?? "")))) return { error: t("account.wrongPassword") };
  const codes = await regenerateRecoveryCodes(user.id);
  if (!codes) return { error: t("error.generic") };
  await audit(user.email, "user.2fa.codes");
  return { codes, remaining: await remainingRecoveryCodes(user.id) };
}

/* ───────────── Clés d'accès ───────────── */

export type PasskeyResult = { error?: string; options?: Record<string, unknown>; challengeId?: string; ok?: boolean };

/** Ajouter une clé : le mot de passe est redemandé (une session laissée ouverte ne suffit pas). */
export async function startPasskeyRegistration(password: string): Promise<PasskeyResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  if (!(await verifyPassword(user.email, String(password ?? "")))) return { error: t("account.wrongPassword") };
  const started = await startRegistration(user.id, await currentRelying());
  if ("error" in started) return { error: started.error === "max" ? t("account.passkeys.max") : t("error.generic") };
  return { options: started.options as unknown as Record<string, unknown>, challengeId: started.challengeId };
}

export async function finishPasskeyRegistration(challengeId: string, response: Record<string, unknown>, name: string): Promise<PasskeyResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  const done = await finishRegistration(user.id, String(challengeId ?? ""), response as never, String(name ?? ""), await currentRelying());
  if (!done.ok) return { error: t("account.passkeys.failed") };
  await audit(user.email, "user.passkey.add");
  revalidatePath("/admin/account");
  return { ok: true };
}

export async function renameMyPasskey(id: string, name: string): Promise<PasskeyResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  if (!(await renamePasskey(user.id, String(id ?? ""), String(name ?? "")))) return { error: t("error.generic") };
  revalidatePath("/admin/account");
  return { ok: true };
}

/** Retirer une clé : mot de passe demandé ; impossible de retirer la dernière si le propriétaire exige la double vérification et qu'on n'a pas le code. */
export async function removeMyPasskey(id: string, password: string): Promise<PasskeyResult> {
  const { user, t } = await adminCtx("editor", { allowUnenrolled: true });
  if (!(await verifyPassword(user.email, String(password ?? "")))) return { error: t("account.wrongPassword") };
  const enforced = (await getSetting<boolean>("security.require2fa")) === true;
  if (enforced && !user.totp && (await countPasskeys(user.id)) <= 1) return { error: t("account.twofa.required") };
  if (!(await deletePasskey(user.id, String(id ?? "")))) return { error: t("error.generic") };
  await audit(user.email, "user.passkey.remove");
  revalidatePath("/admin/account");
  return { ok: true };
}
