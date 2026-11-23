"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";

/**
 * Choose the owner of an access (permanent: the "Choose an owner" entry of a row menu, and the rows of the temporary Assign owners page). Only people who may own an access are
 * offered (the server checks again). The confirmation of what changes is written by the caller (`note`); the select never offers more than the server accepts.
 */
export function OwnerSelect({ tokenId, current, owners, assign, labels, compact }: {
  tokenId: string; current?: string; owners: { id: string; label: string }[];
  assign: (tokenId: string, ownerId: string) => Promise<{ ok: boolean; reason?: string }>;
  labels: { choose: string; assign: string; failed: string; done: string; pick: string }; compact?: boolean;
}) {
  const [value, setValue] = useState(current ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className={compact ? "space-y-2 px-4 py-2" : "flex flex-wrap items-center gap-2"} onSubmit={(e) => {
      e.preventDefault();
      if (!value) { setMsg({ ok: false, text: labels.pick }); return; }
      start(async () => { const r = await assign(tokenId, value); setMsg(r.ok ? { ok: true, text: labels.done } : { ok: false, text: labels.failed }); });
    }}>
      <label className={compact ? "block text-sm font-medium" : "sr-only"} htmlFor={`owner-${tokenId}`}>{labels.choose}</label>
      <select id={`owner-${tokenId}`} value={value} onChange={(e) => setValue(e.target.value)} className={`${ui.input} ${compact ? "" : "min-w-[12rem] flex-1"}`}>
        <option value="">{labels.choose}</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <PendingButton pending={busy}>{labels.assign}</PendingButton>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}
