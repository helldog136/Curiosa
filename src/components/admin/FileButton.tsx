"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ui } from "./ui";
import { useProgressText } from "./ProgressLabels";

/**
 * CHOIX D'UN FICHIER, dans la langue de l'interface : le vrai champ fichier du navigateur reste là (clavier, lecteur d'écran, `required`, envoi avec le formulaire)
 * mais caché ; la personne voit un bouton « Choisir un fichier » et le nom choisi (« Aucun fichier choisi » sinon). Le texte du navigateur (« Choose File - No file
 * chosen ») suivait la langue du navigateur, pas celle du site (F-LANG-001). Le message d'erreur s'écrit sous le champ comme les autres (voir FieldErrors).
 */
export function FileButton({ id, name, accept, required, describedBy }: { id?: string; name: string; accept?: string; required?: boolean; describedBy?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  const p = useProgressText();
  const [picked, setPicked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Après « reset » du formulaire, le nom affiché est remis à zéro.
  useEffect(() => {
    const form = input.current?.form;
    const clear = () => setPicked("");
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input id={inputId} name={name} type="file" accept={accept} required={required} aria-describedby={describedBy} className="peer sr-only"
        onChange={(e) => setPicked(Array.from(e.target.files ?? []).map((f) => f.name).join(", "))}
        ref={input} />
      <label htmlFor={inputId} data-file-button=""
        className={`${ui.btn} min-h-11 cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--v-accent)] peer-aria-[invalid=true]:border-red-500`}>
        {picked ? p("fileChange") : p("fileChoose")}
      </label>
      <span className="min-w-0 text-sm text-muted [overflow-wrap:anywhere]" data-file-name="">{picked || p("fileNone")}</span>
    </div>
  );
}
