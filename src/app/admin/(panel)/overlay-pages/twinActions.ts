"use server";
import { revalidatePath } from "next/cache";
import { ADMIN_HREF } from "@/core/adminLinks";
import { adminCtx } from "@/core/admin";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { updateLook } from "@/core/overlays/lookService";
import { listOverlaySkins } from "@/core/overlays/skinLoad";
import { listPages } from "@/core/overlays/store";
import { clearTwinOffer } from "@/core/overlays/twinOffer";
import { audit } from "@/core/permissions";
import { activeSkinId } from "@/core/skins/service";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * (core 0.47.0) The two buttons of the matching-overlay-skin offer (components/admin/TwinOfferNotice.tsx). The offer is made once after the site skin changed; these actions are only
 * ever called by those buttons, never by the site skin change itself. The skin must still be installed, working and the twin of the CURRENT site skin; each page goes through the
 * same look validation as every other change of a page's skin (`updateLook`), and the rules per context of a page are left as they are.
 */
export async function applyMatchingOverlaySkinAction(skin: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  void _prev; void _fd;
  const { user, t, locale, config } = await adminCtx(OVERLAY_NEED);
  const id = String(skin).slice(0, 60);
  const [skins, pages, site] = await Promise.all([listOverlaySkins(), listPages(), activeSkinId()]);
  if (!skins.some((s) => s.id === id && s.status === "ok" && s.twinOf === site)) return { error: t("appearance.twin.failed") };
  let failed = false;
  for (const p of pages) {
    if (p.look.skin === id) continue;
    const r = await updateLook(p.id, (cur) => ({ ...cur, skin: id }), locale, config.defaultLocale);
    if (!r.ok) { failed = true; continue; }
    await audit(user.email, "overlay.skin", p.id);
  }
  if (failed) return { error: t("appearance.twin.failed") };
  await clearTwinOffer();   // used: not offered again (the card stays on screen with its answer until the person leaves the page)
  return { ok: t("appearance.twin.done") };
}

/** "Not now": the offer is withdrawn for this change of the site skin. */
export async function dismissTwinOfferAction(): Promise<void> {
  await adminCtx(OVERLAY_NEED);
  await clearTwinOffer();
  revalidatePath(ADMIN_HREF, "layout");
}
