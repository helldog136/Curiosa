"use client";

import { useEffect, useRef, useState } from "react";
import { groupFlagName } from "@/core/modules/groups";
import { ui } from "./ui";

/**
 * Groupe de réglages facultatif. Fermé : un seul bouton « ＋ Ajouter… ». Ouvert : une carte avec les champs et un bouton « Retirer ».
 * Le champ caché `__group__<id>` (1 ouvert / 0 retiré) dit au serveur quoi faire ; fermé, les champs ne sont pas dans le formulaire
 * (donc jamais contrôlés par le navigateur), et le serveur efface les valeurs du groupe.
 */
export function OptionalGroup({ id, title, addLabel, removeLabel, initiallyOpen, children }: {
  id: string; title: string; addLabel: string; removeLabel: string; initiallyOpen: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const body = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  // À l'ouverture par l'utilisateur (pas au premier affichage), le curseur va dans le premier champ.
  useEffect(() => {
    if (!open || !opened.current) return;
    body.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=file]):not([type=checkbox]), textarea, select")?.focus();
  }, [open]);

  return (
    <div data-optional-group={id}>
      <input type="hidden" name={groupFlagName(id)} value={open ? "1" : "0"} />
      {open ? (
        <section aria-label={title} className="space-y-4 rounded-2xl border border-line bg-bg/40 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold">{title}</h3>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2.5 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10">
              {removeLabel}
            </button>
          </div>
          <div ref={body} className="space-y-4">{children}</div>
        </section>
      ) : (
        <button type="button" onClick={() => { opened.current = true; setOpen(true); }} className={`${ui.btn} w-full justify-start border-dashed sm:w-auto`}>
          <span aria-hidden="true">＋</span> {addLabel}
        </button>
      )}
    </div>
  );
}
