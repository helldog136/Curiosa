/**
 * (core 0.45.0) The rule for "Skin for this page": ONE page may ask for ONE installed site skin different from the site's. Pure (no Next, no database): the callers
 * pass the ids of the installed site skins. Used by the admin form, the assistant tools and the public rendering, so the three cannot disagree.
 *
 * - The setting exists only when MORE THAN ONE site skin is installed (`PAGE_SKIN_MIN_SKINS`): with one, there is nothing to choose.
 * - A value is the id of an installed SITE skin (never an overlay skin, never `basic`, never a free text). Empty or `none` means "same as the site" (stored as null).
 * - Reading is tolerant: a stored id that is no longer installed (skin removed, restored backup) is simply ignored at rendering.
 */
import { SKIN_ID_RE } from "./allowlist";

export const PAGE_SKIN_MIN_SKINS = 2;
/** Words an assistant may send for "same as the site". */
export const PAGE_SKIN_NONE_WORDS: readonly string[] = ["", "none"];

export type PageSkinCheck =
  | { ok: true; skin: string | null }
  | { ok: false; reason: "single" | "unknown" | "form" };

/** Is the setting offered at all? (more than one installed site skin) */
export const pageSkinOffered = (installedSiteSkinIds: readonly string[]): boolean => installedSiteSkinIds.length >= PAGE_SKIN_MIN_SKINS;

/**
 * Checks a value sent by the form or an assistant.
 * `current` is the value already stored: sending it back unchanged is always accepted (a skin removed since then must not block saving other changes).
 */
export function checkPageSkin(raw: unknown, installedSiteSkinIds: readonly string[], current: string | null = null): PageSkinCheck {
  if (raw === undefined || raw === null) return { ok: true, skin: current };
  if (typeof raw !== "string") return { ok: false, reason: "form" };
  const v = raw.trim();
  if (PAGE_SKIN_NONE_WORDS.includes(v.toLowerCase())) return { ok: true, skin: null };
  if (current !== null && v === current) return { ok: true, skin: current };
  if (!SKIN_ID_RE.test(v)) return { ok: false, reason: "form" };
  if (!pageSkinOffered(installedSiteSkinIds)) return { ok: false, reason: "single" };
  return installedSiteSkinIds.includes(v) ? { ok: true, skin: v } : { ok: false, reason: "unknown" };
}

/** What the public site applies: the stored id if it is still an installed site skin AND not the site's own skin (then nothing changes); otherwise null (the site skin). */
export function effectivePageSkin(stored: string | null | undefined, installedSiteSkinIds: readonly string[], activeSkinId: string): string | null {
  if (!stored || !SKIN_ID_RE.test(stored) || stored === activeSkinId) return null;
  return pageSkinOffered(installedSiteSkinIds) && installedSiteSkinIds.includes(stored) ? stored : null;
}
