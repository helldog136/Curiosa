"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import type { MyAccessState } from "@/app/admin/(panel)/account/actions";
import { Badge } from "./Badge";
import { CopyBlock } from "./CopyBlock";
import { HelpTip } from "./HelpTip";
import { MoreOptions } from "./MoreOptions";
import { ConfirmButton } from "./ConfirmButton";
import { PendingButton } from "./PendingButton";
import { RowMenu } from "./RowMenu";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";
import { FieldErrorText } from "./FieldErrors";
import { PLAIN_INPUT, MANAGER_IGNORE } from "./managerHints";
import { submitKeepingValues } from "./keepValues";
import { createGate } from "./singleFlight";
import { ui } from "./ui";

/**
 * "My AI accesses" (Account page, core 0.47.0): the AI accesses that belong to the signed-in person. A person may own several; each has its own LEVEL of permissions,
 * always capped by what the person can do themselves (checked on every request, see docs/PERSONAL-AI.md). Presentation only: every rule is in the service and the actions.
 * The access code is shown ONCE, above the form, and never read again (the same pattern as McpTokenCreator / CreatedAccess).
 */
export type AccessRowView = { id: string; name: string; level: string; levelLabel: string; state: "active" | "paused" | "inert"; stateLabel: string; stateWhy?: string };
export type MyAccessesLabels = {
  name: string; example: string; password: string; level: string; submit: string; new: string; pending: string; createdTitle: string; secret: string; createdOnce: string; copy: string; copied: string; connect: string;
  active: string; paused: string; switchLabel: string; resumeNeed: string; resume: string; resumeWith: string;
  menu: string; changeLevel: string; saveLevel: string; remove: string; removeConfirm: string; removeAction: string; ceiling: string;
};

