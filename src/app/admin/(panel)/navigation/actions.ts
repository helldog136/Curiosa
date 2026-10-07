"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { setSetting, type NavItem } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";
import { listMenuPages } from "./pages";
import type { ActionState } from "@/components/admin/ActionForm";

export async function saveNavigation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const total = Math.min(Number(formData.get("count")) || 0, 40);
  const items: NavItem[] = [];
  // Pages cochées : adresse et libellés viennent de la base (jamais du navigateur), dans l'ordre des pages.
  const ticked = new Set(formData.getAll("page").map(String));
  const known = await listMenuPages(config.defaultLocale);
  const titles = await prisma.entryTranslation.findMany({ where: { entryId: { in: known.map((k) => k.id) } }, select: { entryId: true, locale: true, title: true } });
  for (const page of known.filter((k) => ticked.has(k.id))) {
    const label: Record<string, string> = {};
    for (const l of config.locales) {
      const title = titles.find((x) => x.entryId === page.id && x.locale === l)?.title ?? page.title;
      label[l] = title;
    }
    items.push({ href: page.href, label });
  }
  for (let i = 0; i < total; i++) {
    const href = String(formData.get(`href_${i}`) ?? "").trim();
    if (!href) continue;
    const internal = href.startsWith("/") && !href.startsWith("//");
    if (!internal && !isSafeExternalUrl(href)) return { error: t("error.badUrl") };
    const label: Record<string, string> = {};
    for (const l of config.locales) {
      const v = String(formData.get(`label_${i}_${l}`) ?? "").trim();
      if (v) label[l] = v;
    }
    if (Object.keys(label).length === 0) return { error: t("navigation.error.label") };
    items.push({ href, label });
  }
  await setSetting("nav.custom", items);
  await audit(user.email, "navigation.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
