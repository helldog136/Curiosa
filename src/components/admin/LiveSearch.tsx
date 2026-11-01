"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { foldText, queryWords } from "@/core/adminkit/search";
import { ui } from "./ui";

/**
 * RECHERCHE EN DIRECT (règle R15) : un champ « Rechercher » qui filtre PENDANT LA FRAPPE, sans bouton ni rechargement, sans seuil (une lettre filtre déjà), sans
 * tenir compte des majuscules ni des accents, en cherchant dans tout ce qui est affiché. Présent dès le départ, même quand la liste est courte. Quand rien ne
 * correspond : « Aucun résultat » et un bouton « Effacer la recherche ». Échap efface ; « / » met le curseur dans le champ.
 *
 * Deux façons de s'en servir :
 *  - `mode="page"` (défaut) : la liste est déjà dans la page (rendue par le serveur). Chaque ligne porte `data-live-item="<scope>"` et `data-search="<son texte>"`
 *    (voir `searchText()`), éventuellement `data-live-<clé>="<valeur>"` pour les pastilles (plusieurs valeurs possibles, séparées par une espace : une ligne « person editor » répond aux pastilles « person » et « editor ») ; un groupe porte `data-live-group="<scope>"` (il disparaît s'il
 *    est vide). Sans JavaScript la liste entière reste affichée.
 *  - `mode="server"` : la liste est paginée par le serveur ; la frappe interroge le serveur (délai de 250 ms) en remplaçant `?q=` dans l'adresse. Le serveur
 *    rend alors la bonne page (et le message « aucun résultat » de la liste, voir `NoResults`).
 */
/** Le champ « Rechercher » lui-même (partagé avec le bloc `table`) : loupe, bouton « Effacer la recherche » dès qu'il y a du texte, Échap efface. */
export function SearchField({ value, onChange, onClear, placeholder, clearLabel, busy, inputRef }: {
  value: string; onChange: (v: string) => void; onClear: () => void; placeholder: string; clearLabel: string; busy?: boolean; inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">🔍</span>
      <input ref={inputRef} type="search" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onClear(); } }}
        placeholder={placeholder} aria-label={placeholder} autoComplete="off" spellCheck={false} data-testid="live-search" aria-busy={busy || undefined}
        className={`${ui.input} min-h-11 rounded-full py-3 pl-11 ${value ? "pr-28" : "pr-4"}`} />
      {value && <button type="button" onClick={onClear} className="absolute right-2 top-1/2 min-h-9 -translate-y-1/2 rounded-full px-3 text-sm text-muted hover:text-fg">{clearLabel}</button>}
    </div>
  );
}

