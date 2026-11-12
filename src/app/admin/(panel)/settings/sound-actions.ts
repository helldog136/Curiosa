"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { soundFileExists } from "@/core/backgroundSound";
import { audit } from "@/core/permissions";
import { deleteSetting, setSetting } from "@/core/settings";
import { isSoundCorner, isSoundFile, isSoundPages, normalizeVolume, SOUND_DEFAULTS, SOUND_KEYS, VOLUME_DEFAULT, VOLUME_MAX, VOLUME_MIN } from "@/core/soundConfig";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Réglages du son de fond du site public (docs/BACKGROUND-SOUND.md). Tout est toujours envoyé, replié ou non. Une valeur invalide n'enregistre RIEN et l'erreur
 * s'affiche sous le champ, avec un exemple (R22). Le fichier doit être un son déjà envoyé sur le site (jamais une adresse extérieure).
 */
export async function saveSound(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const enabled = formData.get("soundEnabled") === "on";
  const file = String(formData.get("soundFile") ?? "").trim();

  if (file !== "") {
    if (!isSoundFile(file)) return { errors: { soundFile: t("settings.soundFileInvalid") } };
    if (!(await soundFileExists(file))) return { errors: { soundFile: t("settings.soundFileMissing") } };
  } else if (enabled) {
    return { errors: { soundFile: t("settings.soundFileRequired") } };
  }

  const rawVolume = String(formData.get("soundVolume") ?? "").trim();
  let volume = VOLUME_DEFAULT;
  if (rawVolume !== "") {
    volume = /^\d{1,3}$/.test(rawVolume) ? Number(rawVolume) : NaN;
    if (!(volume >= VOLUME_MIN && volume <= VOLUME_MAX)) return { errors: { soundVolume: t("settings.soundVolumeError", { min: VOLUME_MIN, max: VOLUME_MAX, example: VOLUME_DEFAULT }) } };
  }
  const pages = String(formData.get("soundPages") ?? SOUND_DEFAULTS.pages);
  const corner = String(formData.get("soundCorner") ?? SOUND_DEFAULTS.corner);
  if (!isSoundPages(pages)) return { errors: { soundPages: t("error.generic") } };
  if (!isSoundCorner(corner)) return { errors: { soundCorner: t("error.generic") } };
  const startMuted = formData.get("soundStartMuted") === "on";

  await setSetting(SOUND_KEYS.enabled, enabled);
  if (file) await setSetting(SOUND_KEYS.file, file); else await deleteSetting(SOUND_KEYS.file);
  // Les valeurs d'origine ne sont pas écrites : le réglage suit alors les défauts du cœur.
  if (normalizeVolume(volume) === VOLUME_DEFAULT) await deleteSetting(SOUND_KEYS.volume); else await setSetting(SOUND_KEYS.volume, volume);
  if (pages === SOUND_DEFAULTS.pages) await deleteSetting(SOUND_KEYS.pages); else await setSetting(SOUND_KEYS.pages, pages);
  if (corner === SOUND_DEFAULTS.corner) await deleteSetting(SOUND_KEYS.corner); else await setSetting(SOUND_KEYS.corner, corner);
  if (startMuted) await setSetting(SOUND_KEYS.startMuted, true); else await deleteSetting(SOUND_KEYS.startMuted);
  await audit(user.email, "settings.sound", enabled ? "on" : "off");
  revalidatePath("/", "layout");
  return { ok: t("settings.soundSaved") };
}
