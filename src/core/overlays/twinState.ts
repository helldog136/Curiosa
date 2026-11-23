import { listOverlaySkins } from "./skinLoad";
import { listPages } from "./store";
import { activeSkinId, installed } from "../skins/service";

/** (core 0.47.0) The live state the matching-overlay-skin offer is decided on (overlays/twinOffer.ts): installed overlay skins with their twin, the active site skin, each overlay page's default skin. */
export async function liveTwinState(locale: string): Promise<{ skins: { id: string; twinOf?: string; status: string; name: string }[]; activeSite: string; pageSkins: (string | null)[] }> {
  const [skins, pages, activeSite] = await Promise.all([listOverlaySkins(), listPages(), activeSkinId()]);
  return { skins: skins.map((s) => ({ id: s.id, twinOf: s.twinOf, status: s.status, name: locale === "fr" ? s.name.fr : s.name.en })), activeSite, pageSkins: pages.map((p) => p.look.skin) };
}

/** (core 0.47.0) The installed SITE skins by id (name in the person's language) and the active one: what a twin card compares its `twinOf` with (overlays/twin.ts). */
export async function siteSkinsForTwins(locale: string): Promise<{ names: Map<string, string>; active: string }> {
  const [all, active] = await Promise.all([installed(), activeSkinId()]);
  return { names: new Map(all.filter((s) => s.kind === "site" && s.status === "ok").map((s) => [s.id, locale === "fr" ? s.name.fr : s.name.en])), active };
}
