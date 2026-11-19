"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef } from "react";
import { clearSecrets, submitKeepingValues } from "./keepValues";
import { saveAccessAction, removeAccessAction } from "@/app/admin/(panel)/access/actions";
import type { AccessState } from "@/core/gitAccess";
import { ConfirmButton } from "./ConfirmButton";
import { TextField } from "./Field";
import { FormDialog } from "./FormDialog";
import { PendingButton } from "./PendingButton";
import { ui } from "./ui";

/** Keys of the texts these parts need: the page passes them already translated (`labels`), so the same parts serve Appearance and Extensions. */
export const ACCESS_LABEL_KEYS = [
  "access.configured", "access.reenter", "access.reenter.why", "access.edit", "access.edit.title", "access.edit.save", "access.checking", "access.remove",
  "access.remove.confirm", "access.removing", "access.field.label", "access.field.example", "access.field.keep", "access.field.help", "modal.close",
] as const;
export type AccessLabels = Record<string, string>;
const fill = (text: string | undefined, repo: string) => (text ?? "").replaceAll("{repo}", repo);

/**
 * The access code field (read-only code of one private repository): label without colon, example under the field, the GitHub steps in the "?" bubble, the error under
 * the field. It is shown only when it is needed (R7): after a refusal, or in the edit window. Never pre-filled; the code never comes back from the server.
 */
export function CodeField({ labels, error, keep = false, name = "code", value, onChange }: { labels: AccessLabels; error?: string; /** Edit window of a saved code: says that an empty field keeps it. */ keep?: boolean; name?: string; /** Controlled use (the page keeps the code until it is tried); without them the field is a plain form field. */ value?: string; onChange?: (v: string) => void }) {
  return (
    <TextField name={name} type="password" label={labels["access.field.label"] ?? ""} help={labels["access.field.help"]} example={keep ? labels["access.field.keep"] : labels["access.field.example"]}
      error={error} noManager autoComplete="off" inputProps={{ spellCheck: false, autoCapitalize: "off", ...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : {}) }} />
  );
}

function EditForm({ url, state, labels, onChanged }: { url: string; state: AccessState["state"]; labels: AccessLabels; onChanged: () => void }) {
  const [res, act, pending] = useActionState(saveAccessAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { clearSecrets(form.current); if (res?.ok) onChanged(); }, [res, onChanged]);
  return (
    <form ref={form} method="post" autoComplete="off" onSubmit={submitKeepingValues(act)} className="space-y-4" data-testid="access-edit-form">
      <input type="hidden" name="url" value={url} />
      <CodeField labels={labels} keep={state === "configured"} error={res?.errors?.code} />
      <div className="flex flex-wrap items-center gap-3">
        <PendingButton variant="primary" pending={pending} pendingLabel={labels["access.checking"]}>{labels["access.edit.save"]}</PendingButton>
        {res?.ok && <p role="status" className="text-sm text-emerald-700">{res.ok}</p>}
      </div>
    </form>
  );
}

function RemoveForm({ url, repo, labels, onChanged }: { url: string; repo: string; labels: AccessLabels; onChanged: () => void }) {
  const [res, act] = useActionState(removeAccessAction, null);
  useEffect(() => { if (res?.ok) onChanged(); }, [res, onChanged]);
  return (
    <form method="post" onSubmit={submitKeepingValues(act)}>
      <input type="hidden" name="url" value={url} />
      <ConfirmButton message={fill(labels["access.remove.confirm"], repo)} pendingLabel={labels["access.removing"]}>{labels["access.remove"]}</ConfirmButton>
    </form>
  );
}

/**
 * Once the access of a repository is set up (R33): ONE summary line, ONE "Edit" button that opens a window with the field ("Leave empty to keep the current one"),
 * and a named "Remove access" that says what stops working. No field is shown any more. The state is said in words: configured, or to enter again (with the
 * reason: a restored backup does not carry the code).
 */
export function AccessSummary({ url, access, labels, onChanged }: { url: string; access: AccessState; labels: AccessLabels; onChanged: () => void }) {
  if (access.state === "none" || !access.repo) return null;
  const repo = access.repo;
  const configured = access.state === "configured";
  return (
    <div className="space-y-2 rounded-xl border border-line bg-bg px-4 py-3" data-testid="access-summary" data-state={access.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={configured ? ui.chipOk : ui.chipWarn}><span aria-hidden>{configured ? "✓" : "✎"}</span> {configured ? labels["access.configured"] : labels["access.reenter"]}</span>
        <span className="min-w-0 flex-1 basis-40 truncate text-sm text-muted" title={repo}>{repo}</span>
        <span className="flex flex-wrap items-center gap-2">
          <FormDialog trigger={labels["access.edit"] ?? ""} triggerLabel={`${labels["access.edit"]} ${repo}`} title={fill(labels["access.edit.title"], repo)} closeLabel={labels["modal.close"] ?? ""} testid="access-edit-open">
            <EditForm url={url} state={access.state} labels={labels} onChanged={onChanged} />
          </FormDialog>
          <RemoveForm url={url} repo={repo} labels={labels} onChanged={onChanged} />
        </span>
      </div>
      {!configured && <p className="text-sm text-muted">{labels["access.reenter.why"]}</p>}
    </div>
  );
}

/**
 * Extensions > add from an address: the repository refused the reading (private, or an address or code to check). One field appears under the message (R7, R22);
 * once the code works the page reads the repository again. A code already saved for it shows the summary line instead of the field (R33).
 */
export function PrivateRepoGate({ url, access, labels, error }: { url: string; access: AccessState; labels: AccessLabels; error: string }) {
  const router = useRouter();
  const onSaved = useCallback(() => router.refresh(), [router]);
  const [res, act, pending] = useActionState(saveAccessAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { clearSecrets(form.current); if (res?.ok) onSaved(); }, [res, onSaved]);
  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg p-4" data-testid="private-gate">
      {access.state !== "none" ? (
        <>
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <AccessSummary url={url} access={access} labels={labels} onChanged={onSaved} />
        </>
      ) : (
        <form ref={form} method="post" autoComplete="off" onSubmit={submitKeepingValues(act)} className="space-y-3">
          <input type="hidden" name="url" value={url} />
          <CodeField labels={labels} error={res?.errors?.code ?? error} />
          <PendingButton variant="primary" pending={pending} pendingLabel={labels["access.checking"]}>{labels["access.edit.save"]}</PendingButton>
        </form>
      )}
    </div>
  );
}
