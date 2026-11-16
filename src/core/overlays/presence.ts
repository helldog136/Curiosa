import { prisma } from "../db";
import { getActiveInstances } from "../modules/registry";
import { parseElements } from "./store";

/**
 * (core 0.25.0) Does this site use overlays at all, and where is an element placed? Read only, bounded, never throws.
 *
 *  - `overlaysUseful()`: an active extension offers overlay page elements or an overlay of its own, or an overlay page already exists. When it is false, the
 *    administration hides "Overlay pages" and the AI tools of overlay skins (a site without streaming never sees them).
 *  - `placementOf(instanceKey, element?)`: on which overlay pages an element of an instance is placed (visible), and whether one of them is active. For an
 *    honest "placed on an active overlay page" check in an extension's own list of prerequisites (`ctx.api.overlays.placement`).
 */
export async function overlaysUseful(): Promise<boolean> {
  try {
    if ((await prisma.overlayPage.count()) > 0) return true;
    return (await getActiveInstances()).some((a) => (a.mod.manifest.overlayElements?.length ?? 0) > 0 || typeof a.mod.def.overlay === "function");
  } catch {
    return true;   // when in doubt, show: hiding a page someone uses would be worse than showing one entry too many
  }
}

export type Placement = { placed: boolean; onActivePage: boolean; pages: { name: string; active: boolean }[] };
/** The 20 pages at most, read once; only the name and the state of each page, never its address. */
export async function placementOf(instanceKey: string, element?: string): Promise<Placement> {
  try {
    const rows = await prisma.overlayPage.findMany({ select: { name: true, active: true, elements: true }, orderBy: [{ createdAt: "asc" }], take: 20 });
    const pages = rows.filter((r) => parseElements(r.elements).some((e) => e.instance === instanceKey && e.visible && (!element || e.element === element))).map((r) => ({ name: r.name, active: r.active }));
    return { placed: pages.length > 0, onActivePage: pages.some((p) => p.active), pages };
  } catch {
    return { placed: false, onActivePage: false, pages: [] };
  }
}
