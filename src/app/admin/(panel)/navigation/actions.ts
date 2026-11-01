"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { citedRefs, validateMenuInput } from "@/core/menuInput";
import { existingRefs, saveMenu } from "@/core/menuStore";
import { headerLink } from "@/core/header";
import { normalizeLinkInput } from "@/core/url";
import { deleteSetting, setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Enregistre le menu : une liste ordonnée à deux niveaux (pages du site, pages des extensions, contenus, raccourcis, liens libres, sous-menus). Le navigateur
 * n'est jamais cru sur parole : les références doivent exister, les adresses sont validées, les plafonds (40 au total, 8 par sous-menu) appliqués.
 * Chaque erreur est renvoyée sous son champ (`items.2.href`, `items.1.items.0.label`) ou sous son élément (`items.3`).
 */
export async function saveNavigation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get("items") ?? "[]")); } catch { return { error: t("error.generic") }; }
  const known = await existingRefs(citedRefs(raw));
  const result = validateMenuInput(raw, { exists: (kind, ref) => known.has(`${kind}:${ref}`), locales: config.locales, t });
  if (!result.ok) return { error: result.error, errors: result.errors };
  await saveMenu(result.items);
  await audit(user.email, "navigation.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

/**
 * Le lien secondaire et le bouton du haut de chaque page (réglages inchangés : `header.secondaryLabel/Href`, `header.buttonLabel/Href`).
 * Autrefois enregistrés avec les réglages du site ; ils vivent maintenant à côté du menu qu'ils complètent. Une adresse invalide n'enregistre rien ;
 * un texte vide efface le texte de cette langue.
 */
export async function saveHeaderLinks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const hrefs: [string, string][] = [];
  for (const [field, key] of [["headerSecondaryHref", "header.secondaryHref"], ["headerButtonHref", "header.buttonHref"]] as const) {
    if (!formData.has(field)) continue;
    const href = normalizeLinkInput(String(formData.get(field) ?? ""));
    if (href && !headerLink("x", href)) return { errors: { [field]: t("error.badLink") } };
    hrefs.push([key, href]);
  }
  for (const key of ["header.secondaryLabel", "header.buttonLabel"]) {
    for (const locale of config.locales) {
      const value = String(formData.get(`${key}__${locale}`) ?? "").trim().slice(0, 20000);
      if (value) await setSetting(key, value, locale);
      else await deleteSetting(key, locale);
    }
  }
  for (const [key, href] of hrefs) {
    if (href) await setSetting(key, href);
    else await deleteSetting(key);
  }
  await audit(user.email, "settings.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
