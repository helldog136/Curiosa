"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { isHexColor } from "@/core/color";
import { isKnownLocale } from "@/core/i18n/locales";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

const TRANSLATABLE = ["site.name", "site.tagline", "footer.text"];

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");

  // Version simplifiée : les réglages techniques ne sont pas envoyés, on ne les touche pas.
  const adv = formData.get("__adv") === "1";
  const defaultLocale = String(formData.get("defaultLocale") ?? "");
  const enabled = formData.getAll("enabledLocales").map(String).filter(isKnownLocale);
  if (!isKnownLocale(defaultLocale)) return { error: t("error.generic") };
  const locales = [...new Set([defaultLocale, ...enabled])];

  const background = String(formData.get("background") ?? "");
  const accent = String(formData.get("accent") ?? "");
  if (!isHexColor(background) || !isHexColor(accent)) return { error: t("error.generic") };
  const font = String(formData.get("font"));
  const logo = String(formData.get("logo") ?? "").trim();
  if (logo && !(logo.startsWith("/uploads/") || /^https?:\/\//.test(logo))) return { error: t("error.badUrl") };

  await setSetting("i18n.default", defaultLocale);
  await setSetting("i18n.enabled", locales);
  if (adv) {
    const adminLocale = String(formData.get("adminLocale") ?? "");
    if (isKnownLocale(adminLocale)) await setSetting("i18n.adminDefault", adminLocale);
    await setSetting("i18n.autoDetect", formData.get("autoDetect") === "on");
  }

  for (const key of TRANSLATABLE) {
    if (key === "footer.text" && !adv) continue;
    for (const locale of locales) {
      const value = String(formData.get(`${key}__${locale}`) ?? "").trim();
      if (value) await setSetting(key, value, locale);
      else await deleteSetting(key, locale);
    }
  }
  if (logo) await setSetting("site.logo", logo);
  else await deleteSetting("site.logo");
  if (adv) await setSetting("site.contactEmail", String(formData.get("contactEmail") ?? "").trim());
  await setSetting("theme.background", background);
  await setSetting("theme.accent", accent);
  if (adv) await setSetting("theme.font", ["sans", "serif", "mono"].includes(font) ? font : "sans");

  await audit(user.email, "settings.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
