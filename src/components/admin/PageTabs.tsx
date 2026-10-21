"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
import { focusFirstError } from "./FieldErrors";
import { REVEAL_EVENT } from "./reveal";
import { errorTabToShow, keyTarget, leaveNeedsConfirm, withTab } from "./pageTabsModel";

export type PageTab = { id: string; label: string };
export type PageTabsLabels = { modified: string; error: string; leave: string; list: string };

/**
 * Onglets d'une page de module (cœur 0.2.2), motif WAI-ARIA « tabs » : `tablist` / `tab` / `tabpanel`, flèches gauche et droite, Début et Fin, focus visible, 44 px.
 *  - Les panneaux sont rendus par le serveur (`<TabPanel>`), TOUS présents dans la page : changer d'onglet ne perd rien de ce qui est saisi, chaque formulaire
 *    garde ses valeurs et la barre « Enregistrer » collante (ActionForm) enregistre tous les formulaires modifiés, quel que soit l'onglet affiché.
 *  - L'onglet actif vit dans l'adresse (`?tab=<id>`) : lien partageable, bouton Retour qui revient à l'onglet d'avant (page entière) ; dans une fenêtre
 *    par-dessus une liste (`history="replace"`), l'adresse est remplacée pour que « Fermer » (retour arrière) ferme bien la fenêtre. Ni cookie ni stockage.
 *  - Un point sur l'onglet modifié (formulaire `data-dirty`) ; un point ROUGE sur l'onglet qui a une erreur (champ `aria-invalid`, champ refusé par le
 *    navigateur, bandeau d'erreur) ; une erreur qui apparaît dans un onglet caché y fait basculer et met le focus sur le premier champ en erreur.
 *  - Mobile : la rangée défile horizontalement et reste collée en haut de l'écran (sous la barre du menu) ; l'onglet actif est toujours ramené dans la vue.
 *  - Quitter la page par un lien avec des modifications non enregistrées demande confirmation (la fermeture de l'onglet du navigateur est gardée par ActionForm).
 */
