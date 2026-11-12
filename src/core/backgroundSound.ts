import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { getSetting } from "@/core/settings";
import { normalizeSound, SOUND_KEYS, type SoundConfig } from "@/core/soundConfig";

/** The saved configuration of the background sound (always safe to use: damaged values fall back to the defaults). */
export async function getSoundConfig(): Promise<SoundConfig> {
  return normalizeSound({
    enabled: await getSetting(SOUND_KEYS.enabled), file: await getSetting(SOUND_KEYS.file), volume: await getSetting(SOUND_KEYS.volume),
    pages: await getSetting(SOUND_KEYS.pages), corner: await getSetting(SOUND_KEYS.corner), startMuted: await getSetting(SOUND_KEYS.startMuted),
  });
}

/** Does the file named by the setting exist on this site? (A sound that was deleted or lost in a restore must not leave a dead button on every page.) */
export async function soundFileExists(file: string): Promise<boolean> {
  try { return (await fs.stat(path.join(UPLOADS_DIR, path.basename(file)))).isFile(); } catch { return false; }
}

/** The configuration to play on the public site, or null: switched off, no file, or the file is gone. */
export async function activeSound(): Promise<(SoundConfig & { file: string }) | null> {
  const config = await getSoundConfig();
  if (!config.enabled || !config.file || !(await soundFileExists(config.file))) return null;
  return { ...config, file: config.file };
}
