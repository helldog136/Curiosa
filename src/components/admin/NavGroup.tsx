"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isCurrent } from "./navCurrent";
import { NAV_STATE_COOKIE, isGroupOpen, parseNavState, serializeNavState } from "@/core/modules/menuPlacement";

/** Retient plié / déplié dans un cookie (lu par le serveur au prochain affichage : le menu n'a pas à « sauter »). */
function remember(id: string, open: boolean) {
  try {
    const mine = document.cookie.split("; ").find((c) => c.startsWith(`${NAV_STATE_COOKIE}=`));
    const state = parseNavState(mine ? decodeURIComponent(mine.slice(NAV_STATE_COOKIE.length + 1)) : "");
    state[id] = open;
    document.cookie = `${NAV_STATE_COOKIE}=${encodeURIComponent(serializeNavState(state))}; path=/; max-age=31536000; SameSite=Lax`;
  } catch { /* cookies refusés : le groupe se plie quand même, sans mémoire */ }
}

/**
 * Groupe pliable du menu d'admin. Rendu déjà dans le bon état côté serveur (`stored` vient du cookie, `openByDefault` de la taille du menu) ;
 * la page ouverte déplie toujours son groupe. `targets` : adresses des liens du groupe (avec leurs adresses liées).
 */
export function NavGroup({ id, title, targets, stored, openByDefault, badge = 0, badgeLabel, children }: { id: string; title: string; targets: string[]; stored?: boolean; openByDefault: boolean; /** Total des pastilles du groupe : montré tant qu'il est plié, pour qu'une action à faire ne se cache pas. */ badge?: number; badgeLabel?: string; children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const here = targets.some((t) => isCurrent(t, path, search));
  // Le choix de l'utilisateur (ou, à défaut, ce que le cookie a retenu) ; la page ouverte, elle, déplie toujours son groupe, y compris en arrivant par un lien ou le retour arrière.
  const [choice, setChoice] = useState<boolean | undefined>(stored);
  const open = isGroupOpen(id, choice === undefined ? {} : { [id]: choice }, openByDefault, here);
  return (
    <details open={open} data-nav-group={id} className="group mt-1">
      <summary
        onClick={(e) => { e.preventDefault(); if (here) return; setChoice(!open); remember(id, !open); }}
        className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:bg-accent/10 hover:text-accent [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className={`inline-block text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="flex-1">{title}</span>
        {!open && badge > 0 && <span data-testid="admin-badge" title={badgeLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {badgeLabel}</span></span>}
      </summary>
      <div className="ml-2 border-l border-line pl-2">{children}</div>
    </details>
  );
}
