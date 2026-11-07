"use server";
import { REDIRECTS_HREF, redirectHref, redirectsHref } from "@/core/adminLinks";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { endFormParts, endInstant } from "@/core/redirectEnd";
import { checkRedirectTarget, createRedirectRecord, deleteRedirectRecord, proposeRedirectPath, updateRedirectRecord, type RedirectFail } from "@/core/redirects";
import { invalidateRedirectGate } from "@/core/redirectGate";
import { MEASURE_SETTING } from "@/core/redirectMeasure";
import { setSetting } from "@/core/settings";
import { siteTimezone } from "@/core/siteTime";
import type { ActionState } from "@/components/admin/ActionForm";

const FIELD: Record<RedirectFail["field"], string> = { path: "path", targetUrl: "targetUrl", entryId: "entryId", expiresAt: "end__date", endMessage: "endMessage" };

/** Le champ « date de fin » du formulaire (voir `endFormParts`) → l'instant (null : pas de fin) ou une erreur sous le champ. `current` : la date déjà enregistrée (la laisser telle quelle n'est jamais une erreur). */
async function readEnd(formData: FormData, t: (k: string) => string, current?: Date | null): Promise<{ at: Date | null } | { errors: Record<string, string> }> {
  const { date, time } = endFormParts(formData);
  const at = endInstant(date, time, await siteTimezone());
  if (at === undefined) return { errors: { end__date: t("redirects.error.date") } };
  if (at && at.getTime() <= Date.now() && at.getTime() !== current?.getTime()) return { errors: { end__date: t("redirects.error.datePast") } };
  return { at };
}

export async function createRedirect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config, advanced } = await adminCtx("editor");
  const end = await readEnd(formData, t);
  if ("errors" in end) return { errors: end.errors };
  const entryId = advanced ? String(formData.get("entryId") ?? "") || null : null;
  const result = await createRedirectRecord({
    path: String(formData.get("path") ?? ""),
    targetUrl: String(formData.get("targetUrl") ?? ""),
    entryId,
    permanent: advanced && formData.get("permanent") === "on",
    expiresAt: end.at,
    endMessage: String(formData.get("endMessage") ?? ""),
  }, { siteName: config.name });
  if (!result.ok) return { errors: { [FIELD[result.fail.field]]: t(result.fail.key) } };
  await audit(user.email, "redirect.create", result.redirect.path);
  revalidatePath(REDIRECTS_HREF);
  // Elle arrive tout de suite sur la fiche : QR code, « Copier », « Tester le lien ».
  redirect(redirectHref(result.redirect.id, { created: "1" }));
}

/** Formulaire de la fiche : destination, lien suivant une entrée (avancé), permanent (avancé), date de fin et message. Le nom court ne change jamais (il est dans le QR code imprimé). */
export async function updateRedirect(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, advanced } = await adminCtx("editor");
  const row = await prisma.redirect.findUnique({ where: { id } });
  if (!row) return { error: t("redirects.error.missing") };
  const end = await readEnd(formData, t, row.expiresAt);
  if ("errors" in end) return { errors: end.errors };
  const result = await updateRedirectRecord(id, {
    targetUrl: String(formData.get("targetUrl") ?? ""),
    ...(advanced ? { entryId: String(formData.get("entryId") ?? "") || null, permanent: formData.get("permanent") === "on" } : {}),
    expiresAt: end.at,
    endMessage: String(formData.get("endMessage") ?? ""),
  });
  if (!result.ok) return { errors: { [FIELD[result.fail.field]]: t(result.fail.key) } };
  await audit(user.email, "redirect.update", row.path);
  revalidatePath(REDIRECTS_HREF);
  revalidatePath(redirectHref(id));
  return { ok: t("redirects.saved") };
}

export async function toggleRedirect(id: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r || r.managedBy) return;   // un lien géré par un module se règle dans ce module
  await prisma.redirect.update({ where: { id }, data: { active: !r.active } });
  invalidateRedirectGate();
  await audit(user.email, "redirect.toggle", r.path);
  revalidatePath(REDIRECTS_HREF);
  revalidatePath(redirectHref(id));
}

/**
 * L'interrupteur « Actif » d'un lien : il DIT l'état voulu (`active`), il n'inverse rien, donc un double clic ne défait jamais le premier. Renvoie le message de retour
 * (ou l'erreur) que l'interrupteur affiche juste à côté ; l'état réel revient avec la page.
 */
export async function setRedirectActive(id: string, active: boolean): Promise<{ ok?: string; error?: string }> {
  const { user, t } = await adminCtx("editor");
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r) return { error: t("redirects.error.missing") };
  if (r.managedBy) return { error: t("redirects.error.managed") };
  if (r.active !== active) {
    await prisma.redirect.update({ where: { id }, data: { active } });
    invalidateRedirectGate();
    await audit(user.email, "redirect.toggle", r.path);
    revalidatePath(REDIRECTS_HREF);
    revalidatePath(redirectHref(id));
  }
  return { ok: t(active ? "redirects.switch.on" : "redirects.switch.off") };
}

/** « Réactiver » en un clic : retire la date de fin (le lien redirige de nouveau tout de suite). */
export async function reactivateRedirect(id: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const r = await prisma.redirect.findUnique({ where: { id } });
  if (!r || r.managedBy) return;
  await prisma.redirect.update({ where: { id }, data: { expiresAt: null, active: true } });
  invalidateRedirectGate();
  await audit(user.email, "redirect.reactivate", r.path);
  revalidatePath(REDIRECTS_HREF);
  revalidatePath(redirectHref(id));
}

export async function deleteRedirect(id: string): Promise<void> {
  const { user } = await adminCtx("editor");
  const path = await deleteRedirectRecord(id);
  if (path === null) return;
  await audit(user.email, "redirect.delete", path);
  revalidatePath(REDIRECTS_HREF);
  redirect(redirectsHref({ deleted: "1" }));
}

/** Nom court proposé pour une adresse collée (appelé par le formulaire dès que l'adresse est saisie) ; vide si l'adresse n'est pas comprise. */
export async function suggestRedirectName(address: string): Promise<string> {
  const { config } = await adminCtx("editor");
  const checked = await checkRedirectTarget(String(address ?? "").slice(0, 2100));
  if ("error" in checked) return "";
  return proposeRedirectPath({ url: checked.url, siteName: config.name });
}

/** « Compter les clics sur mes liens » : réglage du site, réservé à l'administration (il change les adresses de boutons de tout le site). Désactivé par défaut. */
export async function saveMeasureLinks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  await setSetting(MEASURE_SETTING, formData.get("measureLinks") === "on");
  invalidateRedirectGate(); // relit aussi la carte « destination → lien court »
  await audit(user.email, "settings.update", MEASURE_SETTING);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
