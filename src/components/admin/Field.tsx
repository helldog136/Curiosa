import { ui } from "./ui";

type Common = { label: string; name: string; help?: string; required?: boolean; /** Petite étiquette à côté du libellé (« à remplir » : le réglage dont dépend l'état « à configurer »). */ flag?: string };

/** Le libellé d'un champ, avec son étiquette éventuelle (la forme « ✎ » accompagne la couleur : l'information ne passe pas que par la couleur). */
function FieldLabel({ id, className, flag, children }: { id: string; className: string; flag?: string; children: React.ReactNode }) {
  return (
    <label className={className} htmlFor={id}>
      {children}
      {flag && <span data-testid="field-flag" className={`${ui.chipWarn} ml-2 align-middle`}><span aria-hidden>✎</span>{flag}</span>}
    </label>
  );
}

/** `inline` : libellé à gauche du champ (une ligne par langue d'un réglage traduisible), au lieu d'au-dessus. */
const rowClass = (inline?: boolean) => (inline ? "sm:flex sm:items-start sm:gap-3" : undefined);
const labelClass = (inline?: boolean) => (inline ? "mb-1 block pt-0 text-sm text-muted sm:mb-0 sm:w-24 sm:shrink-0 sm:pt-3" : ui.label);

export function TextField({ label, name, help, required, flag, defaultValue, type = "text", placeholder, autoComplete, list, pattern, title, inline }: Common & {
  defaultValue?: string | number; type?: string; placeholder?: string; autoComplete?: string; list?: string; pattern?: string; title?: string; inline?: boolean;
}) {
  return (
    <div className={rowClass(inline)}>
      <FieldLabel id={name} className={labelClass(inline)} flag={flag}>{label}</FieldLabel>
      <div className={inline ? "min-w-0 flex-1" : undefined}>
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} list={list} pattern={pattern} title={title} {...(autoComplete === "off" || autoComplete === "new-password" ? { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } : {})} className={type === "color" ? ui.colorInput : ui.input} />
        {help && <p className={ui.help}>{help}</p>}
      </div>
    </div>
  );
}

export function TextArea({ label, name, help, required, flag, defaultValue, rows = 6, mono, inline }: Common & { defaultValue?: string; rows?: number; mono?: boolean; inline?: boolean }) {
  return (
    <div className={rowClass(inline)}>
      <FieldLabel id={name} className={labelClass(inline)} flag={flag}>{label}</FieldLabel>
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

/**
 * Plusieurs choix parmi une liste (réglage `multichoice`, 0.3.0) : de vraies cases à cocher du navigateur, aucun JavaScript. Chaque ligne est une cible tactile
 * d'au moins 44 px (toute la ligne se coche) ; le groupe est un `fieldset` nommé par sa légende, relié à son aide et à son éventuelle erreur (l'erreur s'affiche
 * juste dessous, voir FieldErrors). Une case décochée n'envoie rien : le marqueur `<name>__multi` dit au serveur que le champ était à l'écran.
 */
export function CheckboxGroup({ label, name, options, checked, help, hint, flag }: {
  label: string; name: string; options: { value: string; label: string }[]; checked: readonly string[]; help?: string; hint?: string; flag?: string;
}) {
  const note = [help, hint].filter(Boolean).join(" ");
  return (
    <fieldset id={`${name}__group`} name={`${name}__group`} tabIndex={-1} data-multichoice="" aria-describedby={note ? `${name}__note` : undefined} className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <legend className={`${ui.label} max-w-full`}>
        {label}
        {flag && <span data-testid="field-flag" className={`${ui.chipWarn} ml-2 align-middle`}><span aria-hidden>✎</span>{flag}</span>}
      </legend>
      <input type="hidden" name={`${name}__multi`} value="1" />
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-[15px] transition-colors hover:bg-surface">
              <input type="checkbox" name={name} value={o.value} defaultChecked={checked.includes(o.value)} className="h-5 w-5 shrink-0 accent-[var(--v-accent)]" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {note && <p id={`${name}__note`} className={ui.help}>{note}</p>}
    </fieldset>
  );
}
