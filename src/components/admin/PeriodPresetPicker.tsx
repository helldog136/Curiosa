"use client";

import { useId, useMemo, useState } from "react";
import { matchesSearch, searchText } from "@/core/adminkit/search";
import { dateWords, parsePeriod } from "@/core/adminkit/values";
import { PRESETS, presetValue, type PresetGroup } from "@/core/adminkit/periodPresets";
import { ui } from "./ui";

export type PresetLabels = {
  preset: string; presetPick: string; presetSearch: string; presetEmpty: string; presetClear: string;
  groups: Record<PresetGroup, string>; names: Record<string, string>;
};

const GROUPS: PresetGroup[] = ["season", "fixed", "movable"];

/** Les dates d'une période toute prête, en peu de mots (« 20 mars – 20 juin », « 3 avril 2026 – 6 avril 2026 »). */
function datesText(value: string, locale: string): string {
  const parsed = parsePeriod(value);
  if (!parsed.ok) return "";
  const { from, to, yearly } = parsed.period;
  const a = dateWords(from, locale, !yearly), b = dateWords(to, locale, !yearly);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * UNE PÉRIODE TOUTE PRÊTE : un bouton qui déploie une liste avec recherche en direct, groupée (saisons, fêtes à date fixe, fêtes qui changent chaque année).
 * Chaque ligne montre son nom en entier et ses dates ; aucune n'est présentée comme la valeur par défaut. Les noms sont rangés par date (saisons, fêtes
 * fixes) ou par ordre alphabétique (fêtes mobiles). Les dates des fêtes mobiles sont celles de la prochaine occurrence, calculées à l'ouverture.
 */
export function PeriodPresetPicker({ name, labels, locale, onPick }: { name: string; labels: PresetLabels; locale: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panel = useId();
  const items = useMemo(() => {
    if (!open) return [];
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    return PRESETS.map((p) => {
      const value = presetValue(p.id, today) ?? "";
      const label = labels.names[p.id] ?? p.id;
      return { ...p, label, dates: datesText(value, locale), haystack: searchText([label, datesText(value, locale)]) };
    });
  }, [open, labels.names, locale]);
  const shown = items.filter((i) => matchesSearch(i.haystack, query));
  const close = () => { setOpen(false); setQuery(""); };
  return (
    <div className="min-w-0" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={`${name}__preset-label`} className="text-sm text-muted">{labels.preset}</span>
        <button type="button" aria-expanded={open} aria-controls={panel} aria-labelledby={`${name}__preset-label ${name}__preset-btn`} id={`${name}__preset-btn`} onClick={() => (open ? close() : setOpen(true))}
          className={`${ui.input} min-h-11 w-full text-left sm:w-auto sm:min-w-[12rem]`}>{labels.presetPick}<span aria-hidden="true"> ▾</span></button>
      </div>
      {open && (
        <div id={panel} className="mt-2 rounded-xl border border-line bg-bg p-2">
          <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={labels.presetSearch} aria-label={labels.presetSearch} className={`${ui.input} min-h-11`} />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-2 py-2 text-sm text-muted">{labels.presetEmpty}{" "}
                <button type="button" onClick={() => setQuery("")} className="min-h-11 rounded-lg px-2 underline underline-offset-2 hover:text-fg">{labels.presetClear}</button>
              </p>
            )}
            {GROUPS.map((g) => {
              const rows = shown.filter((i) => i.group === g);
              if (rows.length === 0) return null;
              if (g === "movable") rows.sort((a, b) => a.label.localeCompare(b.label, locale));
              return (
                <section key={g} aria-label={labels.groups[g]}>
                  <h4 className="px-2 pt-2 text-xs font-medium text-muted">{labels.groups[g]} <span aria-hidden="true">({rows.length})</span></h4>
                  <ul>
                    {rows.map((i) => (
                      <li key={i.id}>
                        <button type="button" onClick={() => { onPick(i.id); close(); }} className="flex min-h-11 w-full flex-wrap items-baseline justify-between gap-x-3 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-line/40 focus-visible:bg-line/40">
                          <span>{i.label}</span><span className="text-sm text-muted">{i.dates}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
