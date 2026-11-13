"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { BadgeTone } from "@/core/blocks";
import { isCurrent } from "./navCurrent";
import { BADGE } from "./Badge";

/** Lien du menu d'admin ; celui de la page ouverte est mis en évidence (et signalé aux lecteurs d'écran par aria-current). */
export function NavLink({ href, children, external, exact, also = [], badge = 0, badgeLabel, status, touch }: { /** (0.13.0) 44 px tall (entries of the module tree). */ touch?: boolean; href: string; children: React.ReactNode; external?: boolean; exact?: boolean; /** Autres adresses (chemin, requête permise) qui font aussi de ce lien le lien « courant » (pages liées sous une même entrée de menu). */ also?: string[]; badge?: number; badgeLabel?: string; /** Une pastille d'état écrite (couleur ET texte, jamais la couleur seule) à la place du nombre : « À jour ». */ status?: { label: string; tone: BadgeTone; hint?: string } }) {
  const path = usePathname();
  const search = useSearchParams();
  const here = !external && isCurrent(href, path, search, { exact, also });
  const cls = `${touch ? "flex min-h-11 items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" : "block"} rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent`;
  return (
    <a href={href} aria-current={here ? "page" : undefined} className={`${cls} ${here ? "bg-accent/10 font-semibold text-accent" : ""}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span className="flex items-center justify-between gap-2">
        <span>{children}</span>
        {status && <span data-testid="admin-status" title={status.hint} className={`rounded-full px-2 text-xs font-medium leading-5 ${BADGE[status.tone]}`}>{status.label}{status.hint && <span className="sr-only"> — {status.hint}</span>}</span>}
        {badge > 0 && <span data-testid="admin-badge" title={badgeLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {badgeLabel}</span></span>}
      </span>
    </a>
  );
}
