"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

/** « Afficher l'icône RSS dans le pied de page » : un réglage du site, réservé aux administrateurs. */
export async function saveFeedLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  await setSetting("feed.showLink", formData.get("feedLink") === "on");
  await audit(user.email, "settings.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
