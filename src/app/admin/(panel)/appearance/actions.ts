"use server";
import { APPEARANCE_HREF } from "@/core/adminLinks";

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
import { eraseCustom } from "@/core/skins/customizeStore";
import { repoAddress } from "@/core/skins/source";
import { BASIC_ID } from "@/core/skins/constants";
import { addUpload, removeUpload, type UploadErrorCode } from "@/core/fonts/uploads";
import { UPLOAD_LIMITS } from "@/core/fonts/types";
import { accessState, type AccessState } from "@/core/gitAccess";
import { saveAccessCode } from "@/core/gitAccessAdmin";
import { parseSkinRepoUrl } from "@/core/skins/source";
import { addStaged, discardStaged, stageUpload, stagedId, uploadRateOk } from "@/core/skins/uploadService";
import { ZIP_LIMITS } from "@/core/skins/zip";
import { friendlyIssue, uploadErrorKey } from "@/core/skins/uploadMessages";

/**
 * Actions de la page Apparence. Choisir, retoucher, revenir au skin, annuler : « admin » (comme les réglages). Ajouter, mettre à jour, retirer un skin,
 * lire un dépôt : « owner » (comme les modules : cela récupère des fichiers d'un dépôt git).
 */

const done = () => { revalidatePath("/", "layout"); revalidatePath(APPEARANCE_HREF); };

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
  /** The skin's own id (the `id` of its skin.json), to put it in place once it is added. */ skinId?: string;
  name?: { fr: string; en: string }; description?: { fr: string; en: string }; version?: string; author?: string; license?: string; modes?: string[]; sizeKb?: number;
  assets?: { file: string; kind: string; license?: string; author?: string }[];
  readme?: string | null; licenseText?: string | null;
  previews?: { alt: string; dataUrl: string; mode?: string }[];
  issues?: string[]; unreadable?: string[];
  candidates?: { subdir: string; id: string; name: string }[];
  /** (0.42.0) What is saved for this repository: none, configured, or to enter again. Never the code. */
  access?: AccessState;
} | { ok: false; error: string; /** The access code field is needed (private repository, or an address or code to check). */ needsCode?: boolean; field?: "url" | "code"; access?: AccessState };

/** Lit un dépôt SANS rien installer : README, licences, aperçus, contrôle de lisibilité. */
export async function inspectSkinAction(url: string, code?: string): Promise<InspectView> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const text = (x: { fr: string; en: string }) => (locale === "fr" ? x.fr : x.en);
  const address = String(url).slice(0, 400);
  const parsed = parseSkinRepoUrl(address);
  // (0.42.0) An access code pasted with the address is tried against the repository and stored sealed ONLY if it works; it is never sent back.
  if (parsed.ok && code && code.trim()) {
    const saved = await saveAccessCode(parsed.repo.url, String(code).slice(0, 400), user.email);
    if (!saved.ok) return { ok: false, error: t(`access.error.${saved.error}`, saved.address ? { address: saved.address } : undefined), field: "code", needsCode: saved.error !== "address", access: await accessState(parsed.repo.url) };
  }
  const access = parsed.ok ? await accessState(parsed.repo.url) : undefined;
  const r = await skins.inspect(address);
  if (!r.ok) return { ok: false, error: await failureText(r, t, locale), field: "url", ...(r.error === "skins.error.access" ? { needsCode: true } : {}), ...(access ? { access } : {}) };
  if (!r.summary) {
    return { ok: true, mode: "candidates", url, origin: r.origin, compatible: true, installable: false, candidates: r.candidates.map((c) => ({ subdir: c.subdir, id: c.id, name: text(c.name) })), ...(access ? { access } : {}) };
  }
  const s = r.summary;
  return {
    ok: true, mode: "summary", url, origin: r.origin, compatible: r.compatible, needsCore: r.needsCore, alreadyInstalled: r.alreadyInstalled?.version, installable: r.installable,
    skinId: s.id, name: s.name, description: s.description, version: s.version, author: s.author?.name, license: s.license, modes: s.modes, sizeKb: Math.ceil(s.sizeBytes / 1024),
    assets: s.assets.map((a) => ({ file: a.file, kind: a.kind, license: a.license, author: a.author })),
    readme: s.readme, licenseText: s.licenseText,
    previews: s.previews.map((p) => ({ alt: text(p.alt), dataUrl: p.dataUrl, mode: p.mode })),
    issues: r.issues.map((i) => text(i.message)),
    unreadable: r.readability.filter((i) => i.severity === "error").map((i) => text(i.message)),
    ...(access ? { access } : {}),
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

export type UpdateView = { ok: true; available: boolean; target?: string; level?: string; needsCore?: string; failed?: boolean; access?: boolean } | { ok: false; error: string };

export async function checkUpdateAction(id: string): Promise<UpdateView> {
  await adminCtx({ right: "core:modules.install" });
  const c = await skins.checkUpdate(String(id), { fresh: true });
  return { ok: true, available: c.available, target: c.target, level: c.level ?? undefined, needsCore: c.needsCore, failed: c.failed, ...(c.access ? { access: true } : {}) };
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
  // (0.44.0) the owner's customization of the skin is kept by default (coming back finds it); the box "also delete my pictures" erases it
  if (fd.get("erase") === "on") await eraseCustom(idOf(fd), { actor: user.email });
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

/** Un code d'erreur d'envoi → la phrase qui dit quoi faire (clé `appearance.font.error.*`). */
const FONT_ERROR: Record<UploadErrorCode, string> = {
  license: "license", empty: "empty", "too-large": "large", "not-woff2": "notWoff2", collection: "collection", private: "forbidden", svg: "forbidden", trailing: "broken", cff2: "cff2", corrupt: "broken", "not-font": "notWoff2", bitmap: "forbidden", "converted-large": "convertedLarge",
  header: "broken", tables: "broken", truncated: "broken", compressed: "broken", sizes: "broken", missing: "broken", head: "broken",
  name: "name", limit: "limit", duplicate: "duplicate", style: "style", write: "write",
};
const FONT_FIELD = { font: "font", name: "fontName", license: "license" } as const;

/** Envoi d'une police (administration seulement) : octets vérifiés, case de licence obligatoire. Les erreurs s'affichent sous le champ concerné. */
export async function uploadFontAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const file = fd.get("font");
  const accepted = fd.get("license") === "on";
  if (!accepted) return { errors: { license: t("appearance.font.error.license") } };
  if (!(file instanceof File) || file.size === 0) return { errors: { font: t("appearance.font.error.empty") } };
  if (file.size > UPLOAD_LIMITS.maxInputBytes) return { errors: { font: t("appearance.font.error.large") } };
  const r = await addUpload({ bytes: Buffer.from(await file.arrayBuffer()), name: String(fd.get("fontName") ?? ""), accepted, actor: user.email });
  if (!r.ok) return { errors: { [FONT_FIELD[r.field]]: t(`appearance.font.error.${FONT_ERROR[r.code]}`) } };
  done();
  return { ok: t("appearance.font.uploaded", { name: r.font.family }) };
}

/** Suppression d'une police envoyée : le fichier part ; si elle était choisie, « celle du skin » reprend. */
export async function deleteFontAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const r = await removeUpload(String(fd.get("id") ?? ""), { actor: user.email });
  if (!r.ok) return { error: t("appearance.font.error.gone") };
  done();
  return { ok: r.reset.length ? t("appearance.font.removedReset", { name: r.family }) : t("appearance.font.removed", { name: r.family }) };
}

