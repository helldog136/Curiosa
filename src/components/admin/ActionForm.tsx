"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { FloatingLabels } from "./floating";
import { askConfirm } from "./confirmDialog";
import { ui } from "./ui";

export type ActionState = { ok?: string; error?: string } | null;

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Pas de bouton d'envoi (le formulaire en fournit un) */
  hideSubmit?: boolean;
  /** Bouton d'envoi discret (action secondaire de la page) : l'action principale reste la seule à être pleine couleur. */
  secondary?: boolean;
  /** Demande confirmation (boîte du navigateur) avant d'envoyer. */
  confirm?: string;
  /** Vide les champs après un succès : pour les formulaires qui CRÉENT quelque chose (utilisateur, redirection, jeton). Par défaut les valeurs saisies restent affichées. */
  reset?: boolean;
  /** Dans une page à onglets : les onglets (séparés par des espaces) où le bouton d'envoi est visible. */
  submitTabs?: string;
  /**
   * Barre flottante en bas, au centre de la page quand des modifications sont enregistrables : « Enregistrer » et « Annuler » restent à portée sans remonter ni
   * descendre dans une longue page de réglages. Pour les formulaires qui MODIFIENT quelque chose (réglages, menu, accueil, entrée), pas pour ceux qui créent.
   */
  floating?: FloatingLabels;
};

/** Formulaires dont la barre est affichée en ce moment, dans l'ordre d'apparition : plusieurs barres se superposent sans se recouvrir. */
const shown: string[] = [];
/** Formulaire et état « modifié » de chaque barre affichée : une seule barre sert pour toute la page (celle du premier formulaire), et enregistre tous les formulaires modifiés. */
const registry = new Map<string, { form: HTMLFormElement; dirty: boolean }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
function show(id: string, on: boolean, form?: HTMLFormElement | null, dirty = false) {
  if (on && form) registry.set(id, { form, dirty }); else registry.delete(id);
  const i = shown.indexOf(id);
  if (on && i === -1) shown.push(id);
  else if (!on && i !== -1) shown.splice(i, 1);
  emit();
}

