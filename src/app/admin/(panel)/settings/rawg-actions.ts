"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { checkRawgKey, clearRawgKey, isValidRawgKey, saveRawgKey } from "@/core/services/rawg";
import { delegate } from "@/core/services/rawgBridge";
import type { ActionState } from "@/components/admin/ActionForm";

/** Enregistre (ou retire) la clé RAWG du site. Une clé laissée vide conserve l'ancienne ; elle n'est jamais réaffichée ni journalisée. */
export async function saveRawg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  // Une seule personne garde la clé : depuis la reprise, c'est le module « Jaquettes de jeux » (un formulaire resté ouvert dans un onglet ne doit pas écrire ici).
  if (await delegate()) return { error: t("settings.rawgMoved") };
  if (formData.get("rawgClear") === "on") {
    await clearRawgKey();
    await audit(user.email, "settings.rawg", "removed");
    revalidatePath("/admin/settings");
    return { ok: t("settings.rawgRemoved") };
  }
  const key = String(formData.get("rawgKey") ?? "").trim();
  if (!key) return { ok: t("settings.rawgUnchanged") };
  if (!isValidRawgKey(key)) return { error: t("settings.rawgInvalid") };
  await saveRawgKey(key);
  await audit(user.email, "settings.rawg", "saved");
  revalidatePath("/admin/settings");
  return { ok: t("settings.rawgSaved") };
}

/** « Tester la clé » : interroge RAWG avec la clé enregistrée et répond en langage simple. */
export async function testRawgKey(): Promise<ActionState> {
  const { t } = await adminCtx("owner");
  if (await delegate()) return { error: t("settings.rawgMoved") };
  const result = await checkRawgKey();
  revalidatePath("/admin/settings");
  switch (result) {
    case "ok": return { ok: t("settings.rawgTestOk") };
    case "refused": return { error: t("settings.rawgTestRefused") };
    case "unreachable": return { error: t("settings.rawgTestUnreachable") };
    default: return { error: t("settings.rawgTestNoKey") };
  }
}
