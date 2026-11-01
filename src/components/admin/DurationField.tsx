"use client";

import { useState } from "react";
import { HelpBelow, HelpTip } from "./HelpTip";
import { FieldErrorText, ERROR_BORDER } from "./FieldErrors";
import { isLongHelp } from "./helpRule";
import { DURATION_UNITS, describeDuration, durationUnits, joinDuration, splitDuration, type DurationUnit } from "@/core/adminkit/values";
import { ui } from "./ui";

/** Les noms des unités (déjà traduits) : « secondes », « minutes », « heures », « jours ». */
export type DurationLabels = Record<DurationUnit, string> & { day: string };

/**
 * DURÉE EN UN SEUL CHAMP (R6, R20) : un nombre et son unité sur une ligne (« 90 » « secondes »). La valeur envoyée sous `name` est un nombre entier de SECONDES. Les
 * bornes `min` et `max` (en secondes) limitent la saisie et les unités proposées ; l'unité de départ est la plus grande qui tombe juste (5400 → 90 minutes). Vide :
 * rien n'est envoyé (le module garde sa valeur par défaut, que `emptyHint` peut annoncer : « Vide : 30 s »).
 */
export function DurationField({ label, name, defaultValue, min, max, required, help, example, error, labels, emptyHint }: {
  label: string; name: string; defaultValue?: string | number; min?: number; max?: number; required?: boolean; help?: string; example?: string; error?: string; labels: DurationLabels; emptyHint?: string;
}) {
  const units = durationUnits(max);
  const start = defaultValue === undefined || defaultValue === "" || !Number.isFinite(Number(defaultValue)) ? null : splitDuration(Number(defaultValue), units);
  const [n, setN] = useState(start ? String(start.n) : "");
  const [unit, setUnit] = useState<DurationUnit>(start?.unit ?? (units.includes("min") && (min ?? 0) >= 60 ? "min" : units[0] ?? "s"));
  const size = DURATION_UNITS.find((u) => u.id === unit)?.seconds ?? 1;
  const seconds = n.trim() === "" || !Number.isFinite(Number(n)) ? null : joinDuration(Math.floor(Number(n)), unit);
  const tip = isLongHelp(help) ? help : undefined;
  const described = [example ? `ex-${name}` : "", error ? `err-${name}` : "", `pv-${name}`].filter(Boolean).join(" ");
  return (
    <div data-duration-field="">
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={`${name}__n`} className="block text-[15px] font-medium">{label}</label>
        <HelpTip help={tip} name={label} />
      </div>
      <input type="hidden" name={name} value={seconds === null ? "" : String(seconds)} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-2">
        <input id={`${name}__n`} type="number" inputMode="numeric" min={min === undefined ? 0 : Math.ceil(min / size)} max={max === undefined ? undefined : Math.floor(max / size)} step={1} value={n}
          onChange={(e) => setN(e.target.value)} required={required} aria-describedby={described} aria-invalid={error ? true : undefined} className={`${ui.input} min-h-11${error ? ` ${ERROR_BORDER}` : ""}`} />
        <select aria-label={label} value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)} className={`${ui.input} min-h-11`}>
          {units.map((u) => <option key={u} value={u}>{labels[u]}</option>)}
        </select>
      </div>
      <p id={`pv-${name}`} className="mt-1.5 min-h-5 text-sm text-muted" aria-live="polite">
        {seconds !== null && seconds >= 60 && unit === "s" ? `= ${describeDuration(seconds, labels.day)}` : seconds === null && emptyHint ? emptyHint : ""}
      </p>
      {!tip && <HelpBelow help={help} className={ui.help} />}
      {example && <p id={`ex-${name}`} className={ui.help}>{example}</p>}
      <FieldErrorText id={`err-${name}`} message={error ?? null} />
    </div>
  );
}
