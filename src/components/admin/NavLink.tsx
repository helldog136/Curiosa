"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { BadgeTone } from "@/core/blocks";
import { isCurrent } from "./navCurrent";
import { BADGE } from "./Badge";
import { MenuIcon } from "./MenuIcon";
import { TAB_CHOSEN_EVENT } from "./Tabs";
import type { MenuIconKey } from "@/core/adminSidebar";

// The fragment of the open page: two entries can share a page and differ by it (Team and Roles). The server renders without it; the browser adds it after hydration.
const subscribeHash = (cb: () => void) => { window.addEventListener("hashchange", cb); window.addEventListener(TAB_CHOSEN_EVENT, cb); return () => { window.removeEventListener("hashchange", cb); window.removeEventListener(TAB_CHOSEN_EVENT, cb); }; };

/** Lien du menu d'admin ; celui de la page ouverte est mis en évidence (et signalé aux lecteurs d'écran par aria-current). */
export function NavLink({ href, children, external, exact, also = [], badge = 0, badgeLabel, status, icon, newTabLabel, exceptHash }: { /** Line icon before the label (decorative). */ icon?: MenuIconKey; /** Added for screen readers on a link that opens in a new tab. */ newTabLabel?: string; href: string; children: React.ReactNode; external?: boolean; exact?: boolean; /** Autres adresses (chemin, requête permise) qui font aussi de ce lien le lien « courant » (pages liées sous une même entrée de menu). */ also?: string[]; badge?: number; badgeLabel?: string; /** Une pastille d'état écrite (couleur ET texte, jamais la couleur seule) à la place du nombre : « À jour ». */ status?: { label: string; tone: BadgeTone; hint?: string }; /** Fragments of this page that belong to another entry. */ exceptHash?: readonly string[] }) {
  const path = usePathname();
  const search = useSearchParams();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const here = !external && isCurrent(href, path, search, { exact, also, hash, ...(exceptHash ? { exceptHash } : {}) });
  // Every row is a 44 px target (F-RESP-001), with a visible focus ring.
  const cls = "flex min-h-11 items-center rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <a href={href} aria-current={here ? "page" : undefined} className={`${cls} ${here ? "bg-accent-tint font-semibold text-accent-text" : ""}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">{icon && <MenuIcon name={icon} />}<span className="min-w-0 break-words">{children}{external && newTabLabel && <span className="sr-only"> ({newTabLabel})</span>}</span></span>
        {status && <span data-testid="admin-status" title={status.hint} className={`rounded-full px-2 text-xs font-medium leading-5 ${BADGE[status.tone]}`}>{status.label}{status.hint && <span className="sr-only"> — {status.hint}</span>}</span>}
        {badge > 0 && <span data-testid="admin-badge" title={badgeLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {badgeLabel}</span></span>}
      </span>
    </a>
  );
}
