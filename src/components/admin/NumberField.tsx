"use client";

import { TextField } from "./Field";

/**
 * NOMBRE BORNÉ (R20, R22) : le champ n'accepte que des nombres dans ses bornes (`min`, `max`, `step` : le navigateur refuse le reste), écrit son UNITÉ à droite
 * (« secondes »), montre sa valeur par défaut tant qu'il est vide (en grisé dans le champ, et « Vide : 30 s » dans l'indication) et affiche l'erreur dessous avec un
 * exemple. `hint` : l'indication déjà écrite (« Entre 5 et 3600 · Vide : 30 s », voir `numberHint`).
 */
export function NumberField({ label, name, defaultValue, min, max, step, unit, emptyValue, hint, example, error, required, help, invalidText }: {
  label: string; name: string; defaultValue?: string | number; min?: number; max?: number; step?: number; unit?: string;
  /** La valeur utilisée quand le champ reste vide : affichée en grisé dans le champ. */
  emptyValue?: string | number;
  hint?: string; example?: string; error?: string; required?: boolean; help?: string;
  /** Le message dans la langue du site quand la valeur sort des bornes (remplace la bulle du navigateur, qui est dans sa propre langue et sans exemple). */
  invalidText?: string;
}) {
  const decimal = step !== undefined && !Number.isInteger(step);
  return (
    <TextField label={label} name={name} type="number" defaultValue={defaultValue} min={min} max={max} step={step ?? (decimal ? undefined : 1)} unit={unit} required={required}
      placeholder={emptyValue === undefined ? undefined : String(emptyValue)} help={help} example={[hint, example].filter(Boolean).join(" · ") || undefined} error={error} inputMode={decimal ? "decimal" : "numeric"}
      inputProps={invalidText ? { onInvalid: (e) => e.currentTarget.setCustomValidity(invalidText), onInput: (e) => e.currentTarget.setCustomValidity("") } : undefined} />
  );
}
