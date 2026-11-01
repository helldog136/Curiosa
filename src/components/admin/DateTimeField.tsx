"use client";

import { useState } from "react";
import { HelpBelow, HelpTip } from "./HelpTip";
import { FieldErrorText, ERROR_BORDER } from "./FieldErrors";
import { isLongHelp } from "./helpRule";
import { describeDate, describeDateTime } from "@/core/adminkit/values";
import { ui } from "./ui";

/** Les textes d'un champ date et heure (déjà traduits). */
export type DateTimeLabels = { date: string; time: string; timePlaceholder?: string; clear: string; at: string; preview: string };

/**
 * DATE ET HEURE EN UN SEUL CHAMP (règle R6, R21) : un sélecteur de date natif et un sélecteur d'heure natif sur UNE ligne, sous UN libellé, avec une phrase d'aperçu
 * (« Jusqu'au 30 novembre 2026 à 18:30 »). La valeur envoyée sous `name` est « 2026-11-30T18:30 » ; avec `optionalTime`, l'heure peut rester vide (valeur « 2026-11-30 » :
 * à la charge du module de dire ce que cela veut dire, par exemple « jusqu'à la fin du jour »). Vide : rien n'est envoyé. Les deux sélecteurs portent aussi un nom
 * (`<name>__date`, `<name>__time`) : sans JavaScript, le serveur peut les relire.
 */
export function DateTimeField({ label, name, defaultValue = "", optionalTime, required, help, example, error, locale, labels }: {
  label: string; name: string; defaultValue?: string; optionalTime?: boolean; required?: boolean; help?: string; example?: string; error?: string; locale: string; labels: DateTimeLabels;
}) {
  const [d0 = "", t0 = ""] = defaultValue.split("T");
  const [date, setDate] = useState(d0);
  const [time, setTime] = useState(t0);
  const complete = date !== "" && (time !== "" || optionalTime === true);
  const value = date === "" ? "" : time !== "" ? `${date}T${time}` : optionalTime ? date : "";
  const shown = complete ? (time !== "" ? describeDateTime(`${date}T${time}`, locale, labels.at) : describeDate(date, locale)) : "";
  const tip = isLongHelp(help) ? help : undefined;
  const described = [example ? `ex-${name}` : "", error ? `err-${name}` : "", `pv-${name}`].filter(Boolean).join(" ");
  return (
    <div data-datetime-field="">
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={`${name}__date`} className="block text-[15px] font-medium">{label}</label>
        <HelpTip help={tip} name={label} />
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
        <input id={`${name}__date`} name={`${name}__date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required={required} aria-label={labels.date} aria-describedby={described} aria-invalid={error ? true : undefined} className={`${ui.input} min-h-11${error ? ` ${ERROR_BORDER}` : ""}`} />
        <input id={`${name}__time`} name={`${name}__time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={labels.time} title={labels.timePlaceholder} aria-describedby={described} className={`${ui.input} min-h-11`} />
      </div>
      <p id={`pv-${name}`} className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-3 text-sm text-muted" aria-live="polite">
        {shown ? labels.preview.replace("{when}", shown) : optionalTime && labels.timePlaceholder ? labels.timePlaceholder : ""}
        {(date !== "" || time !== "") && <button type="button" onClick={() => { setDate(""); setTime(""); }} className="min-h-9 rounded-lg px-2 text-sm underline underline-offset-2 hover:text-fg">{labels.clear}</button>}
      </p>
      {!tip && <HelpBelow help={help} className={ui.help} />}
      {example && <p id={`ex-${name}`} className={ui.help}>{example}</p>}
      <FieldErrorText id={`err-${name}`} message={error ?? null} />
    </div>
  );
}
