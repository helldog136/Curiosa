"use client";

import { EditDialog } from "./EditDialog";
import { ActionForm, type ActionState } from "./ActionForm";
import { useModalWindow, type DiscardGuard } from "./ModalWindow";

function CloseButton({ label }: { label: string }) {
  const win = useModalWindow();
  return <button type="button" onClick={() => win?.close()} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline" data-testid="edit-dialog-cancel">{label}</button>;
}

function Form({ action, submitLabel, children }: { action: (prev: ActionState, data: FormData) => Promise<ActionState>; submitLabel: string; children: React.ReactNode }) {
  const win = useModalWindow();
  return <ActionForm action={action} submitLabel={submitLabel} onSaved={() => { win?.markClean(); win?.close(true); }}>{children}</ActionForm>;
}

/** The window above the "Accounts and connections" table that edits one account (the fields come from the server). It closes by itself once the save succeeded. */
export function AccountDialog({ title, closeLabel, cancelLabel, closeHref, guard, action, submitLabel, children }: {
  title: string; closeLabel: string; cancelLabel: string; closeHref: string; guard: DiscardGuard; action: (prev: ActionState, data: FormData) => Promise<ActionState>; submitLabel: string; children: React.ReactNode;
}) {
  return (
    <EditDialog title={title} closeLabel={closeLabel} closeHref={closeHref} guard={guard} footer={<div className="flex justify-end"><CloseButton label={cancelLabel} /></div>} testid="account-dialog">
      <Form action={action} submitLabel={submitLabel}>{children}</Form>
    </EditDialog>
  );
}
