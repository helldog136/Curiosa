"use client";

import { useState } from "react";
import { ui } from "./ui";

type Plan = { id: string; name: string; version: string; status: "builtin" | "installed" | "marketplace" | "custom" | "unavailable"; repoUrl: string | null; ref: string | null; needsConfirmation: boolean };
type Preview = { token: string; site: { name: string }; createdAt: string; frameworkVersion: string; counts: Record<string, number>; modules: Plan[] };
type Report = { ok: boolean; error?: string; modules: { id: string; outcome: string; error?: string }[]; migrations?: { key: string; from: number; to: number; status: string; error?: string }[]; counts?: Record<string, number> };
type Labels = Record<string, string>;

/** Restauration en deux temps : (1) fichier + mot de passe → aperçu ; (2) confirmation, module personnel par module personnel. */
export function RestorePanel({ labels, previewUrl = "/api/admin/backup/restore", applyUrl = "/api/admin/backup/restore/apply", loginHref = "/admin/login", needsToken = false }: { labels: Labels; previewUrl?: string; applyUrl?: string; loginHref?: string; needsToken?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<Report | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const headers = (extra: Record<string, string> = {}) => ({ ...extra, ...(needsToken ? { "x-setup-token": setupToken } : {}) });
  const L = (k: string) => labels[k] ?? k;

  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(previewUrl, { method: "POST", headers: headers(), body: new FormData(event.currentTarget) });
      const json = await res.json();
      if (!json.ok) setError(L(`error.${json.error}`));
      else { setPreview(json); setAccepted(new Set()); }
    } catch { setError(L("error.network")); }
    setBusy(false);
  }

  async function apply() {
    if (!preview || !window.confirm(L("confirmReplace"))) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(applyUrl, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ token: preview.token, confirm: [...accepted] }) });
      const json = await res.json();
      if (json.ok === false && json.error && !json.modules) setError(L(`error.${json.error}`));
      else { setReport(json); setPreview(null); }
    } catch { setError(L("error.network")); }
    setBusy(false);
  }

  if (report) {
    return (
      <div className="space-y-3" role="status">
        <p className={report.ok ? "text-emerald-700" : "text-red-700"}>{report.ok ? `✅ ${L("done")}` : `❌ ${L("error.failed")}`}</p>
        <ul className="list-disc pl-5 text-sm">
          {report.modules.map((m) => <li key={m.id}><span className="font-mono">{m.id}</span> — {L(`outcome.${m.outcome}`)}{m.error ? ` (${m.error})` : ""}</li>)}
        </ul>
        {(report.migrations ?? []).length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {report.migrations!.map((m) => <li key={m.key}><span className="font-mono">{m.key}</span> — {m.status === "ok" ? `${L("migrated")} (v${m.from} → v${m.to})` : `${L("migrationFailed")}${m.error ? ` : ${m.error}` : ""}`}</li>)}
          </ul>
        )}
        {report.ok && <a href={loginHref} className={ui.btnPrimary}>{L("login")}</a>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!preview && (
        <form onSubmit={check} className="space-y-3">
          <label className="block text-sm"><span className={ui.label}>{L("file")}</span><input name="file" type="file" required className={ui.input} /></label>
          {needsToken && <label className="block text-sm"><span className={ui.label}>{L("setupToken")}</span><input type="password" required value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" className={ui.input} /></label>}
          <label className="block text-sm"><span className={ui.label}>{L("password")}</span><input name="password" type="password" required autoComplete="off" className={ui.input} /></label>
          <button className={ui.btn} disabled={busy}>{L("check")}</button>
        </form>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error}</p>}
      {preview && (
        <div className="space-y-4">
          <p className="rounded-lg border border-line bg-surface p-3 text-sm">
            <strong>{preview.site.name}</strong> — {new Date(preview.createdAt).toLocaleString()} (v{preview.frameworkVersion})<br />
            {preview.counts.entries} {L("entries")} · {preview.counts.users} {L("users")} · {preview.counts.instances} {L("instances")} · {preview.counts.uploads} {L("uploads")}
          </p>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{L("replaceWarning")}</p>
          <ul className="space-y-2">
            {preview.modules.filter((m) => m.status !== "builtin").map((m) => (
              <li key={m.id} className={`${ui.card} text-sm`}>
                <p className="font-medium">{m.name} <span className="text-xs text-muted">v{m.version}</span> — {L(`status.${m.status}`)}</p>
                {m.status === "custom" && (
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" checked={accepted.has(m.id)} onChange={(e) => setAccepted((s) => { const n = new Set(s); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} className="mt-1 h-4 w-4" />
                    <span>{L("trustCustom")} <code className="break-all font-mono text-xs">{m.repoUrl}{m.ref ? `#${m.ref}` : ""}</code></span>
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button onClick={apply} disabled={busy} className={ui.btnDanger}>{L("apply")}</button>
            <button onClick={() => { setPreview(null); setError(null); }} disabled={busy} className={ui.btn}>{L("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
