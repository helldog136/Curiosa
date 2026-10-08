"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
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
  /** Vide les champs après un succès : pour les formulaires qui CRÉENT quelque chose (utilisateur, redirection, jeton). Par défaut les valeurs saisies restent affichées. */
  reset?: boolean;
  /** Dans une page à onglets : les onglets (séparés par des espaces) où le bouton d'envoi est visible. */
  submitTabs?: string;
};

/** Formulaire branché sur une action serveur, avec retour d'erreur / succès. */
export function ActionForm({ action, children, submitLabel, className = "space-y-4", hideSubmit, confirm: confirmMessage, reset = false, submitTabs }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // On n'utilise pas `<form action>` : React remettrait alors tous les champs à leur ancienne valeur après l'envoi (les listes et cases
  // reviendraient à ce qui était affiché avant l'enregistrement). On envoie nous-mêmes, et on ne vide que si `reset` le demande.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter ?? undefined;
    const data = new FormData(e.currentTarget, submitter as HTMLElement | undefined);
    startTransition(() => formAction(data));
  }
  useEffect(() => {
    if (!state?.ok || !ref.current) return;
    if (reset) ref.current.reset();
    // Un mot de passe saisi ne reste jamais affiché après l'envoi (même quand les autres champs gardent leur valeur).
    else ref.current.querySelectorAll<HTMLInputElement>("input[type=password]").forEach((i) => { i.value = ""; });
  }, [reset, state]);
  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {children}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      {!hideSubmit && (
        <div data-tab={submitTabs}>
          <button type="submit" disabled={pending} className={ui.btnPrimary}>
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
