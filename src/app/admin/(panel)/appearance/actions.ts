"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { getAuthSecret } from "@/core/secret";
import type { ActionState } from "@/components/admin/ActionForm";
import type { Translator } from "@/core/i18n/dictionary";
import { checkRetouchInput, chooseSkin, parseRetouchForm, resetToSkin, saveRetouches, saveSkinOptions, undoLastChange } from "@/core/skins/appearance";
import { loadAppearanceView, definitionOf } from "@/core/skins/appearanceView";
import { issueText, type SkinIssue } from "@/core/skins/messages";
import { signPreview, previewUrl } from "@/core/skins/previewToken";
import * as skins from "@/core/skins/service";
import { repoAddress } from "@/core/skins/source";
import { BASIC_ID } from "@/core/skins/constants";

/**
 * Actions de la page Apparence. Choisir, retoucher, revenir au skin, annuler : « admin » (comme les réglages). Ajouter, mettre à jour, retirer un skin,
 * lire un dépôt : « owner » (comme les modules : cela récupère des fichiers d'un dépôt git).
 */

const done = () => { revalidatePath("/", "layout"); revalidatePath("/admin/appearance"); };

/** Une phrase simple pour un refus du service des skins : le motif, puis (au plus trois) problèmes précis avec comment les corriger. */
export async function failureText(r: { error: string; issues?: SkinIssue[]; needsCore?: string; detail?: string }, t: Translator, locale: string): Promise<string> {
  const head = t(r.error, { version: r.needsCore ?? "", id: r.detail ?? "" });
  const issues = (r.issues ?? []).filter((i) => i.severity === "error").slice(0, 3).map((i) => `${issueText(i, locale)}`);
  return issues.length ? `${head} ${issues.join(" ")}` : head;
}

const idOf = (fd: FormData) => String(fd.get("id") ?? "");

export async function chooseSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("admin");
  const r = await chooseSkin(idOf(fd), { actor: user.email });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  done();
  return { ok: r.changed ? t("appearance.chosen") : t("appearance.alreadyChosen") };
}

export async function resetSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  if (fd.get("what") !== "reset") return { error: t("error.generic") };
  const r = await resetToSkin({ actor: user.email });
  done();
  return { ok: r.changed ? t("appearance.resetDone") : t("appearance.resetNothing") };
}

export async function undoSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("admin");
  if (fd.get("what") !== "undo") return { error: t("error.generic") };
  const r = await undoLastChange({ actor: user.email });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  done();
  return { ok: t("appearance.undone") };
}

export async function saveAppearance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const input = parseRetouchForm(fd);
  if (!input) return { error: t("error.generic") };
  const refusal = checkRetouchInput(input);
  if (refusal) {
    if (refusal.kind === "image") return { errors: { bgImage: t("error.badImage") } };
    return { error: `${t(refusal.kind === "bgCustom" ? "settings.bg.invalid" : "settings.bg.invalidSvg")} ${refusal.detail}` };
  }
  const view = await loadAppearanceView();
  const r = await saveRetouches(input, view.base, { actor: user.email });
  if (!r.ok) return { error: t(r.error) };
  done();
  return { ok: t("action.saved") };
}

export async function saveOptionsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const view = await loadAppearanceView();
  const chosen: Record<string, unknown> = {};
  for (const o of view.options) chosen[o.id] = fd.get(`option_${o.id}`);
  await saveSkinOptions(view.options.map((o) => ({ id: o.id, default: o.default, values: o.values })), chosen, { actor: user.email });
  done();
  return { ok: t("action.saved") };
}

// ── skins : ajouter, mettre à jour, retirer (propriétaire)

export async function installFromCatalogueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const id = idOf(fd);
  const r = await skins.installFromCatalogue(id, { actor: user.email });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  if (fd.get("activate") === "1") {
    const c = await chooseSkin(id, { actor: user.email });
    done();
    return c.ok ? { ok: t("appearance.installedAndChosen") } : { ok: t("appearance.installedOnly"), error: await failureText(c, t, locale) };
  }
  done();
  return { ok: t("appearance.installedOk") };
}

export type InspectView = {
  ok: true; mode: "summary" | "candidates";
  url: string; origin: "official" | "extra" | "personal"; compatible: boolean; needsCore?: string; alreadyInstalled?: string; installable: boolean;
  name?: { fr: string; en: string }; description?: { fr: string; en: string }; version?: string; author?: string; license?: string; modes?: string[]; sizeKb?: number;
  assets?: { file: string; kind: string; license?: string; author?: string }[];
  readme?: string | null; licenseText?: string | null;
  previews?: { alt: string; dataUrl: string; mode?: string }[];
  issues?: string[]; unreadable?: string[];
  candidates?: { subdir: string; id: string; name: string }[];
} | { ok: false; error: string };

