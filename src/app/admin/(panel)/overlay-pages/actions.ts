"use server";
import { OVERLAY_PAGES_HREF } from "@/core/adminLinks";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { buildCatalog } from "@/core/overlays/catalog";
import { issueMessages } from "@/core/overlays/messages";
import { DEFAULT_STYLE, MAX_ACTIVE_PAGES, MAX_PAGES, RESOLUTIONS } from "@/core/overlays/model";
import { NEW_PAGE_READABILITY } from "@/core/overlays/appearance";
import { validatePageInput } from "@/core/overlays/pageInput";
import { usableOverlaySkinIds } from "@/core/overlays/skinLoad";
import { createPage, deletePage, duplicatePage, getPage, renamePage, resetPageSecret, restoreVersion, savePage, setActive, setTest } from "@/core/overlays/store";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Actions d'administration des pages d'overlay. Règles communes : (1) le palier « admin » est exigé EN TÊTE de chaque action (OVERLAY_NEED) ; (2) la personne qui agit est relue
 * en base par `adminCtx` (jamais lue du formulaire) ; (3) tout ce qui vient du formulaire est revalidé côté serveur ; (4) chaque changement est noté au journal d'audit,
 * sans jamais écrire une adresse secrète.
 */
const LIST = OVERLAY_PAGES_HREF;
const text = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const back = (code: string): never => redirect(`${LIST}?e=${code}`);
const done = (code: string): never => redirect(`${LIST}?ok=${code}`);

export async function createPageAction(formData: FormData): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const [w, h] = text(formData.get("resolution"), 20).split("x").map(Number);
  const known = RESOLUTIONS.find((r) => r[0] === w && r[1] === h) ?? RESOLUTIONS[1]!;
  // (0.21.0) A new page starts readable: its elements follow the page's "Readable everywhere" default.
  const made = await createPage({ name: text(formData.get("name"), 200), width: known[0], height: known[1], style: { ...DEFAULT_STYLE, readability: NEW_PAGE_READABILITY, tvBase: "short" } });
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

/** The row switch of the list: turns a page on or off WITHOUT leaving the list. Same right, same limit and same audit entry as `toggleActiveAction`; an error brings the switch back. */
export async function setPageActiveAction(id: string, active: boolean): Promise<{ ok?: string; error?: string }> {
  const { user, t } = await adminCtx(OVERLAY_NEED);
  const pageId = text(id, 40);
  const r = await setActive(pageId, active === true);
  if (!r.ok) return { error: t(`ovp.flash.${r.error === "limitActive" || r.error === "notFound" ? r.error : "notFound"}`, { pages: MAX_PAGES, active: MAX_ACTIVE_PAGES }) };
  await audit(user.email, active ? "overlay.activate" : "overlay.deactivate", pageId);
  revalidatePath(LIST);
  return { ok: t(active ? "ovp.switch.on" : "ovp.switch.off") };
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
  const checked = validatePageInput(input, { catalog, previous: page.elements, skins: await usableOverlaySkinIds() });
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

/** (0.20.0) Puts a saved version of the page back. The current layout becomes a saved version in turn (a restore can be undone the same way). */
export async function restoreVersionAction(id: string, at: number): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const pageId = text(id, 40);
  const r = await restoreVersion(pageId, Number(at));
  if (r.ok) await audit(user.email, "overlay.restore", pageId);
  revalidatePath(`${LIST}/${pageId}`);
  revalidatePath(LIST);
}
