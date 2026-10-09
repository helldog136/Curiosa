"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { checkForUpdate, setModuleEnabled, uninstallModule, updateModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import { getModule } from "@/core/modules/registry";
import { prisma } from "@/core/db";
import { createInstance, defaultNames, runInstanceCreateHook } from "@/core/instanceService";
import { checkNickname } from "@/core/instanceLabel";
import { duplicateServices, providerInstances, setRouting } from "@/core/modules/dependencies";

// Installer ou mettre à jour du code exécuté côté serveur est réservé au propriétaire.

/** Page d'un module (messages d'erreur, de résultat… compris) : c'est là qu'on atterrit après une action sur lui. */
const modulePage = (id: string, query = "") => `/admin/modules/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;

export async function toggleModule(id: string, enabled: boolean, formData?: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await setModuleEnabled(id, enabled);
  await audit(user.email, enabled ? "module.enable" : "module.disable", id);
  revalidatePath("/", "layout");
  // Depuis la liste (mode simple) on y reste ; depuis la page du module, on y reste aussi.
  const home = formData?.get("from") === "list" ? "/admin/modules" : modulePage(id);
  if (!result.ok) redirect(modulePage(id, `error=${encodeURIComponent(result.error)}${result.detail ? `&detail=${encodeURIComponent(result.detail)}` : ""}`));
  // Un fournisseur de plus pour un service déjà offert : l'admin doit dire qui est le maître.
  if (enabled && (await duplicateServices()).some((d) => !d.resolved)) redirect("/admin/modules?notice=services");
  redirect(home);
}

/** Maître et répliques d'un service offert par plusieurs instances. */
export async function saveServiceRouting(service: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const keys = (await providerInstances(service)).map((p) => p.instance.key);
  const master = String(formData.get("master") ?? "");
  if (!keys.includes(master)) redirect("/admin/modules?error=error.generic");
  const replicas = formData.getAll("replicas").map(String).filter((k) => keys.includes(k) && k !== master);
  await setRouting(service, { master, replicas });
  await audit(user.email, "service.routing", service);
  revalidatePath("/", "layout");
  redirect("/admin/modules");
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
  await audit(user.email, "module.update", id);
  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, href: modulePage(id, `error=${encodeURIComponent(result.error)}`) };
  if (result.migrations?.some((m) => m.status === "failed" || m.status === "newer")) return { ok: false, href: modulePage(id, "error=modules.error.migration") };
  return { ok: true, href: modulePage(id) };
}

export async function uninstallModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await uninstallModule(id);
  if (result.ok) await audit(user.email, "module.uninstall", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(modulePage(id, `error=${encodeURIComponent(result.error)}${result.detail ? `&detail=${encodeURIComponent(result.detail)}` : ""}`));
  redirect("/admin/modules");
}

/**
 * Ajoute une instance d'un module avec ses réglages par défaut. La première n'a besoin d'aucun surnom ; dès la
 * deuxième, il faut pouvoir les distinguer : on demande un surnom pour la nouvelle (et pour l'existante, si elle
 * n'en a pas encore). L'identifiant technique en est dérivé (« Chaîne 2 » → chaine-2).
 */
export async function addInstance(moduleId: string, formData: FormData): Promise<void> {
  const { user, config } = await adminCtx("admin");
  const mod = await getModule(moduleId);
  if (!mod || !mod.row.enabled) redirect(modulePage(moduleId, "error=modules.error.load"));
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
  if ((await duplicateServices()).some((d) => !d.resolved)) redirect("/admin/modules?notice=services");
  redirect(`/admin/instances/${created.id}`);
}