// ── (0.46.1) a skin from a file: drop the .zip, see it, add it

export type UploadView =
  | { ok: true; token: string; id: string; name: string; description: string; version: string; author?: string; modes: string[]; kb: number; files: number; replaces?: string; previewable: boolean; previews: { alt: string; dataUrl: string; mode?: string }[]; notes: string[] }
  | { ok: false; error: string };

/** One sentence for a refusal of a file: what is wrong, what to do, an example (the sentence itself), then the file concerned, then up to three precise problems. */
async function uploadFailureText(r: { error: string; issues?: SkinIssue[]; detail?: string; target?: string }, t: Translator, locale: string): Promise<string> {
  const file = r.detail && !/^[a-z0-9-]+$/.test(r.detail) ? r.detail : "";
  const head = t(uploadErrorKey(r.error), { id: r.detail ?? "", version: r.target ?? "" });
  const where = file && r.error.startsWith("skins.upload.") ? ` ${t("skins.upload.file", { file })}` : "";
  const issues = (r.issues ?? []).filter((i) => i.severity === "error").slice(0, 3).map((i) => friendlyIssue(i, t, locale));
  return [head + where, ...issues].join(" ");
}

/**
 * Checks a dropped .zip WITHOUT adding anything: the archive is read in memory and dropped, the checked skin files wait (30 minutes at most) for "Add this skin".
 * Owner only (as every way of adding a skin). The request is a server action: the same-origin check of the framework applies. At most 12 files per 10 minutes.
 */
export async function checkSkinFileAction(fd: FormData): Promise<UploadView> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const text = (x: { fr: string; en: string }) => (locale === "fr" ? x.fr : x.en);
  const file = fd.get("skinFile");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("skins.upload.nofile") };
  if (file.size > ZIP_LIMITS.archiveBytes) return { ok: false, error: t("skins.upload.too-big") };
  if (!uploadRateOk(user.email)) return { ok: false, error: t("skins.upload.rate") };
  const r = await stageUpload(Buffer.from(await file.arrayBuffer()), { actor: user.email });
  if (!r.ok) return { ok: false, error: await uploadFailureText(r, t, locale) };
  const s = r.summary;
  return {
    ok: true, token: r.token, id: r.id, name: text(s.name), description: text(s.description), version: r.version, author: s.author?.name, modes: s.modes, kb: Math.ceil(s.sizeBytes / 1024), files: s.files,
    ...(r.replaces ? { replaces: r.replaces } : {}), previewable: r.previewable,
    previews: s.previews.map((p) => ({ alt: text(p.alt), dataUrl: p.dataUrl, mode: p.mode })),
    notes: r.issues.slice(0, 5).map((i) => issueText(i, locale)),
  };
}

/** "Add this skin": adds the checked skin (re-checked first). The one button; the plain sentence next to it replaces a tick box (a skin only changes the look and runs nothing). */
export async function addUploadedSkinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx({ right: "core:modules.install" });
  const r = await addStaged(String(fd.get("token") ?? ""), { actor: user.email });
  if (!r.ok) return { errors: { skinFile: await uploadFailureText(r, t, locale) } };
  done();
  return { ok: t("appearance.file.added") };
}

/** "Cancel" (or a new drop): the checked copy is removed. */
export async function cancelUploadAction(token: string): Promise<void> {
  await adminCtx({ right: "core:modules.install" });
  await discardStaged(String(token));
}

/** The preview address of a checked skin (fifteen minutes): the site's own page, dressed with it, nothing saved. */
export async function previewStagedAction(token: string, path = "/"): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { t } = await adminCtx({ right: "core:modules.install" });
  const id = stagedId(String(token));
  if (!id) return { ok: false, error: t("skins.upload.expired") };
  return { ok: true, url: previewUrl(path, signPreview(id, getAuthSecret())) };
}
