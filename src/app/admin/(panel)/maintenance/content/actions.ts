"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { opIdOf, trackOperation } from "@/core/operations/run";
import { continueCheck, ignoreItem, startCheck, tally, unignoreAll, visibleGroups, type BatchOutcome } from "@/core/maintenance/content/run";
import { readIgnored, readReport, readSettings, writeSettings } from "@/core/maintenance/content/store";
import type { ActionState } from "@/components/admin/ActionForm";

// Santé de mon site : réservé aux administrateurs (comme les réglages et le menu que « Corriger » ouvre). Chaque action vérifie le droit elle-même.

export type CheckResult = { state: "done" | "more" | "busy" | "error"; done?: number; total?: number };

/**
 * « Vérifier maintenant » (et « Continuer la vérification » : `resume`). UN paquet de liens par appel, suivi par la barre de progression du cœur ; c'est le navigateur qui,
 * tant que la page reste ouverte, rappelle l'action pour le paquet suivant. Aucun minuteur côté serveur : rien ne tourne sans qu'on l'ait demandé.
 */
export async function checkContentAction(opId: string | undefined, resume: boolean): Promise<CheckResult> {
  const { user } = await adminCtx("admin");
  const tracked = await trackOperation(user, { kind: "content-check", key: "content-check", opId: opIdOf(opId) }, async () => {
    let out = resume ? await continueCheck({ by: "admin" }) : await startCheck({ by: "admin" });
    if (resume && !out.busy && "none" in out.value) out = await startCheck({ by: "admin" });
    return out;
  });
  if (tracked.busy) return { state: "busy" };
  const out = tracked.result;
  if (out.busy || "none" in out.value) return { state: "busy" };
  const value: BatchOutcome = out.value;
  const [report, ignored] = await Promise.all([readReport(), readIgnored()]);
  const counts = report ? tally(visibleGroups(report, ignored)) : null;
  await audit(user.email, "content.check", `${value.finished ? "done" : "partial"} · ${value.done}/${value.total} links${counts ? ` · important ${counts.important}, advised ${counts.advised}, info ${counts.info}` : ""}`);
  revalidatePath("/admin", "layout");
  return { state: value.finished ? "done" : "more", done: value.done, total: value.total };
}

/** « Ignorer » une remarque (elle reste masquée jusqu'à « Tout réafficher »). */
export async function ignoreAction(k: string): Promise<void> {
  await adminCtx("admin");
  await ignoreItem(k);
  revalidatePath("/admin", "layout");
}

export async function unignoreAllAction(): Promise<void> {
  await adminCtx("admin");
  await unignoreAll();
  revalidatePath("/admin", "layout");
}

/** Les deux réglages. « Sites à ne jamais visiter » n'existe qu'en mode avancé : hors mode avancé, la valeur gardée n'est pas touchée. */
export async function saveContentSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, advanced } = await adminCtx("admin");
  const current = await readSettings();
  await writeSettings({ checkLinks: formData.get("checkLinks") === "on", skipHosts: advanced ? String(formData.get("skipHosts") ?? "").slice(0, 10_000) : current.skipHosts });
  revalidatePath("/admin/maintenance/content");
  return { ok: t("content.settings.saved") };
}
