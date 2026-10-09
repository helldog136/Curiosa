"use client";

import { useEffect, useState, useTransition } from "react";
import { ui } from "./ui";
import { createPasskey, passkeysSupported } from "./webauthn";

type Item = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
type R = { error?: string; options?: Record<string, unknown>; challengeId?: string; ok?: boolean };
type Labels = Record<"title" | "help" | "none" | "add" | "name" | "password" | "created" | "lastUsed" | "never" | "remove" | "removeHelp" | "cancel" | "save" | "unsupported" | "cancelled" | "rename", string>;
type Props = {
  items: Item[]; labels: Labels;
  start: (password: string) => Promise<R>;
  finish: (challengeId: string, response: Record<string, unknown>, name: string) => Promise<R>;
  remove: (id: string, password: string) => Promise<R>;
  rename: (id: string, name: string) => Promise<R>;
};

/** Ajouter, renommer et retirer ses clés d'accès (empreinte, visage, code de l'appareil, clé de sécurité). */
export function PasskeysPanel({ items, labels, start, finish, remove, rename }: Props) {
  const [list, setList] = useState(items);
  const [mode, setMode] = useState<"idle" | "add" | { remove: string }>("idle");
  const [pending, run] = useTransition();
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(passkeysSupported()); }, []);
  const reset = () => { setMode("idle"); setPassword(""); setName(""); setError(""); };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : labels.never);

  const add = () => run(async () => {
    setError("");
    const begun = await start(password);
    if (begun.error || !begun.options || !begun.challengeId) { setError(begun.error ?? ""); return; }
    let response;
    try { response = await createPasskey(begun.options); } catch { setError(labels.cancelled); return; }
    const done = await finish(begun.challengeId, response, name);
    if (done.error) { setError(done.error); return; }
    location.reload(); // la liste est relue côté serveur
  });
  const drop = (id: string) => run(async () => {
    const r = await remove(id, password);
    if (r.error) { setError(r.error); return; }
    setList((l) => l.filter((x) => x.id !== id)); reset();
  });

  return (
    <section className={`${ui.card} space-y-4`} data-testid="passkeys-card">
      <h2 className="text-lg font-semibold">{labels.title}</h2>
      <p className="text-sm text-muted">{labels.help}</p>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error}</p>}
      {list.length === 0 && <p className="text-sm text-muted">{labels.none}</p>}
      <ul className="space-y-2">
        {list.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3" data-testid="passkey-row">
            <span className="min-w-0">
              <span className="block font-medium">🔑 {k.name}</span>
              <span className="block text-xs text-muted">{labels.created} {when(k.createdAt)} · {labels.lastUsed} {when(k.lastUsedAt)}</span>
            </span>
            <span className="flex gap-2">
              <button type="button" className={ui.btn} onClick={() => { const n = window.prompt(labels.rename, k.name); if (n) run(async () => { const r = await rename(k.id, n); if (r.error) setError(r.error); else setList((l) => l.map((x) => (x.id === k.id ? { ...x, name: n } : x))); }); }}>{labels.rename}</button>
              <button type="button" className={ui.btnDanger} onClick={() => { setMode({ remove: k.id }); setError(""); setPassword(""); }}>{labels.remove}</button>
            </span>
          </li>
        ))}
      </ul>
      {mode === "idle" && (supported ? <button type="button" className={ui.btnPrimary} onClick={() => { setMode("add"); setName(""); setPassword(""); setError(""); }}>{labels.add}</button> : <p className="text-sm text-muted">{labels.unsupported}</p>)}
      {mode === "add" && (
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={labels.name} aria-label={labels.name} maxLength={60} className={`${ui.input} max-w-xs`} data-testid="passkey-name" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder={labels.password} aria-label={labels.password} className={`${ui.input} max-w-xs`} data-testid="passkey-password" />
          <div className="flex gap-3">
            <button type="button" className={ui.btnPrimary} disabled={pending || !password} onClick={add} data-testid="passkey-add-confirm">{labels.add}</button>
            <button type="button" className={ui.btn} onClick={reset}>{labels.cancel}</button>
          </div>
        </div>
      )}
      {typeof mode === "object" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{labels.removeHelp}</p>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder={labels.password} aria-label={labels.password} className={`${ui.input} max-w-xs`} />
          <div className="flex gap-3">
            <button type="button" className={ui.btnDanger} disabled={pending || !password} onClick={() => drop(mode.remove)}>{labels.remove}</button>
            <button type="button" className={ui.btn} onClick={reset}>{labels.cancel}</button>
          </div>
        </div>
      )}
    </section>
  );
}
