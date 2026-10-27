"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { clearRecognizedCache } from "@/core/modules/recognized";
import { ensureRawgHandover } from "@/core/services/rawgHandover";
import type { ActionState } from "@/components/admin/ActionForm";

/** « Réessayer maintenant » : la reprise de la clé RAWG et des corrections par le module « Jaquettes de jeux » (installé au besoin). Rien n'est affiché des données reprises. */
export async function retryRawgHandover(): Promise<ActionState> {
  const { t } = await adminCtx("owner");
  clearRecognizedCache();   // « Réessayer » : on relit le catalogue pour de bon (une copie de secours déjà en mémoire peut dater d'avant la panne ou d'avant le module)
  const result = await ensureRawgHandover({ install: true, force: true });
  revalidatePath("/admin/settings");
  return result === "done" || result === "nothing" ? { ok: t("settings.rawgRetryDone") } : { error: t("settings.rawgRetryWaiting") };
}
