"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { opIdOf, trackOperation } from "@/core/operations/run";
import { dismissSuggestion, installSuggested as installSuggestedCore, resetSuggestions } from "@/core/modules/suggestInstall";

// Bloc « suggestInstall » (voir core/modules/suggestInstall.ts) : trois gestes, tous réservés au propriétaire, tous sur un clic.

const back = (instanceId: string, query: string) => `/admin/instances/${encodeURIComponent(instanceId)}?${query}`;

/**
 * « Installer » : `confirmExtra` (case cochée) n'est lu que pour un module de l'index supplémentaire. Sans redirection : le bouton montre l'avancement
 * (suivi d'opération, voir core/operations), puis va à `href` (la page de l'instance, avec le résultat ou l'erreur).
 */
export async function installSuggestedAction(instanceId: string, service: string, moduleId: string, confirmExtra: boolean, opId?: string): Promise<{ ok: boolean; error?: string; href: string }> {
  const { user, t } = await adminCtx({ right: "core:modules.install" });
  const run = await trackOperation(user, { kind: "install", key: `install:${String(moduleId).slice(0, 60)}`, opId: opIdOf(opId) },
    () => installSuggestedCore(user, { instanceId, service, moduleId, confirmExtra: confirmExtra === true }),
    (r) => ({ ok: r.ok, error: r.ok ? undefined : r.error }));
  if (run.busy) return { ok: false, error: t("progress.busy"), href: back(instanceId, "") };
  const result = run.result;
  const detail = !result.ok && "detail" in result ? (result.detail ?? "") : "";
  revalidatePath("/", "layout");
  return result.ok
    ? { ok: true, href: back(instanceId, "suggest=installed") }
    : { ok: false, error: t(result.error, { services: detail, modules: detail }), href: back(instanceId, `suggestError=${encodeURIComponent(result.error)}`) };
}

/** « Ne plus proposer » pour ce service, sur cette instance. */
export async function dismissSuggestionAction(instanceId: string, service: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:modules.install" });
  await dismissSuggestion(user, instanceId, service);
  revalidatePath(`/admin/instances/${instanceId}`);
  redirect(back(instanceId, "suggest=dismissed"));
}

/** « Afficher de nouveau les suggestions » (page de l'instance). */
export async function resetSuggestionsAction(instanceId: string): Promise<void> {
  const { user } = await adminCtx({ right: "core:modules.install" });
  await resetSuggestions(user, instanceId);
  revalidatePath(`/admin/instances/${instanceId}`);
  redirect(back(instanceId, "suggest=shown"));
}
