"use client";

import { askConfirm } from "./confirmDialog";
import { PendingButton } from "./PendingButton";

/**
 * Bouton de formulaire qui demande confirmation (boîte dans la page, jamais window.confirm) avant d'envoyer. Une fois envoyé il montre qu'il travaille
 * (rouet, `aria-busy`, inactif : pas de double envoi) ; `pendingLabel` dit quoi (« Suppression… »), à défaut « Je m'en occupe… ».
 */
export function ConfirmButton({ children, message, danger = true, confirmLabel, dangerConfirm = false, pendingLabel }: { children: React.ReactNode; message: string; danger?: boolean; /** Texte du bouton qui valide la boîte (« Oui, tout effacer »…). */ confirmLabel?: string; /** Le bouton qui valide la boîte est rouge aussi. */ dangerConfirm?: boolean; /** Texte pendant l'action. */ pendingLabel?: string }) {
  return (
    <PendingButton variant={danger ? "danger" : "btn"} pendingLabel={pendingLabel}
      onClick={async (e) => { const form = e.currentTarget.form; e.preventDefault(); if (await askConfirm(message, { confirmLabel, danger: dangerConfirm })) form?.requestSubmit(); }}>
      {children}
    </PendingButton>
  );
}
