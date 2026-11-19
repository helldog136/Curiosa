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
import { prisma } from "../db";
import { getActiveInstances, type ActiveInstance } from "../modules/registry";
import { mountedAtRoot, mountedOnBase } from "../modules/mountOrder";
import { hasPublicPage } from "../modules/publicPage";
import { readActiveSetting } from "../skins/registry";
import { installedSiteSkinIds } from "../skins/pageSkin";
import { effectivePageSkin } from "../skins/pageSkinCheck";
import { findEntryBySlug } from "./entries";

export const requestedPageSkin = cache(async (path: string, locale: string): Promise<string | null> => {
  const segs = path.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s).toLowerCase(); } catch { return ""; } });
  if (segs.length === 0 || segs.length > 2 || segs.includes("")) return null;
  if (RESERVED_PATHS.has(segs[0]!)) return null;
  // same resolver order as the catch-all page (core/modules/mountOrder.ts): look among ALL mounted instances, then check the one found has the feature
  const mounted = (await getActiveInstances()).filter(hasPublicPage);
  const byBase = mountedOnBase(mounted, segs[0]!);
  let target: { a: ActiveInstance; slug: string } | null = null;
  if (byBase) {
    if (segs.length === 2) target = { a: byBase, slug: segs[1]! };
  } else if (segs.length === 1) {
    // an active short link on this address is served before the root instance
    if (await prisma.redirect.findFirst({ where: { path: segs[0]!, active: true }, select: { id: true } })) return null;
    const root = mountedAtRoot(mounted);
    if (root) target = { a: root, slug: segs[0]! };
  }
  if (!target || target.a.mod.def.page || !target.a.mod.manifest.content || !target.a.instance.features.includes("skin")) return null;
  const found = await findEntryBySlug(target.a.instance, locale, target.slug);
  if (found.kind !== "found" || !found.entry.skin) return null;
  return effectivePageSkin(found.entry.skin, await installedSiteSkinIds(), await readActiveSetting());
});
