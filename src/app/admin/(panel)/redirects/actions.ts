"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { normalizeRedirectPath, validateRedirectPath } from "@/core/redirects";
import { isSafeExternalUrl } from "@/core/url";
import type { ActionState } from "@/components/admin/ActionForm";

export async function createRedirect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("editor");
  const path = normalizeRedirectPath(String(formData.get("path") ?? ""));
  const entryId = String(formData.get("entryId") ?? "") || null;
  let targetUrl = String(formData.get("targetUrl") ?? "").trim();

  const pathError = await validateRedirectPath(path);
  if (pathError) return { error: t(pathError) };

  if (entryId) {
    const entry = await prisma.entry.findUnique({ where: { id: entryId }, select: { url: true } });
    if (!entry?.url) return { error: t("redirects.error.entry") };
    targetUrl = targetUrl || entry.url;
  }
  if (!isSafeExternalUrl(targetUrl)) return { error: t("error.badUrl") };

  await prisma.redirect.create({ data: { path, targetUrl, entryId, permanent: formData.get("permanent") === "on" } });
  await audit(user.email, "redirect.create", path);
  revalidatePath("/admin/redirects");
  return { ok: t("redirects.created") };
}

export async function toggleRedirect(id: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r) return;
  await prisma.redirect.update({ where: { id }, data: { active: !r.active } });
  await audit(user.email, "redirect.toggle", r.path);
  revalidatePath("/admin/redirects");
}

export async function deleteRedirect(id: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r) return;
  await prisma.redirect.delete({ where: { id } });
  await audit(user.email, "redirect.delete", r.path);
  revalidatePath("/admin/redirects");
}
