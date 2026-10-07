"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { setSetting, type NavItem } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";
import type { ActionState } from "@/components/admin/ActionForm";

export async function saveNavigation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const total = Math.min(Number(formData.get("count")) || 0, 40);
  const items: NavItem[] = [];
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
