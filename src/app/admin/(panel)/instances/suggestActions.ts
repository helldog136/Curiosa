"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { dismissSuggestion, installSuggested as installSuggestedCore, resetSuggestions } from "@/core/modules/suggestInstall";

// Bloc « suggestInstall » (voir core/modules/suggestInstall.ts) : trois gestes, tous réservés au propriétaire, tous sur un clic.

const back = (instanceId: string, query: string) => `/admin/instances/${encodeURIComponent(instanceId)}?${query}`;

/** « Installer » : `confirm` (case cochée) n'est lu que pour un module de l'index supplémentaire. */
export async function installSuggested(instanceId: string, service: string, moduleId: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx("owner");
  const result = await installSuggestedCore(user, { instanceId, service, moduleId, confirmExtra: formData.get("confirm") === "on" });
  revalidatePath("/", "layout");
  redirect(back(instanceId, result.ok ? "suggest=installed" : `suggestError=${encodeURIComponent(result.error)}`));
}

/** « Ne plus proposer » pour ce service, sur cette instance. */
export async function dismissSuggestionAction(instanceId: string, service: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await dismissSuggestion(user, instanceId, service);
  revalidatePath(`/admin/instances/${instanceId}`);
  redirect(back(instanceId, "suggest=dismissed"));
}

/** « Afficher de nouveau les suggestions » (page de l'instance). */
export async function resetSuggestionsAction(instanceId: string): Promise<void> {
  const { user } = await adminCtx("owner");
  await resetSuggestions(user, instanceId);
  revalidatePath(`/admin/instances/${instanceId}`);
  redirect(back(instanceId, "suggest=shown"));
}
