"use client";

import { useState, useTransition } from "react";
import { ui } from "./ui";

type Result = { error?: string; qr?: string; secret?: string; codes?: string[]; remaining?: number };
type Labels = Record<"title" | "help" | "enable" | "scan" | "key" | "confirm" | "confirmButton" | "codesTitle" | "codesHelp" | "codesDone" | "enabled" | "remaining" | "disable" | "disableHelp" | "password" | "code" | "regen" | "regenHelp" | "required" | "need" | "cancel" | "print", string>;
type Props = {
  enabled: boolean;
  remaining: number;
  /** Le propriétaire exige la double vérification de tous : on ne peut pas la désactiver. */
  enforced: boolean;
  needed: boolean;
  labels: Labels;
  start: () => Promise<Result>;
  confirm: (code: string) => Promise<Result>;
  disable: (password: string, code: string) => Promise<Result>;
  regenerate: (password: string) => Promise<Result>;
};

/** Activer / désactiver la double vérification, voir ses codes de secours (une seule fois). Les actions sont des actions serveur : rien de secret ne transite côté client sauf ce qu'on affiche. */
export function TwoFactorPanel({ enabled, remaining, enforced, needed, labels, start, confirm, disable, regenerate }: Props) {
  const [pending, run] = useTransition();
  const [mode, setMode] = useState<"idle" | "enroll" | "codes" | "disable" | "regen">("idle");
  const [setup, setSetup] = useState<Result>({});
  const [codes, setCodes] = useState<string[]>([]);
  const [left, setLeft] = useState(remaining);
  const [isOn, setIsOn] = useState(enabled);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const settle = (r: Result, then: () => void) => { if (r.error) setError(r.error); else { setError(""); then(); } };

  return (
    <section className={`${ui.card} space-y-4`} data-testid="twofa-card">
      <h2 className="text-lg font-semibold">{labels.title} {isOn && <span className={ui.chipOk}>✔ {labels.enabled}</span>}</h2>
      {needed && !isOn && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{labels.need}</p>}
      <p className="text-sm text-muted">{labels.help}</p>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error}</p>}

      {mode === "idle" && !isOn && (
        <button type="button" className={ui.btnPrimary} disabled={pending} onClick={() => run(async () => { const r = await start(); settle(r, () => { setSetup(r); setCode(""); setMode("enroll"); }); })}>{labels.enable}</button>
      )}

      {mode === "enroll" && (
        <div className="space-y-3">
          <p className="text-sm">{labels.scan}</p>
          {setup.qr && <div className="w-48 rounded-xl bg-white p-2" aria-label="QR code" dangerouslySetInnerHTML={{ __html: setup.qr }} />}
          <p className="text-sm">{labels.key} <code className="select-all break-all rounded bg-line px-1.5 py-0.5 font-mono text-xs" data-testid="twofa-secret">{setup.secret}</code></p>
          <label className="block text-sm"><span className={ui.label}>{labels.confirm}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} className={`${ui.input} max-w-40 tracking-widest`} data-testid="twofa-code" />
          </label>
          <div className="flex gap-3">
            <button type="button" className={ui.btnPrimary} disabled={pending || code.trim().length < 6} onClick={() => run(async () => { const r = await confirm(code); settle(r, () => { setCodes(r.codes ?? []); setLeft(r.remaining ?? 0); setIsOn(true); setMode("codes"); }); })}>{labels.confirmButton}</button>
            <button type="button" className={ui.btn} onClick={() => { setMode("idle"); setError(""); }}>{labels.cancel}</button>
          </div>
        </div>
      )}

      {mode === "codes" && (
        <div className="space-y-3" data-testid="twofa-codes">
          <h3 className="font-semibold">{labels.codesTitle}</h3>
          <p className="text-sm text-muted">{labels.codesHelp}</p>
          <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <li key={c} className="select-all rounded bg-line px-2 py-1">{c}</li>)}</ul>
          <div className="flex gap-3">
            <button type="button" className={ui.btn} onClick={() => window.print()}>{labels.print}</button>
            <button type="button" className={ui.btnPrimary} onClick={() => { setCodes([]); setMode("idle"); }}>{labels.codesDone}</button>
          </div>
        </div>
      )}

      {mode === "idle" && isOn && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{labels.remaining.replace("{n}", String(left))}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={ui.btn} onClick={() => { setMode("regen"); setPassword(""); setError(""); }}>{labels.regen}</button>
            {enforced ? <p className="text-sm text-muted">{labels.required}</p> : <button type="button" className={ui.btnDanger} onClick={() => { setMode("disable"); setPassword(""); setCode(""); setError(""); }}>{labels.disable}</button>}
          </div>
        </div>
      )}

      {mode === "regen" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{labels.regenHelp}</p>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder={labels.password} aria-label={labels.password} className={`${ui.input} max-w-xs`} />
          <div className="flex gap-3">
            <button type="button" className={ui.btnPrimary} disabled={pending || !password} onClick={() => run(async () => { const r = await regenerate(password); settle(r, () => { setCodes(r.codes ?? []); setLeft(r.remaining ?? 0); setMode("codes"); }); })}>{labels.regen}</button>
            <button type="button" className={ui.btn} onClick={() => { setMode("idle"); setError(""); }}>{labels.cancel}</button>
          </div>
        </div>
      )}

      {mode === "disable" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{labels.disableHelp}</p>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder={labels.password} aria-label={labels.password} className={`${ui.input} max-w-xs`} />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={labels.code} aria-label={labels.code} autoComplete="one-time-code" className={`${ui.input} max-w-xs`} />
          <div className="flex gap-3">
            <button type="button" className={ui.btnDanger} disabled={pending || !password || !code} onClick={() => run(async () => { const r = await disable(password, code); settle(r, () => { setIsOn(false); setMode("idle"); }); })}>{labels.disable}</button>
            <button type="button" className={ui.btn} onClick={() => { setMode("idle"); setError(""); }}>{labels.cancel}</button>
          </div>
        </div>
      )}
    </section>
  );
}
