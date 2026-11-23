"use client";

import { useRef, useState, useTransition } from "react";
import { Switch } from "./Switch";
import { Segmented } from "./Segmented";
import { MoreOptions } from "./MoreOptions";
import { ActionForm } from "./ActionForm";
import { Badge } from "./Badge";
import { NumberField } from "./NumberField";
import { Select, TextField } from "./Field";
import { SecretReveal, type OneTimeSecret } from "./OneTimeSecret";
import { ShowWhen } from "./ShowWhen";
import { askConfirm } from "./confirmDialog";
import { ui } from "./ui";
import { disableAutoBackup, enableAutoBackup, renewAutoPassphrase, saveAutoOptions, sendAutoBackupNow, setAutoFrequency, type AutoResult } from "@/app/admin/(panel)/backup/auto-actions";

/** What the server page hands over: plain data and texts already translated (the component knows no language). Never a secret, never a full address except the one being edited. */
export type AutoPanelView = {
  enabled: boolean;
  state: "configured" | "degraded" | "notConfigured";
  mailConfigured: boolean;
  mailHref: string;
  frequency: string;
  maxMb: number;
  recipientSummary: string;
  recipient: { kind: "owner" | "user" | "address"; userId: string; address: string; accounts: { id: string; label: string }[] };
  /** Why it is degraded, and what to do. */
  problem: { reason: string; fix: string; toMailSettings: boolean } | null;
  lastLine: string;
  nextLine: string;
  download: { href: string; label: string } | null;
  moreSummary: string;
};
export type AutoPanelLabels = Record<string, string>;

