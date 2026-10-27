"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cookieWrites, hasAccepted, modeFor, type TrayAction, type TrayLabels, type TrayMode } from "@/core/cookieTray";

/** Événement envoyé par le lien « Cookies » du pied de page (et de /privacy) pour rouvrir le bandeau. */
export const OPEN_EVENT = "curiosa:cookies-open";

/**
 * Bandeau de cookies : un panneau qui monte du bas de l'écran (voir core/cookieTray.ts pour ce qui est déposé).
 * Non bloquant : le reste de la page reste utilisable ; Échap = « plus tard » (rien n'est accepté, il ne revient pas pendant la session).
 */
export function CookieTray({ labels, privacyHref, initialOpen }: { labels: TrayLabels; privacyHref: string; initialOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<TrayMode>("ask");
  const [status, setStatus] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const hide = useCallback((message: string, refocus: boolean) => {
    setStatus(message);
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      if (refocus) opener.current?.focus();
    }, 220);
  }, []);

  const act = useCallback((action: TrayAction) => {
    for (const c of cookieWrites[action]) document.cookie = c;
    const message = action === "accept" ? labels.doneAccepted : action === "withdraw" ? labels.doneWithdrawn : action === "refuse" ? labels.doneRefused : "";
    hide(message, opener.current !== null);
    // La page est rendue côté serveur : on la relit pour que les pastilles « nouveautés » suivent le choix.
    if (action === "accept" || action === "withdraw") router.refresh();
  }, [hide, labels, router]);

  useEffect(() => {
    const reopen = (e: Event) => {
      opener.current = (e as CustomEvent<{ from?: HTMLElement }>).detail?.from ?? null;
      setMode(modeFor(hasAccepted(document.cookie)));
      setStatus("");
      setClosing(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "ask") act("later"); else hide("", opener.current !== null);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, mode, act, hide]);

  // Ouvert par le visiteur lui-même : on place le focus dans le bandeau. Au chargement, on ne vole pas le focus.
  useEffect(() => {
    if (open && opener.current) root.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [open]);

  const withdraw = mode === "withdraw";
  return (
    <div data-skin-region="tray">
      <p role="status" aria-live="polite" className="sr-only" data-testid="cookie-status">{status}</p>
      {open && (
        <div ref={root} data-skin-part="cookie-tray" role="dialog" aria-modal="false" aria-labelledby="cookie-tray-title" aria-describedby="cookie-tray-desc" data-testid="cookie-tray" data-mode={mode} data-closing={closing ? "1" : undefined}
          className="cookie-tray fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto border-t border-line bg-surface text-fg shadow-[0_-8px_30px_rgba(0,0,0,0.18)] sm:bottom-4 sm:left-4 sm:right-4 sm:mx-auto sm:max-w-3xl sm:rounded-2xl sm:border">
          <div className="space-y-2 px-4 py-3 text-[13px] leading-snug sm:space-y-3 sm:px-6 sm:py-5 sm:text-sm sm:leading-normal">
            <h2 id="cookie-tray-title" data-skin-part="heading" data-level="2" className="text-[15px] sm:text-base font-semibold">{withdraw ? labels.withdrawTitle : labels.title}</h2>
            <div id="cookie-tray-desc" className="space-y-2 sm:space-y-3">
              {withdraw ? <p>{labels.withdrawText}</p> : (
                <>
                  <p>{labels.intro}</p>
                  <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                    <section className="space-y-0.5 border-l-2 border-line pl-3 sm:space-y-1 sm:rounded-xl sm:border sm:p-3">
                      <h3 data-skin-part="eyebrow" data-level="3" className="text-xs font-semibold uppercase tracking-wide text-muted">{labels.necessaryTitle}</h3>
                      <p>{labels.necessaryText}</p>
                    </section>
                    <section className="space-y-0.5 border-l-2 border-line pl-3 sm:space-y-1 sm:rounded-xl sm:border sm:p-3">
                      <h3 data-skin-part="eyebrow" data-level="3" className="text-xs font-semibold uppercase tracking-wide text-muted">{labels.optionalTitle}</h3>
                      <p>{labels.optionalText}</p>
                    </section>
                  </div>
                  <p className="text-muted">{labels.promise}</p>
                </>
              )}
              <p><a href={privacyHref} data-skin-part="link" className="underline underline-offset-2 hover:text-accent">{labels.more}</a></p>
            </div>
            <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse sm:justify-start">
              {withdraw ? (
                <>
                  <button type="button" data-skin-part="button" data-autofocus data-testid="cookie-withdraw" onClick={() => act("withdraw")} className="rounded-full border-2 border-accent bg-accent px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-accent-fg hover:opacity-90 sm:py-2">{labels.withdraw}</button>
                  <button type="button" data-skin-part="button" data-testid="cookie-close" onClick={() => hide("", opener.current !== null)} className="rounded-full border-2 border-line px-5 py-2.5 text-[13px] sm:text-sm font-semibold hover:border-accent sm:py-2">{labels.close}</button>
                </>
              ) : (
                <>
                  <button type="button" data-skin-part="button" data-autofocus data-testid="cookie-accept" onClick={() => act("accept")} className="rounded-full border-2 border-accent bg-accent px-5 py-2.5 text-[13px] sm:text-sm font-semibold text-accent-fg hover:opacity-90 sm:py-2">{labels.accept}</button>
                  <button type="button" data-skin-part="button" data-testid="cookie-refuse" onClick={() => act("refuse")} className="rounded-full border-2 border-line px-5 py-2.5 text-[13px] sm:text-sm font-semibold hover:border-accent sm:py-2">{labels.refuse}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lien discret (pied de page, page de confidentialité) qui rouvre le bandeau. Sans JavaScript, il mène à la page de confidentialité. */
export function CookieSettingsLink({ label, href, className, part }: { label: string; href: string; className?: string; part?: string }) {
  return (
    <a href={href} data-testid="cookie-settings" data-skin-part={part} className={className}
      onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { from: e.currentTarget } })); }}>
      {label}
    </a>
  );
}
