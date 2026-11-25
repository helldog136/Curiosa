"use client";

import { useEffect, useState } from "react";
import { ActionForm, type ActionState } from "./ActionForm";
import { TextField } from "./Field";
import { UsernameHint } from "./UsernameHint";
import { useFragmentToken } from "./FragmentToken";

export type InviteAcceptLabels = { loading: string; missing: string; invalid: string; rate: string; title: string; intro: string; account: string; name: string; nameExample: string; password: string; confirm: string; help: string; submit: string; pending: string };
type Look = { ok: true; email: string; role: string } | { ok: false; reason: "invalid" | "rate" };

/** The invitation page: the token comes from the address fragment, is checked by the server, and travels only in the form body. */
export function InviteAccept({ peek, action, labels, minLength }: {
  peek: (token: string) => Promise<Look>;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  labels: InviteAcceptLabels;
  minLength: number;
}) {
  const token = useFragmentToken();
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    if (!token) return;
    let live = true;
    void peek(token).then((r) => { if (live) setLook(r); });
    return () => { live = false; };
  }, [token, peek]);

  if (token === null || (token && !look)) return <p role="status" className="text-sm text-muted" data-testid="invite-loading">{labels.loading}</p>;
  if (!token) return <p role="alert" className="text-sm" data-testid="invite-missing">{labels.missing}</p>;
  if (look && !look.ok) return <p role="alert" className="text-sm" data-testid="invite-invalid">{look.reason === "rate" ? labels.rate : labels.invalid}</p>;
  const ok = look as Extract<Look, { ok: true }>;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        <p className="text-sm leading-6 text-muted" data-testid="invite-intro">{labels.intro.replace("{role}", ok.role)}</p>
        <p className="break-all text-sm font-medium" data-testid="invite-email">{labels.account.replace("{email}", ok.email)}</p>
      </div>
      <ActionForm action={action} submitLabel={labels.submit} pendingLabel={labels.pending}>
        <input type="hidden" name="token" value={token} />
        <UsernameHint value={ok.email} />
        <TextField name="name" label={labels.name} required example={labels.nameExample} autoComplete="name" />
        <TextField name="password" type="password" label={labels.password} required passwordMin={minLength} autoComplete="new-password" help={labels.help} />
        <TextField name="confirm" type="password" label={labels.confirm} required passwordMin={minLength} autoComplete="new-password" />
      </ActionForm>
    </div>
  );
}
