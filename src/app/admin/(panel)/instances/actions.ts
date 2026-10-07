"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { DISPLAYS, FEATURES } from "@/core/instances";
import { deleteInstance, validateBasePath } from "@/core/instanceService";
import { instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { getModule } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

function parseFieldSchema(raw: string) {
  const out: { key: string; label: string; type: "text" | "url" | "number" | "boolean" }[] = [];
  for (const line of raw.split("\n")) {
    const [key = "", label = "", type = "text"] = line.split("|").map((s) => s.trim());
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(key) || !label) continue;
    out.push({ key, label, type: (["text", "url", "number", "boolean"] as const).find((x) => x === type) ?? "text" });
  }
  return out.slice(0, 20);
}

/** Réglages généraux d'une instance : noms, chemin public, menu, et — pour les modules à contenu — présentation. */
export async function saveInstance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.moduleInstance.findUnique({ where: { id } });
  const mod = existing ? await getModule(existing.moduleId) : null;
  if (!existing || !mod) return { error: t("error.generic") };

  const data: Record<string, unknown> = {
    enabled: formData.get("enabled") === "on",
    showInNav: formData.get("showInNav") === "on",
    navOrder: Math.trunc(Number(formData.get("navOrder"))) || 0,
  };

  if (hasPage(mod.manifest)) {
    const basePath = String(formData.get("basePath") ?? "").trim().toLowerCase();
    const error = await validateBasePath(basePath, id);
    if (error) return { error: t(error) };
    data.basePath = basePath;
  }

  if (mod.manifest.content) {
    const display = String(formData.get("display"));
    if (!(DISPLAYS as readonly string[]).includes(display)) return { error: t("error.generic") };
    Object.assign(data, {
      display,
      clickAction: formData.get("clickAction") === "external" ? "external" : "detail",
      features: JSON.stringify(FEATURES.filter((f) => formData.get(`feature_${f}`) === "on")),
      fieldSchema: JSON.stringify(parseFieldSchema(String(formData.get("fieldSchema") ?? ""))),
      fallbackToDefault: formData.get("fallbackToDefault") === "on",
      allowGoLinks: formData.get("allowGoLinks") === "on",
    });
  }

  for (const locale of config.locales) {
    const name = String(formData.get(`name_${locale}`) ?? "").trim();
    const description = String(formData.get(`description_${locale}`) ?? "").trim();
    if (!name) {
      if (locale === config.defaultLocale) return { error: t("instances.error.name") };
      await prisma.instanceTranslation.deleteMany({ where: { instanceId: id, locale } });
      continue;
    }
    await prisma.instanceTranslation.upsert({
      where: { instanceId_locale: { instanceId: id, locale } },
      create: { instanceId: id, locale, name, description },
      update: { name, description },
    });
  }

  await prisma.moduleInstance.update({ where: { id }, data });
  await audit(user.email, "instance.update", existing.key);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

/** Réglages déclarés par le manifeste du module, propres à cette instance. */
export async function saveInstanceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const instance = await prisma.moduleInstance.findUnique({ where: { id } });
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) return { error: t("error.generic") };

  for (const field of mod.manifest.settings) {
    const locales = field.translatable ? config.locales : [""];
    for (const locale of locales) {
      const name = field.translatable ? `s__${field.key}__${locale}` : `s__${field.key}`;
      const key = instanceSettingKey(id, field.key);
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
  await audit(user.email, "instance.settings", instance.key);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

export async function deleteInstanceAction(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const row = await prisma.moduleInstance.findUnique({ where: { id } });
  if (!row) return;
  await deleteInstance(id);
  await audit(user.email, "instance.delete", row.key);
  revalidatePath("/", "layout");
  redirect("/admin/modules");
}
