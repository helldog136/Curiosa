"use client";

import { usePathname } from "next/navigation";

export const LEGACY_PAGE = "/admin/maintenance/legacy";

/**
 * Bandeau « mise à niveau pas terminée » de l'administration. Caché sur la page Entretien elle-même : elle dit déjà la même chose, en détail
 * (le bandeau y serait un doublon).
 */
export function LegacyBanner({ title, text, link, ownerNote }: { title: string; text: string; link: string | null; ownerNote: string | null }) {
  const pathname = usePathname();
  if (pathname === LEGACY_PAGE || pathname?.startsWith(`${LEGACY_PAGE}/`)) return null;
  return (
    <div role="status" data-testid="legacy-banner" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3.5 text-sm leading-6">
      <p className="font-medium">{title}</p>
      <p>{text}</p>
      {link ? <a href={LEGACY_PAGE} className="font-medium text-accent underline">{link}</a> : <p className="text-muted">{ownerNote}</p>}
    </div>
  );
}