export function PageTabs({ tabs, initial, labels, history = "push", surface = "page", lead, children }: {
  tabs: PageTab[];
  /** Onglet ouvert quand l'adresse n'en demande aucun (choisi par le serveur : voir core/modules/tabs.ts `initialTab`). */
  initial: string;
  labels: PageTabsLabels;
  history?: "push" | "replace";
  /** Fond de la rangée collée : celui de la page ou celui d'une fenêtre. */
  surface?: "page" | "modal";
  /** Lien placé devant les onglets, dans la même rangée (ex. « Contenu » d'un module à contenu : une autre page, pas un onglet). */
  lead?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const known = useCallback((id: string | null | undefined): id is string => !!id && tabs.some((t) => t.id === id), [tabs]);
  const params = useSearchParams();
  const fromUrl = params?.get("tab") ?? null;
  const [active, setActive] = useState(known(fromUrl) ? fromUrl : known(initial) ? initial : tabs[0]?.id ?? "");
  // Retour / Avancer (ou toute autre mise à jour de l'adresse) : l'onglet suit l'adresse.
  const [seenUrl, setSeenUrl] = useState(fromUrl);
  if (seenUrl !== fromUrl) {
    setSeenUrl(fromUrl);
    const next = known(fromUrl) ? fromUrl : known(initial) ? initial : tabs[0]?.id ?? "";
    if (next !== active) setActive(next);
  }

  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Record<string, { dirty: boolean; error: boolean }>>({});
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const writeUrl = useCallback((id: string, mode: "push" | "replace") => {
    try {
      const target = withTab(window.location.href, id);
      if (!target) return;
      if (mode === "push") window.history.pushState(null, "", target); else window.history.replaceState(null, "", target);
    } catch { /* sans historique (aperçu, navigateur restreint) : l'onglet change quand même */ }
  }, []);

  /** Si la rangée est collée en haut (on avait défilé), on remonte au début du contenu de l'onglet : on ne tombe pas au milieu d'un autre onglet. */
  const toPanelTop = useCallback(() => {
    const el = row.current;
    const box = root.current;
    if (!el || !box) return;
    const stuck = el.getBoundingClientRect().top <= parseFloat(getComputedStyle(el).top || "0") + 1 && box.getBoundingClientRect().top < 0;
    if (!stuck) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }, []);

  const choose = useCallback((id: string, opts: { focus?: boolean; sync?: boolean; mode?: "push" | "replace" } = {}) => {
    if (!known(id)) return;
    if (opts.sync) flushSync(() => setActive(id)); else setActive(id);
    writeUrl(id, opts.mode ?? history);
    if (opts.focus) document.getElementById(`tab-${id}`)?.focus();
  }, [known, writeUrl, history]);

  // L'onglet actif toujours visible dans la rangée (mobile : rangée qui défile), sans faire défiler la page.
  useLayoutEffect(() => {
    const el = row.current;
    const tab = document.getElementById(`tab-${active}`);
    if (!el || !tab) return;
    const scroller = el.querySelector<HTMLElement>("[data-tabs-scroller]");
    if (!scroller) return;
    const left = tab.offsetLeft - scroller.offsetLeft;
    if (left < scroller.scrollLeft + 8 || left + tab.offsetWidth > scroller.scrollLeft + scroller.clientWidth - 8) {
      scroller.scrollTo({ left: Math.max(0, left - 24), behavior: "auto" });
    }
  }, [active]);

  // Rangée qui déborde (téléphone) : un fondu sur le bord où il reste des onglets cachés, pour montrer qu'elle défile.
  const [fade, setFade] = useState({ left: false, right: false });
  useEffect(() => {
    const scroller = row.current?.querySelector<HTMLElement>("[data-tabs-scroller]");
    if (!scroller) return;
    const update = () => {
      const next = { left: scroller.scrollLeft > 1, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 };
      setFade((f) => (f.left === next.left && f.right === next.right ? f : next));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { scroller.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  // Points « modifié » / « erreur » : lus dans la page (formulaires `data-dirty`, champs `aria-invalid`, bandeaux d'erreur), à chaque changement.
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    let previous = new Set<string>();
    let frame = 0;
    const read = () => {
      frame = 0;
      const next: Record<string, { dirty: boolean; error: boolean }> = {};
      const errored: string[] = [];
      for (const t of tabs) {
        const panel = document.getElementById(`tabpanel-${t.id}`);
        const dirty = !!panel?.querySelector('form[data-dirty="1"]');
        const error = !!panel?.querySelector('[aria-invalid="true"], [data-native-invalid], form > [role="alert"]');
        next[t.id] = { dirty, error };
        if (error) errored.push(t.id);
      }
      setMarks((m) => (JSON.stringify(m) === JSON.stringify(next) ? m : next));
      // Une erreur vient d'apparaître dans un onglet caché, et l'onglet affiché n'en a pas : on y va, focus sur le premier champ en erreur.
      const id = errorTabToShow(previous, errored, activeRef.current);
      previous = new Set(errored);
      if (id) {
        choose(id, { sync: true, mode: "replace" });
        requestAnimationFrame(() => focusFirstError(document.getElementById(`tabpanel-${id}`)));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    const observer = new MutationObserver(schedule);
    observer.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-dirty", "aria-invalid", "data-native-invalid", "role"] });
    read();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [tabs, choose]);

  // Champ refusé par le navigateur (obligatoire vide…) dans un onglet caché : on bascule AVANT que le navigateur cherche à l'afficher.
  // Un élément de la page demande à être montré (lien « Il reste à renseigner », ancre) : on ouvre son onglet.
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const panelOf = (el: Element | null) => el?.closest<HTMLElement>("[data-tab-panel]")?.dataset.tabPanel;
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLElement;
      el.setAttribute("data-native-invalid", "");
      const clear = () => { el.removeAttribute("data-native-invalid"); el.removeEventListener("input", clear); el.removeEventListener("change", clear); };
      el.addEventListener("input", clear); el.addEventListener("change", clear);
      const id = panelOf(el);
      if (id && id !== activeRef.current) choose(id, { sync: true, mode: "replace" });
    };
    const onReveal = (e: Event) => {
      const id = panelOf(e.target as Element);
      if (id && id !== activeRef.current) choose(id, { sync: true });
    };
    const onHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const el = hash ? document.getElementById(hash) : null;
      const id = el && box.contains(el) ? panelOf(el) : undefined;
      if (id && id !== activeRef.current) { choose(id, { sync: true, mode: "replace" }); el?.scrollIntoView({ block: "center" }); }
    };
    box.addEventListener("invalid", onInvalid, true);
    box.addEventListener(REVEAL_EVENT, onReveal);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => { box.removeEventListener("invalid", onInvalid, true); box.removeEventListener(REVEAL_EVENT, onReveal); window.removeEventListener("hashchange", onHash); };
  }, [choose]);

  // Avertissement avant de quitter par un lien avec des modifications non enregistrées (la fermeture/rechargement est gardée par ActionForm).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const dirty = !!document.querySelector('form[data-dirty="1"]');
      const ask = leaveNeedsConfirm({ href: a.href, rawHref: a.getAttribute("href") ?? "", target: a.target, download: a.hasAttribute("download") },
        { button: e.button, modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey }, window.location.href, dirty);
      if (ask && !window.confirm(labels.leave)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [labels.leave]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const j = keyTarget(e.key, tabs.findIndex((t) => t.id === active), tabs.length);
    const t = j === null ? undefined : tabs[j];
    if (!t) return;
    e.preventDefault();
    choose(t.id, { focus: true });
  };

  // Masquage par CSS (le serveur rend déjà le bon onglet : pas de clignotement) ; les panneaux masqués restent dans leurs formulaires.
  const css = `[data-page-tabs][data-active] [data-tab-panel]{display:none}${tabs.map((t) => `[data-page-tabs][data-active="${t.id}"] [data-tab-panel="${t.id}"]{display:block}`).join("")}`;
  const bleed = surface === "modal" ? "-mx-4 px-4 sm:-mx-8 sm:px-8 bg-surface" : "-mx-6 px-6 md:-mx-10 md:px-10 bg-bg";

  return (
    <div ref={root} data-page-tabs="" data-active={active} className="scroll-mt-[calc(var(--tabs-top,0px)+0.5rem)] space-y-6">
      <style>{css}</style>
      <div ref={row} data-testid="page-tabs-row" style={{ top: "var(--tabs-top, 0px)" }}
        className={`sticky z-20 ${bleed} border-b border-line/80 bg-opacity-95 pt-1 backdrop-blur`}>
        <div data-tabs-scroller="" data-fade-left={fade.left ? "1" : undefined} data-fade-right={fade.right ? "1" : undefined}
          style={fade.left || fade.right ? { maskImage: `linear-gradient(to right, ${fade.left ? "transparent, black 2rem" : "black"}, ${fade.right ? "black calc(100% - 2.5rem), transparent" : "black"})` } : undefined}
          className="-mb-px flex items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {lead && (
            <a href={lead.href} className="flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent px-3 text-[15px] font-medium text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
              {lead.label}<span aria-hidden className="ml-1.5 text-xs">↗</span>
            </a>
          )}
          {lead && <span aria-hidden className="my-2.5 w-px shrink-0 bg-line" />}
          <div role="tablist" aria-label={labels.list} aria-orientation="horizontal" onKeyDown={onKeyDown} className="flex items-stretch gap-1">
            {tabs.map((t) => {
              const on = t.id === active;
              const mark = marks[t.id];
              return (
                <button key={t.id} id={`tab-${t.id}`} type="button" role="tab" aria-selected={on} aria-controls={`tabpanel-${t.id}`} tabIndex={on ? 0 : -1}
                  data-testid={`tab-${t.id}`} data-dirty={mark?.dirty ? "1" : undefined} data-error={mark?.error ? "1" : undefined}
                  onClick={() => { choose(t.id); toPanelTop(); }}
                  className={`relative flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-4 ${on ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
                  {t.label}
                  {mark?.error ? (
                    <span data-testid={`tab-${t.id}-error`} className="inline-block h-2 w-2 rounded-full bg-red-600"><span className="sr-only"> ({labels.error})</span></span>
                  ) : mark?.dirty ? (
                    <span data-testid={`tab-${t.id}-dot`} className="inline-block h-2 w-2 rounded-full bg-accent"><span className="sr-only"> ({labels.modified})</span></span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Un panneau d'onglet (composant serveur ou client) : rendu tel quel, masqué par PageTabs quand son onglet n'est pas actif. */
export function TabPanel({ id, children, className = "space-y-8" }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} data-tab-panel={id} data-testid={`tabpanel-${id}`} tabIndex={0} className={`${className} focus-visible:outline-none`}>
      {children}
    </div>
  );
}
