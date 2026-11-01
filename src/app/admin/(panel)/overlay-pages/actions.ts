"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { buildCatalog } from "@/core/overlays/catalog";
import { issueMessages } from "@/core/overlays/messages";
import { RESOLUTIONS } from "@/core/overlays/model";
import { validatePageInput } from "@/core/overlays/pageInput";
import { createPage, deletePage, duplicatePage, getPage, renamePage, resetPageSecret, savePage, setActive, setTest } from "@/core/overlays/store";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Actions d'administration des pages d'overlay. Règles communes : (1) le palier « admin » est exigé EN TÊTE de chaque action (OVERLAY_NEED) ; (2) la personne qui agit est relue
 * en base par `adminCtx` (jamais lue du formulaire) ; (3) tout ce qui vient du formulaire est revalidé côté serveur ; (4) chaque changement est noté au journal d'audit,
 * sans jamais écrire une adresse secrète.
 */
const LIST = "/admin/overlay-pages";
const text = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const back = (code: string): never => redirect(`${LIST}?e=${code}`);
const done = (code: string): never => redirect(`${LIST}?ok=${code}`);

export async function createPageAction(formData: FormData): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const [w, h] = text(formData.get("resolution"), 20).split("x").map(Number);
  const known = RESOLUTIONS.find((r) => r[0] === w && r[1] === h) ?? RESOLUTIONS[1]!;
  const made = await createPage({ name: text(formData.get("name"), 200), width: known[0], height: known[1] });
  if (!made.ok) return back(made.error);
  await audit(user.email, "overlay.create", made.page.id);
  revalidatePath(LIST);
  redirect(`${LIST}/${made.page.id}`);
}

export async function duplicatePageAction(id: string, copyLabel: string): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const made = await duplicatePage(text(id, 40), (name) => `${name} ${text(copyLabel, 20)}`.trim());
  if (!made.ok) return back(made.error);
  await audit(user.email, "overlay.duplicate", made.page.id);
  revalidatePath(LIST);
  done("duplicated");
}

export async function renamePageAction(id: string, formData: FormData): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const r = await renamePage(text(id, 40), text(formData.get("name")));
  if (!r.ok) return back(r.error);
  await audit(user.email, "overlay.rename", text(id, 40));
  revalidatePath(LIST);
  done("renamed");
}

export async function toggleActiveAction(id: string, active: boolean): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const r = await setActive(text(id, 40), active === true);
  if (!r.ok) return back(r.error);
  await audit(user.email, active ? "overlay.activate" : "overlay.deactivate", text(id, 40));
  revalidatePath(LIST);
  done(active ? "activated" : "deactivated");
}

export async function deletePageAction(id: string): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const r = await deletePage(text(id, 40));
  if (!r.ok) return back(r.error);
  await audit(user.email, "overlay.delete", text(id, 40));
  revalidatePath(LIST);
  done("deleted");
}

/** « Changer l'adresse secrète » : l'ancienne adresse cesse de fonctionner tout de suite. */
export async function resetSecretAction(id: string): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const r = await resetPageSecret(text(id, 40));
  if (!r.ok) return back(r.error);
  await audit(user.email, "overlay.secret", text(id, 40));
  revalidatePath(LIST);
  done("secret");
}

/** Mode test : démarrer (30 min), prolonger (+30 min), arrêter. L'échéance est constatée à la lecture, rien ne tourne en fond. */
export async function testAction(id: string, mode: "start" | "extend" | "stop"): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const action = mode === "extend" ? "extend" : mode === "stop" ? "stop" : "start";
  const r = await setTest(text(id, 40), action);
  if (!r.ok) return back(r.error);
  await audit(user.email, `overlay.test.${action}`, text(id, 40));
  revalidatePath(`${LIST}/${text(id, 40)}`);
  revalidatePath(LIST);
}

/** Enregistre la mise en page d'une page (le navigateur envoie tout en JSON ; le serveur revalide tout, voir core/overlays/pageInput.ts). Erreurs sous les champs. */
export async function savePageAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale, config } = await adminCtx(OVERLAY_NEED);
  const raw = String(formData.get("data") ?? "");
  if (raw.length > 400_000) return { error: t("ovp.err.generic") };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return { error: t("ovp.err.generic") }; }
  const page = await getPage(text(id, 40));
  if (!page) return { error: t("ovp.err.notFound") };
  const catalog = await buildCatalog(locale, config.defaultLocale);
  const checked = validatePageInput(input, { catalog, previous: page.elements });
  if (!checked.ok) {
    const m = issueMessages(checked.issues, input, catalog, t);
    return { error: m.general ?? t("ovp.err.fields"), errors: m.errors };
  }
  const saved = await savePage(page.id, checked.value);
  if (!saved.ok) return { error: t("ovp.err.notFound") };
  await audit(user.email, "overlay.update", page.id);
  revalidatePath(`${LIST}/${page.id}`);
  revalidatePath(LIST);
  return { ok: t("action.saved") };
}
