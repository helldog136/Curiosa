"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { clientIp } from "@/core/auth/clientIp";
import { checkLogin, formatUntil, recordFailure, recordSuccess } from "@/core/auth/lockout";
import { verifyPassword } from "@/core/auth/password";
import { currentRelying } from "@/core/auth/relying";
import { finishLogin, startLogin } from "@/core/auth/passkeys";
import { passwordBinding, peekToken, readToken, signToken, verifySecondFactor } from "@/core/auth/twoFactor";
import { prisma } from "@/core/db";
import { getAdminTranslator } from "@/core/i18n/request";
import { audit } from "@/core/permissions";

/** `step: "code"` : le mot de passe est bon, on attend le code de la double vérification (`token` prouve l'étape 1, valable 5 minutes). */
export type LoginState = { error?: string; step?: "code"; token?: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t, locale } = await getAdminTranslator();
  const h = await headers();
  const ip = clientIp((name) => h.get(name));
  // Trop d'essais : on le dit tout de suite, avec l'heure à laquelle on peut revenir (jamais un blocage définitif).
  const blocked = async (email: string): Promise<LoginState> => {
    const lock = await checkLogin(ip, email);
    return lock.locked ? { error: t("login.locked", { time: formatUntil(lock.until, locale) }) } : null;
  };
  // Dernière étape, commune : tout est vérifié, la session est créée au moyen d'un billet signé de 60 secondes.
  const open = async (userId: string): Promise<LoginState> => {
    try {
      await signIn("credentials", { ticket: signToken("ticket", userId), redirectTo: "/admin" });
    } catch (error) {
      if (error instanceof AuthError) return { error: t("login.invalid") };
      throw error; // la redirection de signIn est une exception à laisser passer
    }
    return null;
  };

  const token = String(formData.get("token") ?? "");
  if (token) {
    // Étape 2 : le code de l'application (ou un code de secours).
    const uid = peekToken(token);
    const user = uid ? await prisma.user.findUnique({ where: { id: uid } }) : null;
    if (!user || !readToken("pwd", token, passwordBinding(user.passwordHash))) return { error: t("login.expired") };
    const before = await blocked(user.email);
    if (before) return before;
    const second = await verifySecondFactor(user.id, String(formData.get("code") ?? ""));
    if (!second.ok) {
      await recordFailure(ip, user.email);
      return (await blocked(user.email)) ?? { step: "code", token, error: t("login.codeInvalid") };
    }
    await recordSuccess(ip, user.id, user.email);
    await audit(user.email, second.kind === "recovery" ? "login.recovery" : "login", ip);
    return open(user.id);
  }

  // Étape 1 : e-mail et mot de passe.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const before = await blocked(email);
  if (before) return before;
  const user = await verifyPassword(email, String(formData.get("password") ?? ""));
  if (!user) {
    await recordFailure(ip, email);
    return (await blocked(email)) ?? { error: t("login.invalid") };
  }
  if (user.totpEnabledAt) return { step: "code", token: signToken("pwd", user.id, passwordBinding(user.passwordHash)) };
  await recordSuccess(ip, user.id, user.email);
  await audit(user.email, "login", ip);
  return open(user.id);
}

/* ───────────── Connexion avec une clé d'accès ───────────── */

export type PasskeyLoginStart = { options?: Record<string, unknown>; challengeId?: string; error?: string };

export async function passkeyLoginStart(): Promise<PasskeyLoginStart> {
  const started = await startLogin(await currentRelying());
  return { options: started.options as unknown as Record<string, unknown>, challengeId: started.challengeId };
}

/** La clé d'accès a signé le défi : c'est le mot de passe ET le deuxième facteur à la fois (la vérification de l'utilisateur est exigée). */
export async function passkeyLoginFinish(challengeId: string, response: Record<string, unknown>): Promise<{ error?: string }> {
  const { t, locale } = await getAdminTranslator();
  const h = await headers();
  const ip = clientIp((name) => h.get(name));
  const lock = await checkLogin(ip, "");
  if (lock.locked) return { error: t("login.locked", { time: formatUntil(lock.until, locale) }) };
  const found = await finishLogin(String(challengeId ?? ""), response as never, await currentRelying());
  if (!found) {
    await recordFailure(ip, "");
    const again = await checkLogin(ip, "");
    return { error: again.locked ? t("login.locked", { time: formatUntil(again.until, locale) }) : t("login.passkeyInvalid") };
  }
  await recordSuccess(ip, found.userId, found.email);
  await audit(found.email, "login.passkey", ip);
  try {
    await signIn("credentials", { ticket: signToken("ticket", found.userId), redirectTo: "/admin" });
  } catch (error) {
    if (error instanceof AuthError) return { error: t("login.invalid") };
    throw error;
  }
  return {};
}
