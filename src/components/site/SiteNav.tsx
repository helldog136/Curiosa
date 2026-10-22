"use client";

import { useEffect, useId, useRef, useState } from "react";

export type NavLinkItem = { label: string; href: string; news: boolean };
export type NavItem = NavLinkItem & { children?: NavLinkItem[] };
export type NavStrings = { main: string; menu: string; submenu: string; news: string };

const LINK = "inline-flex min-h-11 items-center py-1.5 text-muted hover:text-fg sm:min-h-0";
const fmt = (s: string, name: string) => s.replace("{name}", name);

/**
 * Menu principal du site, avec ses sous-menus (deux niveaux). Sans JavaScript, c'est une liste de liens ordinaires : les sous-éléments sont de vrais liens,
 * visibles sous leur parent (la feuille de style de repli <noscript> montre tout et cache les boutons). Avec JavaScript :
 *  - un sous-menu s'ouvre avec le BOUTON flèche à côté du parent (ou le parent lui-même quand il n'a pas de page) : Entrée / Espace, ou ↓ sur le parent ;
 *    ↑ ↓ Début Fin se déplacent dans le sous-menu, Échap le ferme et rend le focus au bouton, Tab hors du menu le ferme ;
 *  - au toucher, un PREMIER toucher sur un parent qui a une page ouvre son sous-menu, un SECOND suit le lien ; à la souris, le survol ouvre (CSS pur) et le clic suit ;
 *  - sur petit écran, tout le menu tient dans un panneau (bouton « Menu ») et les sous-menus s'y déplient à la suite.
 * `aria-expanded` dit l'état aux lecteurs d'écran. Aucun minuteur ; le mouvement réduit supprime la rotation de la flèche. Le focus clavier est visible (style global).
 */
