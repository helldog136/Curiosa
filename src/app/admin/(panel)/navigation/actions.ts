"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { citedRefs, validateMenuInput } from "@/core/menuInput";
import { existingRefs, saveMenu } from "@/core/menuStore";
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
