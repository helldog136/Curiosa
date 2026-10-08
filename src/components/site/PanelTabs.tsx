"use client";

import { useId, useRef, useState } from "react";

export type PanelTab = { label: string; content: React.ReactNode; image?: string };

/** Onglets d'un bloc de page : la liste à gauche, le texte de l'onglet choisi au milieu, et l'image de l'onglet (ou l'image commune) à côté. Clavier : flèches, Début, Fin. */
export function PanelTabs({ tabs, side }: { tabs: PanelTab[]; side?: React.ReactNode }) {
  const [current, setCurrent] = useState(0);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => { const n = (i + tabs.length) % tabs.length; setCurrent(n); refs.current[n]?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(tabs.length - 1); }
  };
  const active = tabs[current];
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(10rem,14rem)_1fr]" data-testid="panel-tabs">
      <div role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto border-b border-line md:flex-col md:overflow-visible md:border-b-0 md:border-l">
        {tabs.map((t, i) => (
          <button key={i} ref={(el) => { refs.current[i] = el; }} role="tab" id={`${id}-t${i}`} aria-selected={i === current} aria-controls={`${id}-p`} tabIndex={i === current ? 0 : -1}
            onClick={() => setCurrent(i)} onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-left text-sm font-bold uppercase tracking-wide transition-colors md:-ml-px md:mb-0 md:border-b-0 md:border-l-2 ${i === current ? "border-accent text-accent" : "border-transparent hover:text-accent"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t${current}`} className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div className="space-y-3">{active?.content}</div>
        {active?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={active.image} alt="" loading="lazy" className="max-h-72 rounded-2xl object-cover" />
        ) : side ? <div className="mx-auto w-64 sm:w-72">{side}</div> : null}
      </div>
    </div>
  );
}
