"use client";
import { LOGIN_HREF } from "@/core/adminLinks";

import { useState } from "react";
import { AnimatedActionButton } from "./AnimatedActionButton";
import { PendingButton } from "./PendingButton";
import { FileButton } from "./FileButton";
import { PasswordInput } from "./PasswordInput";
import { useProgressText } from "./ProgressLabels";
import { ui } from "./ui";

type Plan = { id: string; name: string; version: string; status: "installed" | "catalogue" | "custom" | "unavailable"; repoUrl: string | null; ref: string | null; needsConfirmation: boolean; /** Module actif dont un fournisseur manque : services en clair. */ missingLabels?: string[] };
type SkinPlan = { id: string; name: string; version: string; status: "installed" | "catalogue" | "personal" | "upload"; repoUrl: string; ref: string | null; needsConfirmation: boolean };
type Item = { id: string; note: string; params?: Record<string, string | number>; path?: string };
type Conversion = { backupVersion: string; currentVersion: string; gap: "same" | "older" | "unknown"; core: Item[]; rawg: { key: boolean; fixes: number; todo: number } | null; modules: { id: string; route: "bridge" | "installed" | "blocked"; dataVersion: number; floor: number; tags: string[]; path: string }[] };
type Result = { converted: Item[]; setAside: Item[]; failed: Item[] };
type Preview = { token: string; site: { name: string }; createdAt: string; frameworkVersion: string; counts: Record<string, number>; modules: Plan[]; /** Skins de la sauvegarde (absent d'une sauvegarde d'avant les skins). */ skins?: SkinPlan[]; conversion?: Conversion | null };
type Report = { ok: boolean; error?: string; report?: Result; safetyCopy?: string | null; modules: { id: string; outcome: string; error?: string }[]; skins?: { id: string; outcome: string }[]; migrations?: { key: string; from: number; to: number; status: string; error?: string }[]; counts?: Record<string, number>; dependencyLines?: { id: string; name: string; labels: string[] }[]; providedNames?: string[] };
type Labels = Record<string, string>;

