import { startTransition, type FormEvent } from "react";

/**
 * Envoi d'un formulaire à une action serveur SANS que React le remette à zéro.
 *
 * Avec `<form action={…}>`, React 19 vide tous les champs non contrôlés dès que l'action est terminée, même si elle répond par une erreur : la personne
 * perd ce qu'elle a tapé juste au moment où on lui demande de corriger un champ. On envoie donc nous-mêmes (`onSubmit`) : les valeurs restent affichées.
 * Le bouton qui a envoyé le formulaire est pris en compte (comme dans un envoi normal).
 */
export function submitKeepingValues(run: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter ?? undefined;
    const data = new FormData(form, submitter as HTMLElement | undefined);
    startTransition(() => run(data));
  };
}

/** Un mot de passe (ou tout champ secret) saisi ne reste jamais affiché après un envoi, réussi ou non. */
export function clearSecrets(form: HTMLFormElement | null): void {
  form?.querySelectorAll<HTMLInputElement>("input[type=password]").forEach((i) => { i.value = ""; });
}
