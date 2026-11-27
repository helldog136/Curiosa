"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionForm, type ActionState } from "./ActionForm";
import { TextField } from "./Field";
import { forgetTokenAfter, useFragmentToken } from "./FragmentToken";

export type ResetLabels = { loading: string; missing: string; invalid: string; rate: string; password: string; confirm: string; help: string; submit: string; pending: string };

/** The page of a reset link: same token handling as the invitation page (fragment → server check → request body). */
export function ResetPasswordForm({ peek, action, labels, minLength, intro }: {
  intro: string;
  peek: (token: string) => Promise<{ ok: boolean; rate?: boolean }>;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  labels: ResetLabels;
  minLength: number;
}) {
  const token = useFragmentToken();
  const wrapped = useMemo(() => forgetTokenAfter(action), [action]);
  const [look, setLook] = useState<{ ok: boolean; rate?: boolean } | null>(null);
  useEffect(() => {
    if (!token) return;
    let live = true;
    void peek(token).then((r) => { if (live) setLook(r); });
    return () => { live = false; };
  }, [token, peek]);
  if (token === null || (token && !look)) return <p role="status" className="text-sm text-muted" data-testid="reset-loading">{labels.loading}</p>;
  if (!token) return <p role="alert" className="text-sm" data-testid="reset-missing">{labels.missing}</p>;
  if (look && !look.ok) return <p role="alert" className="text-sm" data-testid="reset-invalid">{look.rate ? labels.rate : labels.invalid}</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-muted">{intro}</p>
      <ActionForm action={wrapped} submitLabel={labels.submit} pendingLabel={labels.pending}>
        <input type="hidden" name="token" value={token} />
        <TextField name="password" type="password" label={labels.password} required passwordMin={minLength} autoComplete="new-password" help={labels.help} />
        <TextField name="confirm" type="password" label={labels.confirm} required passwordMin={minLength} autoComplete="new-password" />
      </ActionForm>
    </div>
  );
}
