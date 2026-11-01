"use client";

import { useEffect, useId, useRef } from "react";
import { ui } from "./ui";

/**
 * BOÎTE DE FORMULAIRE : un bouton discret ouvre une boîte (élément <dialog> natif : Échap ferme, le focus y reste, le clavier suffit) qui contient un
 * formulaire préparé côté serveur. Sert à sortir d'une ligne de liste ce qui demande plusieurs champs (« Modifier ce rôle »), pour que toutes les lignes gardent
 * la même hauteur (règle R16). `closeWhen` : la boîte se referme d'elle-même 1,2 s après (le temps de lire « Enregistré »).
 */
export function FormDialog({ trigger, title, intro, closeLabel, children, closeWhen = false, onClose, wide = false, triggerLabel, testid }: {
  /** Texte du bouton qui ouvre la boîte. */
  trigger: string;
  title: string;
  /** Une phrase sous le titre. */
  intro?: string;
  closeLabel: string;
  children: React.ReactNode;
  closeWhen?: boolean;
  /** Appelé à la fermeture, quelle qu'en soit la cause (bouton, Échap, clic à côté). */
  onClose?: () => void;
  wide?: boolean;
  /** Nom accessible du bouton quand le texte seul ne dit pas sur quoi il agit (« Modifier le rôle Modération »). */
  triggerLabel?: string;
  testid?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!closeWhen) return;
    const timer = window.setTimeout(() => dialog.current?.close(), 1200);
    return () => window.clearTimeout(timer);
  }, [closeWhen]);
  useEffect(() => {
    const d = dialog.current;
    if (!d || !onClose) return;
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onClose]);
  return (
    <>
      <button type="button" aria-label={triggerLabel} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} className={`${ui.btn} min-h-11 whitespace-nowrap`} data-testid={testid}>{trigger}</button>
      <dialog ref={dialog} aria-labelledby={titleId}
        onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}
        className={`m-auto max-h-[90vh] ${wide ? "w-[min(94vw,44rem)]" : "w-[min(94vw,34rem)]"} overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60`}>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
              {intro && <p className="mt-1 text-sm leading-6 text-muted">{intro}</p>}
            </div>
            <button type="button" onClick={() => dialog.current?.close()} aria-label={closeLabel} title={closeLabel} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted hover:text-fg"><span aria-hidden>×</span></button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
