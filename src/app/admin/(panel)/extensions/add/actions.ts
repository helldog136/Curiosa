"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { revalidatePath } from "next/cache";
import { clearRecognizedCache } from "@/core/modules/recognized";
import { installFromCatalogue, installModule } from "@/core/modules/installer";
import { forgetModulesReport } from "@/core/modules/updateStatus";
import { addSource, clearSourcesCache, removeSource } from "@/core/modules/sources";
import { audit } from "@/core/permissions";
import { buildNames } from "@/core/modules/dependencyView";
import { describeMissingList } from "@/core/modules/dependencyMessages";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { removalNoticeHref } from "@/core/modules/removal";
import { getModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import type { ActionState } from "@/components/admin/ActionForm";
import { opIdOf, trackOperation } from "@/core/operations/run";

// Installer du code exécuté côté serveur est réservé au propriétaire.

/** Après une installation : la liste des extensions, avec « vos données ont été retrouvées » si celles d'une désinstallation précédente sont revenues. */
async function afterInstall(id: string, restored: string[] | undefined, locale: string, defaultLocale: string, user: string): Promise<string> {
  if (!restored?.length) return EXTENSIONS_HREF;
  await audit(user, "module.restore", id);
  const mod = await getModule(id).catch(() => null);
  return removalNoticeHref(EXTENSIONS_HREF, { notice: "restored", name: mod ? localized(mod.manifest.name, locale, defaultLocale) : id });
}

export async function installFromCatalogueAction(id: string): Promise<void> {
  const { user, locale, config } = await adminCtx("owner");
  const result = await installFromCatalogue(id);
  forgetModulesReport();
  if (!result.ok) redirect(`${EXTENSIONS_ADD_HREF}?error=${encodeURIComponent(result.error)}`);
  for (const provided of result.provided ?? []) await audit(user.email, "module.install.auto", provided);
  await audit(user.email, "module.install", id);
  redirect(await afterInstall(id, result.restored, locale, config.defaultLocale, user.email));
}

/** Installation depuis la fiche d'un module : sans redirection, pour que le bouton montre le téléchargement avant de passer à la page des modules. */
export async function installModuleAction(id: string, opId?: string): Promise<{ ok: true; /** Combien d'éléments gardés d'une désinstallation précédente sont revenus. */ restored: number } | { ok: false; error: string }> {
  const { user, t, locale, config } = await adminCtx("owner");
  // Suivi d'opération (téléchargement → vérification → dépendances → activation → vos réglages). Un second clic rejoint l'installation en cours.
  const run = await trackOperation(user, { kind: "install", key: `install:${String(id).slice(0, 60)}`, opId: opIdOf(opId) }, () => installFromCatalogue(id), (r) => ({ ok: r.ok, error: r.ok ? undefined : r.error }));
  if (run.busy) return { ok: false, error: t("progress.busy") };
  const result = run.result;
  forgetModulesReport();
  if (!result.ok) {
    // Un fournisseur qui n'a pas pu être mis en place : on dit lequel et pourquoi (le bouton affiche ce message).
    if (result.missing?.length) {
      const names = await buildNames(locale, config.defaultLocale);
      return { ok: false, error: describeMissingList(result.missing, t, names).join(" ") };
    }
    return { ok: false, error: t(result.error, { services: result.detail ?? "", modules: result.detail ?? "" }) };
  }
  for (const provided of result.provided ?? []) await audit(user.email, "module.install.auto", provided);
  await audit(user.email, "module.install", id);
  if (result.restored?.length) await audit(user.email, "module.restore", id);
  revalidatePath(EXTENSIONS_HREF);
  return { ok: true, restored: result.restored?.length ?? 0 };
}

/**
 * Module de l'index supplémentaire (non vérifié par le catalogue officiel) : propriétaire seulement, et seulement après avoir coché qu'il a lu l'avertissement.
 * Jamais d'office : c'est le seul chemin qui passe `confirmExtra`.
 */
export async function installExtraAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale, config } = await adminCtx("owner");
  if (formData.get("trust") !== "on") return { error: t("catalogue.trustRequired") };
  const id = String(formData.get("id") ?? "");
  const run = await trackOperation(user, { kind: "install", key: `install:${id.slice(0, 60)}`, opId: opIdOf(formData.get("_op")) }, () => installFromCatalogue(id, { confirmExtra: true }), (r) => ({ ok: r.ok, error: r.ok ? undefined : r.error }));
  if (run.busy) return { error: t("progress.busy") };
  const result = run.result;
  forgetModulesReport();
  if (!result.ok) return { error: result.missing?.length ? describeMissingList(result.missing, t, await buildNames(locale, config.defaultLocale)).join(" ") : t(result.error, { services: result.detail ?? "", modules: result.detail ?? "" }) };
  for (const provided of result.provided ?? []) await audit(user.email, "module.install.auto", provided);
  await audit(user.email, "module.install", id);
  redirect(await afterInstall(id, result.restored, locale, config.defaultLocale, user.email));
}

/** Dépôt git personnel : jamais vérifié. L'installation exige que l'utilisateur ait coché qu'il l'a compris. */
export async function installCustomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale, config } = await adminCtx("owner");
  if (formData.get("trust") !== "on") return { error: t("catalogue.trustRequired") };
  const repo = String(formData.get("repo") ?? "");
  const run = await trackOperation(user, { kind: "install", key: `install-custom:${repo.slice(0, 200)}`, opId: opIdOf(formData.get("_op")) }, () => installModule(repo), (r) => ({ ok: r.ok, error: r.ok ? undefined : r.error }));
  if (run.busy) return { error: t("progress.busy") };
  const result = run.result;
  forgetModulesReport();
  if (!result.ok) return { error: result.missing?.length ? describeMissingList(result.missing, t, await buildNames(locale, config.defaultLocale)).join(" ") : t(result.error) };
  for (const provided of result.provided ?? []) await audit(user.email, "module.install.auto", provided);
  await audit(user.email, "module.install.custom", result.id);
  redirect(await afterInstall(result.id, result.restored, locale, config.defaultLocale, user.email));
}

/** Relit tout de suite la liste des modules reconnus (sinon elle est relue au plus toutes les 15 minutes). */
export async function refreshCatalogueAction(): Promise<void> {
  await adminCtx("owner");
  clearRecognizedCache();
  revalidatePath(EXTENSIONS_ADD_HREF);
}

/** Ajoute un dépôt de modules personnel (propriétaire seulement) : il doit contenir au moins un module. */
export async function addSourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const result = await addSource(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.source.add", String(formData.get("repo") ?? "").slice(0, 200));
  revalidatePath(EXTENSIONS_ADD_HREF);
  return { ok: t("catalogue.sources.added", { count: String(result.modules.length) }) };
}

export async function removeSourceAction(url: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await removeSource(url);
  await audit(user.email, "module.source.remove", url.slice(0, 200));
  revalidatePath(EXTENSIONS_ADD_HREF);
}

/** Relit tout de suite les modules des dépôts personnels (sinon relus au plus toutes les 10 minutes). */
export async function refreshSourcesAction(): Promise<void> {
  await adminCtx("owner");
  clearSourcesCache();
  revalidatePath(EXTENSIONS_ADD_HREF);
}
