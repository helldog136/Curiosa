"use client";

import { useState } from "react";
import { HelpBelow, HelpTip } from "./HelpTip";
import { FieldErrorText, ERROR_BORDER } from "./FieldErrors";
import { isLongHelp } from "./helpRule";
import { describePeriod, monthName, serializePeriod } from "@/core/adminkit/values";
import { monthInputs, monthShown, periodState, toInputs } from "@/core/adminkit/periodInputs";
import { PRESETS, isMovable, presetValue } from "@/core/adminkit/periodPresets";
import { PeriodPresetPicker, type PresetLabels } from "./PeriodPresetPicker";
import { ui } from "./ui";

/** Les textes d'un champ période (déjà traduits). */
export type PeriodLabels = { from: string; to: string; yearly: string; sentenceYearly: string; sentenceOnce: string; none: string; clear: string; order: string; month: string; monthPick: string; incomplete: string;
  presetNote: string; presetMoon: string; presetEve: string;
  /** Période ouverte (réglage `openEnded`) : les deux étiquettes des dates, les deux phrases d'aperçu, l'indication et l'erreur « aucune date ». Absents : les textes d'une période fermée. */
  openFrom?: string; openTo?: string; sentenceSince?: string; sentenceUntil?: string; openHint?: string; incompleteOpen?: string } & PresetLabels;


/**
 * PÉRIODE EN UN SEUL CHAMP (R6, R21) : « Du [date] au [date] » et un interrupteur « Chaque année », sur une ligne, puis la phrase qui dit ce qui a été compris
 * (« Du 1er novembre au 30 novembre, chaque année »). La valeur envoyée sous `name` : `11-01/11-30` (chaque année) ou `2026-11-01/2026-11-30` (une fois) ; vide tant
 * que les deux dates ne sont pas choisies. Une période « chaque année » peut enjamber le 31 décembre ; une période unique doit finir après son début.
 */
