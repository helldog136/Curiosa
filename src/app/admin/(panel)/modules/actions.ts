"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { checkForUpdate, installModule, setModuleEnabled, uninstallModule, updateModule } from "@/core/modules/installer";
import { audit } from "@/core/permissions";
import { setSetting, deleteSetting } from "@/core/settings";
import { getModule } from "@/core/modules/registry";
import { moduleSettingKey } from "@/core/modules/context";
import type { ActionState } from "@/components/admin/ActionForm";

// Installer ou mettre à jour du code exécuté côté serveur est réservé au propriétaire.

export async function installModuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const result = await installModule(String(formData.get("repo") ?? ""));
  if (!result.ok) return { error: t(result.error) };
  await audit(user.email, "module.install", result.id);
  redirect(`/admin/modules/${result.id}`);
}

export async function installFromCatalogue(repo: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await installModule(repo);
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  await audit(user.email, "module.install", result.id);
  redirect(`/admin/modules/${result.id}`);
}

export async function toggleModule(id: string, enabled: boolean): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await setModuleEnabled(id, enabled);
  await audit(user.email, enabled ? "module.enable" : "module.disable", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  redirect("/admin/modules");
}

export async function checkUpdateAction(id: string): Promise<void> {
  await adminCtx("owner");
  const { available } = await checkForUpdate(id);
  redirect(`/admin/modules?update=${available ? "yes" : "no"}`);
}

export async function updateModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await updateModule(id);
  await audit(user.email, "module.update", id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(`/admin/modules?error=${encodeURIComponent(result.error)}`);
  redirect("/admin/modules");
}

export async function uninstallModuleAction(id: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await uninstallModule(id);
  await audit(user.email, "module.uninstall", id);
  revalidatePath("/", "layout");
  redirect("/admin/modules");
}

export async function saveModuleSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const mod = await getModule(id);
  if (!mod) return { error: t("error.generic") };

  for (const field of mod.manifest.settings) {
    const locales = field.translatable ? config.locales : [""];
    for (const locale of locales) {
      const name = field.translatable ? `s__${field.key}__${locale}` : `s__${field.key}`;
      const key = moduleSettingKey(id, field.key);
      if (field.type === "boolean") {
        await setSetting(key, formData.get(name) === "on", locale);
        continue;
      }
      const raw = String(formData.get(name) ?? "").trim();
      // Un secret laissé vide est conservé tel quel.
      if (field.type === "secret" && raw === "") continue;
      if (raw === "") {
        await deleteSetting(key, locale);
        continue;
      }
      if (field.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { error: t("error.generic") };
        await setSetting(key, n, locale);
      } else if (field.type === "select") {
        if (!field.options?.some((o) => o.value === raw)) return { error: t("error.generic") };
        await setSetting(key, raw, locale);
      } else if (field.type === "url") {
        if (!/^https?:\/\//i.test(raw)) return { error: t("error.badUrl") };
        await setSetting(key, raw, locale);
      } else {
        await setSetting(key, raw.slice(0, 5000), locale);
      }
    }
  }
  await audit(user.email, "module.settings", id);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

