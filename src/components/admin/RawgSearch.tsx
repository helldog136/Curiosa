"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { PendingButton } from "./PendingButton";
import { ui } from "./ui";

/**
 * « Chercher un autre nom » (écran « Quel est le bon jeu ? ») : un petit formulaire de recherche qui recharge la page avec `?q=`. Le bouton montre « en cours »
 * pendant le chargement ; l'erreur (nom trop long) s'affiche sous le champ. Le texte n'est qu'un mot de recherche : le serveur le borne et ne s'en sert
 * que pour interroger l'API RAWG, jamais comme une adresse.
 */
export function RawgSearch({ path, title, initial, error, labels }: { path: string; title: string; initial: string; error?: string; labels: { label: string; help: string; button: string; pending: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial);
  const id = useId();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = value.trim();
    start(() => router.push(`${path}?titre=${encodeURIComponent(title)}${q ? `&q=${encodeURIComponent(q)}` : ""}`));
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3" role="search">
      <div>
        <label htmlFor={`${id}-q`} className={ui.label}>{labels.label}</label>
        <input id={`${id}-q`} type="search" value={value} onChange={(e) => setValue(e.target.value)} maxLength={400} autoComplete="off" aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err ${id}-help` : `${id}-help`} className={ui.input} />
        {error && <p id={`${id}-err`} role="alert" className="mt-1.5 text-[13px] leading-5 text-red-700">{error}</p>}
        <p id={`${id}-help`} className={ui.help}>{labels.help}</p>
      </div>
      <PendingButton pending={pending} pendingLabel={labels.pending}>{labels.button}</PendingButton>
    </form>
  );
}
