"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Compte la page vue, anonymement : un petit message envoyé après l'affichage (jamais de cookie, d'identifiant ni de script tiers).
 * Rien n'est envoyé si le visiteur a demandé de ne pas être suivi (Do Not Track / Global Privacy Control).
 */
export function VisitBeacon() {
  const path = usePathname();
  useEffect(() => {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    const body = JSON.stringify({ p: path, r: document.referrer });
    try { if (!navigator.sendBeacon("/api/hit", new Blob([body], { type: "text/plain" }))) throw new Error("beacon"); }
    catch { fetch("/api/hit", { method: "POST", body, keepalive: true }).catch(() => {}); }
  }, [path]);
  return null;
}