/** Lit un dépôt SANS rien installer : README, licences, aperçus, contrôle de lisibilité. */
export async function inspectSkinAction(url: string): Promise<InspectView> {
  const { t, locale } = await adminCtx({ right: "core:modules.install" });
  const text = (x: { fr: string; en: string }) => (locale === "fr" ? x.fr : x.en);
  const r = await skins.inspect(String(url).slice(0, 400));
  if (!r.ok) return { ok: false, error: await failureText(r, t, locale) };
  if (!r.summary) {
    return { ok: true, mode: "candidates", url, origin: r.origin, compatible: true, installable: false, candidates: r.candidates.map((c) => ({ subdir: c.subdir, id: c.id, name: text(c.name) })) };
  }
  const s = r.summary;
  return {
    ok: true, mode: "summary", url, origin: r.origin, compatible: r.compatible, needsCore: r.needsCore, alreadyInstalled: r.alreadyInstalled?.version, installable: r.installable,
    name: s.name, description: s.description, version: s.version, author: s.author?.name, license: s.license, modes: s.modes, sizeKb: Math.ceil(s.sizeBytes / 1024),
    assets: s.assets.map((a) => ({ file: a.file, kind: a.kind, license: a.license, author: a.author })),
    readme: s.readme, licenseText: s.licenseText,
    previews: s.previews.map((p) => ({ alt: text(p.alt), dataUrl: p.dataUrl, mode: p.mode })),
    issues: r.issues.map((i) => text(i.message)),
    unreadable: r.readability.filter((i) => i.severity === "error").map((i) => text(i.message)),
  };
}

/** Dépôt personnel : installé seulement avec la case « je comprends » cochée. */
export async function installPersonalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const url = String(fd.get("url") ?? "").trim();
  if (fd.get("understood") !== "on") return { errors: { understood: t("appearance.personal.mustConfirm") } };
  const r = await skins.install(url, { confirmPersonal: true, actor: user.email });
  if (!r.ok) return { errors: { url: await failureText(r, t, locale) } };
  if (fd.get("activate") === "1") {
    const c = await chooseSkin(r.id, { actor: user.email });
    done();
    if (!c.ok) return { ok: t("appearance.installedOnly"), error: await failureText(c, t, locale) };
    return { ok: t("appearance.installedAndChosen") };
  }
  done();
  return { ok: t("appearance.installedOk") };
}

export type UpdateView = { ok: true; available: boolean; target?: string; level?: string; needsCore?: string; failed?: boolean } | { ok: false; error: string };

export async function checkUpdateAction(id: string): Promise<UpdateView> {
  await adminCtx({ right: "core:modules.install" });
  const c = await skins.checkUpdate(String(id), { fresh: true });
  return { ok: true, available: c.available, target: c.target, level: c.level ?? undefined, needsCore: c.needsCore, failed: c.failed };
}

export async function updateSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const r = await skins.update(idOf(fd), { actor: user.email, acceptMajor: fd.get("acceptMajor") === "on" || fd.get("acceptMajor") === "1" });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  done();
  return { ok: t("appearance.updatedOk", { version: r.version }) };
}

export async function revertSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const r = await skins.revert(idOf(fd), { actor: user.email });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  done();
  return { ok: t("appearance.revertedOk", { version: r.version }) };
}

export async function removeSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const r = await skins.remove(idOf(fd), { actor: user.email });
  if (!r.ok) return { error: await failureText(r, t, locale) };
  done();
  return { ok: r.wasActive ? t("appearance.removedActive") : t("appearance.removedOk") };
}

/** Adresse d'aperçu (valable quinze minutes) : la page du site, habillée du skin demandé, sans rien enregistrer. */
export async function previewLinkAction(id: string, path = "/"): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { t } = await adminCtx("admin");
  const def = await definitionOf(String(id));
  if (!def && id !== BASIC_ID) return { ok: false, error: t("skins.error.notfound") };
  return { ok: true, url: previewUrl(path, signPreview(String(id), getAuthSecret())) };
}

/** Adresse du dépôt d'un skin du catalogue (pour « Voir les détails » avant d'installer). */
export async function catalogueAddress(id: string): Promise<string | null> {
  await adminCtx({ right: "core:modules.install" });
  const cat = await skins.listCatalogue();
  const e = cat.items.find((x) => x.id === id);
  return e ? repoAddress({ url: e.repo, ref: e.ref ?? null, subdir: e.subdir ?? null }) : null;
}
