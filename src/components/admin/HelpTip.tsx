"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useReducer, useRef } from "react";
import { HELP_BUBBLE_MAX_WIDTH, TIP_CLOSED, helpAriaLabel, helpText, isLongHelp, placeBubble, tipReducer } from "./helpRule";

const LabelCtx = createContext("Help: {name}");

/** Donne aux boutons « ? » de l'admin leur libellé accessible déjà traduit (« Aide : {name} »), sans le repasser champ par champ. */
export function HelpTipProvider({ label, children }: { label: string; children: React.ReactNode }) {
  return <LabelCtx.Provider value={label}>{children}</LabelCtx.Provider>;
}

/**
 * Bouton « ? » d'un champ d'administration qui ouvre l'aide dans une bulle (aide longue seulement : voir `isLongHelp`). À poser À CÔTÉ du libellé, jamais dedans.
 * Souris : survol. Clavier : focus (Entrée / Espace épingle, Échap ferme). Toucher : un appui ouvre, un appui ailleurs ferme.
 * Texte seulement (React l'échappe : jamais de HTML), bulle en position fixe (aucun décalage de la mise en page, jamais rognée par un cadre), bornée à 320 px et
 * ramenée dans l'écran, sans minuteur ni bibliothèque. Sans JavaScript, `HelpBelow` affiche le texte sous le champ et ce bouton est masqué.
 */
export function HelpTip({ help, name }: { help?: string | null; name: string }) {
  const template = useContext(LabelCtx);
  const id = useId();
  const [state, send] = useReducer(tipReducer, TIP_CLOSED);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const long = isLongHelp(help);
  const open = long && state.open;

  const place = () => {
    const b = button.current, p = bubble.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const size = { width: p.offsetWidth, height: p.offsetHeight };
    const at = placeBubble({ left: r.left, top: r.top, width: r.width, height: r.height }, size, { width: document.documentElement.clientWidth, height: window.innerHeight });
    p.style.left = `${at.left}px`;
    p.style.top = `${at.top}px`;
  };

  // Avant l'affichage : la bulle est posée au bon endroit dès la première image (aucun saut visible).
  useLayoutEffect(() => { if (open) place(); });
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (!root.current?.contains(e.target as Node)) send("outside"); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") send("escape"); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (!long || !help) return null;
  const text = helpText(help);
  return (
    <span ref={root} data-helptip="" className="inline-flex shrink-0 align-middle"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") send("mouseEnter"); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") send("mouseLeave"); }}>
      <button ref={button} type="button" aria-label={helpAriaLabel(template, name)} aria-expanded={open} aria-describedby={id}
        onClick={() => send("click")}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) send("keyboardFocus"); }}
        onBlur={() => send("blur")}
        className="group -my-[11px] -ml-1 inline-flex h-11 w-11 shrink-0 cursor-help items-center justify-center rounded-full">
        <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold leading-none transition-colors group-hover:border-accent group-hover:text-accent ${open ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-muted"}`}>?</span>
      </button>
      <span ref={bubble} id={id} role="tooltip" hidden={!open}
        style={{ position: "fixed", left: 0, top: 0, width: "max-content", maxWidth: `min(${HELP_BUBBLE_MAX_WIDTH}px, calc(100vw - 16px))` }}
        className="help-tip-bubble z-50 whitespace-pre-line rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] font-normal leading-5 text-fg shadow-lg [overflow-wrap:anywhere]">
        {text}
      </span>
    </span>
  );
}

/**
 * Ce qui reste SOUS le champ : l'aide courte, en clair (comme avant) ; pour une aide longue (portée par le bouton « ? »), uniquement un repli sans JavaScript :
 * le texte s'affiche en clair et le bouton, inutile alors, est masqué. Un composant sans état : il sert aussi bien côté serveur que côté client.
 */
export function HelpBelow({ help, className, id }: { help?: string | null; className: string; id?: string }) {
  if (!help || !help.trim()) return null;
  if (!isLongHelp(help)) return <p id={id} className={className}>{help}</p>;
  return (
    <noscript>
      <style>{"[data-helptip]{display:none}"}</style>
      <p className={className}>{help}</p>
    </noscript>
  );
}
