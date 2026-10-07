import { ui } from "./ui";

type Common = { label: string; name: string; help?: string; required?: boolean };

export function TextField({ label, name, help, required, defaultValue, type = "text", placeholder, autoComplete, list }: Common & {
  defaultValue?: string | number; type?: string; placeholder?: string; autoComplete?: string; list?: string;
}) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} list={list} className={ui.input} />
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}

export function TextArea({ label, name, help, required, defaultValue, rows = 6, mono }: Common & { defaultValue?: string; rows?: number; mono?: boolean }) {
  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <textarea id={name} name={name} rows={rows} required={required} defaultValue={defaultValue} className={`${ui.input} ${mono ? "font-mono" : ""}`} />
      {help && <p className={ui.help}>{help}</p>}
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
