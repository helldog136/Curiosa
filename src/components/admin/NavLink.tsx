"use client";

import { usePathname } from "next/navigation";

/** Lien du menu d'admin ; celui de la page ouverte est mis en évidence (et signalé aux lecteurs d'écran par aria-current). */
export function NavLink({ href, children, external, exact, also = [], badge = 0, badgeLabel, prominent = false }: { href: string; /** Entrée mise en avant (la gestion des modules) : bordure et fond d'accent, toujours visible. */ prominent?: boolean; children: React.ReactNode; external?: boolean; exact?: boolean; /** Autres chemins qui font aussi de ce lien le lien « courant » (pages liées sous une même entrée de menu). */ also?: string[]; badge?: number; badgeLabel?: string }) {
  const path = usePathname();
  const base = href.split("?")[0]!;
  const here = !external && ([base, ...also].some((b) => (exact ? path === b : path === b || path.startsWith(`${b}/`))));
  const cls = prominent
    ? "block rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-[15px] font-semibold text-accent shadow-sm transition-colors hover:bg-accent/20"
    : "block rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent";
  return (
    <a href={href} aria-current={here ? "page" : undefined} className={`${cls} ${here ? (prominent ? "bg-accent/25 ring-2 ring-accent/40" : "bg-accent/10 font-semibold text-accent") : ""}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span className="flex items-center justify-between gap-2">
        <span>{children}</span>
        {badge > 0 && <span data-testid="admin-badge" title={badgeLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {badgeLabel}</span></span>}
      </span>
    </a>
  );
}
