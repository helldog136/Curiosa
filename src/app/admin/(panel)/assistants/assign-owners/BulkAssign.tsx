"use client";

// TEMPORARY (SUNSET 0.50.0): the whole folder assign-owners/ is deleted in 0.50.0 (docs/PERSONAL-AI.md, "Choosing owners").
import { useState, useTransition } from "react";
import { askConfirm } from "@/components/admin/confirmDialog";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";

/** "Give all to ...": one person for every access without an owner, after a confirmation that says what changes. */
export function BulkAssign({ owners, count, assignAll, labels }: {
  owners: { id: string; label: string }[]; count: number;
  assignAll: (ownerId: string) => Promise<{ ok: boolean; changed: number }>;
  labels: { pick: string; choose: string; placeholder: string; button: string; confirm: string; confirmLabel: string; done: string; failed: string };
}) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-3" data-testid="assign-all" onSubmit={async (e) => {
      e.preventDefault();
      const person = owners.find((o) => o.id === value);
      if (!person) { setMsg({ ok: false, text: labels.pick }); return; }
      if (!(await askConfirm(labels.confirm.replace("{n}", String(count)).replace("{name}", person.label), { confirmLabel: labels.confirmLabel }))) return;
      start(async () => { const r = await assignAll(value); setMsg(r.ok ? { ok: true, text: labels.done.replace("{n}", String(r.changed)) } : { ok: false, text: labels.failed }); });
    }}>
      <div className="min-w-[12rem] flex-1">
        <label className={ui.label} htmlFor="assign-all-owner">{labels.choose}</label>
        <select id="assign-all-owner" value={value} onChange={(e) => setValue(e.target.value)} className={ui.input}>
          <option value="">{labels.placeholder}</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <PendingButton variant="primary" pending={busy}>{labels.button}</PendingButton>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`w-full text-sm font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}
