import { deleteSetting, getSetting, setSetting } from "../settings";
import { readRows } from "../skins/registry";
import { twinToOffer, type TwinCandidate, type TwinOffer } from "./twin";

/**
 * (core 0.47.0) The matching-overlay-skin offer is made ONCE per change of the site skin. Changing the site skin arms it (`armTwinOffer`: the site skin and the moment, nothing else);
 * the administration then shows the offer if, at that moment, an installed overlay twin of the active site skin is not worn by every overlay page (`pendingTwinOffer`), until the
 * person uses it or sets it aside, or after a few hours. Nothing is ever applied by the change itself.
 */
export const TWIN_OFFER_KEY = "overlay.twinOffer";
export const TWIN_OFFER_TTL_MS = 6 * 60 * 60_000;
type Armed = { site: string; at: number };

export async function armTwinOffer(site: string, now = Date.now()): Promise<void> {
  try {
    // a site without any overlay skin has nothing to offer: it keeps no extra setting
    if ((await readRows()).some((r) => r.kind === "overlay")) await setSetting(TWIN_OFFER_KEY, { site, at: now } satisfies Armed);
    else await deleteSetting(TWIN_OFFER_KEY);
  } catch { /* an offer is never worth failing a skin change */ }
}
export async function clearTwinOffer(): Promise<void> {
  try { await deleteSetting(TWIN_OFFER_KEY); } catch { /* nothing to clear */ }
}

/** The armed site skin, or null (absent, unreadable, or older than the lifetime). */
export function readArmed(raw: unknown, now: number): string | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return typeof a.site === "string" && typeof a.at === "number" && now - a.at >= 0 && now - a.at < TWIN_OFFER_TTL_MS ? a.site : null;
}

/** What to offer NOW, or null. `load` reads the live state only when an offer is armed (one setting read otherwise). */
export async function pendingTwinOffer(load: (locale: string) => Promise<{ skins: readonly TwinCandidate[]; activeSite: string; pageSkins: readonly (string | null)[] }>, locale = "en", now = Date.now()): Promise<TwinOffer | null> {
  const site = readArmed(await getSetting(TWIN_OFFER_KEY), now);
  if (!site) return null;
  const live = await load(locale);
  return live.activeSite === site ? twinToOffer(live.skins, site, live.pageSkins) : null;
}