export function AutoBackupPanel({ view, labels: L }: { view: AutoPanelView; labels: AutoPanelLabels }) {
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [now, startNow] = useTransition();
  const [nowNote, setNowNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [renewing, startRenew] = useTransition();
  const [renewNote, setRenewNote] = useState<string | null>(null);
  const freq = useRef<HTMLFormElement>(null);
  const [freqNote, setFreqNote] = useState<string | null>(null);

  const reveal = (passphrase: string | undefined, title: string) => {
    if (!passphrase) return;
    setSecret({ value: passphrase, title, notes: [L.secretKeep!, L.secretOnce!, L.secretRegenerate!], copy: L.copy!, copied: L.copied!, done: L.secretDone! });
  };
  const toggle = async (next: boolean) => {
    const r: AutoResult = next ? await enableAutoBackup() : await disableAutoBackup();
    if (r.error) return { error: r.error };
    if (next) reveal(r.passphrase, L.secretTitle!); else setSecret(null);
    return { ok: r.ok };
  };
  const openEdit = () => {
    document.getElementById("autobackup-more")?.setAttribute("open", "");
    document.getElementById("recipientKind__group")?.focus();
  };

  return (
    <div className="space-y-4" data-testid="autobackup">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={view.state === "configured" ? "ok" : view.state === "degraded" ? "warn" : "neutral"} testid="autobackup-state">{L[`state.${view.state}`]}</Badge>
        {view.mailConfigured || view.enabled
          ? <Switch label={L.switchLabel!} checked={view.enabled} onToggle={toggle} onText={L.on} offText={L.off} failedText={L.failed} testid="autobackup-switch" />
          : <span className="flex flex-wrap items-center gap-3"><span className="text-sm">{L.needMail}</span><a href={view.mailHref} className={`${ui.btnPrimary} min-h-11`}>{L.openMail}</a></span>}
      </div>

      {secret && <SecretReveal secret={secret} />}

      {view.enabled && (
        <>
          {view.problem && (
            <div role="status" className="space-y-1 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="autobackup-problem">
              <p className="font-medium">{view.problem.reason}</p>
              <p>{view.problem.fix}</p>
              {view.problem.toMailSettings && <a href={view.mailHref} className={`${ui.btn} min-h-11`}>{L.openMail}</a>}
            </div>
          )}
          <form ref={freq} onSubmit={(e) => e.preventDefault()}
            onChange={(e) => {
              const value = new FormData(e.currentTarget).get("frequency");
              void setAutoFrequency(String(value)).then((r) => setFreqNote(r.error ?? r.ok ?? null));
            }}>
            <Segmented label={L.frequency!} name="frequency" defaultValue={view.frequency}
              options={[{ value: "daily", label: L["frequency.daily"]! }, { value: "weekly", label: L["frequency.weekly"]! }, { value: "monthly", label: L["frequency.monthly"]! }]} />
            <p role="status" className="min-h-5 text-xs text-muted">{freqNote}</p>
          </form>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="autobackup-recipient">
            <span>{view.recipientSummary}</span>
            <button type="button" className={`${ui.btn} min-h-11`} onClick={openEdit}>{L.edit}</button>
          </p>
          <p className="text-sm" data-testid="autobackup-last">{view.lastLine}</p>
          <p className="text-sm text-muted" data-testid="autobackup-next">{view.nextLine}</p>
          {view.download && <p className="text-sm"><a className="underline" href={view.download.href} data-testid="autobackup-download">{view.download.label}</a></p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={`${ui.btn} min-h-11`} disabled={now} aria-busy={now || undefined} data-testid="autobackup-now"
              onClick={() => { setNowNote(null); startNow(async () => { const r = await sendAutoBackupNow(); setNowNote(r.error ? { tone: "error", text: r.error } : { tone: "ok", text: r.ok ?? "" }); }); }}>
              {now ? L.nowWorking : L.now}
            </button>
            <span role={nowNote?.tone === "error" ? "alert" : "status"} className={`text-sm ${nowNote?.tone === "error" ? "font-medium text-red-700" : "text-emerald-700"}`}>{nowNote ? <>{nowNote.tone === "error" ? "⚠ " : "✓ "}{nowNote.text}</> : null}</span>
          </div>

          <MoreOptions id="autobackup-more" title={L.more!} summary={view.moreSummary}>
            <ActionForm action={saveAutoOptions} submitLabel={L.saveOptions!} className="space-y-4" secondary>
              <Segmented label={L.recipient!} name="recipientKind" defaultValue={view.recipient.kind}
                options={[{ value: "owner", label: L["recipient.owner"]! }, { value: "user", label: L["recipient.user"]! }, { value: "address", label: L["recipient.address"]! }]} />
              <ShowWhen field="recipientKind" equals="user" initial={view.recipient.kind}>
                <Select label={L["recipient.account"]!} name="recipientUser" defaultValue={view.recipient.userId} options={view.recipient.accounts.map((a) => ({ value: a.id, label: a.label }))} />
              </ShowWhen>
              <ShowWhen field="recipientKind" equals="address" initial={view.recipient.kind}>
                <TextField label={L["recipient.typed"]!} name="recipientAddress" type="email" defaultValue={view.recipient.address} example={L["recipient.example"]} autoComplete="off" />
              </ShowWhen>
              <NumberField label={L.limit!} name="maxMb" defaultValue={view.maxMb} min={1} max={25} step={1} unit="MB" emptyValue={20} hint={L.limitHint} />
            </ActionForm>
            <div className="space-y-2 border-t border-line pt-4">
              <button type="button" className={`${ui.btnDanger} min-h-11`} disabled={renewing} data-testid="autobackup-renew"
                onClick={async () => { if (!(await askConfirm(L.renewConfirm!, { danger: true, confirmLabel: L.renew }))) return; setRenewNote(null); startRenew(async () => { const r = await renewAutoPassphrase(); if (r.error) setRenewNote(r.error); else { reveal(r.passphrase, L.secretTitleNew!); window.scrollTo({ top: 0, behavior: "smooth" }); } }); }}>
                {renewing ? L.renewWorking : L.renew}
              </button>
              {renewNote && <p role="alert" className="text-sm font-medium text-red-700">{renewNote}</p>}
            </div>
          </MoreOptions>
        </>
      )}
    </div>
  );
}