export function MyAccesses({ rows, levels, create, pause, resume, remove, setLevel, labels, canCreate, initial = null }: {
  /** The state the form starts from (tests and captures: the "created" and "error" screens). */ initial?: MyAccessState;
  rows: AccessRowView[]; levels: { value: string; label: string }[]; canCreate: boolean;
  create: (prev: MyAccessState, form: FormData) => Promise<MyAccessState>;
  pause: (id: string) => Promise<{ error?: string }>; resume: (id: string, password: string) => Promise<{ ok?: boolean; error?: string }>;
  remove: (id: string) => Promise<void>; setLevel: (id: string, level: string) => Promise<{ ok?: boolean; error?: string }>;
  labels: MyAccessesLabels;
}) {
  const [gate] = useState(createGate);
  const [state, run, pending] = useActionState(useMemo(() => gate.wrap(create), [gate, create]), initial);
  const submit = (data: FormData) => { if (gate.enter()) run(data); };
  const created = state?.created;
  return (
    <div className="space-y-5" data-testid="my-accesses">
      {created && (
        <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status" data-testid="my-access-created">
          <h3 className="text-base font-semibold">{labels.createdTitle.replace("{name}", created.name)}</h3>
          <CopyBlock text={created.token} label={labels.secret} copyLabel={labels.copy} copiedLabel={labels.copied} />
          <p className="text-sm font-medium">{labels.createdOnce}</p>
          <p className="text-sm">{labels.connect}</p>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="my-access-list">
          {rows.map((r) => <AccessRow key={r.id} row={r} pause={pause} resume={resume} remove={remove} setLevel={setLevel} levels={levels} labels={labels} />)}
        </ul>
      )}
      {canCreate && (
        <MoreOptions title={labels.new}>
        <form onSubmit={submitKeepingValues(submit)} key={created?.token ?? "new"} autoComplete="off" {...MANAGER_IGNORE} className="space-y-4" data-testid="my-access-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={ui.label} htmlFor="my-access-name">{labels.name}</label>
              <input {...PLAIN_INPUT} id="my-access-name" name="accessLabel" required maxLength={80} placeholder="Claude" aria-invalid={state?.errors?.name ? true : undefined} aria-describedby={state?.errors?.name ? "err-accessLabel" : undefined} className={ui.input} />
              <p className={ui.help}>{labels.example}</p>
              <FieldErrorText id="err-accessLabel" message={state?.errors?.name ?? null} />
            </div>
            <div>
              <label className={ui.label} htmlFor="my-access-password">{labels.password}</label>
              <input id="my-access-password" name="confirmPassword" type="password" required autoComplete="current-password" aria-invalid={state?.errors?.password ? true : undefined} aria-describedby={state?.errors?.password ? "err-confirmPassword" : undefined} className={ui.input} />
              <FieldErrorText id="err-confirmPassword" message={state?.errors?.password ?? null} />
            </div>
          </div>
          <Segmented label={labels.level} name="level" options={levels} defaultValue="read" />
          {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
          <PendingButton variant="primary" pending={pending} pendingLabel={labels.pending}>{labels.submit}</PendingButton>
        </form>
        </MoreOptions>
      )}
    </div>
  );
}

function AccessRow({ row, pause, resume, remove, setLevel, levels, labels }: { row: AccessRowView; pause: (id: string) => Promise<{ error?: string }>; resume: (id: string, password: string) => Promise<{ ok?: boolean; error?: string }>; remove: (id: string) => Promise<void>; setLevel: (id: string, level: string) => Promise<{ ok?: boolean; error?: string }>; levels: { value: string; label: string }[]; labels: MyAccessesLabels }) {
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const tone = row.state === "active" ? "ok" : "warn";
  return (
    <li className="space-y-2 px-4 py-3" data-testid="my-access-row" data-state={row.state}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={row.name}>{row.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5"><Badge tone="info" testid="my-access-level">{row.levelLabel}</Badge><Badge tone={tone} title={row.stateWhy} testid="my-access-state">{row.stateLabel}</Badge><HelpTip help={labels.ceiling} name={row.name} always /></p>
        </div>
        <div className="flex items-center gap-2">
          {row.state === "inert" ? null : (
            <Switch label={labels.switchLabel.replace("{name}", row.name)} checked={row.state === "active"} onText={labels.active} offText={labels.paused} testid="my-access-switch"
              onToggle={async (next) => {
                if (!next) return pause(row.id);
                setAsking(true);
                return { error: labels.resumeNeed };
              }} />
          )}
          <RowMenu label={labels.menu.replace("{name}", row.name)}>
            <LevelForm row={row} levels={levels} setLevel={setLevel} labels={labels} />
            <div className="mt-1 border-t border-line pt-1">
              <form action={remove.bind(null, row.id)}><ConfirmButton menu message={labels.removeConfirm.replace("{name}", row.name)} confirmLabel={labels.removeAction} dangerConfirm>{labels.remove}</ConfirmButton></form>
            </div>
          </RowMenu>
        </div>
      </div>
      {asking && row.state === "paused" && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
          e.preventDefault();
          const password = String(new FormData(e.currentTarget).get("confirmPassword") ?? "");
          setProblem(null);
          start(async () => { const r = await resume(row.id, password); if (r.error) setProblem(r.error); else setAsking(false); });
        }}>
          <div className="min-w-[12rem] flex-1">
            <label className={ui.label} htmlFor={`resume-${row.id}`}>{labels.resumeWith}</label>
            <input id={`resume-${row.id}`} name="confirmPassword" type="password" required autoComplete="current-password" aria-invalid={problem ? true : undefined} aria-describedby={problem ? `err-resume-${row.id}` : undefined} className={ui.input} />
            <FieldErrorText id={`err-resume-${row.id}`} message={problem} />
          </div>
          <PendingButton variant="primary" pending={busy}>{labels.resume}</PendingButton>
        </form>
      )}
    </li>
  );
}

/** Level of one access, within what its owner can do (the select only offers those levels). Inside the "⋯" menu: no permanent field. */
function LevelForm({ row, levels, setLevel, labels }: { row: AccessRowView; levels: { value: string; label: string }[]; setLevel: (id: string, level: string) => Promise<{ ok?: boolean; error?: string }>; labels: MyAccessesLabels }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="space-y-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); const level = String(new FormData(e.currentTarget).get("level") ?? ""); start(async () => { const r = await setLevel(row.id, level); setMessage(r.error ?? null); }); }}>
      <label className="block text-sm font-medium" htmlFor={`level-${row.id}`}>{labels.changeLevel}</label>
      <select id={`level-${row.id}`} name="level" defaultValue={row.level} className={ui.input}>{levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
      <PendingButton pending={busy}>{labels.saveLevel}</PendingButton>
      {message && <p role="alert" className="text-xs font-medium text-red-700">{message}</p>}
    </form>
  );
}
