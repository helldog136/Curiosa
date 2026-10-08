"use client";

import { usePathname } from "next/navigation";

/** Lien du menu d'admin ; celui de la page ouverte est mis en évidence (et signalé aux lecteurs d'écran par aria-current). */
export function NavLink({ href, children, external, exact }: { href: string; children: React.ReactNode; external?: boolean; exact?: boolean }) {
  const path = usePathname();
  const base = href.split("?")[0]!;
  const here = !external && (exact ? path === base : path === base || path.startsWith(`${base}/`));
  const cls = "block rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent";
  return (
    <a href={href} aria-current={here ? "page" : undefined} className={`${cls} ${here ? "bg-accent/10 font-semibold text-accent" : ""}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      {children}
    </a>
  );
}
