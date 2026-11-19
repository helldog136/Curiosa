/**
 * (core 0.45.0) "Skin for this page", rendering side: which skin the page at this address asks for.
 *
 * The public site is made of full document loads (plain links, no client navigation: tests/core/page-skin.test.mjs checks it), so the layout, which writes
 * `<html data-skin>` and the one style sheet, runs for each address and can ask this function. It answers a skin id only when ALL of these hold: a content
 * instance with the `skin` feature is mounted where the address points, a PUBLISHED entry of the visitor's language has that slug, its stored skin is an
 * installed site skin, more than one is installed, and it is not the site's own skin. Anything else: null (the site skin). Nothing is written.
 * Costs one extra read of the page when such an instance exists, and nothing otherwise.
 */
import { cache } from "react";
import { RESERVED_PATHS } from "../config";
import { getActiveInstances } from "../modules/registry";
import { hasPublicPage } from "../modules/publicPage";
import { readActiveSetting } from "../skins/registry";
import { installedSiteSkinIds } from "../skins/pageSkin";
import { effectivePageSkin } from "../skins/pageSkinCheck";
import { findEntryBySlug } from "./entries";

export const requestedPageSkin = cache(async (path: string, locale: string): Promise<string | null> => {
  const segs = path.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s).toLowerCase(); } catch { return ""; } });
  if (segs.length === 0 || segs.length > 2 || segs.includes("")) return null;
  if (RESERVED_PATHS.has(segs[0]!)) return null;
  const skinned = (await getActiveInstances()).filter((a) => hasPublicPage(a) && !a.mod.def.page && a.mod.manifest.content && a.instance.features.includes("skin"));
  if (skinned.length === 0) return null;
  // same order as the page resolver: an instance mounted on the first segment, else the one mounted at the root
  const byBase = skinned.find((a) => a.instance.basePath && a.instance.basePath === segs[0]);
  const target = byBase && segs.length === 2 ? { a: byBase, slug: segs[1]! } : !byBase && segs.length === 1 ? { a: skinned.find((a) => a.instance.basePath === ""), slug: segs[0]! } : null;
  if (!target?.a) return null;
  const found = await findEntryBySlug(target.a.instance, locale, target.slug);
  if (found.kind !== "found" || !found.entry.skin) return null;
  return effectivePageSkin(found.entry.skin, await installedSiteSkinIds(), await readActiveSetting());
});
