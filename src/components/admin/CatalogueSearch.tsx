"use client";

import { useEffect, useRef, useState } from "react";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Barre de recherche du catalogue : elle filtre au fil de la frappe les fiches déjà affichées (`[data-catalogue-item]`, texte cherché dans
 * `data-search`), sans accents ni majuscules, tous les mots devant s'y trouver. Les rubriques vides disparaissent. « / » met le curseur dans la barre.
 */
export function CatalogueSearch({ placeholder, noneLabel, clearLabel }: { placeholder: string; noneLabel: string; clearLabel: string }) {
  const [query, setQuery] = useState("");
  const [none, setNone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    document.querySelectorAll<HTMLElement>("[data-catalogue-item]").forEach((el) => {
      const hit = words.every((w) => (el.dataset.search ?? "").includes(w));
      el.hidden = !hit;
      if (hit) shown++;
    });
    document.querySelectorAll<HTMLElement>("[data-catalogue-section]").forEach((sec) => {
      sec.hidden = sec.querySelectorAll("[data-catalogue-item]:not([hidden])").length === 0;
    });
    setNone(words.length > 0 && shown === 0);
  }, [query]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">🔍</span>
        <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          autoComplete="off" data-testid="catalogue-search"
          className="w-full rounded-full border border-line bg-bg py-3 pl-11 pr-24 text-base outline-none transition-colors focus:border-accent" />
        {query && <button type="button" onClick={() => { setQuery(""); input.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-sm text-muted hover:text-fg">{clearLabel}</button>}
      </div>
      {none && <p role="status" className="mt-4 text-muted" data-testid="catalogue-search-none">{noneLabel}</p>}
    </div>
  );
}