export function SiteNav({ items, strings }: { items: NavItem[]; strings: NavStrings }) {
  const base = useId().replace(/:/g, "");
  const [panel, setPanel] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLElement>(null);
  const pointer = useRef("");
  /** Quoi faire du focus une fois le sous-menu ouvert à l'écran : « first » (premier lien) ou « last ». */
  const pendingFocus = useRef<{ index: number; where: "first" | "last" } | null>(null);

  useEffect(() => {
    const want = pendingFocus.current;
    if (!want || open !== want.index) return;
    pendingFocus.current = null;
    const links = root.current?.querySelectorAll<HTMLElement>(`[data-sub="${want.index}"] a`);
    if (links?.length) (want.where === "first" ? links[0]! : links[links.length - 1]!).focus();
  }, [open]);

  useEffect(() => {
    if (!panel && open === null) return;
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setOpen(null); setPanel(false); } };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [panel, open]);

  const trigger = (index: number) => root.current?.querySelector<HTMLElement>(`[data-trigger="${index}"]`);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const inSub = target.closest<HTMLElement>("[data-sub]");
    if (e.key === "Escape") {
      if (open !== null) { e.preventDefault(); const i = open; setOpen(null); trigger(i)?.focus(); }
      else if (panel) { e.preventDefault(); setPanel(false); root.current?.querySelector<HTMLElement>("[data-panel-button]")?.focus(); }
      return;
    }
    if (inSub) {
      const links = [...inSub.querySelectorAll<HTMLElement>("a")];
      const at = links.indexOf(target as HTMLElement);
      const index = Number(inSub.getAttribute("data-sub"));
      if (e.key === "ArrowDown") { e.preventDefault(); links[Math.min(at + 1, links.length - 1)]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (at <= 0) trigger(index)?.focus(); else links[at - 1]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); links[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); links[links.length - 1]?.focus(); }
      return;
    }
    const row = target.closest<HTMLElement>("[data-row]");
    const index = row ? Number(row.getAttribute("data-row")) : -1;
    if (index >= 0 && e.key === "ArrowDown" && items[index]?.children?.length) {
      e.preventDefault();
      if (open === index) { root.current?.querySelector<HTMLElement>(`[data-sub="${index}"] a`)?.focus(); return; }
      pendingFocus.current = { index, where: "first" };
      setOpen(index);
    }
  }

  const dot = (
    <span data-testid="news-dot" role="img" aria-label={strings.news} title={strings.news} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
  );
  const chevron = (isOpen: boolean) => (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={`h-3 w-3 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}>
      <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <nav ref={root} aria-label={strings.main} data-site-nav="" className="text-sm"
      onKeyDown={onKeyDown} onPointerDown={(e) => { pointer.current = e.pointerType; }}
      onBlur={(e) => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to)) setOpen(null); }}>
      <noscript>
        {/* Sans JavaScript : tout le menu et tous les sous-menus sont visibles, à la suite ; les boutons (inutiles) disparaissent. */}
        <style>{`[data-site-nav] ul[data-nav-list]{display:flex!important;flex-wrap:wrap;gap:.25rem 1.25rem}[data-site-nav] ul[data-sub]{display:block!important;position:static!important;border:0!important;box-shadow:none!important;background:none!important;padding:0 0 0 .75rem!important}[data-site-nav] button{display:none!important}`}</style>
      </noscript>
      <button type="button" data-panel-button="" aria-expanded={panel} aria-controls={`${base}-list`} onClick={() => { setPanel((p) => !p); setOpen(null); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 py-2 font-medium hover:border-accent sm:hidden">
        <span aria-hidden="true">{panel ? "✕" : "☰"}</span> {strings.menu}
      </button>
      <ul id={`${base}-list`} data-nav-list="" className={`${panel ? "flex" : "hidden"} mt-2 flex-col gap-y-1 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:gap-x-5`}>
        {items.map((item, i) => {
          const kids = item.children ?? [];
          if (kids.length === 0) {
            return <li key={`${item.href}-${item.label}`}><a href={item.href} className={LINK}>{item.label}{item.news && dot}</a></li>;
          }
          const isOpen = open === i;
          const subId = `${base}-sub-${i}`;
          const toggle = () => setOpen((o) => (o === i ? null : i));
          return (
            <li key={`${i}-${item.label}`} data-row={i} className="group/sub relative">
              <div className="flex items-center gap-1">
                {item.href ? (
                  <>
                    <a href={item.href} data-link={i} className={LINK}
                      onClick={(e) => {
                        // Au toucher (ou au stylet), un premier toucher ouvre le sous-menu ; le second suit le lien. Un clic au clavier (detail 0) ou à la souris suit toujours.
                        if (e.detail > 0 && pointer.current !== "mouse" && pointer.current !== "" && !isOpen) { e.preventDefault(); setOpen(i); }
                      }}>
                      {item.label}{item.news && dot}
                    </a>
                    <button type="button" data-trigger={i} aria-expanded={isOpen} aria-controls={subId} aria-label={fmt(strings.submenu, item.label)} onClick={toggle}
                      className="inline-flex h-11 w-9 items-center justify-center rounded-lg text-muted hover:text-fg sm:h-8 sm:w-6">
                      {chevron(isOpen)}
                    </button>
                  </>
                ) : (
                  <button type="button" data-trigger={i} aria-expanded={isOpen} aria-controls={subId} onClick={toggle} className={`${LINK} gap-1`}>
                    {item.label}{chevron(isOpen)}
                  </button>
                )}
              </div>
              <ul id={subId} data-sub={i}
                className={`${isOpen ? "block" : "hidden"} pl-3 sm:absolute sm:left-0 sm:top-full sm:z-40 sm:min-w-48 sm:overflow-hidden sm:rounded-xl sm:border sm:border-line sm:bg-surface sm:py-1 sm:pl-0 sm:shadow-lg sm:group-hover/sub:block`}>
                {kids.map((c) => (
                  <li key={`${c.href}-${c.label}`}>
                    <a href={c.href} className="flex min-h-11 items-center py-1.5 text-muted hover:text-fg sm:px-4 sm:text-fg sm:hover:bg-accent sm:hover:text-accent-fg">{c.label}{c.news && dot}</a>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
