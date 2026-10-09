"use client";

import { useState } from "react";

type Props = {
  action: string;
  fields: { name: string; label: string; kind?: "text" | "email" | "textarea"; required?: boolean }[];
  submitLabel: string;
  successText: string;
};

/** Rendu du bloc "form" : poste en fetch vers /m/<module>/<route> et affiche le résultat. */
export function ModuleForm({ action, fields, submitLabel, successText }: Props) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    try {
      const form = event.currentTarget;
      const res = await fetch(`/m/${action}`, { method: "POST", body: new FormData(form) });
      // Une route peut répondre `{ message: "…" }` : texte court affiché tel quel (React l'échappe), succès ou échec.
      const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
      setMessage(typeof body?.message === "string" ? body.message.slice(0, 300) : null);
      setState(res.ok ? "done" : "error");
      if (res.ok) form.reset();
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <p role="status" className="rounded-lg border border-line bg-surface p-4">{message ?? successText}</p>;

  const input = "w-full rounded-lg border border-line bg-bg px-3 py-2";
  return (
    <form onSubmit={submit} className="space-y-3">
      {fields.map((f) => (
        <label key={f.name} className="block text-sm">
          <span className="mb-1 block text-muted">{f.label}</span>
          {f.kind === "textarea" ? (
            <textarea name={f.name} required={f.required} rows={5} className={input} />
          ) : (
            <input name={f.name} type={f.kind ?? "text"} required={f.required} className={input} />
          )}
        </label>
      ))}
      {/* Piège à robots : invisible pour un humain. */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {submitLabel}
      </button>
      {state === "error" && <p role="alert" className="text-sm text-danger">{message ?? "!"}</p>}
    </form>
  );
}
