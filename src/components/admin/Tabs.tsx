"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type TabDef = { id: string; label: string };

/**
 * Onglets en haut d'une page longue. Les panneaux sont des éléments quelconques portant `data-tab="<id>"` (ils peuvent se trouver dans des
 * formulaires différents, ou dans un seul : le formulaire reste entier, les panneaux masqués sont simplement cachés et continuent d'être envoyés).
 * `data-tab` accepte plusieurs ids séparés par des espaces (ex. un bouton « Enregistrer » commun à trois onglets).
 * L'onglet courant est mémorisé dans l'adresse (#apparence) : on peut le partager et il survit à un rechargement.
 * Si un champ obligatoire d'un onglet caché est invalide à l'envoi, on bascule sur son onglet au lieu de bloquer sans rien dire.
 */
const subscribeHash = (cb: () => void) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); };

export function Tabs({ tabs, initial, children }: { tabs: TabDef[]; initial?: string; children: React.ReactNode }) {
  const known = (id: string | undefined): id is string => !!id && tabs.some((t) => t.id === id);
  // L'adresse (#id) fait foi au chargement ; ensuite le choix de l'utilisateur (clic, ou bascule sur un champ invalide).
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? (known(hash) ? hash : known(initial) ? initial : tabs[0]!.id);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onInvalid = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tab]");
      const id = target?.dataset.tab?.split(" ").find((x) => tabs.some((t) => t.id === x));
      if (id) setPicked(id);
    };
    const el = root.current;
    el?.addEventListener("invalid", onInvalid, true);
    return () => el?.removeEventListener("invalid", onInvalid, true);
  }, [tabs]);

  const choose = (id: string) => { setPicked(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* sans historique : tant pis */ } };
  // Masquage par CSS (et non par rendu) : pas de clignotement au chargement, et tous les champs restent dans le formulaire.
  const css = tabs.map((t) => `[data-tabs-root][data-active="${t.id}"] [data-tab]:not([data-tab~="${t.id}"]){display:none}`).join("");

  return (
    <div ref={root} data-tabs-root data-active={active} className="space-y-6">
      <style>{css}</style>
      <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => choose(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[15px] font-medium transition-colors ${active === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
