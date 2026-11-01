"use client";

import { useEffect } from "react";

/**
 * Anciennes adresses à ancre (« /admin/settings#appearance ») : l'onglet a changé de page, l'adresse enregistrée dans un favori ou un message
 * mène donc à la nouvelle page. Le serveur ne voit pas l'ancre ; la redirection se fait dans le navigateur, dès l'affichage.
 */
export function LegacyHash({ map }: { map: Record<string, string> }) {
  useEffect(() => {
    const target = map[window.location.hash.slice(1)];
    if (target && Object.hasOwn(map, window.location.hash.slice(1))) window.location.replace(target);
  }, [map]);
  return null;
}
