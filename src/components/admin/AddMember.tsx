"use client";

import { useState, useSyncExternalStore } from "react";

const subscribeHash = (cb: () => void) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); };

/**
 * « Ajouter à l'équipe » : deux boutons côte à côte (« Ajouter une personne », « Ajouter un assistant IA »), un seul formulaire visible à la fois.
 * Les deux formulaires sont déjà dans la page (rendus par le serveur) ; ici on ne fait qu'en montrer un. L'ancre `#<anchor>` dans l'adresse ouvre celui de l'assistant.
 */
export function AddMember({ person, assistant, initial, anchor, label, personLabel, assistantLabel }: {
  person: React.ReactNode; assistant: React.ReactNode; initial: "person" | "assistant"; anchor: string; label: string; personLabel: string; assistantLabel: string;
}) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const [picked, setPicked] = useState<"person" | "assistant" | null>(null);
  const active = picked ?? (hash === anchor ? "assistant" : initial);
  const choose = (v: "person" | "assistant") => { setPicked(v); try { window.history.replaceState(null, "", v === "assistant" ? `#${anchor}` : window.location.pathname + window.location.search); } catch { /* sans historique : tant pis */ } };
  return (
    <div className="space-y-4">
      <span id={anchor} className="sr-only" />
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {([["person", personLabel], ["assistant", assistantLabel]] as const).map(([id, text]) => (
          <button key={id} type="button" aria-pressed={active === id} onClick={() => choose(id)} data-testid={`add-${id}`}
            className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium transition-colors ${active === id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent hover:text-accent"}`}>
            {text}
          </button>
        ))}
      </div>
      <div hidden={active !== "person"}>{person}</div>
      <div hidden={active !== "assistant"}>{assistant}</div>
    </div>
  );
}
