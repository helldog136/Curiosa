"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { checkForUpdate, repairRequirements, uninstallModule, updateModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import { getModule } from "@/core/modules/registry";
import { prisma } from "@/core/db";
import { createInstance, defaultNames, runInstanceCreateHook } from "@/core/instanceService";
import { checkNickname } from "@/core/instanceLabel";
import { duplicateServices, isEachService, providerInstances, setRouting } from "@/core/modules/dependencies";
import { cleanupSuggestions, forgetAuto } from "@/core/modules/autoInstalled";
import { encodeMissing } from "@/core/modules/dependencyMessages";
import type { InstallResult } from "@/core/modules/installer";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { listRetired, eraseRetired, restoreInstance } from "@/core/modules/retired";
import { noticeFor, removalNoticeHref } from "@/core/modules/removal";
import { localized } from "@/core/modules/types";

// Installer ou mettre à jour du code exécuté côté serveur est réservé au propriétaire.

/** Page d'un module (messages d'erreur, de résultat… compris) : c'est là qu'on atterrit après une action sur lui. */
const modulePage = (id: string, query = "") => `/admin/modules/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;

/** Paramètres d'adresse d'un refus : l'erreur, sa précision, et (si l'installateur a détaillé ce qui manque) ce détail pour l'afficher en clair. */
const refusal = (result: Extract<InstallResult, { ok: false }>, op = "") => {
  const missing = encodeMissing(result.missing);
  return `error=${encodeURIComponent(result.error)}${result.detail ? `&detail=${encodeURIComponent(result.detail)}` : ""}${missing ? `&missing=${encodeURIComponent(missing)}` : ""}${op ? `&op=${op}` : ""}`;
};

/** « Mettre en place ce qui manque » : les modules dont celui-ci a besoin sont installés d'office (avec leur instance). */
export async function repairModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await repairRequirements(id);
  for (const provided of result.ok ? result.provided ?? [] : []) await audit(user.email, "module.install.auto", provided);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(modulePage(id, refusal(result, "repair")));
  // Un fournisseur de plus pour un service déjà offert : l'admin doit dire qui est le maître.
  if ((await duplicateServices()).some((d) => !d.resolved)) redirect(`${EXTENSIONS_HREF}?notice=services`);
  redirect(modulePage(id));
}

/** Maître et répliques d'un service offert par plusieurs instances. */
export async function saveServiceRouting(service: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const providers = await providerInstances(service);
  if (isEachService(providers, service)) redirect(EXTENSIONS_HREF);   // chaque instance répond pour elle-même : aucun maître à choisir
  const keys = providers.map((p) => p.instance.key);
  const master = String(formData.get("master") ?? "");
  if (!keys.includes(master)) redirect(`${EXTENSIONS_HREF}?error=error.generic`);
  const replicas = formData.getAll("replicas").map(String).filter((k) => keys.includes(k) && k !== master);
  await setRouting(service, { master, replicas });
  await audit(user.email, "service.routing", service);
  revalidatePath("/", "layout");
  redirect(EXTENSIONS_HREF);
}

/** Résultat des actions de mise à jour : sans redirection, pour que le bouton montre l'animation avant d'ouvrir `href` (la page des modules, avec le résultat ou l'erreur). */
export type ModuleActionResult = { ok: boolean; href: string };

export async function checkUpdateAction(id: string): Promise<ModuleActionResult> {
  await adminCtx("owner");
  const { available, target, level } = await checkForUpdate(id);
  const params = new URLSearchParams({ update: available ? "yes" : "no", module: id });
  if (available && target) params.set("to", target);
  if (available && level) params.set("level", level);
  return { ok: true, href: modulePage(id, params.toString()) };
}

export async function updateModuleAction(id: string): Promise<ModuleActionResult> {
  const { user } = await adminCtx("owner");
  const result = await updateModule(id);
  await audit(user.email, "module.update", result.ok && result.auditTarget ? result.auditTarget : id);
  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, href: modulePage(id, refusal(result)) };   // « Il manque : … » (requires de la nouvelle version) dit quoi
  if (result.migrations?.some((m) => m.status === "failed" || m.status === "newer")) return { ok: false, href: modulePage(id, "error=modules.error.migration") };
  return { ok: true, href: modulePage(id) };
}

/** Nom lisible d'un module, à lire AVANT de le désinstaller (ensuite on ne sait plus le charger). */
async function nameOf(id: string, locale: string, defaultLocale: string): Promise<string> {
  const mod = await getModule(id).catch(() => null);
  return mod ? localized(mod.manifest.name, locale, defaultLocale) : id;
}

/** Désinstalle un module. `keepData` : « Retirer et garder mes données » (rangées, retrouvées à la réinstallation) ou « Retirer et tout effacer » (irréversible). */
export async function uninstallModuleAction(id: string, keepData: boolean): Promise<void> {
  const { user, locale, config } = await adminCtx("owner");
  const name = await nameOf(id, locale, config.defaultLocale);
  const result = await uninstallModule(id, { keepData });
  if (result.ok) await audit(user.email, keepData ? "module.uninstall.keep" : "module.uninstall.erase", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(modulePage(id, refusal(result, "uninstall")));
  redirect(removalNoticeHref(EXTENSIONS_HREF, { notice: noticeFor(keepData), name }));
}

/** Données gardées d'une instance retirée : les retrouver (le module est installé). */
export async function restoreRetiredAction(id: string): Promise<void> {
  const { user, locale, config } = await adminCtx("admin");
  const line = (await listRetired()).find((r) => r.id === id);
  if (!line) redirect(EXTENSIONS_HREF);
  const result = await restoreInstance(id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(modulePage(line.moduleId, `error=${result.reason === "single" ? "instances.error.single" : "modules.error.restore"}`));
  await audit(user.email, "instance.restore", result.key);
  redirect(removalNoticeHref(EXTENSIONS_HREF, { notice: "restored", name: await nameOf(line.moduleId, locale, config.defaultLocale) }));
}

/** Efface pour de bon des données gardées : une instance (`id`) ou tout ce qui reste d'un module (`moduleId`). */
export async function eraseRetiredAction(target: { id: string } | { moduleId: string }): Promise<void> {
  // Une instance : un administrateur, comme pour la supprimer. Tout ce qui reste d'un module : le propriétaire, comme pour le désinstaller.
  const { user } = await adminCtx("moduleId" in target ? "owner" : "admin");
  const lines = await listRetired("moduleId" in target ? target.moduleId : undefined);
  const mine = "id" in target ? lines.filter((l) => l.id === target.id) : lines;
  if (!mine.length) redirect(EXTENSIONS_HREF);
  const moduleId = mine[0]!.moduleId;
  await eraseRetired(target);
  await audit(user.email, "retired.erase", mine.map((l) => l.key).join(", ").slice(0, 200));
  revalidatePath("/", "layout");
  redirect((await getModule(moduleId).catch(() => null)) ? modulePage(moduleId) : EXTENSIONS_ADD_HREF);
}

/**
 * Nettoyage PROPOSÉ d'un module installé automatiquement dont plus personne ne dépend : jamais d'office, toujours confirmé par le propriétaire,
 * avec le même choix qu'une désinstallation : garder ses données (rangées) ou tout effacer.
 */
export async function cleanupAutoModuleAction(id: string, keepData: boolean): Promise<void> {
  const { user, locale, config } = await adminCtx("owner");
  const suggestion = (await cleanupSuggestions()).find((c) => c.id === id);
  if (!suggestion) redirect(modulePage(id, "error=modules.error.autoUsed"));
  const name = await nameOf(id, locale, config.defaultLocale);
  const result = await uninstallModule(id, { keepData });
  if (result.ok) await audit(user.email, "module.uninstall.auto", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(modulePage(id, refusal(result)));
  redirect(removalNoticeHref(EXTENSIONS_HREF, { notice: noticeFor(keepData), name }));
}

/** « Le garder » : le module n'est plus considéré comme installé automatiquement (plus de proposition de nettoyage). */
export async function keepAutoModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await forgetAuto(id);
  await audit(user.email, "module.keep.auto", id);
  revalidatePath("/", "layout");
  redirect(modulePage(id));
}

/**
 * Ajoute une instance d'un module avec ses réglages par défaut. La première n'a besoin d'aucun surnom ; dès la
 * deuxième, il faut pouvoir les distinguer : on demande un surnom pour la nouvelle (et pour l'existante, si elle
 * n'en a pas encore). L'identifiant technique en est dérivé (« Chaîne 2 » → chaine-2).
 */
export async function addInstance(moduleId: string, formData: FormData): Promise<void> {
  const { user, config } = await adminCtx("admin");
  const mod = await getModule(moduleId);
  if (!mod) redirect(modulePage(moduleId, "error=modules.error.load"));
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId } });
  if (mod.manifest.instances === "single" && existing.length > 0) redirect(modulePage(moduleId, "error=instances.error.single"));

  let nickname: string | undefined;
  if (existing.length > 0) {
    // Surnoms déjà pris + ceux qu'on s'apprête à attribuer aux instances qui n'en ont pas.
    const assigned = new Map<string, string>();
    for (const e of existing) {
      const given = e.nickname ?? String(formData.get(`nickname_${e.id}`) ?? "");
      assigned.set(e.id, given);
    }
    const check = (value: string, others: string[]) => checkNickname(value, others);
    for (const e of existing) {
      if (e.nickname) continue;
      const others = [...assigned.entries()].filter(([id]) => id !== e.id).map(([, v]) => v);
      const res = check(assigned.get(e.id) ?? "", others);
      if (!res.ok) redirect(modulePage(moduleId, `error=instances.error.nickname.${res.reason}`));
      assigned.set(e.id, res.value);
    }
    const res = check(String(formData.get("nickname") ?? ""), [...assigned.values()]);
    if (!res.ok) redirect(modulePage(moduleId, `error=instances.error.nickname.${res.reason}`));
    nickname = res.value;
    for (const e of existing) if (!e.nickname) await prisma.moduleInstance.update({ where: { id: e.id }, data: { nickname: assigned.get(e.id) } });
  }

  const created = await createInstance(prisma, { manifest: mod.manifest, nickname, names: nickname ? defaultNames(mod.manifest, config.locales, nickname) : defaultNames(mod.manifest, config.locales) });
  await runInstanceCreateHook(created.id);
  await audit(user.email, "instance.create", created.key);
  revalidatePath("/", "layout");
  if ((await duplicateServices()).some((d) => !d.resolved)) redirect(`${EXTENSIONS_HREF}?notice=services`);
  redirect(`/admin/instances/${created.id}`);
}