/** Une rangée de pastilles de filtre (une seule active) : le nombre de lignes de chacune est écrit dedans. */
export function Pills({ label, allLabel, options, value, onChange, pillKey }: {
  label: string; allLabel: string; options: { value: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void; pillKey: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2" data-live-pills={pillKey}>
      {[{ value: "all", label: allLabel, count: undefined as number | undefined }, ...options].map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent hover:text-accent"}`}>
            {o.label}{o.count !== undefined && <span className={on ? "opacity-80" : "text-muted"}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type LiveFilter = { key: string; allLabel: string; options: { value: string; label: string; count?: number }[] };

type Props = {
  scope: string;
  placeholder: string;
  noneLabel: string;
  clearLabel: string;
  /** Modèle du compteur, par exemple « {shown} sur {total} » ; absent : pas de compteur. */
  countLabel?: string;
  /** Pastilles de filtre (mode page) : une seule active par clé. */
  filters?: LiveFilter[];
  mode?: "page" | "server";
  /** Mode serveur : l'adresse de la page (sans paramètres), les autres paramètres à garder, le nom du paramètre de recherche (défaut « q ») et la valeur actuelle. */
  action?: string;
  keep?: Record<string, string>;
  param?: string;
  initialQuery?: string;
  /** « Recherche en cours… » (mode serveur). */
  busyLabel?: string;
  className?: string;
};

export function LiveSearch({ scope, placeholder, noneLabel, clearLabel, countLabel, filters = [], mode = "page", action, keep = {}, param = "q", initialQuery = "", busyLabel, className = "" }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [pills, setPills] = useState<Record<string, string>>({});
  const [none, setNone] = useState(false);
  const [counts, setCounts] = useState<{ shown: number; total: number } | null>(null);
  const [busy, startBusy] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mode page : montrer / cacher les lignes à chaque frappe ou choix de pastille.
  useEffect(() => {
    if (mode !== "page") return;
    const words = queryWords(query);
    let shown = 0, total = 0;
    document.querySelectorAll<HTMLElement>(`[data-live-item="${CSS.escape(scope)}"]`).forEach((el) => {
      total++;
      const hay = foldText(el.dataset.search ?? el.textContent ?? "");
      const textOk = words.every((w) => hay.includes(w));
      const pillsOk = Object.entries(pills).every(([key, want]) => want === "all" || (el.getAttribute(`data-live-${key}`) ?? "").split(" ").includes(want));
      el.hidden = !(textOk && pillsOk);
      if (!el.hidden) shown++;
    });
    document.querySelectorAll<HTMLElement>(`[data-live-group="${CSS.escape(scope)}"]`).forEach((g) => {
      g.hidden = g.querySelectorAll(`[data-live-item="${CSS.escape(scope)}"]:not([hidden])`).length === 0;
    });
    // Les compteurs s'affichent à l'image suivante (le filtrage des lignes, lui, est immédiat).
    const frame = requestAnimationFrame(() => { setNone(total > 0 && shown === 0); setCounts({ shown, total }); });
    return () => cancelAnimationFrame(frame);
  }, [mode, scope, query, pills]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  function toServer(value: string) {
    const params = new URLSearchParams(keep);
    if (value.trim()) params.set(param, value.trim());
    const qs = params.toString();
    startBusy(() => router.replace(`${action ?? ""}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }
  function change(value: string) {
    setQuery(value);
    if (mode !== "server") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => toServer(value), 250);
  }
  function clear() {
    change("");
    if (mode === "server") { if (timer.current) clearTimeout(timer.current); toServer(""); }
    setPills({});
    input.current?.focus();
  }

  const count = counts && countLabel && (query || Object.values(pills).some((v) => v !== "all")) ? countLabel.replace("{shown}", String(counts.shown)).replace("{total}", String(counts.total)) : "";
  return (
    <div className={`space-y-3 ${className}`} data-live-search={scope}>
      <SearchField value={query} onChange={change} onClear={clear} placeholder={placeholder} clearLabel={clearLabel} busy={busy} inputRef={input} />
      {filters.map((f) => (
        <Pills key={f.key} pillKey={f.key} label={f.allLabel} allLabel={f.allLabel} options={f.options} value={pills[f.key] ?? "all"} onChange={(v) => setPills((p) => ({ ...p, [f.key]: v }))} />
      ))}
      <p className="min-h-5 text-sm text-muted" role="status" aria-live="polite">{busy && busyLabel ? busyLabel : none ? "" : count}</p>
      {none && (
        <div role="status" className={`${ui.card} space-y-2 text-[15px]`} data-testid="live-search-none">
          <p className="font-medium">{noneLabel}</p>
          <button type="button" onClick={clear} className={`${ui.btn} min-h-11`}>{clearLabel}</button>
        </div>
      )}
    </div>
  );
}

/** Le message « Aucun résultat » d'une liste paginée par le serveur (mode `server`) : une phrase, puis « Effacer la recherche » (un lien, qui marche aussi sans JavaScript). */
export function NoResults({ message, clearLabel, href }: { message: string; clearLabel: string; href: string }) {
  return (
    <div role="status" className={`${ui.card} space-y-3 text-[15px]`} data-testid="live-search-none">
      <p className="font-medium">{message}</p>
      <a href={href} className={`${ui.btn} min-h-11`}>{clearLabel}</a>
    </div>
  );
}
