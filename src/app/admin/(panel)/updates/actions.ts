"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { checkForUpdate, getUpdateCheck, setAutoUpdate, setUpdateChannel, startUpdate } from "@/core/updates/service";
import { getModulesReport, moduleNames, updateModules } from "@/core/modules/updateStatus";
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

/** Revérifie les modules maintenant (sans attendre la fin du délai de mémorisation). */
export async function recheckModules(): Promise<ActionState> {
  const { t } = await adminCtx("owner");
  await getModulesReport(true);
  revalidatePath("/admin/updates");
  revalidatePath("/admin/modules");
  return { ok: t("updates.modules.rechecked") };
}

/** Bilan d'une mise à jour de modules, déjà en clair (noms et raisons traduits) pour l'afficher tel quel. */
export type ModulesBilan = { updated: string[]; failed: { name: string; reason: string; migration: boolean }[]; skipped: string[]; stoppedOn: string | null; /** Sautés sans échec : le module demande un cœur plus récent (`core`). */ incompatible?: { name: string; core: string }[] };

/**
 * Met à jour des modules (ceux demandés, sinon tous ceux qui sont en retard) un par un. Réservé au propriétaire : c'est du code qui tourne sur le serveur.
 * Chaque mise à jour est inscrite au journal (« module.update »), réussie ou non, comme sur la page des modules.
 */
export async function updateModulesAction(ids?: string[]): Promise<ModulesBilan> {
  const { user, t, locale, config } = await adminCtx("owner");
  const todo = ids?.length ? ids.filter((id) => typeof id === "string") : (await getModulesReport(true)).outdated.map((o) => o.id);
  const summary = await updateModules(todo, async (id) => { await audit(user.email, "module.update", id); });
  revalidatePath("/", "layout");
  const names = await moduleNames(locale, config.defaultLocale);
  const name = (id: string) => names.get(id) ?? id;
  return {
    updated: summary.updated.map(name),
    failed: summary.failed.map((f) => ({ name: name(f.id), reason: t(f.error), migration: f.migration })),
    skipped: summary.skipped.map(name),
    stoppedOn: summary.stoppedOn ? name(summary.stoppedOn) : null,
    ...(summary.incompatible ? { incompatible: summary.incompatible.map((i) => ({ name: name(i.id), core: i.core })) } : {}),
  };
}
