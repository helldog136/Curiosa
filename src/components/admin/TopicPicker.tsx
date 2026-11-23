"use client";

import { PLAIN_INPUT } from "./managerHints";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { foldText as fold } from "@/core/modules/installedList";

export type TopicOption = { id: string; title: string; group: string; count: number; href: string };
export type TopicPickerLabels = { label: string; search: string; none: string; all: string; remove: string; list: string };

/**
 * (core 0.37.0) The filter of the extension catalogue by « what the extension adds settings to »: ONE compact control instead of a chip per page (R19: more than ten choices
 * = a search). A native `<details>` (it opens and closes without a script), a search box that filters the places as the person types, the places grouped as the menu is,
 * each with its number of extensions. The choice is a plain link (`?topic=`): the address stays shareable and Back works. The chosen place is shown as a removable chip.
 */
export function TopicPicker({ options, current, allHref, labels }: { options: TopicOption[]; current: string | null; allHref: string; labels: TopicPickerLabels }) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const chosen = options.find((o) => o.id === current) ?? null;
  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => fold(`${o.group} ${o.title}`).includes(w)));
  }, [options, query]);
  const groups = [...new Set(shown.map((o) => o.group))];

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const outside = (e: Event) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && el.open) { el.open = false; el.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key); };
  }, []);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="topic-facets">
      <details ref={root} className="relative" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) queueMicrotask(() => input.current?.focus()); else setQuery(""); }}>
        <summary data-testid="topic-picker" aria-label={labels.label}
          className="inline-flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-bg px-4 text-[15px] font-medium transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span>{labels.label}</span><span aria-hidden className="text-xs text-muted">▾</span>
        </summary>
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-2 shadow-lg">
          <label htmlFor={`${id}-q`} className="sr-only">{labels.search}</label>
          <input id={`${id}-q`} ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={labels.search} {...PLAIN_INPUT} data-testid="topic-search"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const first = shown[0]; if (first) window.location.assign(first.href); } }}
            className="min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base outline-none focus:border-accent" />
          <ul aria-label={labels.list} className="mt-2 max-h-72 overflow-y-auto">
            {!query && <li><a href={allHref} aria-current={current === null ? "true" : undefined} data-testid="topic-all" className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-accent/10">{labels.all}</a></li>}
            {groups.map((g) => (
              <li key={g} role="presentation">
                {g && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</p>}
                <ul>
                  {shown.filter((o) => o.group === g).map((o) => (
                    <li key={o.id}><a href={o.href} aria-current={o.id === current ? "true" : undefined} data-testid={`topic-${o.id}`}
                      className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-sm hover:bg-accent/10 ${o.id === current ? "bg-accent/10 font-medium" : ""}`}><span>{o.title}</span><span className="text-xs text-muted">{o.count}</span></a></li>
                  ))}
                </ul>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted" role="status">{labels.none}</li>}
          </ul>
        </div>
      </details>
      {chosen && (
        <a href={allHref} data-testid="topic-chip" aria-label={labels.remove.replace("{name}", chosen.title)} title={labels.remove.replace("{name}", chosen.title)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-accent bg-accent px-4 text-sm font-medium text-accent-fg">
          <span>{chosen.group ? `${chosen.group} › ` : ""}{chosen.title}</span><span aria-hidden>✕</span>
        </a>
      )}
    </div>
  );
}
