import { listContexts } from "./context";
import { validateLook, type LookIssue, type PageLook } from "./look";
import type { OverlayPageData } from "./model";
import { getPage, saveLook } from "./store";
import { usableOverlaySkinIds } from "./skinLoad";

/**
 * Changing the look of a page, ONE way for the administration and the AI tools (core 0.8.0): read the page, build the next look from the current one,
 * validate it against the skins that really work and the contexts the active modules really offer, save it. Nothing here deletes a skin or a module.
 */
export type LookUpdate = { ok: true; page: OverlayPageData } | { ok: false; error: "notFound" | "invalid"; issues: LookIssue[] };

export async function updateLook(pageId: string, next: (current: PageLook) => unknown, lang: string, defaultLocale: string): Promise<LookUpdate> {
  const page = await getPage(pageId);
  if (!page) return { ok: false, error: "notFound", issues: [] };
  const [skins, contexts] = await Promise.all([usableOverlaySkinIds(), listContexts(lang, defaultLocale)]);
  const checked = validateLook(next(page.look), { skins, contexts, previous: page.look });
  if (!checked.ok) return { ok: false, error: "invalid", issues: checked.issues };
  const saved = await saveLook(pageId, checked.value);
  return saved.ok ? { ok: true, page: saved.page } : { ok: false, error: "notFound", issues: [] };
}
