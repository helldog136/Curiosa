"use client";

import { askConfirm } from "./confirmDialog";
import { ui } from "./ui";

/** Bouton de formulaire qui demande confirmation (boîte dans la page, jamais window.confirm) avant d'envoyer. */
export function ConfirmButton({ children, message, danger = true }: { children: React.ReactNode; message: string; danger?: boolean }) {
  return (
    <button className={danger ? ui.btnDanger : ui.btn} onClick={async (e) => { const form = e.currentTarget.form; e.preventDefault(); if (await askConfirm(message)) form?.requestSubmit(); }}>
      {children}
    </button>
  );
}
