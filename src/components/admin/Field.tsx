import { ui } from "./ui";
import { HelpBelow, HelpTip } from "./HelpTip";
import { isLongHelp } from "./helpRule";

type Common = { label: string; name: string; help?: string; required?: boolean; /** Petite étiquette à côté du libellé (« à remplir » : le réglage dont dépend l'état « à configurer »). */ flag?: string };

/**
 * Le libellé d'un champ, avec son étiquette éventuelle (la forme « ✎ » accompagne la couleur : l'information ne passe pas que par la couleur).
 * Aide longue : le bouton « ? » se place à CÔTÉ du libellé (jamais dedans : il n'entrerait pas dans le nom du champ), sans changer la hauteur de la ligne.
 */
export function FieldLabel({ id, className, flag, help, text, children }: { id: string; className: string; flag?: string; help?: string; text: string; children: React.ReactNode }) {
  const label = (
    <label className={isLongHelp(help) ? className.replace(/\bmb-1\.5\b/, "mb-0") : className} htmlFor={id}>
      {children}
      {flag && <span data-testid="field-flag" className={`${ui.chipWarn} ml-2 align-middle`}><span aria-hidden>✎</span>{flag}</span>}
    </label>
  );
  if (!isLongHelp(help)) return label;
  return <div className="mb-1.5 flex items-center gap-1">{label}<HelpTip help={help} name={text} /></div>;
}

/** `inline` : libellé à gauche du champ (une ligne par langue d'un réglage traduisible), au lieu d'au-dessus. */
const rowClass = (inline?: boolean) => (inline ? "sm:flex sm:items-start sm:gap-3" : undefined);
const labelClass = (inline?: boolean) => (inline ? "mb-1 block pt-0 text-sm text-muted sm:mb-0 sm:w-24 sm:shrink-0 sm:pt-3" : ui.label);

export function TextField({ label, name, help, required, flag, defaultValue, type = "text", placeholder, autoComplete, list, pattern, title, inline }: Common & {
  defaultValue?: string | number; type?: string; placeholder?: string; autoComplete?: string; list?: string; pattern?: string; title?: string; inline?: boolean;
}) {
  return (
    <div className={rowClass(inline)}>
      <FieldLabel id={name} className={labelClass(inline)} flag={flag} help={help} text={label}>{label}</FieldLabel>
      <div className={inline ? "min-w-0 flex-1" : undefined}>
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} autoComplete={autoComplete} list={list} pattern={pattern} title={title} {...(autoComplete === "off" || autoComplete === "new-password" ? { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } : {})} className={type === "color" ? ui.colorInput : ui.input} />
        <HelpBelow help={help} className={ui.help} />
      </div>
    </div>
  );
}

export function TextArea({ label, name, help, required, flag, defaultValue, rows = 6, mono, inline }: Common & { defaultValue?: string; rows?: number; mono?: boolean; inline?: boolean }) {
  return (
    <div className={rowClass(inline)}>
      <FieldLabel id={name} className={labelClass(inline)} flag={flag} help={help} text={label}>{label}</FieldLabel>
      <div className={inline ? "min-w-0 flex-1" : undefined}>
        <textarea id={name} name={name} rows={rows} required={required} defaultValue={defaultValue} className={`${ui.input} ${mono ? "font-mono" : ""}`} />
        <HelpBelow help={help} className={ui.help} />
      </div>
    </div>
  );
}

export function Checkbox({ label, name, defaultChecked, help, value, required }: { label: string; name: string; defaultChecked?: boolean; help?: string; value?: string; required?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} required={required} className="h-4 w-4 accent-[var(--v-accent)]" />
          {label}
        </label>
        <HelpTip help={help} name={label} />
      </div>
      <HelpBelow help={help} className={ui.help} />
    </div>
  );
}

export function Select({ label, name, options, defaultValue, help }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; help?: string;
}) {
  return (
    <div>
      <FieldLabel id={name} className={ui.label} help={help} text={label}>{label}</FieldLabel>
      <select id={name} name={name} defaultValue={defaultValue} className={ui.input}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <HelpBelow help={help} className={ui.help} />
    </div>
  );
}

/**
 * Plusieurs choix parmi une liste (réglage `multichoice`, 0.2.14) : de vraies cases à cocher du navigateur, aucun JavaScript. Chaque ligne est une cible tactile
 * d'au moins 44 px (toute la ligne se coche) ; le groupe est un `fieldset` nommé par sa légende, relié à son aide et à son éventuelle erreur (l'erreur s'affiche
 * juste dessous, voir FieldErrors). Une case décochée n'envoie rien : le marqueur `<name>__multi` dit au serveur que le champ était à l'écran.
 */
export function CheckboxGroup({ label, name, options, checked, help, hint, flag }: {
  label: string; name: string; options: { value: string; label: string }[]; checked: readonly string[]; help?: string; hint?: string; flag?: string;
}) {
  // L'aide longue passe dans la bulle « ? » ; l'indication (`hint`, ex. « 2 à 3 choix ») reste sous la liste.
  const tip = isLongHelp(help) ? help : undefined;
  const flagChip = flag && <span data-testid="field-flag" className={`${ui.chipWarn} ml-2 align-middle`}><span aria-hidden>✎</span>{flag}</span>;
  const note = [tip ? undefined : help, hint].filter(Boolean).join(" ");
  return (
    <fieldset id={`${name}__group`} name={`${name}__group`} tabIndex={-1} data-multichoice="" aria-labelledby={tip ? `${name}__legend` : undefined} aria-describedby={note ? `${name}__note` : undefined} className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <legend className={`${ui.label} max-w-full`}>
        {tip ? <span id={`${name}__legend`}>{label}{flagChip}</span> : <>{label}{flagChip}</>}
        <HelpTip help={tip} name={label} />
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
      <HelpBelow help={tip} className={ui.help} />
    </fieldset>
  );
}
