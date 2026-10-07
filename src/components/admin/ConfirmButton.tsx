"use client";

import { ui } from "./ui";

/** Bouton de formulaire qui demande confirmation avant d'envoyer. */
export function ConfirmButton({ children, message, danger = true }: { children: React.ReactNode; message: string; danger?: boolean }) {
  return (
    <button className={danger ? ui.btnDanger : ui.btn} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
