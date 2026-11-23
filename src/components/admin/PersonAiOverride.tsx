"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "./PendingButton";
import { ui } from "./ui";

/**
 * Per-person choice, inside the person's "⋯" menu on the Team page (never a field of the invitation form): may this person own AI accesses? "Default" follows the role.
 * The effective result is written in plain words next to it, with the number of accesses the person owns. Only holders of `core:mcp.tokens` get it (the action checks again).
 */
export function PersonAiOverride({ value, effective, owned, save, labels }: {
  value: "inherit" | "allow" | "deny"; effective: boolean; owned: number;
  save: (value: string) => Promise<boolean>;
  labels: { title: string; inherit: string; allow: string; deny: string; save: string; may: string; mayNot: string; owned: string; done: string; failed: string };
}) {
  const [current, setCurrent] = useState(value);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="space-y-2 px-4 py-2" data-testid="person-ai" onSubmit={(e) => { e.preventDefault(); start(async () => { const ok = await save(current); setMsg({ ok, text: ok ? labels.done : labels.failed }); }); }}>
      <label className="block text-sm font-medium" htmlFor="person-ai-select">{labels.title}</label>
      <select id="person-ai-select" value={current} onChange={(e) => setCurrent(e.target.value as typeof value)} className={ui.input}>
        <option value="inherit">{labels.inherit}</option><option value="allow">{labels.allow}</option><option value="deny">{labels.deny}</option>
      </select>
      <p className="text-xs text-muted">{effective ? labels.may : labels.mayNot}{owned > 0 ? ` ${labels.owned.replace("{n}", String(owned))}` : ""}</p>
      <PendingButton pending={busy}>{labels.save}</PendingButton>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}
