"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Spinner } from "./ActionKit";
import { createClickGuard } from "./clickGuard";

/** Fiches déjà réchauffées pendant cette visite (un survol de plus ne redemande rien). */
const warmed = new Set<string>();
export const WARM_ROUTE = "/api/admin/extension-warm";
/** Préchauffage à l'ouverture de la liste : seules les fiches À L'ÉCRAN, trois au plus par visite, une fois chacune (aucune boucle, aucun minuteur). */
export const AUTO_WARM_MAX = 3;
let autoWarmed = 0;

/** Demande au site de commencer à lire la fiche pendant que la personne décide de cliquer (jamais bloquant, jamais d'erreur visible). */
export function warm(query: string): void {
  if (warmed.has(query)) return;
  warmed.add(query);
  try { void fetch(`${WARM_ROUTE}?${query}`, { credentials: "same-origin", priority: "low" } as RequestInit).catch(() => warmed.delete(query)); } catch { warmed.delete(query); }
}

/** Retour visible dès le clic (R23) : le texte change, une roue tourne, et le lecteur d'écran l'annonce. Sert aussi à rouvrir le clic quand la navigation est finie. */
function Pending({ label, guard }: { label: string; guard: ReturnType<typeof createClickGuard> }) {
  const { pending } = useLinkStatus();
  useEffect(() => { if (!pending) guard.reset(); }, [pending, guard]);
  return <span aria-live="polite" className={pending ? "inline-flex items-center gap-2" : "sr-only"}>{pending && <><Spinner /><span>{label}</span></>}</span>;
}

/**
 * Le bouton « Voir le détail et installer » : la fiche se lit au survol, au focus ou au toucher (avant même le clic), un clic donne un retour tout de suite, et un
 * second clic pendant l'ouverture est ignoré (une seule navigation, pas de fiche ouverte deux fois).
 */
export function CatalogueDetailsLink({ href, query, className, children, pendingLabel }: { href: string; /** `id=…` ou `repo=…` : ce que le site réchauffe. */ query: string; className: string; children: React.ReactNode; pendingLabel: string }) {
  const [guard] = useState(createClickGuard);
  const start = () => warm(query);
  const spot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = spot.current;
    if (!el || typeof IntersectionObserver === "undefined" || autoWarmed >= AUTO_WARM_MAX) return;
    const seen = new IntersectionObserver((rows) => {
      if (rows.some((r) => r.isIntersecting) && autoWarmed < AUTO_WARM_MAX && !warmed.has(query)) { autoWarmed++; warm(query); }
      if (autoWarmed >= AUTO_WARM_MAX || rows.some((r) => r.isIntersecting)) seen.disconnect();
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [query]);
  // L'adresse a changé (la fiche s'est ouverte, ou s'est refermée) : le prochain clic compte de nouveau.
  const where = `${usePathname()}?${useSearchParams()}`;
  useEffect(() => { guard.reset(); }, [where, guard]);
  return (
    <Link href={href} scroll={false} className={className} onPointerEnter={start} onFocus={start} onTouchStart={start}
      onClick={(e) => { if (!guard.begin()) e.preventDefault(); }}>
      <span ref={spot}>{children}</span>
      <Pending label={pendingLabel} guard={guard} />
    </Link>
  );
}
