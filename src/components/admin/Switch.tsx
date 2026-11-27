"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { HelpBelow, HelpTip } from "./HelpTip";
import { FieldErrorText } from "./FieldErrors";
import { ui } from "./ui";

/**
 * INTERRUPTEUR D'ÉTAT. Il MONTRE l'état courant (règle R17 : un interrupteur n'est pas un verbe « Activer / Désactiver »), la couleur ne suffit jamais (le rail
 * porte aussi une coche quand il est activé et un tiret quand il ne l'est pas), et la cible fait au moins 44 px. Dans une liste (`quiet`, règle R37), le mot d'état
 * n'est PAS écrit à côté : il reste dans le nom accessible (« Lien /twitch, activé ») pour les lecteurs d'écran ; hors liste, il s'écrit en toutes lettres. Deux formes, une seule apparence :
 *   - `Switch`      effet IMMÉDIAT (dans une liste) : un clic appelle `onToggle(suivant)`. L'interrupteur bascule tout de suite, reste « en cours » pendant l'appel,
 *                   affiche le retour juste à côté (`ok`) et REVIENT EN ARRIÈRE avec le message d'erreur si l'appel échoue (`error` ou exception).
 *   - `SwitchField` dans un FORMULAIRE : une vraie case à cocher (`role="switch"`) qui part avec le formulaire (valeur « on », absente si décochée).
 */

/** Ce que renvoie l'appel : `error` (texte) fait revenir en arrière ; `ok` est le message de réussite. Rien du tout (ou `{}`) = réussi sans message. */
export type SwitchResult = { ok?: string; error?: string } | void | null;

const TRACK = "relative inline-block h-6 w-11 shrink-0 rounded-full border transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:shadow after:transition-transform after:content-['']";
const TRACK_ON = "bg-accent border-accent after:translate-x-5";
const TRACK_OFF = "bg-line/60 border-line-strong";

/** L'indice qui ne dépend pas de la couleur (R28, R37) : une coche à gauche quand c'est activé, un tiret à droite quand ce ne l'est pas (la poignée occupe l'autre moitié). */
function TrackCue({ on }: { on: boolean }) {
  return on
    ? <svg aria-hidden="true" viewBox="0 0 16 16" className="absolute left-1 top-1 h-3.5 w-3.5 text-accent-fg" data-switch-cue="on"><path d="M3 8.5l3.2 3L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16" className="absolute right-1 top-1 h-3.5 w-3.5 text-muted" data-switch-cue="off"><path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

/** Le message de retour reste affiché 3 secondes (une erreur reste jusqu'au prochain clic). */
const OK_MS = 3000;

export function Switch({ label, checked, onToggle, onText, offText, quiet, disabled, failedText, className = "", testid }: {
  /** Nom accessible (« Lien /twitch actif ») : décrit la chose, pas l'action. */
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => Promise<SwitchResult> | SwitchResult;
  /** L'état en toutes lettres (« Actif » / « Désactivé »), à côté de l'interrupteur ; avec `quiet`, seulement dans le nom accessible. */
  onText?: string;
  offText?: string;
  /** Interrupteur de ligne (R37) : aucun mot d'état écrit, l'état reste dans le nom accessible. */
  quiet?: boolean;
  disabled?: boolean;
  /** Texte si l'appel échoue sans message (« Impossible, réessayez »). */
  failedText?: string;
  className?: string;
  testid?: string;
}) {
  const [on, setOn] = useState(checked);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La page se recharge avec la vraie valeur du serveur : l'interrupteur la suit.
  const [seen, setSeen] = useState(checked);
  if (seen !== checked) { setSeen(checked); setOn(checked); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function change() {
    if (pending || disabled) return;
    const next = !on;
    if (timer.current) clearTimeout(timer.current);
    setOn(next);
    setNote(null);
    start(async () => {
      let result: SwitchResult;
      try { result = await onToggle(next); } catch { result = { error: failedText ?? "!" }; }
      if (result && result.error) { setOn(!next); setNote({ tone: "error", text: result.error }); return; }
      if (result && result.ok) {
        setNote({ tone: "ok", text: result.ok });
        timer.current = setTimeout(() => setNote(null), OK_MS);
      }
    });
  }

  const state = on ? onText : offText;
  const name = quiet && state ? `${label}, ${state}` : label;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 ${className}`} data-testid={testid}>
      <button type="button" role="switch" aria-checked={on} aria-label={name} aria-busy={pending || undefined} disabled={disabled} onClick={change}
        className="group inline-flex min-h-11 items-center gap-2 rounded-xl px-1 disabled:cursor-not-allowed disabled:opacity-60 aria-busy:cursor-progress">
        <span aria-hidden="true" className={`${TRACK} ${on ? TRACK_ON : TRACK_OFF} ${pending ? "opacity-70" : ""}`}><TrackCue on={on} /></span>
        {state && !quiet && <span className="text-sm">{state}</span>}
      </button>
      {/* Le retour est juste à côté de ce qu'on a touché : annoncé aux lecteurs d'écran, jamais seulement coloré. */}
      <span role={note?.tone === "error" ? "alert" : "status"} className={`text-xs ${note?.tone === "error" ? "font-medium text-red-700" : "text-emerald-700"}`}>
        {note ? <>{note.tone === "error" ? <span aria-hidden="true">⚠ </span> : <span aria-hidden="true">✓ </span>}{note.text}</> : null}
      </span>
    </span>
  );
}

/**
 * L'interrupteur d'un FORMULAIRE : même apparence, mais c'est une case à cocher qui part avec le formulaire. Toute la ligne se coche (cible de 44 px).
 * `name` : nom du champ (reçu « on » si coché, absent sinon) ; `label` : ce que veut dire « activé » (« Compter les clics »), jamais une phrase négative.
 */
export function SwitchField({ label, name, defaultChecked, help, example, error, value = "on", required, onText, offText }: {
  label: string; name: string; defaultChecked?: boolean; help?: string; example?: string; error?: string; value?: string; required?: boolean; onText?: string; offText?: string;
}) {
  const [on, setOn] = useState(Boolean(defaultChecked));
  const id = `sw_${name}`;
  const state = on ? onText : offText;
  return (
    <div>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
          <input id={id} type="checkbox" role="switch" name={name} value={value} defaultChecked={defaultChecked} required={required} onChange={(e) => setOn(e.currentTarget.checked)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `err-${name}` : undefined} className="peer sr-only" />
          <span aria-hidden="true" className={`${TRACK} ${on ? TRACK_ON : TRACK_OFF} peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${error ? "!border-red-500" : ""}`}><TrackCue on={on} /></span>
          <span>{label}</span>
          {state && <span className="text-sm text-muted">{state}</span>}
        </label>
        <HelpTip help={help} name={label} />
      </div>
      <HelpBelow help={help} className={ui.help} />
      {example && <p className={ui.help}>{example}</p>}
      <FieldErrorText id={`err-${name}`} message={error ?? null} />
    </div>
  );
}
