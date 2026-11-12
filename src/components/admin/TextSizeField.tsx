"use client";

import { useId, useState } from "react";
import { FieldErrorText, useFieldError } from "./FieldErrors";
import { HelpTip } from "./HelpTip";
import { ui } from "./ui";
import { TEXT_SCALE_DEFAULT, TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_PRESETS, checkTextScale, presetOf } from "@/core/overlays/textScale";

/**
 * Text size of a page or of an element (core 0.11.0): ready-made sizes as segmented radio buttons (arrow keys move between them), and "Other" for a
 * percentage between 50 and 300. `value` null = no own setting (an element then follows the page). 100 % is stored as nothing.
 * The precision lives in the "?" bubble next to the legend (keyboard and screen reader reachable), never in a visible sentence. The words come from the editor's strings (`ed.textSize.*`); this component never invents text.
 */
type S = (k: string, v?: Record<string, string | number>) => string;
export function TextSizeField({ legend, help, value, inherit, errorPath, onChange, s, testId }: {
  legend: string; help: string; value: number | null; inherit: boolean; errorPath: string; onChange: (v: number | null) => void; s: S; testId: string;
}) {
  const name = useId();
  const server = useFieldError(errorPath);
  const [other, setOther] = useState(value !== null && presetOf(value) === null);
  const [draft, setDraft] = useState(value !== null && presetOf(value) === null ? String(value) : "");
  const [bad, setBad] = useState(false);
  const current = value ?? (inherit ? null : TEXT_SCALE_DEFAULT);
  const choices: { key: string; label: string; percent: number | null }[] = [
    ...(inherit ? [{ key: "inherit", label: s("ed.textSize.inherit"), percent: null }] : []),
    ...TEXT_SCALE_PRESETS.map((p) => ({ key: p.id, label: s(`ed.textSize.${p.id}`), percent: p.percent as number | null })),
  ];
  const checked = (c: { percent: number | null }) => !other && current === c.percent;
  const pick = (percent: number | null) => { setOther(false); setBad(false); onChange(percent); };
  const type = (raw: string) => {
    setDraft(raw);
    const r = checkTextScale(raw);
    if (!r.ok || raw.trim() === "") { setBad(true); return; }
    setBad(false);
    onChange(r.value);
  };
  const otherId = `${name}-other`, errId = `${name}-err`;
  const message = bad ? s("ed.textSize.err", { min: TEXT_SCALE_MIN, max: TEXT_SCALE_MAX }) : server.message;
  return (
    <fieldset className="min-w-0" data-testid={testId}>
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium">{legend}<HelpTip help={help} name={legend} /></legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <span key={c.key} className="relative">
            <input id={`${name}-${c.key}`} type="radio" name={name} className="peer sr-only" checked={checked(c)} onChange={() => pick(c.percent)} />
            <label htmlFor={`${name}-${c.key}`} className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-bg px-3.5 text-sm font-medium transition-colors hover:border-accent peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">{c.label}</label>
          </span>
        ))}
        <span className="relative">
          <input id={`${name}-other`} type="radio" name={name} className="peer sr-only" checked={other} onChange={() => { setOther(true); if (draft === "") { const seed = value ?? 125; setDraft(String(seed)); onChange(seed); } }} />
          <label htmlFor={`${name}-other`} className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-bg px-3.5 text-sm font-medium transition-colors hover:border-accent peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">{s("ed.textSize.other")}</label>
        </span>
      </div>
      {other && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={otherId} className="text-sm">{s("ed.textSize.otherLabel")}</label>
          <input id={otherId} inputMode="numeric" value={draft} onChange={(e) => type(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} aria-invalid={message ? true : undefined} aria-describedby={message ? errId : undefined} className={`${ui.input} w-24 ${message ? "border-red-500" : ""}`} />
          <span className="text-sm text-muted" aria-hidden>%</span>
          <span className="text-sm text-muted">{s("ed.textSize.bounds", { min: TEXT_SCALE_MIN, max: TEXT_SCALE_MAX })}</span>
        </div>
      )}
      <FieldErrorText id={errId} message={message} />
    </fieldset>
  );
}
