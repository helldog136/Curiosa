"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { checkForUpdate, getUpdateCheck, setAutoUpdate, setUpdateChannel, startUpdate } from "@/core/updates/service";
import { getModulesReport, moduleNames, updateModules } from "@/core/modules/updateStatus";
import { buildNames } from "@/core/modules/dependencyView";
import { describeMissingList } from "@/core/modules/dependencyMessages";
import type { ActionState } from "@/components/admin/ActionForm";
import { opIdOf, trackOperation } from "@/core/operations/run";
import { EXTENSIONS_HREF, EXTENSIONS_UPDATES_HREF } from "@/core/modules/extensionsLinks";

/** Réservé au propriétaire : une mise à jour change le code qui tourne sur le serveur. */
export async function checkNow(): Promise<ActionState> {
  const { t } = await adminCtx({ right: "core:updates" });
  const check = await checkForUpdate();
  revalidatePath("/admin/updates");
  if (check.error) return { error: t("updates.unreachable") };
  return { ok: check.available ? t("updates.found", { version: check.latest ?? "" }) : t("updates.upToDate") };
}

export async function applyUpdate(): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:updates" });
  const check = await getUpdateCheck();
  if (!check.available || !check.latest) return { error: t("updates.nothingToApply") };
  const result = await startUpdate(check.latest, user.email);
  revalidatePath("/admin/updates");
  if (!result.ok) return { error: t(`updates.error.${result.error}`) };
  return { ok: t("updates.started", { version: check.latest }) };
}

export async function saveAutoUpdate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:updates" });
  const on = formData.get("auto") === "on";
  await setAutoUpdate(on);
  await audit(user.email, on ? "update.auto.on" : "update.auto.off");
  revalidatePath("/admin/updates");
  return { ok: t("action.saved") };
}

/** Canal « release candidates » : réservé au mode avancé, car une rc n'a pas fini d'être éprouvée. */
export async function saveChannel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, advanced } = await adminCtx({ right: "core:updates" });
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
  const { t } = await adminCtx({ right: "core:updates" });
  await getModulesReport(true);
  revalidatePath("/admin/updates");
  revalidatePath(EXTENSIONS_HREF);
  revalidatePath(EXTENSIONS_UPDATES_HREF);
  return { ok: t("updates.modules.rechecked") };
}

/** Bilan d'une mise à jour de modules, déjà en clair (noms et raisons traduits) pour l'afficher tel quel. */
export type ModulesBilan = { /** Rien n'a été lancé : une autre mise à jour est déjà en cours et trop longue à attendre. */ busy?: boolean; updated: string[]; failed: { name: string; reason: string; migration: boolean }[]; skipped: string[]; stoppedOn: string | null; /** Sautés sans échec : le module demande un cœur plus récent (`core`). */ incompatible?: { name: string; core: string }[]; /** Mis à jour, mais il manque encore un module pour fonctionner (texte déjà en clair). */ warnings?: { name: string; list: string }[]; /** Modules installés d'office pour eux. */ provided?: string[] };

/**
 * Met à jour des modules (ceux demandés, sinon tous ceux qui sont en retard) un par un. Réservé au propriétaire : c'est du code qui tourne sur le serveur.
 * Chaque mise à jour est inscrite au journal (« module.update »), réussie ou non, comme sur la page des modules.
 */
export async function updateModulesAction(ids?: string[], opId?: string): Promise<ModulesBilan> {
  const { user, t, locale, config } = await adminCtx({ right: "core:updates" });
  const todo = ids?.length ? ids.filter((id) => typeof id === "string").slice(0, 200) : (await getModulesReport(true)).outdated.map((o) => o.id);
  const names = await moduleNames(locale, config.defaultLocale);
  // Suivi d'opération : « module N sur M » avec le nom du module en cours. Un second lancement (autre onglet, double clic) rejoint celui-ci et en rend le bilan.
  const run = await trackOperation(user, { kind: ids?.length === 1 ? "module-update" : "modules-update", key: ids?.length ? `modules-update:${[...todo].sort().join(",").slice(0, 300)}` : "modules-update:all", opId: opIdOf(opId), unitTotal: todo.length },
    () => updateModules(todo, async (id, _ok, result) => { await audit(user.email, "module.update", result.ok && result.auditTarget ? result.auditTarget : id); }, (id) => names.get(id) ?? id),
    (s) => ({ ok: s.failed.length === 0, error: s.failed.length ? "modules-failed" : undefined }));
  if (run.busy) return { updated: [], failed: [], skipped: [], stoppedOn: null, busy: true };
  const summary = run.result;
  revalidatePath("/", "layout");
  const name = (id: string) => names.get(id) ?? id;
  const readable = summary.warnings?.length || summary.provided?.length ? await buildNames(locale, config.defaultLocale) : null;
  return {
    updated: summary.updated.map(name),
    failed: summary.failed.map((f) => ({ name: name(f.id), reason: t(f.error, { services: f.detail ?? "", modules: f.detail ?? "" }), migration: f.migration })),
    skipped: summary.skipped.map(name),
    stoppedOn: summary.stoppedOn ? name(summary.stoppedOn) : null,
    ...(readable && summary.warnings?.length ? { warnings: summary.warnings.map((w) => ({ name: name(w.id), list: describeMissingList(w.missing, t, readable).join(" ") })) } : {}),
    ...(readable && summary.provided?.length ? { provided: summary.provided.map(readable.module) } : {}),
    ...(summary.incompatible ? { incompatible: summary.incompatible.map((i) => ({ name: name(i.id), core: i.core })) } : {}),
  };
}
