/**
 * (core 0.45.0) The optional `skin` argument of the content tools (`create_draft`, `update_draft`), for instances that have the `skin` feature ("Skin for this page").
 * The same rule as the admin form (`checkPageSkin`): an installed SITE skin id, `none` or empty = the site's own skin, refused with a plain message when fewer than two
 * site skins are installed. Overlay skins and unknown ids are refused. The only side effect is the value stored on the draft: no upload, no change of the skin itself.
 */
import { offeredSiteSkinIds } from "../skins/pageSkin";
import { checkPageSkin } from "../skins/pageSkinCheck";
import { McpToolError } from "../services/mcp/validate";

export const SKIN_ARG_DESCRIPTION = 'Optional. The id of an installed site skin this page alone is shown with (a showcase of that skin). "none" or "" = the same skin as the rest of the site. Only available when more than one site skin is installed. The page stays a draft until it is published.';

/** The value to store: `undefined` = leave it as it is (argument absent), `null` = the site's skin, an id = that skin. */
export async function mcpPageSkin(raw: unknown, current: string | null = null): Promise<string | null | undefined> {
  if (raw === undefined || raw === null) return undefined;
  const ids = await offeredSiteSkinIds();
  const r = checkPageSkin(raw, ids, current);
  if (r.ok) return r.skin;
  if (r.reason === "single") throw new McpToolError('Page skins need more than one site skin installed on this site, and only one is. Leave "skin" out, or install another site skin first.');
  if (r.reason === "unknown") throw new McpToolError(`Unknown site skin "${String(raw).slice(0, 41)}". Installed site skins: ${ids.join(", ")}. Use "none" for the site's own skin.`);
  throw new McpToolError('"skin" must be the id of an installed site skin (lowercase letters, digits and dashes), or "none".');
}
