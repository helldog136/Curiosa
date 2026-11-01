"use client";

import { useMemo, useState } from "react";
import { foldText, queryWords } from "@/core/adminkit/search";
import { SearchField } from "./LiveSearch";
import { ui } from "./ui";

export type RightItem = { id: string; label: string; help?: string; sensitive?: boolean };
export type RightGroup = { id: string; title: string; rights: RightItem[] };
export type RightsLabels = {
  search: string; none: string; clear: string; checkAll: string; uncheckAll: string; sensitive: string;
  /** « {n} sur {total} » (cases cochées dans le module). */
  count: string;
  /** « {n} droits choisis » (ligne de résumé). */
  chosen: string;
};

/**
 * LES DROITS D'UN RÔLE, module par module (règles R4 et R15). Chaque module est un groupe REPLIÉ qui dit en une pastille combien de cases y sont cochées ;
 * une recherche en direct (sans accents ni majuscules) ouvre les modules qui ont une réponse et masque les autres ; « Tout cocher » sert à un module entier.
 * Les cases cachées par la recherche restent cochées et partent avec le formulaire (champ `right`, comme avant) : le serveur reçoit exactement la même chose.
 */
export function RightsEditor({ groups, selected, labels, name = "right" }: { groups: RightGroup[]; selected: string[]; labels: RightsLabels; name?: string }) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));
  const [opened, setOpened] = useState<Set<string>>(() => new Set(groups.length === 1 && groups[0] ? [groups[0].id] : []));
  const words = queryWords(query);
  const searching = words.length > 0;

  const matches = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const g of groups) {
      const hit = new Set<string>();
      for (const r of g.rights) {
        const hay = foldText(`${g.title} ${r.label} ${r.help ?? ""}`);
        if (words.every((w) => hay.includes(w))) hit.add(r.id);
      }
      out.set(g.id, hit);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, query]);
  const anyMatch = !searching || [...matches.values()].some((s) => s.size > 0);

  const toggle = (id: string, on: boolean) => setChecked((c) => { const n = new Set(c); if (on) n.add(id); else n.delete(id); return n; });
  const setAll = (g: RightGroup, on: boolean) => setChecked((c) => { const n = new Set(c); for (const r of g.rights) { if (on) n.add(r.id); else n.delete(r.id); } return n; });
  const total = groups.reduce((n, g) => n + g.rights.filter((r) => checked.has(r.id)).length, 0);

  return (
    <div className="space-y-3" data-rights-editor="">
      <SearchField value={query} onChange={setQuery} onClear={() => setQuery("")} placeholder={labels.search} clearLabel={labels.clear} />
      <p className="text-sm text-muted" role="status" aria-live="polite">{labels.chosen.replace("{n}", String(total))}</p>
      {!anyMatch && (
        <div role="status" className={`${ui.card} space-y-2 text-[15px]`} data-testid="live-search-none">
          <p className="font-medium">{labels.none}</p>
          <button type="button" onClick={() => setQuery("")} className={`${ui.btn} min-h-11`}>{labels.clear}</button>
        </div>
      )}
      <div className="space-y-2">
        {groups.map((g) => {
          const hit = matches.get(g.id)!;
          const mine = g.rights.filter((r) => checked.has(r.id)).length;
          const open = searching ? hit.size > 0 : opened.has(g.id);
          return (
            <details key={g.id} open={open} hidden={searching && hit.size === 0} data-right-group={g.id}
              onToggle={(e) => { if (searching) return; const isOpen = e.currentTarget.open; setOpened((o) => { if (o.has(g.id) === isOpen) return o; const n = new Set(o); if (isOpen) n.add(g.id); else n.delete(g.id); return n; }); }}
              className="group rounded-2xl border border-line bg-bg/40">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-2 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="inline-block text-xs text-muted transition-transform group-open:rotate-90">▶</span>
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                <span className={`${mine > 0 ? ui.chip : "inline-flex rounded-full bg-line/60 px-2.5 py-0.5 text-xs font-medium text-muted"} shrink-0`}>{labels.count.replace("{n}", String(mine)).replace("{total}", String(g.rights.length))}</span>
              </summary>
              <div className="space-y-1 border-t border-line px-4 py-3">
                <div className="flex justify-end">
                  <button type="button" onClick={() => setAll(g, mine < g.rights.length)} className="min-h-9 rounded-lg px-2 text-sm text-muted underline-offset-2 hover:text-accent hover:underline">
                    {mine < g.rights.length ? labels.checkAll : labels.uncheckAll}
                  </button>
                </div>
                {g.rights.map((r) => (
                  <label key={r.id} hidden={searching && !hit.has(r.id)} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm">
                    <input type="checkbox" name={name} value={r.id} checked={checked.has(r.id)} onChange={(e) => toggle(r.id, e.currentTarget.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--v-accent)]" />
                    <span className="min-w-0">
                      {r.label}
                      {r.sensitive && <span className={`${ui.chipWarn} ml-2`}>{labels.sensitive}</span>}
                      {r.help && <span className="block text-muted">{r.help}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
