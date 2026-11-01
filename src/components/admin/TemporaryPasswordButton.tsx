"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ui } from "./ui";
import { PendingButton } from "./PendingButton";

export type TemporaryPasswordResult = { error?: string; password?: string; mailed?: boolean; name?: string; chosen?: boolean };

export type TemporaryPasswordLabels = {
  open: string; title: string; generate: string; generateHelp: string; custom: string; customLabel: string; customHelp: string; warning: string;
  apply: string; cancel: string; working: string;
  doneTitle: string; shownOnce: string; handOver: string; copy: string; copied: string; mailed: string; noMail: string; savedCustom: string; close: string;
};

/**
 * « Définir un mot de passe temporaire » (réservé au propriétaire, vérifié côté serveur). Une boîte : choix (généré par défaut, ou choisi), avertissement, puis,
 * en mode généré, le mot de passe affiché UNE SEULE FOIS. Il n'existe que dans l'état de cette boîte : fermée, il est effacé ; il n'est ni dans l'adresse, ni dans un cookie,
 * ni dans le stockage du navigateur. L'action est appelée comme une fonction (corps de la requête), pas par une adresse.
 */
export function TemporaryPasswordButton({ memberName, action, labels }: { memberName: string; action: (mode: string, password?: string) => Promise<TemporaryPasswordResult>; labels: TemporaryPasswordLabels }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"generate" | "custom">("generate");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TemporaryPasswordResult | null>(null);
  const [copied, setCopied] = useState(false);
  const id = useId();

  function reset() { setMode("generate"); setCustom(""); setBusy(false); setError(null); setResult(null); setCopied(false); }
  function show() { reset(); dialog.current?.showModal(); }
  function hide() { dialog.current?.close(); }
  // Quelle que soit la façon de fermer (bouton, Échap), tout est effacé.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.addEventListener("close", reset);
    return () => d.removeEventListener("close", reset);
  }, []);

  async function apply() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await action(mode, mode === "custom" ? custom : undefined);
      if (r.error) setError(r.error); else setResult(r);
    } catch {
      setError(labels.working);
    } finally {
      setBusy(false); setCustom("");
    }
  }

  async function copy() {
    if (!result?.password) return;
    try { await navigator.clipboard.writeText(result.password); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { const node = document.getElementById(`${id}-pw`); if (node) { const range = document.createRange(); range.selectNodeContents(node); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); } }
  }

  return (
    <>
      <button type="button" className={ui.btnDanger} onClick={show} data-testid="temp-password-open">{labels.open}</button>
      <dialog ref={dialog} aria-labelledby={`${id}-t`} onCancel={(e) => { if (busy) e.preventDefault(); }} className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-5 text-fg shadow-2xl backdrop:bg-black/60 sm:p-6" data-testid="temp-password-dialog">
        {result ? (
          <div className="space-y-4">
            <h3 id={`${id}-t`} className="text-lg font-semibold">{labels.doneTitle}</h3>
            {result.password ? (
              <>
                <p className="text-sm leading-6">{labels.shownOnce}</p>
                <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg p-3 sm:flex-row sm:items-center">
                  <code id={`${id}-pw`} translate="no" data-testid="temp-password-value" className="min-w-0 flex-1 select-all break-all font-mono text-xl tracking-wide">{result.password}</code>
                  <button type="button" onClick={copy} className={`${ui.btn} shrink-0`} aria-live="polite" data-testid="temp-password-copy">{copied ? `✓ ${labels.copied}` : labels.copy}</button>
                </div>
              </>
            ) : (
              <p className="text-sm leading-6">{labels.savedCustom}</p>
            )}
            <p className="text-sm leading-6 text-muted">{labels.handOver}</p>
            <p className="text-sm leading-6 text-muted">{result.mailed ? labels.mailed : labels.noMail}</p>
            <div className="flex justify-end"><button type="button" className={ui.btnPrimary} onClick={hide} data-testid="temp-password-close">{labels.close}</button></div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void apply(); }} className="space-y-4">
            <h3 id={`${id}-t`} className="text-lg font-semibold">{labels.title}</h3>
            <p className="text-sm text-muted">{memberName}</p>
            <fieldset className="space-y-3">
              <label className="flex items-start gap-3 text-sm"><input type="radio" name={`${id}-mode`} checked={mode === "generate"} onChange={() => setMode("generate")} className="mt-1 h-4 w-4 accent-[var(--v-accent)]" /><span><span className="font-medium">{labels.generate}</span><span className="block text-muted">{labels.generateHelp}</span></span></label>
              <label className="flex items-start gap-3 text-sm"><input type="radio" name={`${id}-mode`} checked={mode === "custom"} onChange={() => setMode("custom")} className="mt-1 h-4 w-4 accent-[var(--v-accent)]" /><span className="font-medium">{labels.custom}</span></label>
              {mode === "custom" && (
                <div>
                  <label htmlFor={`${id}-c`} className={ui.label}>{labels.customLabel}</label>
                  <input id={`${id}-c`} type="password" value={custom} onChange={(e) => setCustom(e.target.value)} autoComplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" required className={ui.input} data-testid="temp-password-custom" />
                  <p className={ui.help}>{labels.customHelp}</p>
                </div>
              )}
            </fieldset>
            <p className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm leading-6" data-testid="temp-password-warning">{labels.warning}</p>
            {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700" data-testid="temp-password-error">{error}</p>}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" className={ui.btn} onClick={hide} disabled={busy}>{labels.cancel}</button>
              <PendingButton variant="primary" pending={busy} pendingLabel={labels.working} testid="temp-password-apply">{labels.apply}</PendingButton>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
