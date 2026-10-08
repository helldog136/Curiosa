"use client";

import { useActionState } from "react";
import { ui } from "./ui";

export type ActionState = { ok?: string; error?: string } | null;

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Pas de bouton d'envoi (le formulaire en fournit un) */
  hideSubmit?: boolean;
  /** Demande confirmation (boîte du navigateur) avant d'envoyer. */
  confirm?: string;
};

/** Formulaire branché sur une action serveur, avec retour d'erreur / succès. */
export function ActionForm({ action, children, submitLabel, className = "space-y-4", hideSubmit, confirm: confirmMessage }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className} onSubmit={(e) => { if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault(); }}>
      {children}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      {!hideSubmit && (
        <button type="submit" disabled={pending} className={ui.btnPrimary}>
          {submitLabel}
        </button>
      )}
    </form>
  );
}
