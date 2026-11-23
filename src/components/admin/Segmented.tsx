import { HelpBelow, HelpTip } from "./HelpTip";
import { FieldErrorText } from "./FieldErrors";
import { isLongHelp } from "./helpRule";
import { ui } from "./ui";

/** Au plus 4 choix en boutons côte à côte (règle R19) : au-delà, la liste ou la recherche conviennent mieux. */
export const SEGMENTED_MIN = 2;
export const SEGMENTED_MAX = 4;
export const fitsSegmented = (count: number): boolean => count >= SEGMENTED_MIN && count <= SEGMENTED_MAX;

/**
 * BOUTONS SEGMENTÉS : 2 à 4 choix visibles d'un coup, un seul à la fois. De vrais boutons radio du navigateur (clavier : flèches, Tab ; lecteur d'écran :
 * « 2 sur 3 ») posés sous un habillage de bouton : aucun JavaScript, le choix part avec le formulaire sous `name`. Les libellés ne sont JAMAIS tronqués (ils
 * passent à la ligne) et chaque bouton fait au moins 44 px.
 */
export function Segmented({ label, name, options, defaultValue, help, example, error, required }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; help?: string; example?: string; error?: string; required?: boolean;
}) {
  const current = options.some((o) => o.value === defaultValue) ? defaultValue : options[0]?.value;
  const tip = isLongHelp(help) ? help : undefined;
  const note = [!tip ? help : undefined, example].filter(Boolean).join(" ");
  return (
    <fieldset id={`${name}__group`} tabIndex={-1} data-segmented="" aria-describedby={[note ? `${name}__note` : "", error ? `err-${name}` : ""].filter(Boolean).join(" ") || undefined} className="min-w-0">
      <legend className={`${ui.label} max-w-full`}>{label}<HelpTip help={tip} name={label} /></legend>
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-line bg-bg p-1" role="presentation">
        {options.map((o) => (
          <label key={o.value} className="relative flex min-h-11 min-w-[7rem] flex-1 cursor-pointer items-center justify-center rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-surface has-[:checked]:bg-accent has-[:checked]:text-accent-fg has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === current} required={required} className="peer sr-only" />
            <span className="[overflow-wrap:anywhere]">{o.label}</span>
          </label>
        ))}
      </div>
      {note && <p id={`${name}__note`} className={ui.help}>{note}</p>}
      <HelpBelow help={tip} className={ui.help} />
      <FieldErrorText id={`err-${name}`} message={error ?? null} />
    </fieldset>
  );
}
