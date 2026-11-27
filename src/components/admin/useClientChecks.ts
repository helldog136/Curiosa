"use client";

import { useState, type RefObject } from "react";
import type { FieldErrorMap } from "@/core/fieldErrors";
import { useFieldErrorsDom } from "./FieldErrors";
import { collectNativeErrors, validatableFields, type InvalidKey } from "./nativeValidation";
import { useProgressText } from "./ProgressLabels";

/**
 * Les contraintes du navigateur (obligatoire, adresse, nombre, longueur, format) dites sous le champ, dans la langue du site (voir nativeValidation.ts).
 * Pour un formulaire qui s'envoie lui-même : mettre `noValidate` sur le `<form>` et, au début de son `onSubmit`,
 * `if (!check(e.currentTarget)) { e.preventDefault(); return; }`. Les messages s'affichent comme ceux du serveur (sous le champ, focus sur le premier, effacés dès qu'on corrige).
 * Renvoie `true` quand tout est valide.
 */
export function useClientChecks(form: RefObject<HTMLFormElement | null>): (target: HTMLFormElement) => boolean {
  const p = useProgressText();
  const [errors, setErrors] = useState<FieldErrorMap | null>(null);
  useFieldErrorsDom(form, errors ?? undefined, errors);
  return (target) => {
    const found = collectNativeErrors(validatableFields(target), (k: InvalidKey, v) => p(`invalid.${k}`, v));
    const bad = Object.keys(found).length > 0;
    setErrors(bad ? found : null);
    return !bad;
  };
}
