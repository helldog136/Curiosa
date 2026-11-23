/**
 * TWINS (core 0.47.0): an overlay skin may name the SITE skin it matches (`twinOf` in skin.json and in its catalogue entry). Metadata only: nothing here applies a skin.
 * Pure (no database, no Next): the gallery and the site skin change read these two decisions; both are tested without a server.
 */

export type TwinBadge = { kind: "match" } | { kind: "twin"; name: string } | null;

/**
 * What a twin card says. "match": the active site skin IS the twin (the one short badge). "twin": the site skin is installed but not active (a quiet line with its name).
 * Nothing when the card has no twin or its site skin is not installed (a name nobody can see tells nothing).
 */
export function twinBadge(twinOf: string | undefined, activeSiteSkin: string, siteSkinNames: ReadonlyMap<string, string>): TwinBadge {
  if (!twinOf) return null;
  if (twinOf === activeSiteSkin) return { kind: "match" };
  const name = siteSkinNames.get(twinOf);
  return name ? { kind: "twin", name } : null;
}

export type TwinCandidate = { id: string; twinOf?: string; status: string; name?: string };
export type TwinOffer = { skin: string; name: string; /** Overlay pages that do not wear it yet. */ pages: number };

/**
 * The ONE overlay skin to offer when the site skin changes to `newSiteSkin`: installed and working, twin of that skin, and not worn already by every overlay page.
 * `pageSkins`: the default skin of each overlay page (null: the common style). No page, nothing to offer. Several twins: the first by id (stable).
 */
export function twinToOffer(skins: readonly TwinCandidate[], newSiteSkin: string, pageSkins: readonly (string | null)[]): TwinOffer | null {
  if (!newSiteSkin || pageSkins.length === 0) return null;
  const twins = skins.filter((s) => s.status === "ok" && s.twinOf === newSiteSkin).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const t of twins) {
    const pages = pageSkins.filter((p) => p !== t.id).length;
    if (pages > 0) return { skin: t.id, name: t.name ?? t.id, pages };
  }
  return null;
}
