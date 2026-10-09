import { ui } from "./ui";

type Common = { label: string; name: string; help?: string; required?: boolean };

/** `inline` : libellé à gauche du champ (une ligne par langue d'un réglage traduisible), au lieu d'au-dessus. */
const rowClass = (inline?: boolean) => (inline ? "sm:flex sm:items-start sm:gap-3" : undefined);
const labelClass = (inline?: boolean) => (inline ? "mb-1 block pt-0 text-sm text-muted sm:mb-0 sm:w-24 sm:shrink-0 sm:pt-3" : ui.label);

export function TextField({ label, name, help, required, defaultValue, type = "text", placeholder, autoComplete, list, pattern, title, inline }: Common & {
  defaultValue?: string | number; type?: string; placeholder?: string; autoComplete?: string; list?: string; pattern?: string; title?: string; inline?: boolean;
}) {
  return (
    <div className={rowClass(inline)}>
      <label className={labelClass(inline)} htmlFor={name}>{label}</label>
      <div className={inline ? "min-w-0 flex-1" : undefined}>
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} list={list} pattern={pattern} title={title} {...(autoComplete === "off" || autoComplete === "new-password" ? { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } : {})} className={type === "color" ? ui.colorInput : ui.input} />
        {help && <p className={ui.help}>{help}</p>}
      </div>
    </div>
  );
}

export function TextArea({ label, name, help, required, defaultValue, rows = 6, mono, inline }: Common & { defaultValue?: string; rows?: number; mono?: boolean; inline?: boolean }) {
  return (
    <div className={rowClass(inline)}>
      <label className={labelClass(inline)} htmlFor={name}>{label}</label>
      <div className={inline ? "min-w-0 flex-1" : undefined}>
        <textarea id={name} name={name} rows={rows} required={required} defaultValue={defaultValue} className={`${ui.input} ${mono ? "font-mono" : ""}`} />
        {help && <p className={ui.help}>{help}</p>}
      </div>
    </div>
  );
}

export function Checkbox({ label, name, defaultChecked, help, value, required }: { label: string; name: string; defaultChecked?: boolean; help?: string; value?: string; required?: boolean }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} required={required} className="h-4 w-4 accent-[var(--v-accent)]" />
        {label}
      </label>
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}

export function Select({ label, name, options, defaultValue, help }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; help?: string;
}) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className={ui.input}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}
