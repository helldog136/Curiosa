"use client";

import { askConfirm } from "./confirmDialog";
import { ui } from "./ui";

/** Bouton de formulaire qui demande confirmation (boîte dans la page, jamais window.confirm) avant d'envoyer. */
export function ConfirmButton({ children, message, danger = true, confirmLabel, dangerConfirm = false }: { children: React.ReactNode; message: string; danger?: boolean; /** Texte du bouton qui valide la boîte (« Oui, tout effacer »…). */ confirmLabel?: string; /** Le bouton qui valide la boîte est rouge aussi. */ dangerConfirm?: boolean }) {
  return (
    <button className={danger ? ui.btnDanger : ui.btn} onClick={async (e) => { const form = e.currentTarget.form; e.preventDefault(); if (await askConfirm(message, { confirmLabel, danger: dangerConfirm })) form?.requestSubmit(); }}>
      {children}
    </button>
  );
}
