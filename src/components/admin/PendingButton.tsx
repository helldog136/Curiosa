"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { LabelStack, Spinner } from "./ActionKit";
import { DONE_FLASH_MS, SHOW_BUSY_AFTER_MS } from "./animatedAction";
import { useProgressText } from "./ProgressLabels";

/** Vrai quand `value` est vrai depuis au moins `delayMs` ; faux dès que `value` retombe. */
export function useDelayedTrue(value: boolean, delayMs: number): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setArmed(true), delayMs);
    return () => { clearTimeout(timer); setArmed(false); };
  }, [value, delayMs]);
  return value && armed;
}

const BASE = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition disabled:cursor-progress";
const VARIANTS = {
  btn: `${BASE} border border-line bg-surface font-medium shadow-sm hover:border-accent hover:text-accent`,
  primary: `${BASE} bg-accent px-5 font-semibold text-accent-fg shadow-sm hover:brightness-110`,
  danger: `${BASE} border border-red-500/40 bg-surface font-medium text-red-600 hover:bg-red-500/10`,
  /** Texte cliquable discret (« Ne plus proposer », « Annuler »…) : sans cadre, mais une cible de 44 px. */
  link: "inline-flex min-h-11 items-center justify-center gap-2 px-1 text-sm text-muted underline-offset-2 transition hover:underline disabled:cursor-progress",
} as const;

export type PendingButtonProps = {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  /** Texte pendant l'action (« Installation… ») ; par défaut « Je m'en occupe… ». */
  pendingLabel?: string;
  /** Texte de fin, quelques instants (« Terminé ») ; sans lui, pas de message de fin. */
  doneLabel?: string;
  /** État fourni par l'appelant (formulaire piloté par `useActionState`) ; sinon celui du formulaire parent (`useFormStatus`). */
  pending?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  className?: string;
  testid?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  "aria-label"?: string;
};

/**
 * Bouton d'un formulaire qui lance une action sur le serveur. Dès le clic il est inactif (pas de double envoi) ; après un court instant il montre un rouet et
 * « en cours » (`aria-busy`), puis « Terminé » quelques secondes. Sa largeur ne bouge pas. Annonce début et fin aux lecteurs d'écran (`aria-live`).
 */
export function PendingButton({ children, variant = "btn", pendingLabel, doneLabel, pending: controlled, disabled = false, type = "submit", className = "", testid, onClick, title, "aria-label": ariaLabel }: PendingButtonProps) {
  const status = useFormStatus();
  const p = useProgressText();
  const pending = controlled ?? status.pending;
  const busy = useDelayedTrue(pending, SHOW_BUSY_AFTER_MS);
  const [flash, setFlash] = useState(false);
  // Quand l'action se termine (`pending` retombe), « Terminé » s'affiche quelques instants.
  useEffect(() => {
    if (!pending || !doneLabel) return;
    return () => setFlash(true);
  }, [pending, doneLabel]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), DONE_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const working = pendingLabel ?? p("working");
  const showDone = flash && !pending;
  const shown = busy ? 1 : showDone ? 2 : 0;
  const labels = [children, working, ...(doneLabel ? [doneLabel] : [])];
  return (
    <>
      <button type={type} disabled={disabled || pending} aria-busy={pending ? true : undefined} aria-label={ariaLabel} title={title} onClick={onClick}
        data-testid={testid} data-pending={pending ? "true" : "false"} data-phase={busy ? "working" : showDone ? "done" : "idle"}
        className={`${VARIANTS[variant]} ${disabled && !pending ? "opacity-60" : ""} ${className}`}>
        {busy && <Spinner />}
        {showDone && <span aria-hidden="true">✓</span>}
        <LabelStack labels={labels} shown={shown} />
      </button>
      <span role="status" aria-live="polite" className="sr-only">{busy ? working : showDone ? doneLabel : ""}</span>
    </>
  );
}