/** Empreinte des valeurs actuelles du formulaire (champs texte, listes, cases, champs cachés des éditeurs) : deux empreintes différentes = des modifications. */
function snapshot(form: HTMLFormElement): string {
  const out: [string, string][] = [];
  for (const [k, v] of new FormData(form).entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out.push([k, v]);
  return JSON.stringify(out);
}

/** Formulaire branché sur une action serveur, avec retour d'erreur / succès. */
export function ActionForm({ action, children, submitLabel, className = "space-y-4", hideSubmit, secondary, confirm: confirmMessage, reset = false, submitTabs, floating }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // On n'utilise pas `<form action>` : React remettrait alors tous les champs à leur ancienne valeur après l'envoi (les listes et cases
  // reviendraient à ce qui était affiché avant l'enregistrement). On envoie nous-mêmes, et on ne vide que si `reset` le demande.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter ?? undefined;
    if (confirmMessage && !(await askConfirm(confirmMessage))) return;
    const data = new FormData(form, submitter as HTMLElement | undefined);
    startTransition(() => formAction(data));
  }
  useEffect(() => {
    if (!state?.ok || !ref.current) return;
    if (reset) ref.current.reset();
    // Un mot de passe saisi ne reste jamais affiché après l'envoi (même quand les autres champs gardent leur valeur).
    else ref.current.querySelectorAll<HTMLInputElement>("input[type=password]").forEach((i) => { i.value = ""; });
  }, [reset, state]);

  // ── Barre flottante ────────────────────────────────────────────────────────────────────────────────────────────────
  const id = useId();
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const leaving = useRef(false);
  /** Dernier résultat d'envoi déjà « consommé » (affiché quelques secondes, ou remplacé par de nouvelles modifications). */
  const [seen, setSeen] = useState<unknown>(null);
  const latest = useRef<unknown>(null);
  useEffect(() => { latest.current = state; }, [state]);
  const slot = useSyncExternalStore(subscribe, () => shown.indexOf(id), () => -1);
  useEffect(() => {
    if (!floating) return;
    const form = ref.current;
    if (!form) return;
    // Les éditeurs (menu, accueil, thème…) initialisent leurs champs cachés juste après l'affichage : la référence est prise un instant plus tard.
    const start = window.setTimeout(() => { baseline.current = snapshot(form); }, 500);
    const check = () => { if (baseline.current !== null) { const d = snapshot(form) !== baseline.current; setDirty(d); if (d) setSeen(latest.current); } };
    // Un éditeur React change ses champs cachés sans déclencher d'événement : en plus des événements, un contrôle régulier.
    const poll = window.setInterval(check, 400);
    form.addEventListener("input", check); form.addEventListener("change", check);
    const warn = (e: BeforeUnloadEvent) => { if (!leaving.current && baseline.current !== null && snapshot(form) !== baseline.current) { e.preventDefault(); e.returnValue = ""; } };
    const keys = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && baseline.current !== null && snapshot(form) !== baseline.current) { e.preventDefault(); form.requestSubmit(); } };
    window.addEventListener("beforeunload", warn); window.addEventListener("keydown", keys);
    return () => { window.clearTimeout(start); window.clearInterval(poll); form.removeEventListener("input", check); form.removeEventListener("change", check); window.removeEventListener("beforeunload", warn); window.removeEventListener("keydown", keys); show(id, false); };
  }, [floating, id]);
  // Après un envoi réussi, l'état actuel devient la nouvelle référence : la barre se retire (avec un « Enregistré » de quelques secondes).
  useEffect(() => {
    if (!floating || !ref.current || !state) return;
    if (state.ok) baseline.current = snapshot(ref.current);
    const form = ref.current;
    const recheck = window.setTimeout(() => setDirty(baseline.current !== null && snapshot(form) !== baseline.current), 0);
    const expire = window.setTimeout(() => setSeen(state), 4000);
    return () => { window.clearTimeout(recheck); window.clearTimeout(expire); };
  }, [floating, state]);
  const recent: "ok" | "error" | null = state && state !== seen ? (state.ok ? "ok" : state.error ? "error" : null) : null;
  const visible = !!floating && (dirty || recent !== null);
  useEffect(() => { show(id, visible, ref.current, dirty); }, [id, visible, dirty]);
  const anyDirty = slot === 0 && [...registry.values()].some((r) => r.dirty);
  const saveAll = () => { for (const r of [...registry.values()]) if (r.dirty) r.form.requestSubmit(); };

  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {children}
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      {!hideSubmit && !floating && (
        <div data-tab={submitTabs}>
          <button type="submit" disabled={pending} className={secondary ? ui.btn : ui.btnPrimary}>
            {submitLabel}
          </button>
        </div>
      )}
      {floating && <div aria-hidden="true" className="h-12" />}
      {floating && visible && slot <= 0 && (
        <div role="region" aria-label={floating.dirty} data-testid="floating-bar" style={{ bottom: "1.25rem" }}
          className="fixed left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur">
          {dirty || anyDirty ? (
            <>
              <span className="hidden text-sm text-muted sm:inline">{floating.dirty}</span>
              <button type="button" className={ui.btn} onClick={() => { if (window.confirm(floating.discardConfirm)) { leaving.current = true; window.location.reload(); } }}>{floating.discard}</button>
              <button type="button" onClick={saveAll} disabled={pending} className={ui.btnPrimary}>{submitLabel}</button>
            </>
          ) : recent === "ok" ? (
            <span role="status" className="text-sm font-medium text-emerald-700">✓ {floating.saved}</span>
          ) : (
            <span role="alert" className="text-sm font-medium text-red-700">{state?.error}</span>
          )}
        </div>
      )}
    </form>
  );
}