export function PeriodField({ label, name, defaultValue = "", required, help, example, error, locale, labels, refYear = new Date().getFullYear(), openEnded = false }: {
  label: string; name: string; defaultValue?: string; required?: boolean; help?: string; example?: string; error?: string; locale: string; labels: PeriodLabels; refYear?: number;
  /** Le réglage accepte une période ouverte : une seule date suffit (« À partir du … », « Jusqu'au … »). Désactivé par défaut. */
  openEnded?: boolean;
}) {
  const start = toInputs(defaultValue, refYear, openEnded);
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [yearly, setYearly] = useState(start.yearly);
  const [touched, setTouched] = useState(false);
  const [applied, setApplied] = useState<{ id: string; from: string; to: string } | null>(null);
  // Avec un seul bout, la période ne peut pas revenir chaque année : l'interrupteur se range et la valeur est « une seule fois » (voir periodState).
  const { oneSide, yearlyOn, period, wrongOrder } = periodState(from, to, yearly, openEnded);
  const month = monthShown(from, to, yearlyOn);
  const pickMonth = (m: number, nextYearly = yearlyOn) => { const r = monthInputs(m, nextYearly, from, refYear); setFrom(r.from); setTo(r.to); };
  // Une période toute prête : fête fixe ou saison = « chaque année » ; fête mobile = les dates de la prochaine occurrence, « chaque année » décoché d'office.
  const pickPreset = (id: string) => {
    const now = new Date();
    const v = presetValue(id, { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    if (!v) return;
    const r = toInputs(v, refYear);
    setFrom(r.from); setTo(r.to); setYearly(r.yearly);
    setApplied(isMovable(id) ? { id, from: r.from, to: r.to } : null);
  };
  const note = applied && applied.from === from && applied.to === to && !yearlyOn ? applied : null; // disparaît dès qu'un jour est modifié à la main
  const noteKind = note ? PRESETS.find((p) => p.id === note.id)?.note : undefined;
  const setYearlyKeepingMonth = (next: boolean) => { setYearly(next); if (month !== null) pickMonth(month, next); };
  const value = period ? serializePeriod(period) : "";
  const sentence = period ? describePeriod(period, locale, { yearly: labels.sentenceYearly, once: labels.sentenceOnce, since: labels.sentenceSince, until: labels.sentenceUntil }) : "";
  const tip = isLongHelp(help) ? help : undefined;
  // R22 : pas d'erreur à l'ouverture ; elle vient après un essai d'enregistrement ou en quittant le champ à moitié rempli.
  const incomplete = touched && ((!openEnded && (from === "") !== (to === "")) || (required === true && from === "" && to === ""));
  const msg = error ?? (wrongOrder ? labels.order : incomplete ? (openEnded ? labels.incompleteOpen ?? labels.incomplete : labels.incomplete) : undefined);
  // Période ouverte et « obligatoire » : une date suffit, donc seule la date qui manque encore est exigée tant que les deux sont vides.
  const needDate = required === true && (!openEnded || (from === "" && to === ""));
  const described = [example ? `ex-${name}` : "", openEnded && labels.openHint ? `oh-${name}` : "", msg ? `err-${name}` : "", `pv-${name}`].filter(Boolean).join(" ");
  return (
    <div data-period-field="" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTouched(true); }}>
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={`${name}__from`} className="block text-[15px] font-medium">{label}</label>
        <HelpTip help={tip} name={label} />
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="mb-2 flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={`${name}__month`} className="text-sm text-muted">{labels.month}</label>
        <select id={`${name}__month`} value={month === null ? "" : String(month)} onChange={(e) => { if (e.target.value !== "") pickMonth(Number(e.target.value)); }} className={`${ui.input} min-h-11 w-full sm:w-auto sm:min-w-[12rem]`}>
          <option value="">{labels.monthPick}</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{monthName(i + 1, locale)}</option>)}
        </select>
      </div>
      <PeriodPresetPicker name={name} labels={labels} locale={locale} onPick={pickPreset} />
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <span className="text-sm text-muted">{openEnded ? labels.openFrom ?? labels.from : labels.from}</span>
        <input id={`${name}__from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} onInvalid={() => setTouched(true)} required={needDate} aria-describedby={described} aria-invalid={msg ? true : undefined} className={`${ui.input} min-h-11${msg ? ` ${ERROR_BORDER}` : ""}`} />
        <span className="text-sm text-muted">{openEnded ? labels.openTo ?? labels.to : labels.to}</span>
        <input id={`${name}__to`} type="date" value={to} min={yearlyOn ? undefined : from || undefined} onChange={(e) => setTo(e.target.value)} onInvalid={() => setTouched(true)} required={needDate} aria-label={openEnded ? labels.openTo ?? labels.to : labels.to} aria-describedby={described} className={`${ui.input} min-h-11`} />
      </div>
      {openEnded && labels.openHint && <p id={`oh-${name}`} className={`${ui.help} mt-1`}>{labels.openHint}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        {!oneSide && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearlyKeepingMonth(e.target.checked)} className="h-5 w-5 accent-[var(--v-accent)]" />
            {labels.yearly}
          </label>
        )}
        {(from !== "" || to !== "") && <button type="button" onClick={() => { setFrom(""); setTo(""); setYearly(false); }} className="min-h-9 rounded-lg px-2 text-sm text-muted underline underline-offset-2 hover:text-fg">{labels.clear}</button>}
      </div>
      <p id={`pv-${name}`} className="min-h-5 text-sm text-muted" aria-live="polite">{sentence || (from === "" && to === "" ? labels.none : "")}</p>
      {note && <p className={ui.help}>{labels.presetNote}{noteKind === "moon" ? ` ${labels.presetMoon}` : noteKind === "eve" ? ` ${labels.presetEve}` : ""}</p>}
      {!tip && <HelpBelow help={help} className={ui.help} />}
      {example && <p id={`ex-${name}`} className={ui.help}>{example}</p>}
      <FieldErrorText id={`err-${name}`} message={msg ?? null} />
    </div>
  );
}
