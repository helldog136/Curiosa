import { boxed, STALLED } from "../modules/budget";
import { buildContext } from "../modules/context";
import { getActiveInstances } from "../modules/registry";
import { getInstanceLabeler } from "../modules/labels";
import { localized, type OverlayElementRequest } from "../modules/types";
import { finalAddress, parseAddress } from "./address";
import { frameLayout, type FrameLayout } from "./layout";
import type { OverlayPageData, PageElement } from "./model";

/**
 * Pour chaque élément VISIBLE d'une page, demande au module (côté serveur, avec ses secrets) l'adresse de son élément. Jamais d'exception : un élément qui ne répond pas,
 * qui plante ou qui répond une adresse refusée est « en échec » (cadre vide en direct, message en mode test) ; un élément dont le module a disparu est « manquant ».
 * Les modules sont interrogés en parallèle (30 éléments au plus), chacun avec le temps imparti habituel (budget.ts).
 */
export type ResolvedElement = {
  el: PageElement;
  title: string;
  status: "ok" | "missing" | "failed";
  /** Pourquoi, pour le mode test et l'administration seulement (jamais montré en direct). */
  reason?: "gone" | "stalled" | "error" | "address" | "empty";
  layout?: FrameLayout;
  src?: string;
  demoSrc?: string;
};

export async function resolvePage(page: OverlayPageData, opts: { lang: string; defaultLocale: string }): Promise<ResolvedElement[]> {
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(opts.lang, opts.defaultLocale);
  const one = async (el: PageElement): Promise<ResolvedElement> => {
    const a = active.find((x) => x.instance.key === el.instance);
    const decl = a?.mod.manifest.overlayElements?.find((d) => d.id === el.element);
    const serve = a?.mod.def.overlayElements?.[el.element];
    if (!a || !decl || typeof serve !== "function") return { el, title: `${el.instance} · ${el.element}`, status: "missing", reason: "gone" };
    const title = `${labeler.label(a.instance)} · ${localized(decl.label, opts.lang, opts.defaultLocale)}`;
    const layout = frameLayout(decl, el);
    const request: OverlayElementRequest = {
      element: decl.id, fit: decl.fit, width: layout.iframeW, height: layout.iframeH,
      style: decl.followsStyle ? { text: page.style.text, surface: page.style.background, corners: page.style.corners } : null,
      options: { ...el.options }, lang: opts.lang,
    };
    try {
      const ctx = await buildContext(a.mod, a.instance, opts.lang);
      const answer = await boxed({ kind: "overlay", moduleId: a.mod.manifest.id, instanceKey: a.instance.key, name: `element:${decl.id}` }, () => serve(ctx, request));
      if (answer === STALLED) return { el, title, status: "failed", reason: "stalled", layout };
      if (answer === null || answer === undefined) return { el, title, status: "failed", reason: "empty", layout };
      const base = parseAddress(answer);
      if (!base) return { el, title, status: "failed", reason: "address", layout };
      const input = { decl, layout, style: page.style, options: el.options, lang: opts.lang };
      return { el, title, status: "ok", layout, src: finalAddress(base, input), ...(decl.demo ? { demoSrc: finalAddress(base, input, true) } : {}) };
    } catch (error) {
      // Le message d'un module peut contenir une adresse secrète : on ne journalise que sa nature.
      console.error(`[overlays] element ${a.instance.key}/${decl.id} failed (${error instanceof Error ? error.name : "error"})`);
      return { el, title, status: "failed", reason: "error", layout };
    }
  };
  return Promise.all(page.elements.filter((e) => e.visible).map(one));
}
