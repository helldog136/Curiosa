"use client";

import { usePathname } from "next/navigation";

/** Lien du menu d'admin ; celui de la page ouverte est mis en évidence (et signalé aux lecteurs d'écran par aria-current). */
export function NavLink({ href, children, external, exact, badge = 0, badgeLabel }: { href: string; children: React.ReactNode; external?: boolean; exact?: boolean; badge?: number; badgeLabel?: string }) {
  const path = usePathname();
  const base = href.split("?")[0]!;
  const here = !external && (exact ? path === base : path === base || path.startsWith(`${base}/`));
  const cls = "block rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent";
  return (
    <a href={href} aria-current={here ? "page" : undefined} className={`${cls} ${here ? "bg-accent/10 font-semibold text-accent" : ""}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span className="flex items-center justify-between gap-2">
        <span>{children}</span>
        {badge > 0 && <span data-testid="admin-badge" title={badgeLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {badgeLabel}</span></span>}
      </span>
    </a>
  );
}
