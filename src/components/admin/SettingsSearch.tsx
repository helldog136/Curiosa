"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchHref } from "@/core/adminLinks";
import { parseSearch, searchEntries, searchModules, splitMatches, type SearchEntry } from "@/core/modules/placeSearch";

/** R15: a long list is paged at 50; « Show more » adds the next 50. */
const PAGE_SIZE = 50;

export type SettingsSearchLabels = {
  placeholder: string; label: string; none: string; clear: string; count: string; moduleAll: string; moduleLabel: string; advanced: string; modified: string;
  all: string; filters: string; seeAll: string; setting: string; section: string; empty: string; loading: string; failed: string; more: string;
};

/**
 * Global settings search (core 0.34.0). Two shapes of one component:
 *  - `menu`: a box at the top of the sidebar. The index is fetched once, on the first focus; results drop down under the box while the person types (no button, no reload),
 *    arrow keys and Enter work, Escape closes, Enter with nothing chosen opens the full page.
 *  - `page`: the page `/admin/search`: the box, the filters (module, advanced, modified) and every result with its breadcrumb. The entries come with the page, so the
 *    first answer is drawn by the server too (no script needed to read it).
 * Only data is filtered here: no module script runs, no HTML is built from a label (matches are split into text pieces).
 */
export function SettingsSearch({ variant, labels, endpoint, initial, initialQuery = "", advancedMode }: {
  variant: "menu" | "page"; labels: SettingsSearchLabels; endpoint: string; initial?: SearchEntry[]; initialQuery?: string; advancedMode: boolean;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<SearchEntry[] | null>(initial ?? null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [query, setQuery] = useState(initialQuery);
  const [module, setModule] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [modified, setModified] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [more, setMore] = useState<{ key: string; n: number }>({ key: "", n: PAGE_SIZE });
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const page = variant === "page";

  async function load() {
    if (entries || state === "loading") return;
    setState("loading");
    try {
      const r = await fetch(endpoint, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(String(r.status));
      setEntries(((await r.json()) as { entries: SearchEntry[] }).entries);
      setState("idle");
    } catch { setState("failed"); }
  }
  useEffect(() => { if (page) queueMicrotask(() => { void load(); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const parsed = useMemo(() => parseSearch(query, { module: module || undefined, advanced: advanced ? true : undefined, modified: modified ? true : undefined }), [query, module, advanced, modified]);
  const results = useMemo(() => (entries ? searchEntries(entries, parsed, page ? 1000 : 8) : []), [entries, parsed, page]);
  const modules = useMemo(() => (entries ? searchModules(entries) : []), [entries]);
  const asking = parsed.words.length > 0 || Object.values(parsed.filters).some((v) => v !== undefined);

  // The extra pages belong to one search: a new query or filter starts again at 50.
  const searchKey = JSON.stringify(parsed);
  const limit = more.key === searchKey ? more.n : PAGE_SIZE;
  useEffect(() => {
    if (!page) return;
    const q = query.trim();
    try { window.history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : window.location.pathname); } catch { /* sans historique : tant pis */ }
  }, [page, query]);

  function go(href: string) { setOpen(false); router.push(href); }
  function onKey(e: React.KeyboardEvent) {
    if (page) return;
    if (e.key === "Escape") { setOpen(false); setActive(-1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = active >= 0 ? results[active] : undefined;
      if (chosen) go(chosen.href); else if (query.trim()) go(searchHref(query.trim()));
    }
  }

  const row = (e: SearchEntry, i: number) => {
    const pieces = splitMatches(e.title, parsed.words);
    return (
      <li key={e.id} role="presentation">
        <a id={`${listId}-${i}`} role={page ? undefined : "option"} aria-selected={page ? undefined : i === active} href={e.href} data-testid="settings-result"
          onClick={(ev) => { if (!ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.button === 0) { ev.preventDefault(); go(e.href); } }}
          className={`block rounded-lg px-3 py-2 text-sm ${i === active ? "bg-accent/10" : "hover:bg-accent/5"} ${page ? "min-h-11 border border-line" : ""}`}>
          <span className="block font-medium">
            {pieces.map((p, k) => (p.hit ? <mark key={k} className="rounded bg-accent/20 px-0.5 text-fg">{p.text}</mark> : <span key={k}>{p.text}</span>))}
            {e.kind === "setting" && e.sectionTitle !== e.title && <span className="ml-2 font-normal text-muted">· {e.sectionTitle}</span>}
          </span>
          <span className="block text-xs text-muted" data-testid="settings-crumb">{e.breadcrumb}{e.moduleId !== "core" && e.moduleName !== e.sectionTitle ? ` · ${e.moduleName}` : ""}{e.advanced ? ` · ${labels.advanced}` : ""}{e.modified ? ` · ${labels.modified}` : ""}</span>
        </a>
      </li>
    );
  };

  const box = (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔍</span>
      <input ref={input} type="search" value={query} role={page ? undefined : "combobox"} aria-expanded={page ? undefined : open && asking} aria-controls={page ? undefined : listId} aria-autocomplete={page ? undefined : "list"}
        aria-activedescendant={!page && active >= 0 ? `${listId}-${active}` : undefined} aria-label={labels.label} placeholder={labels.placeholder} autoComplete="off" data-testid={page ? "settings-search-page" : "settings-search"}
        onFocus={() => { void load(); setOpen(true); }} onBlur={() => { setTimeout(() => setOpen(false), 150); }} onKeyDown={onKey}
        onChange={(e) => { setQuery(e.target.value); setActive(-1); setOpen(true); }}
        className={`w-full rounded-full border border-line bg-bg py-2.5 pl-9 pr-10 text-[15px] [&::-webkit-search-cancel-button]:hidden outline-none transition-colors focus:border-accent ${page ? "min-h-12 text-base" : "min-h-11"}`} />
      {query && <button type="button" aria-label={labels.clear} onClick={() => { setQuery(""); setActive(-1); input.current?.focus(); }} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-fg">✕</button>}
    </div>
  );

  if (!page) {
    return (
      <div className="relative" data-testid="settings-search-menu">
        {box}
        {open && asking && (
          <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-line bg-surface p-1 shadow-lg">
            {state === "loading" && !entries ? <p role="status" className="px-3 py-2 text-sm text-muted">{labels.loading}</p>
              : state === "failed" ? <p role="alert" className="px-3 py-2 text-sm">{labels.failed}</p>
              : results.length === 0 ? <p role="status" className="px-3 py-2 text-sm text-muted" data-testid="settings-none">{labels.none}</p>
              : (
                <ul id={listId} role="listbox" aria-label={labels.label} className="max-h-[60vh] overflow-y-auto">
                  {results.map(row)}
                  <li role="presentation"><a href={searchHref(query.trim())} className="block rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent/5">{labels.seeAll} →</a></li>
                </ul>
              )}
          </div>
        )}
      </div>
    );
  }

  const chip = (on: boolean, label: string, toggle: () => void, testid: string) => (
    <button type="button" aria-pressed={on} onClick={toggle} data-testid={testid}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:border-accent hover:text-accent"}`}>{label}</button>
  );
  return (
    <div className="space-y-4" data-testid="settings-search-full">
      {box}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={labels.filters}>
        <label className="sr-only" htmlFor={`${listId}-module`}>{labels.moduleLabel}</label>
        <select id={`${listId}-module`} value={module} onChange={(e) => setModule(e.target.value)} data-testid="settings-filter-module"
          className="min-h-11 max-w-full rounded-full border border-line bg-bg px-4 text-sm">
          <option value="">{labels.moduleAll}</option>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {advancedMode && chip(advanced, labels.advanced, () => setAdvanced((v) => !v), "settings-filter-advanced")}
        {chip(modified, labels.modified, () => setModified((v) => !v), "settings-filter-modified")}
      </div>
      {state === "failed" && <p role="alert" className="text-sm">{labels.failed}</p>}
      {!asking ? <p className="text-sm text-muted" data-testid="settings-empty">{labels.empty}</p>
        : results.length === 0 ? (
          <p role="status" className="text-sm text-muted" data-testid="settings-none">{labels.none}{" "}
            <button type="button" className="underline hover:text-accent" onClick={() => { setQuery(""); setModule(""); setAdvanced(false); setModified(false); input.current?.focus(); }}>{labels.clear}</button></p>
        ) : (
          <>
            <p className="text-sm text-muted" role="status" data-testid="settings-count">{labels.count.replace("{n}", String(results.length))}</p>
            <ul className="space-y-2" aria-label={labels.label}>{results.slice(0, limit).map(row)}</ul>
            {results.length > limit && <button type="button" onClick={() => setMore({ key: searchKey, n: limit + PAGE_SIZE })} data-testid="settings-more" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:border-accent hover:text-accent">{labels.more.replace("{n}", String(results.length - limit))}</button>}
          </>
        )}
    </div>
  );
}