/** Restauration en deux temps : (1) fichier + mot de passe → aperçu ; (2) confirmation, module personnel par module personnel. */
export function RestorePanel({ labels, previewUrl = "/api/admin/backup/restore", applyUrl = "/api/admin/backup/restore/apply", loginHref = LOGIN_HREF, needsToken = false }: { labels: Labels; previewUrl?: string; applyUrl?: string; loginHref?: string; needsToken?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<Report | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const headers = (extra: Record<string, string> = {}) => ({ ...extra, ...(needsToken ? { "x-setup-token": setupToken } : {}) });
  const L = (k: string) => labels[k] ?? k;
  const p = useProgressText();
  const fill = (key: string, params: Record<string, string | number> = {}) => Object.entries(params).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, String(v)), L(key));
  /** "1 entrée", "12 entrées": the singular text exists as `<key>.one`. */
  const count = (key: string, n: number) => (n === 1 ? L(`${key}.one`) : L(key)).replace("{n}", String(n));
  const line = (i: Item) => fill(`report.${i.note}`, i.params);

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

  /** Restaure (l'aperçu a déjà été vérifié). Suivi d'opération côté serveur : modules → copie de sécurité → données → images → fin. */
  async function apply(opId: string): Promise<{ ok: boolean; error?: string }> {
    if (!preview) return { ok: false };
    setBusy(true); setError(null);
    try {
      const res = await fetch(applyUrl, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ token: preview.token, confirm: [...accepted], op: opId }) });
      const json = await res.json();
      if (json.ok === false && json.error && !json.modules) { const message = json.error === "busy" ? p("busy") : L(`error.${json.error}`); setError(message); setBusy(false); return { ok: false, error: message }; }
      setReport(json); setPreview(null); setBusy(false);
      return { ok: json.ok !== false };
    } catch { const message = L("error.network"); setError(message); setBusy(false); return { ok: false, error: message }; }
  }

  if (report) {
    return (
      <div className="space-y-3" role="status">
        <p className={report.ok ? "text-emerald-700" : "text-red-700"}>{report.ok ? `✅ ${L("done")}` : `❌ ${L("error.failed")}`}</p>
        {(["failed", "setAside", "converted"] as const).map((kind) => (report.report?.[kind] ?? []).length > 0 && (
          <section key={kind} data-testid={`restore-${kind}`} className={`${ui.card} text-sm`}>
            <h3 className="font-medium">{fill(`report.${kind}`, { n: report.report![kind].length })}</h3>
            <ul className="mt-2 space-y-2">
              {report.report![kind].map((i) => (
                <li key={`${i.id}-${i.note}`}>
                  {line(i)}
                  {i.path && kind !== "converted" && <><br /><span className="text-xs text-muted">{fill("report.where", { path: "" })}<Paths path={i.path} /></span></>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {report.safetyCopy && <p className="text-xs text-muted" data-testid="restore-snapshot">{fill("report.saved", { path: report.safetyCopy })}</p>}
        {(report.skins ?? []).length > 0 && (
          <ul className="list-disc pl-5 text-sm" data-testid="restore-skins">
            {report.skins!.map((s) => <li key={s.id}>{L("skin")} <span className="font-mono">{s.id}</span> — {L(`skinOutcome.${s.outcome}`)}</li>)}
          </ul>
        )}
        {(report.providedNames ?? []).length > 0 && <p className="text-sm text-muted" data-testid="restore-provided">➕ {L("deps.provided").replace("{names}", report.providedNames!.join(", "))}</p>}
        {(report.dependencyLines ?? []).length > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="restore-missing" role="alert">
            <p className="font-medium">⚠ {L("deps.title")}</p>
            <ul className="mt-1 list-disc pl-5">{report.dependencyLines!.map((d) => <li key={d.id}><strong>{d.name}</strong> — {L("deps.missing").replace("{list}", d.labels.join(", "))}</li>)}</ul>
            <p className="mt-2 text-muted">{L("deps.note")}</p>
          </div>
        )}
        {report.ok && <a href={loginHref} className={ui.btnPrimary}>{L("login")}</a>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!preview && (
        <form onSubmit={check} className="space-y-3">
          <div className="text-sm"><label className={ui.label} htmlFor="restore-file">{L("file")}</label><FileButton id="restore-file" name="file" required /></div>
          {needsToken && <label className="block text-sm"><span className={ui.label}>{L("setupToken")}</span><input type="text" required value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} className={ui.input} /></label>}
          <div className="text-sm"><label className={ui.label} htmlFor="restore-password">{L("password")}</label><PasswordInput id="restore-password" name="password" required autoComplete="current-password" className={ui.input} /></div>
          <PendingButton pending={busy} pendingLabel={p("checking")}>{L("check")}</PendingButton>
        </form>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error}</p>}
      {preview && (
        <div className="space-y-4">
          <p className="rounded-lg border border-line bg-surface p-3 text-sm">
            <strong>{preview.site.name}</strong> — {new Date(preview.createdAt).toLocaleString()} (v{preview.frameworkVersion})<br />
            {(["entries", "users", "instances", "uploads"] as const).map((k) => count(k, preview.counts[k] ?? 0)).join(" · ")}
          </p>
          {preview.conversion && <ConversionPlanView plan={preview.conversion} fill={fill} where={L("report.where")} />}
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{L("replaceWarning")}</p>
          <ul className="space-y-2">
            {preview.modules.map((m) => (
              <li key={m.id} className={`${ui.card} text-sm`}>
                <p className="font-medium">{m.name} <span className="text-xs text-muted">v{m.version}</span> — {L(`status.${m.status}`)}</p>
                {m.missingLabels && m.missingLabels.length > 0 && <p className="mt-1 text-amber-700" data-testid={`restore-plan-missing-${m.id}`}>⚠ {L("deps.missing").replace("{list}", m.missingLabels.join(", "))}</p>}
                {m.status === "custom" && (
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" checked={accepted.has(m.id)} onChange={(e) => setAccepted((s) => { const n = new Set(s); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} className="mt-1 h-4 w-4" />
                    <span>{L("trustCustom")} <code className="break-all font-mono text-xs">{m.repoUrl}{m.ref ? `#${m.ref}` : ""}</code></span>
                  </label>
                )}
              </li>
            ))}
          </ul>
          {(preview.skins ?? []).length > 0 && (
            <ul className="space-y-2" data-testid="restore-plan-skins">
              {preview.skins!.map((s) => (
                <li key={s.id} className={`${ui.card} text-sm`}>
                  <p className="font-medium">{L("skin")} {s.name} <span className="text-xs text-muted">v{s.version}</span> — {L(s.status === "personal" ? "status.skinPersonal" : s.status === "upload" ? "status.skinUpload" : `status.${s.status}`)}</p>
                  {s.status === "personal" && (
                    <label className="mt-2 flex items-start gap-2">
                      <input type="checkbox" checked={accepted.has(`skin:${s.id}`)} onChange={(e) => setAccepted((a) => { const n = new Set(a); if (e.target.checked) n.add(`skin:${s.id}`); else n.delete(`skin:${s.id}`); return n; })} className="mt-1 h-4 w-4" />
                      <span>{L("trustCustomSkin")} <code className="break-all font-mono text-xs">{s.repoUrl}{s.ref ? `#${s.ref}` : ""}</code></span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <AnimatedActionButton look="danger" icon="♻" track={needsToken ? undefined : "restore"} testid="restore-apply" className="items-start" confirm={L("confirmReplace")}
              labels={{ idle: L("apply"), working: p("restoring"), done: p("done"), failed: L("error.failed") }} run={apply} />
            <button onClick={() => { setPreview(null); setError(null); }} disabled={busy} className={`${ui.btn} min-h-11`}>{L("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The conversion plan, short: only what differs from a plain restore (nothing at all for a backup of the same release). */
function ConversionPlanView({ plan, fill, where }: { plan: Conversion; fill: (key: string, params?: Record<string, number | string>) => string; where: string }) {
  const rows: { key: string; text: string; path?: string }[] = [
    ...plan.core.map((i) => ({ key: i.id, text: fill(`plan.${i.note}`, i.params), path: i.note === "switchedOff" ? i.path : undefined })),
    ...(plan.rawg ? [{ key: "core.rawg", text: fill("plan.rawg", { fixes: plan.rawg.fixes }) }] : []),
    ...plan.modules.map((m) => ({ key: `module.${m.id}`, text: fill(`plan.module.${m.route}`, { module: m.id, from: m.dataVersion, steps: m.tags.length }), path: m.route === "bridge" ? undefined : m.path })),
  ];
  if (plan.gap !== "older" && rows.length === 0) return null;
  return (
    <section className={`${ui.card} space-y-2 text-sm`} data-testid="restore-plan">
      {plan.gap === "older" && <p className="font-medium">{fill("plan.gap", { from: plan.backupVersion, to: plan.currentVersion })}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.key}>
              {r.text}
              {r.path && <><br /><span className="text-xs text-muted">{where.replace("{path}", "")}<Paths path={r.path} /></span></>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Files or folders of the unpacked archive: one `code` each, never cut in the middle of a name unless a single name is wider than the screen. */
function Paths({ path }: { path: string }) {
  return <>{path.split(", ").map((p, n) => <span key={p}>{n > 0 && " · "}<code className="font-mono [overflow-wrap:anywhere]">{p}</code></span>)}</>;
}
