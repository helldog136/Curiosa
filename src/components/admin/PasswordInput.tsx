"use client";

import { useState, type InputHTMLAttributes } from "react";
import { ui } from "./ui";
import { useProgressText } from "./ProgressLabels";

/** Ce que les gestionnaires de mots de passe (1Password, Bitwarden, Dashlane, LastPass, Chrome, Safari) comprennent pour « ne me proposez rien ici ». */
export const MANAGER_IGNORE = { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } as const;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "autoComplete"> & {
  /** `new-password` : créer ou changer un mot de passe (les gestionnaires proposent d'en générer un). `current-password` : se connecter ou confirmer qui l'on est. Jamais `off`. */
  autoComplete: "new-password" | "current-password";
  /** Textes du bouton ; à défaut ceux de l'administration (contexte). */
  showLabel?: string;
  hideLabel?: string;
  /** Mot de passe d'un AUTRE compte, ou secret technique : ce n'est pas la connexion de la personne, on demande aux gestionnaires de ne pas le proposer. */
  noManager?: boolean;
  /** Longueur minimale exigée : dite à Safari et aux gestionnaires (`passwordrules`) pour qu'ils génèrent un mot de passe valable. Pas de blocage du navigateur : l'erreur s'écrit sous le champ. */
  passwordMin?: number;
};

/**
 * Champ mot de passe : UN SEUL `<input>` qui reste le même nœud du début à la fin (le bouton « Afficher » change seulement son attribut `type`),
 * pour que les gestionnaires de mots de passe gardent leur lien avec lui. Aucun blocage du collage ni de la copie, jamais `autocomplete="off"`.
 * Le bouton est un vrai `<button type="button">` : il n'envoie pas le formulaire et se prend au clavier.
 */
export function PasswordInput({ autoComplete, showLabel, hideLabel, noManager, passwordMin, className, id, ...rest }: Props) {
  const [shown, setShown] = useState(false);
  const p = useProgressText();
  // Safari (et les gestionnaires qui lisent cet attribut) génèrent un mot de passe qui respecte la règle du site.
  const rules = autoComplete === "new-password" && typeof passwordMin === "number" ? { passwordrules: `minlength: ${passwordMin};` } : {};
  const label = shown ? (hideLabel ?? p("hidePassword")) : (showLabel ?? p("showPassword"));
  return (
    <div className="relative" data-password-wrap="">
      <input
        {...rest} id={id}
        type={shown ? "text" : "password"} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        data-secret="" {...rules}
        {...(noManager ? MANAGER_IGNORE : {})}
        className={`${className ?? ui.input} !pr-24`}
      />
      <button
        type="button" onClick={() => setShown((s) => !s)} aria-controls={id}
        className="absolute inset-y-1 right-1 min-w-11 rounded-lg px-3 text-sm font-medium text-accent hover:bg-accent/10"
      >
        {label}
      </button>
    </div>
  );
}
