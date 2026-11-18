"use client";

import { useEffect } from "react";

/**
 * (core 0.34.0) Stable deep links to the core's own sections: `/admin/site/general#core.privacy` leads to the core page, and this component turns the anchor `#core.privacy`
 * into the page's own (`#privacy`, the tab) as soon as the page is drawn. The server never sees the anchor, so it is done here; no module script is involved.
 */
export function CoreAnchors({ map }: { map: Record<string, string> }) {
  useEffect(() => {
    const apply = () => {
      const key = window.location.hash.slice(1);
      if (!Object.hasOwn(map, key)) return;
      const local = map[key]!;
      try { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${local ? `#${local}` : ""}`); } catch { /* sans historique : tant pis */ }
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      if (local) requestAnimationFrame(() => document.getElementById(local)?.scrollIntoView({ block: "start" }));
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [map]);
  return null;
}
