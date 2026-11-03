"use client";

import { useEffect, useId, useState } from "react";
import { ui } from "./ui";

/**
 * Un secret montré UNE SEULE FOIS (mot de passe provisoire donné à une autre personne). Il vit dans l'état de la page et nulle part ailleurs : ni dans l'adresse, ni dans un cookie,
 * ni dans le stockage du navigateur, ni dans le journal ; un rechargement, un changement de page ou « J'ai noté le mot de passe » l'efface. Le serveur écrit tous les textes
 * (`title`, `notes`, boutons) : le composant ne connaît aucune langue.
 */
export type OneTimeSecret = { value: string; title: string; notes: string[]; copy: string; copied: string; done: string };

/** La valeur, facile à sélectionner en entier, et son bouton « Copier ». Pas un champ de saisie : un gestionnaire de mots de passe n'a rien à y enregistrer. */
export function SecretValue({ value, copy, copied, testid }: { value: string; copy: string; copied: string; testid: string }) {
  const id = useId();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 2000);
    return () => window.clearTimeout(timer);
  }, [done]);

  async function onCopy() {
    try { await navigator.clipboard.writeText(value); setDone(true); }
    catch {
      // Presse-papiers refusé (page non sécurisée, autorisation retirée) : on sélectionne le texte, la personne n'a plus qu'à copier.
      const node = document.getElementById(id);
      if (node) { const range = document.createRange(); range.selectNodeContents(node); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg p-3 sm:flex-row sm:items-center">
      <code id={id} translate="no" data-testid={`${testid}-value`} className="min-w-0 flex-1 select-all break-all font-mono text-xl tracking-wide">{value}</code>
      <button type="button" onClick={onCopy} className={`${ui.btn} min-h-11 shrink-0`} aria-live="polite" data-testid={`${testid}-copy`}>{done ? `✓ ${copied}` : copy}</button>
    </div>
  );
}

/** Le bandeau de résultat d'une action qui renvoie un secret : valeur, « Copier », ce qu'il faut savoir, et « J'ai noté… » qui l'efface de la page. */
export function SecretReveal({ secret }: { secret: OneTimeSecret }) {
  const [hidden, setHidden] = useState(false);
  const id = useId();
  if (hidden) return null;
  return (
    <section aria-labelledby={`${id}-t`} className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="one-time-secret">
      <h3 id={`${id}-t`} className="text-base font-semibold">{secret.title}</h3>
      <SecretValue value={secret.value} copy={secret.copy} copied={secret.copied} testid="one-time-secret" />
      {secret.notes.map((note, i) => <p key={i} className={`text-sm leading-6 ${i === 0 ? "font-medium" : "text-muted"}`}>{note}</p>)}
      <div className="flex justify-end"><button type="button" className={`${ui.btn} min-h-11`} onClick={() => setHidden(true)} data-testid="one-time-secret-done">{secret.done}</button></div>
    </section>
  );
}
