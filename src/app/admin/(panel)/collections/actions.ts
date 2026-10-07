"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { DISPLAYS, FEATURES, type FieldDef } from "@/core/collections";
import { RESERVED_PATHS } from "@/core/config";
import { prisma } from "@/core/db";
import { isKnownLocale } from "@/core/i18n/locales";
import { audit } from "@/core/permissions";
import { getPreset, type CollectionPreset } from "@/core/presets";
import { createCollectionFromPreset } from "@/core/services";
import type { Translator } from "@/core/i18n/dictionary";
import type { ActionState } from "@/components/admin/ActionForm";

const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
const PATH_RE = /^[a-z0-9-]*$/;

async function checkPath(basePath: string, t: Translator, ignoreId?: string): Promise<string | null> {
  if (!PATH_RE.test(basePath)) return t("collections.error.path");
  if (basePath && (RESERVED_PATHS.has(basePath) || isKnownLocale(basePath))) return t("collections.error.reserved");
  const clash = await prisma.collection.findUnique({ where: { basePath } });
  if (clash && clash.id !== ignoreId) return t("collections.error.exists");
  if (basePath && (await prisma.redirect.findFirst({ where: { OR: [{ path: basePath }, { path: { startsWith: `${basePath}/` } }] } }))) {
    return t("collections.error.redirectClash");
  }
  return null;
}

export async function createCollection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const key = String(formData.get("key") ?? "").trim();
  const basePath = String(formData.get("basePath") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!KEY_RE.test(key) || !name) return { error: t("error.generic") };
  if (await prisma.collection.findUnique({ where: { key } })) return { error: t("collections.error.exists") };
  const pathError = await checkPath(basePath, t);
  if (pathError) return { error: pathError };

  const preset: CollectionPreset = getPreset(String(formData.get("preset"))) ?? {
    id: "blank", key, basePath, display: "cards", clickAction: "detail", features: ["summary", "body"],
    showInNav: true, allowGoLinks: false, names: {}, descriptions: {},
  };
  const named: CollectionPreset = { ...preset, names: { ...preset.names, [config.defaultLocale]: name } };
  const created = await createCollectionFromPreset(prisma, named, config.locales, { key, basePath });
  await audit(user.email, "collection.create", key);
  redirect(`/admin/collections/${created.id}`);
}

function parseFieldSchema(raw: string): FieldDef[] {
  const out: FieldDef[] = [];
  for (const line of raw.split("\n")) {
    const [key = "", label = "", type = "text"] = line.split("|").map((s) => s.trim());
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(key) || !label) continue;
    out.push({ key, label, type: (["text", "url", "number", "boolean"] as const).find((x) => x === type) ?? "text" });
  }
  return out.slice(0, 20);
}

export async function updateCollection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.collection.findUnique({ where: { id } });
  if (!existing) return { error: t("error.generic") };

  const basePath = String(formData.get("basePath") ?? "").trim().toLowerCase();
  const pathError = await checkPath(basePath, t, id);
  if (pathError) return { error: pathError };

  const display = String(formData.get("display"));
  if (!(DISPLAYS as readonly string[]).includes(display)) return { error: t("error.generic") };
  const features = FEATURES.filter((f) => formData.get(`feature_${f}`) === "on");
  const nav = Number(formData.get("navOrder"));

  await prisma.collection.update({
    where: { id },
    data: {
      basePath,
      display,
      clickAction: formData.get("clickAction") === "external" ? "external" : "detail",
      features: JSON.stringify(features),
      fieldSchema: JSON.stringify(parseFieldSchema(String(formData.get("fieldSchema") ?? ""))),
      showInNav: formData.get("showInNav") === "on",
      navOrder: Number.isFinite(nav) ? Math.trunc(nav) : 0,
      published: formData.get("published") === "on",
      fallbackToDefault: formData.get("fallbackToDefault") === "on",
      allowGoLinks: formData.get("allowGoLinks") === "on",
    },
  });

  for (const locale of config.locales) {
    const name = String(formData.get(`name_${locale}`) ?? "").trim();
    const description = String(formData.get(`description_${locale}`) ?? "").trim();
    if (!name) {
      // Un nom vide = pas de version dans cette langue (sauf la langue par défaut, obligatoire).
      if (locale === config.defaultLocale) return { error: t("collections.error.name") };
      await prisma.collectionTranslation.deleteMany({ where: { collectionId: id, locale } });
      continue;
    }
    await prisma.collectionTranslation.upsert({
      where: { collectionId_locale: { collectionId: id, locale } },
      create: { collectionId: id, locale, name, description },
      update: { name, description },
    });
  }
  await audit(user.email, "collection.update", existing.key);
  return { ok: t("action.saved") };
}

export async function deleteCollection(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const c = await prisma.collection.findUnique({ where: { id } });
  if (!c) return;
  await prisma.collection.delete({ where: { id } });
  await audit(user.email, "collection.delete", c.key);
  redirect("/admin/collections");
}
