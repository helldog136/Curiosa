"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { foldText, queryWords } from "@/core/adminkit/search";

export type EntrySearchLabels = {
  label: string;
  placeholder: string;
  clear: string;
  /** « {n} results » / « {n} result » : le compteur annoncé à voix haute (poliment) après chaque frappe. */
  count: string;
  countOne: string;
  none: string;
  tips: string;
  busy: string;
};

type Props = {
  labels: EntrySearchLabels;
  /** Adresse de la liste (sans paramètres) : la recherche du serveur y remplace `?q=`. */
  action: string;
  initialQuery: string;
  /** La liste complète ne tient pas sur une page : la frappe interroge aussi le serveur (délai de 250 ms), sinon seule la page affichée serait filtrée. */
  server: boolean;
  /** Nombre de résultats connu du serveur pour `initialQuery` (la liste affichée est déjà filtrée). */
  serverTotal: number;
  /** Le texte cherché de chaque entrée de la page affichée (même texte que `data-entry-search`) : sert à compter les résultats sans lire la page. */
  hays: string[];
  /** La liste (`EntryList`), rendue par le serveur : ses `li` portent `data-entry-search`. */
  children: React.ReactNode;
};

/**
 * RECHERCHE EN DIRECT d'une liste publique (règle R15 appliquée au site) : un champ qui filtre PENDANT LA FRAPPE, sans bouton ni rechargement, sans tenir compte
 * des majuscules ni des accents, dans tout ce qui est affiché (titre, résumé, mots-clés). Sans JavaScript, la liste entière reste affichée.
 * Liste sur une page : les lignes sont cachées / montrées dans le navigateur. Liste sur plusieurs pages (`server`) : en plus, le serveur filtre toute la liste
 * (`?q=`, remplacé sans recharger la page) puis re-découpe les pages. Pièce de skin : `search` (`data-variant="list"`), `input`, `button`.
 */
export function EntrySearch({ labels, action, initialQuery, server, serverTotal, hays, children }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [busy, startBusy] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const words = queryWords(query);
  // Montrer / cacher les lignes de la page affichée à chaque frappe, et chaque fois que le serveur remplace la liste.
  useEffect(() => {
    list.current?.querySelectorAll<HTMLElement>("[data-entry-search]").forEach((el) => {
      const hay = foldText(el.dataset.entrySearch ?? "");
      const ok = words.every((w) => hay.includes(w));
      el.hidden = !ok;
      el.style.display = ok ? "" : "none";
    });
  });
  const shown = hays.filter((h) => words.every((w) => foldText(h).includes(w))).length;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function toServer(value: string) {
    const q = value.trim();
    startBusy(() => router.replace(q ? `${action}?q=${encodeURIComponent(q)}` : action, { scroll: false }));
  }
  function change(value: string) {
    setQuery(value);
    if (!server) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => toServer(value), 250);
  }
  function clear() {
    setQuery("");
    if (server) { if (timer.current) clearTimeout(timer.current); toServer(""); }
    input.current?.focus();
  }

  const searching = words.length > 0;
  // La liste affichée est celle du serveur quand elle a été filtrée par lui ; sinon, ce qui reste visible dans la page.
  const serverAnswered = server && searching && query.trim() === initialQuery;
  const count = serverAnswered ? serverTotal : shown;
  const none = searching && !busy && (serverAnswered ? serverTotal === 0 : server ? false : shown === 0);
  const status = busy ? labels.busy : !searching || none ? "" : (count === 1 ? labels.countOne : labels.count).replace("{n}", String(count));

  return (
    <div className="space-y-4" data-entry-search-root="">
      <div role="search" data-skin-part="search" data-variant="list" className="space-y-2">
        <label htmlFor="entry-search-input" className="sr-only">{labels.label}</label>
        <div className="relative max-w-xl">
          <input
            ref={input} id="entry-search-input" type="search" value={query} onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); clear(); } }}
            placeholder={labels.placeholder} autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={80} data-skin-part="input" aria-busy={busy || undefined}
            className={`min-h-target w-full min-w-0 rounded-button border-token border-line bg-surface px-3 text-base text-fg placeholder:text-muted ${query ? "pr-28" : ""}`}
          />
          {query && (
            <button type="button" onClick={clear} data-skin-part="button" className="absolute right-1 top-1/2 inline-flex min-h-9 -translate-y-1/2 items-center rounded-button px-3 text-sm text-muted transition-colors hover:text-accent">
              {labels.clear}
            </button>
          )}
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{status}</p>
      </div>
      <div ref={list}>{children}</div>
      {none && (
        <div data-skin-part="notice" data-tone="info" role="status" className="space-y-2 rounded-card border-token border-line bg-surface p-4 text-sm" data-testid="entry-search-none">
          <p className="font-medium">{labels.none}</p>
          <p className="text-muted">{labels.tips}</p>
          <button type="button" onClick={clear} data-skin-part="button" className="inline-flex min-h-target items-center rounded-button border-token border-line bg-surface px-4 transition-colors hover:border-accent hover:text-accent">{labels.clear}</button>
        </div>
      )}
    </div>
  );
}
