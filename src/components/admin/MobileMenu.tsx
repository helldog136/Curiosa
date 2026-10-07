"use client";

import { useState } from "react";
import { ui } from "./ui";

/**
 * Menu d'admin : sur grand écran, la barre latérale est toujours visible ; sur téléphone, seule une barre (nom du site + bouton « Menu »)
 * reste en haut de la page et la liste des liens s'ouvre à la demande, au lieu de repousser le contenu des dizaines de lignes plus bas.
 */
export function MobileMenu({ brand, menuLabel, children }: { brand: React.ReactNode; menuLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface md:static md:min-h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 p-4 pb-3 md:pb-0">
        {brand}
        <button type="button" className={`${ui.btn} md:hidden`} aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>
          {open ? "✕" : "☰"} {menuLabel}
        </button>
      </div>
      <div id="admin-nav" className={`${open ? "block" : "hidden"} max-h-[calc(100dvh-4.5rem)] overflow-y-auto px-4 pb-4 md:block md:max-h-none md:overflow-visible`}>
        {children}
      </div>
    </aside>
  );
}
