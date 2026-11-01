"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pills, SearchField } from "./LiveSearch";
import { ui } from "./ui";

export type JournalFilterLabels = {
  search: string; clear: string; busy: string;
  module: string; moduleAll: string; level: string; levelAll: string; kind: string; kindAll: string; period: string; periodAll: string;
};
type Option = { value: string; label: string };

/**
 * Filtres du journal (page « Journal d'audit » et onglet « Historique » d'un module) : la recherche filtre PENDANT LA FRAPPE (le serveur est interrogé 250 ms après la
 * dernière lettre, la liste est paginée côté serveur), l'origine se choisit par pastilles (couleur et texte), le niveau, la période et l'extension par listes.
 * Tout vit dans l'adresse (partageable, bouton Retour) ; les paramètres qui ne sont pas ceux du journal sont gardés tels quels (`prefix` : voir core/journal/query.ts).
 */
export function JournalFilters({ prefix, initial, modules, levels, kinds, periods, labels }: {
  prefix: string;
  initial: { q: string; module: string; level: string; kind: string; period: string };
  modules?: Option[];
  levels: Option[]; kinds: Option[]; periods: Option[];
  labels: JournalFilterLabels;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(initial.q);
  const [busy, startBusy] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Remplace des paramètres du journal dans l'adresse actuelle (la page revient à 1). */
  function go(change: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    next.delete(`${prefix}page`);
    for (const [k, v] of Object.entries(change)) { if (v) next.set(`${prefix}${k}`, v); else next.delete(`${prefix}${k}`); }
    const qs = next.toString();
    startBusy(() => router.replace(`${path}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }
  function type(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: value.trim() }), 250);
  }
  function clear() {
    setQuery("");
    if (timer.current) clearTimeout(timer.current);
    go({ q: "" });
  }
  const read = (k: string, fallback: string) => params?.get(`${prefix}${k}`) ?? fallback;
  const select = (key: "module" | "level" | "period", label: string, all: string, options: Option[]) => (
    <div className="min-w-[11rem] flex-1">
      <label htmlFor={`${prefix}journal-${key}`} className="mb-1 block text-sm font-medium">{label}</label>
      <select id={`${prefix}journal-${key}`} value={read(key, initial[key])} onChange={(e) => go({ [key]: e.target.value })} className={`${ui.input} min-h-11`}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="journal-filters" aria-busy={busy || undefined}>
      <SearchField value={query} onChange={type} onClear={clear} placeholder={labels.search} clearLabel={labels.clear} busy={busy} />
      <div className="flex flex-wrap items-end gap-4">
        {modules && select("module", labels.module, labels.moduleAll, modules)}
        {select("level", labels.level, labels.levelAll, levels)}
        {select("period", labels.period, labels.periodAll, periods)}
      </div>
      <Pills label={labels.kind} allLabel={labels.kindAll} options={kinds} value={read("kind", initial.kind) || "all"} onChange={(v) => go({ kind: v === "all" ? "" : v })} pillKey="kind" />
      <p className="sr-only" role="status" aria-live="polite">{busy ? labels.busy : ""}</p>
    </div>
  );
}
