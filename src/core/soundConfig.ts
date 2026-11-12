import { AUDIO_URL_RE } from "./audioTypes";

/**
 * BACKGROUND SOUND of the public site (core 0.10.0): the settings and their rules. Pure (no disk, no database): used by the admin form, the MCP tool, the
 * server loader (`backgroundSound.ts`) and the visitor's player.
 *
 * Off by default. The sound is a file already on the site (`/uploads/<uuid>.<mp3|ogg|wav|m4a|aac>`, see `audioTypes.ts`): never an outside address.
 */
export const SOUND_KEYS = {
  enabled: "sound.enabled", file: "sound.file", volume: "sound.volume", pages: "sound.pages", corner: "sound.corner", startMuted: "sound.startMuted",
} as const;

export const SOUND_PAGES = ["all", "home"] as const;
export type SoundPages = (typeof SOUND_PAGES)[number];
export const SOUND_CORNERS = ["bottom-right", "bottom-left"] as const;
export type SoundCorner = (typeof SOUND_CORNERS)[number];

/** Volume in percent: never silent (that is "off"), never above 100. The default is a quiet background. */
export const VOLUME_MIN = 5;
export const VOLUME_MAX = 100;
export const VOLUME_DEFAULT = 30;

export type SoundConfig = { enabled: boolean; file: string | null; volume: number; pages: SoundPages; corner: SoundCorner; startMuted: boolean };
export const SOUND_DEFAULTS: SoundConfig = { enabled: false, file: null, volume: VOLUME_DEFAULT, pages: "all", corner: "bottom-right", startMuted: false };

export const isSoundFile = (v: unknown): v is string => typeof v === "string" && AUDIO_URL_RE.test(v);
export const isSoundPages = (v: unknown): v is SoundPages => (SOUND_PAGES as readonly unknown[]).includes(v);
export const isSoundCorner = (v: unknown): v is SoundCorner => (SOUND_CORNERS as readonly unknown[]).includes(v);

/** A volume in percent, as an integer between VOLUME_MIN and VOLUME_MAX; anything else is the default. */
export function normalizeVolume(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= VOLUME_MIN && n <= VOLUME_MAX ? n : VOLUME_DEFAULT;
}

/** The stored values (anything, possibly damaged by hand or restored from an older backup) as a safe configuration. */
export function normalizeSound(raw: { enabled?: unknown; file?: unknown; volume?: unknown; pages?: unknown; corner?: unknown; startMuted?: unknown }): SoundConfig {
  return {
    enabled: raw.enabled === true,
    file: isSoundFile(raw.file) ? raw.file : null,
    volume: normalizeVolume(raw.volume),
    pages: isSoundPages(raw.pages) ? raw.pages : SOUND_DEFAULTS.pages,
    corner: isSoundCorner(raw.corner) ? raw.corner : SOUND_DEFAULTS.corner,
    startMuted: raw.startMuted === true,
  };
}

/** Does the sound play on this page? `pathname` is the address the visitor sees (a language prefix such as /fr is allowed). */
export function soundVisibleOn(pathname: string | null | undefined, pages: SoundPages, locales: readonly string[]): boolean {
  if (pages === "all") return true;
  const path = (pathname ?? "/").split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (path === "/") return true;
  return locales.some((l) => path === `/${l}`);
}
