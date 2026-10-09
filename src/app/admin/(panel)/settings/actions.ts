"use server";

import { providersOf } from "@/core/services/topics";
import { SOCIAL_TOPIC } from "@/core/social";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { isHexColor } from "@/core/color";
import { isBackgroundImage, isPreset, parseBackground } from "@/core/background";
import { headerLink, isHeaderLayout } from "@/core/header";
import { LOGO_KEYS } from "@/core/logos";
import { sanitizeSvg } from "@/core/svg";
import { isGlowLevel, normalizeTuning } from "@/core/glow";
import { isKnownLocale } from "@/core/i18n/locales";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

const TRANSLATABLE = ["site.name", "site.tagline", "site.about", "footer.text", "header.secondaryLabel", "header.buttonLabel", "privacy.extra"];

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
  // Jeu de logos : chaque image est optionnelle ; une adresse invalide n'enregistre rien.
  const logoValues: Record<string, string> = {};
  for (const [field, key] of [["logo", "square"], ["logoWide", "wide"], ["logoDark", "squareDark"], ["logoWideDark", "wideDark"], ["favicon", "favicon"], ["logoShare", "share"]] as const) {
    const v = String(formData.get(field) ?? "").trim();
    if (v && !(v.startsWith("/uploads/") || /^https:\/\//.test(v))) return { error: t("error.badUrl") };
    logoValues[key] = v;
  }

  await setSetting("i18n.default", defaultLocale);
  await setSetting("i18n.enabled", locales);
  if (adv) {
    const adminLocale = String(formData.get("adminLocale") ?? "");
    if (isKnownLocale(adminLocale)) await setSetting("i18n.adminDefault", adminLocale);
    await setSetting("i18n.autoDetect", formData.get("autoDetect") === "on");
    await setSetting("seo.blockAiBots", formData.get("blockAiBots") === "on");
  }

  for (const key of TRANSLATABLE) {
    if (key === "footer.text" && !adv) continue;
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
  // En-tête : disposition, icônes sociales, lien secondaire et bouton (adresse : page du site, https ou mailto ; une adresse invalide n'enregistre rien).
  const layout = String(formData.get("headerLayout") ?? "classic");
  await setSetting("header.layout", isHeaderLayout(layout) ? layout : "classic");
  // La case n'existe que s'il y a au moins un réseau : sans réseau, on ne touche pas au choix (sinon il serait remis à « masqué » sans que personne l'ait voulu).
  if ((await providersOf(SOCIAL_TOPIC)).length > 0) await setSetting("header.socials", formData.get("headerSocials") === "on");
  for (const [field, key] of [["headerSecondaryHref", "header.secondaryHref"], ["headerButtonHref", "header.buttonHref"]] as const) {
    if (!(formData.has(field))) continue;
    const href = String(formData.get(field) ?? "").trim();
    if (href && !headerLink("x", href)) return { error: t("error.badUrl") };
    if (href) await setSetting(key, href);
    else await deleteSetting(key);
  }
  await setSetting("stats.enabled", formData.get("statsEnabled") === "on");
  await setSetting("news.toggle", formData.get("newsToggle") === "on");
  if (adv) await setSetting("site.contactEmail", String(formData.get("contactEmail") ?? "").trim());
  // Fond de page : préréglage (tous modes), description personnalisée (avancé), image de fond. Une description invalide n'enregistre rien.
  const bgPreset = String(formData.get("bgPreset") ?? "none");
  const bgImage = String(formData.get("bgImage") ?? "").trim();
  if (bgImage && !isBackgroundImage(bgImage)) return { error: t("error.badUrl") };
  const bgCustom = adv ? String(formData.get("bgCustom") ?? "").trim() : null;
  if (bgCustom) {
    const parsed = parseBackground(bgCustom);
    if (!parsed.ok) return { error: `${t("settings.bg.invalid")} ${parsed.error}` };
  }
  // Dessin SVG (avancé) : validé avant tout enregistrement, avec le message précis de ce qui ne passe pas.
  const bgSvg = adv ? String(formData.get("bgSvg") ?? "").trim() : null;
  const bgSvgFit = ["contain", "tile"].includes(String(formData.get("bgSvgFit"))) ? String(formData.get("bgSvgFit")) : "cover";
  const bgSvgAlign = ["left", "right"].includes(String(formData.get("bgSvgAlign"))) ? String(formData.get("bgSvgAlign")) : "center";
  if (bgSvg) {
    const checked = sanitizeSvg(bgSvg, undefined, bgSvgFit as "cover" | "contain" | "tile", bgSvgAlign as "left" | "center" | "right");
    if (!checked.ok) return { error: `${t("settings.bg.invalidSvg")} ${checked.error}` };
  }
  await setSetting("theme.bgPreset", isPreset(bgPreset) && (adv || (bgPreset !== "custom" && bgPreset !== "svg")) ? bgPreset : "none");
  if (bgSvg !== null) {
    await setSetting("theme.bgSvg", bgSvg);
    await setSetting("theme.bgSvgFit", bgSvgFit);
    await setSetting("theme.bgSvgAlign", bgSvgAlign);
    await setSetting("theme.bgSvgTile", Math.min(1200, Math.max(20, Math.round(Number(formData.get("bgSvgTile")) || 200))));
  }
  if (bgCustom !== null) await setSetting("theme.bgCustom", bgCustom);
  if (bgImage) await setSetting("theme.bgImage", bgImage);
  else await deleteSetting("theme.bgImage");
  await setSetting("theme.background", background);
  await setSetting("theme.accent", accent);
  const glow = String(formData.get("glow") ?? "none");
  // « personnalisé » n'existe qu'en mode avancé ; en mode simple on ne touche pas aux réglages fins déjà enregistrés.
  await setSetting("theme.glow", isGlowLevel(glow) && (adv || glow !== "custom") ? glow : "none");
  if (adv) {
    const raw: Record<string, unknown> = Object.fromEntries(["count", "size", "variance", "hue", "intensity", "seed"].map((k) => [k, formData.get(`glow_${k}`)]));
    // Couleur propre aux taches, sauf si « suivre la couleur d'accent » est coché.
    raw.color = formData.get("glow_followAccent") === "on" ? "" : String(formData.get("glow_color") ?? "");
    await setSetting("theme.glow.custom", normalizeTuning(raw));
  }
  if (adv) await setSetting("theme.font", ["sans", "serif", "mono"].includes(font) ? font : "sans");

  await audit(user.email, "settings.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
