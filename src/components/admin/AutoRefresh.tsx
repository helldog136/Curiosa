"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recharge les données de la page toutes les `seconds` secondes tant que `active` (suivi d'une opération longue). */
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    // Pendant le redémarrage du serveur, le proxy répond 502 : on ne relit la page que si le serveur répond, sinon on attend le tour suivant.
    const id = setInterval(async () => {
      try {
        const r = await fetch(window.location.pathname, { method: "HEAD", cache: "no-store", redirect: "manual" });
        if (r.status >= 500) return;
      } catch { return; }
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [active, seconds, router]);
  return null;
}
