"use server";

import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { getInstanceById } from "@/core/instances";
import { prisma } from "@/core/db";
import { uniqueSlug } from "@/core/entries";
import { audit } from "@/core/permissions";
import { slugify } from "@/core/slug";
import { isSafeExternalUrl } from "@/core/url";
import type { ActionState } from "@/components/admin/ActionForm";

const opt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function saveEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("editor");
  const id = String(formData.get("id") ?? "");
  const collection = await getInstanceById(String(formData.get("instanceId") ?? ""));
  const locale = String(formData.getAll("locale").at(-1) ?? "");
  if (!collection || !config.locales.includes(locale)) return { error: t("error.generic") };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: t("error.titleRequired") };

  const url = opt(formData.get("url"));
  if (url && !isSafeExternalUrl(url)) return { error: t("error.badUrl") };
  const cover = opt(formData.get("cover"));
  if (cover && !(cover.startsWith("/uploads/") || cover.startsWith("https://") || cover.startsWith("http://"))) {
    return { error: t("error.badUrl") };
  }
  const icon = opt(formData.get("icon"))?.slice(0, 40) ?? null;
  const code = opt(formData.get("code"))?.slice(0, 200) ?? null;

  const date = (k: string) => {
    const v = opt(formData.get(k));
    const d = v ? new Date(`${v}T00:00:00Z`) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const status = formData.get("status") === "published" ? "published" : "draft";

  const fields: Record<string, unknown> = {};
  for (const f of collection.fieldSchema) {
    const raw = formData.get(`field_${f.key}`);
    if (f.type === "boolean") fields[f.key] = raw === "on";
    else if (raw !== null && String(raw).trim() !== "") fields[f.key] = f.type === "number" ? Number(raw) : String(raw).trim().slice(0, 2000);
  }

  const shared = {
    status,
    cover,
    icon,
    url,
    code,
    featured: formData.get("featured") === "on",
    expiresAt: date("expiresAt"),
    fields: JSON.stringify(fields),
  };
  const text = {
    title,
    summary: String(formData.get("summary") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim(),
  };
  const wantedSlug = slugify(String(formData.get("slug") ?? "") || title);

  let entryId = id;
  if (id) {
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry || entry.instanceId !== collection.id) return { error: t("error.generic") };
    // La date de publication saisie prime ; sinon on garde l'existante, ou on pose "maintenant" à la première publication.
    const publishedAt = date("publishedAt") ?? entry.publishedAt ?? (status === "published" ? new Date() : null);
    await prisma.entry.update({ where: { id }, data: { ...shared, publishedAt } });
  } else {
    const created = await prisma.entry.create({
      data: { ...shared, instanceId: collection.id, sourceLocale: locale, authorId: user.id, publishedAt: date("publishedAt") ?? (status === "published" ? new Date() : null) },
    });
    entryId = created.id;
  }

  const slug = await uniqueSlug(prisma, collection.id, locale, wantedSlug, entryId);
  await prisma.entryTranslation.upsert({
    where: { entryId_locale: { entryId, locale } },
    create: { entryId, instanceId: collection.id, locale, slug, ...text },
    update: { slug, ...text },
  });

  await audit(user.email, id ? "entry.update" : "entry.create", `${collection.key}/${slug}`);
  if (!id) redirect(`/admin/entries/${entryId}?locale=${locale}`);
  return { ok: t("action.saved") };
}

export async function deleteTranslation(entryId: string, locale: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const count = await prisma.entryTranslation.count({ where: { entryId } });
  if (count < 2) return; // on ne laisse jamais une entrée sans texte
  await prisma.entryTranslation.deleteMany({ where: { entryId, locale } });
  await audit(user.email, "entry.deleteTranslation", `${entryId}/${locale}`);
  redirect(`/admin/entries/${entryId}`);
}

export async function deleteEntry(entryId: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const entry = await prisma.entry.findUnique({ where: { id: entryId }, include: { instance: true } });
  if (!entry) return;
  await prisma.entry.delete({ where: { id: entryId } });
  await audit(user.email, "entry.delete", entryId);
  redirect(`/admin/entries?c=${entry.instance.key}`);
}
