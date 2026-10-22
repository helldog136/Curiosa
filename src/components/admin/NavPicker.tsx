"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchMenu } from "@/app/admin/(panel)/navigation/searchActions";
import type { CatalogGroup, CatalogItem, CatalogPage } from "@/core/menuCatalog";
import { ui } from "./ui";

const GROUPS: CatalogGroup[] = ["system", "instance", "entry", "redirect"];
/** Attente après la dernière touche avant de chercher (pas de minuteur de fond : il est annulé à chaque frappe et à la fermeture). */
const DEBOUNCE_MS = 250;

type Strings = Record<string, string>;
type GroupState = { items: CatalogItem[]; next: string | null; loading: boolean; error: boolean; loaded: boolean };
const BUSY: GroupState = { items: [], next: null, loading: true, error: false, loaded: false };

const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

/**
 * « Ajouter au menu » : un champ de recherche (accents et majuscules ignorés) au-dessus des résultats rangés par origine (pages du site, pages des extensions,
 * contenus, raccourcis). Chaque groupe se pagine (« Voir plus »). Ce qui est déjà au menu est marqué « Déjà dans le menu » (bouton qui reste atteignable
 * au clavier mais ne fait rien : le focus ne se perd pas). Réponses ordonnées : seule la réponse à la DERNIÈRE recherche compte.
 */
export function NavPicker({ strings, inMenu, onAdd, onClose, full }: { strings: Strings; inMenu: (i: CatalogItem) => boolean; onAdd: (i: CatalogItem) => void; onClose: () => void; full: boolean }) {
  const base = useId().replace(/:/g, "");
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Record<CatalogGroup, GroupState>>({ system: BUSY, instance: BUSY, entry: BUSY, redirect: BUSY });
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  /** Une page d'un groupe : le résultat n'est gardé que si aucune recherche plus récente n'est partie entre-temps. */
  async function fetchGroup(group: CatalogGroup, text: string, cursor: string | null, mine: number) {
    let page: CatalogPage | null = null;
    try { const r = await searchMenu(group, text, cursor); page = r.ok ? r.page : null; } catch { page = null; }
    if (mine !== seq.current) return;
    setGroups((g) => {
      const cur = g[group];
      return { ...g, [group]: page ? { items: cursor ? [...cur.items, ...page.items.filter((p) => !cur.items.some((c) => c.ref === p.ref && c.kind === p.kind))] : page.items, next: page.next, loading: false, error: false, loaded: true } : { ...cur, loading: false, error: true, loaded: true } };
    });
  }

  /** Nouvelle recherche (depuis un geste) : les quatre groupes repartent de zéro. */
  function start(text: string) {
    const mine = ++seq.current;
    setGroups({ system: BUSY, instance: BUSY, entry: BUSY, redirect: BUSY });
    void Promise.all(GROUPS.map((g) => fetchGroup(g, text, null, mine)));
  }

  function more(group: CatalogGroup, cursor: string) {
    setGroups((g) => ({ ...g, [group]: { ...g[group], loading: true } }));
    void fetchGroup(group, q, cursor, seq.current);
  }

  useEffect(() => {
    const mine = ++seq.current;
    void Promise.all(GROUPS.map((g) => fetchGroup(g, "", null, mine)));
    input.current?.focus();
    const stamp = seq;
    const pending = timer;
    return () => { stamp.current++; clearTimeout(pending.current); };
  }, []);

  // Annonce aux lecteurs d'écran, sans état en plus : « Recherche en cours… » puis le nombre de résultats une fois les quatre groupes arrivés.
  const total = GROUPS.reduce((n, g) => n + groups[g].items.length, 0);
  const settled = GROUPS.every((g) => groups[g].loaded && !groups[g].loading);
  const live = !settled ? strings.loading ?? "" : total === 0 ? strings.noResults ?? "" : fmt(strings.results ?? "", { n: total });

  function onType(text: string) {
    setQ(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => start(text), DEBOUNCE_MS);
  }

  return (
    <div className={`${ui.card} space-y-4`} data-testid="nav-picker" role="group" aria-labelledby={`${base}-title`}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <p id={`${base}-title`} className="font-semibold">{strings.pickPage}</p>
      <div>
        <label htmlFor={`${base}-q`} className={ui.label}>{strings.searchLabel}</label>
        <input ref={input} id={`${base}-q`} type="search" value={q} onChange={(e) => onType(e.target.value)} placeholder={strings.searchPlaceholder} autoComplete="off" maxLength={80}
          aria-describedby={`${base}-help`} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer.current); start(q); } }} className={ui.input} />
        <p id={`${base}-help`} className={ui.help}>{strings.searchHelp}</p>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{live}</p>
      {full && <p className="text-sm font-medium text-amber-700">{strings.totalFull}</p>}
      {GROUPS.map((g) => {
        const s = groups[g];
        if (s.loaded && !s.loading && s.items.length === 0 && !s.error) return null;
        return (
          <section key={g} aria-labelledby={`${base}-${g}`} className="space-y-2">
            <h3 id={`${base}-${g}`} className="text-xs font-semibold uppercase tracking-wide text-muted">{strings[`group.${g}`]}</h3>
            {s.loading && s.items.length === 0 && <p className={ui.help}>{strings.loading}</p>}
            {s.error && <p className="text-sm font-medium text-red-700" role="alert">{strings.unreachable}</p>}
            <ul className="grid gap-2 sm:grid-cols-2">
              {s.items.map((it) => {
                const done = inMenu(it);
                return (
                  <li key={`${it.kind}:${it.ref}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium leading-tight">{it.title}</span>
                      <span className="block break-all text-xs text-muted">{it.sub}</span>
                      {it.suggested && <span className={`${ui.chip} mt-1`}>{strings.suggested}</span>}
                    </span>
                    <button type="button" aria-disabled={done || full} aria-label={`${done ? strings.inMenu : strings.addOne} : ${it.title}`}
                      onClick={() => { if (!done && !full) onAdd(it); }}
                      className={`${done ? "inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-muted" : `${ui.btn} min-h-11 shrink-0 ${full ? "opacity-60" : ""}`}`}>
                      {done ? strings.inMenu : strings.addOne}
                    </button>
                  </li>
                );
              })}
            </ul>
            {s.next && (
              <button type="button" className={`${ui.btn} min-h-11`} disabled={s.loading} onClick={() => more(g, s.next!)}>{s.loading ? strings.loading : strings.more}</button>
            )}
          </section>
        );
      })}
      <button type="button" className={`${ui.btn} min-h-11`} onClick={onClose}>{strings.cancel}</button>
    </div>
  );
}
