"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { checkForUpdate, getUpdateCheck, setAutoUpdate, setUpdateChannel, startUpdate } from "@/core/updates/service";
import type { ActionState } from "@/components/admin/ActionForm";

/** Réservé au propriétaire : une mise à jour change le code qui tourne sur le serveur. */
export async function checkNow(): Promise<ActionState> {
  const { t } = await adminCtx("owner");
  const check = await checkForUpdate();
  revalidatePath("/admin/updates");
  if (check.error) return { error: t("updates.unreachable") };
  return { ok: check.available ? t("updates.found", { version: check.latest ?? "" }) : t("updates.upToDate") };
}

export async function applyUpdate(): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const check = await getUpdateCheck();
  if (!check.available || !check.latest) return { error: t("updates.nothingToApply") };
  const result = await startUpdate(check.latest, user.email);
  revalidatePath("/admin/updates");
  if (!result.ok) return { error: t(`updates.error.${result.error}`) };
  return { ok: t("updates.started", { version: check.latest }) };
}

export async function saveAutoUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const on = formData.get("auto") === "on";
  await setAutoUpdate(on);
  await audit(user.email, on ? "update.auto.on" : "update.auto.off");
  revalidatePath("/admin/updates");
  return { ok: t("action.saved") };
}

/** Canal « release candidates » : réservé au mode avancé, car une rc n'a pas fini d'être éprouvée. */
export async function saveChannel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, advanced } = await adminCtx("owner");
  if (!advanced) return { error: t("error.generic") };
  const rc = formData.get("rc") === "on" && formData.get("rcRisk") === "on";
  await setUpdateChannel(rc ? "rc" : "stable");
  await checkForUpdate();
  await audit(user.email, rc ? "update.channel.rc" : "update.channel.stable");
  revalidatePath("/admin/updates");
  return { ok: t("action.saved") };
}
