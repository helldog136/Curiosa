"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { LOGO_KEYS } from "@/core/logos";
import { isKnownLocale } from "@/core/i18n/locales";
import { isSiteEntity } from "@/core/seo";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";
import { isTimezone, TIMEZONE_SETTING } from "@/core/siteTime";
import type { ActionState } from "@/components/admin/ActionForm";

const TRANSLATABLE = ["site.name", "site.tagline", "site.about", "footer.text", "privacy.extra"];

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");

  // Version simplifiée : les réglages techniques ne sont pas envoyés, on ne les touche pas.
  const adv = formData.get("__adv") === "1";
  // Contact et pied de page : envoyés dans les deux versions (marqueur `__contact`) ; sans le marqueur, on n'y touche pas.
  const withContact = adv || formData.get("__contact") === "1";
  const defaultLocale = String(formData.get("defaultLocale") ?? "");
  const enabled = formData.getAll("enabledLocales").map(String).filter(isKnownLocale);
  if (!isKnownLocale(defaultLocale)) return { error: t("error.generic") };
  const locales = [...new Set([defaultLocale, ...enabled])];

  // Jeu de logos : chaque image est optionnelle ; une adresse invalide n'enregistre rien.
  const logoValues: Record<string, string> = {};
  for (const [field, key] of [["logo", "square"], ["logoWide", "wide"], ["logoDark", "squareDark"], ["logoWideDark", "wideDark"], ["favicon", "favicon"], ["logoShare", "share"]] as const) {
    const v = String(formData.get(field) ?? "").trim();
    if (v && !(v.startsWith("/uploads/") || /^https:\/\//.test(v))) return { errors: { [field]: t("error.badImage") } };
    logoValues[key] = v;
  }

  // Fuseau horaire du site (avancé) : vide = celui du serveur ; sinon un nom connu (« Europe/Brussels »), rien n'est enregistré à tort.
  const timezone = adv ? String(formData.get("timezone") ?? "").trim() : null;
  if (timezone && !isTimezone(timezone)) return { errors: { timezone: t("settings.timezoneError") } };

  await setSetting("i18n.default", defaultLocale);
  await setSetting("i18n.enabled", locales);
  if (adv) {
    const adminLocale = String(formData.get("adminLocale") ?? "");
    if (isKnownLocale(adminLocale)) await setSetting("i18n.adminDefault", adminLocale);
    await setSetting("i18n.autoDetect", formData.get("autoDetect") === "on");
  }
  // Robots IA et fichier pour les IA : le formulaire les envoie dans les deux versions de l'admin (marqueur `__ai`).
  // Les deux choix sont enregistrés ensemble ; l'ancien réglage unique est retiré (les nouveaux le remplacent).
  if (formData.get("__ai") === "1") {
    await setSetting("seo.blockAiTraining", formData.get("aiTraining") !== "allow");
    await setSetting("seo.blockAiAnswers", formData.get("aiAnswers") === "block");
    await deleteSetting("seo.blockAiBots");
    await setSetting("seo.llmsTxt", formData.get("llmsTxt") === "on");
    const entity = String(formData.get("entityType") ?? "");
    await setSetting("seo.entityType", isSiteEntity(entity) ? entity : "organization");
  }

  for (const key of TRANSLATABLE) {
    if (key === "footer.text" && !withContact) continue;
    for (const locale of locales) {
      const value = String(formData.get(`${key}__${locale}`) ?? "").trim().slice(0, 20000);
      if (value) await setSetting(key, value, locale);
      else await deleteSetting(key, locale);
    }
  }
  for (const [key, value] of Object.entries(logoValues)) {
    const settingKey = LOGO_KEYS[key as keyof typeof LOGO_KEYS];
    if (value) await setSetting(settingKey, value);
    else await deleteSetting(settingKey);
  }
  // Le lien et le bouton de l'en-tête se règlent dans « Menu du site » (navigation/actions.ts), les icônes sociales dans « Réseaux sociaux » ;
  // la disposition de l'en-tête, les couleurs, la police, le halo et le fond dans Apparence (appearance/actions.ts).
  await setSetting("stats.enabled", formData.get("statsEnabled") === "on");
  await setSetting("news.toggle", formData.get("newsToggle") === "on");
  if (withContact) await setSetting("site.contactEmail", String(formData.get("contactEmail") ?? "").trim());
  if (timezone) await setSetting(TIMEZONE_SETTING, timezone);
  else if (timezone !== null) await deleteSetting(TIMEZONE_SETTING);
  await audit(user.email, "settings.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
