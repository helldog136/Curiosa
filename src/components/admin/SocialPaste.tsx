"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recognizeSocial, type Recognized, type SocialSource } from "@/core/socialRecognize";
import { addNetworkWithProfile } from "@/app/admin/(panel)/social/actions";
import { ui } from "./ui";

/**
 * « COLLEZ L'ADRESSE DE VOTRE PROFIL » : un seul champ pour ajouter un ou plusieurs réseaux. Chaque adresse collée est reconnue EN DIRECT (réseau, nom du compte, bouton qui
 * s'affichera) avant que rien ne soit installé ; un nom seul propose les réseaux possibles ; un clic ajoute tout, un réseau après l'autre, avec la progression (« Ajout de TikTok… 2 sur 6 »).
 * Sans JavaScript, la liste « Ajouter un réseau » plus bas reste là.
 */
export type SocialPasteLabels = {
  label: string; help: string; example: string; placeholder: string;
  add: string; addOne: string; addMany: string; running: string; done: string; doneMany: string; failed: string;
  ready: string; have: string; dup: string; choose: string; choosePlaceholder: string; unknown: string; ownerOnly: string; clear: string; limit: string;
};
type Icon = { svg?: string; text?: string } | null;
type Row =
  | { text: string; state: "ready"; id: string; name: string; label: string; url: string; icon: Icon }
  | { text: string; state: "have" | "dup"; name: string; label: string; icon: Icon }
  | { text: string; state: "choose"; choices: { id: string; name: string; label: string; url: string; icon: Icon }[] }
  | { text: string; state: "unknown" };

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

function IconView({ icon }: { icon: Icon }) {
  if (!icon) return <span aria-hidden="true" className="inline-block h-5 w-5" />;
  if (icon.svg) return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5 shrink-0"><path d={icon.svg} /></svg>;
  return <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">{icon.text}</span>;
}

export function SocialPaste({ sources, icons, existing, canInstall, shown, max, labels }: {
  sources: SocialSource[]; icons: Record<string, Icon>; existing: string[]; canInstall: boolean; shown: number; max: number; labels: SocialPasteLabels;
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [run, setRun] = useState<{ n: number; total: number; name: string } | null>(null);
  const [report, setReport] = useState<{ ok: string[]; failed: string[] } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const rows = useMemo<Row[]>(() => {
    const have = new Set(existing);
    const seen = new Set<string>();
    const view = (r: Recognized): Row => {
      if (r.kind === "unknown") return { text: r.text, state: "unknown" };
      if (r.kind === "ambiguous") {
        const chosen = r.choices.find((c) => c.id === picks[r.text]);
        if (!chosen) return { text: r.text, state: "choose", choices: r.choices.map((c) => ({ ...c, icon: icons[c.id] ?? null })) };
        return one(r.text, chosen);
      }
      return one(r.text, r);
    };
    const one = (piece: string, m: { id: string; name: string; label: string; url: string }): Row => {
      const icon = icons[m.id] ?? null;
      if (have.has(m.url)) return { text: piece, state: "have", name: m.name, label: m.label, icon };
      if (seen.has(m.url)) return { text: piece, state: "dup", name: m.name, label: m.label, icon };
      seen.add(m.url);
      return { text: piece, state: "ready", id: m.id, name: m.name, label: m.label, url: m.url, icon };
    };
    return recognizeSocial(text, sources).map(view);
  }, [text, picks, sources, icons, existing]);

  const ready = rows.filter((r): r is Extract<Row, { state: "ready" }> => r.state === "ready");
  const busy = run !== null;
  const status = (r: Row) => (r.state === "ready" ? labels.ready : r.state === "have" ? labels.have : r.state === "dup" ? labels.dup : r.state === "choose" ? labels.choose : labels.unknown);

  async function addAll() {
    if (busy || ready.length === 0) return;
    const ok: string[] = [], failed: string[] = [], kept: string[] = [];
    setReport(null);
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i]!;
      setRun({ n: i + 1, total: ready.length, name: r.name });
      let res: Awaited<ReturnType<typeof addNetworkWithProfile>>;
      try { res = await addNetworkWithProfile(r.id, r.text); } catch { res = { ok: false, error: labels.failed }; }
      if (res.ok) ok.push(res.label);
      else { failed.push(`${r.name} : ${res.error}`); if (!res.added) kept.push(r.text); }
    }
    setRun(null);
    setReport({ ok, failed });
    // Ce qui a été ajouté (ou l'était déjà) quitte le champ ; ce qui a échoué ou n'est pas reconnu y reste pour être corrigé ou réessayé.
    const keep = new Set([...kept, ...rows.filter((r) => r.state === "unknown" || r.state === "choose").map((r) => r.text)]);
    setText([...keep].join("\n"));
    router.refresh();
    box.current?.focus();
  }

  return (
    <div className="space-y-3" data-testid="social-paste">
      <div>
        <label htmlFor={id} className={ui.label}>{labels.label}</label>
        <textarea ref={box} id={id} rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={labels.placeholder} autoComplete="off" spellCheck={false}
          aria-describedby={`${id}-help ${id}-ex`} className={ui.input} data-testid="social-paste-input" />
        <p id={`${id}-help`} className={ui.help}>{labels.help}</p>
        <p id={`${id}-ex`} className={ui.help} data-field-example="">{labels.example}</p>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-2" aria-label={labels.label} data-testid="social-paste-rows">
          {rows.map((r) => (
            <li key={r.text} data-state={r.state} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              {r.state === "choose" ? (
                <>
                  <span className="min-w-0 max-w-full break-all font-medium">{r.text}</span>
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="sr-only">{fill(labels.choose, {})}</span>
                    <select value={picks[r.text] ?? ""} onChange={(e) => setPicks((p) => ({ ...p, [r.text]: e.target.value }))} className={`${ui.input} min-h-11 max-w-xs`} disabled={busy}>
                      <option value="">{labels.choosePlaceholder}</option>
                      {r.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </label>
                </>
              ) : r.state === "unknown" ? (
                <>
                  <span className="min-w-0 max-w-full break-all font-medium">{r.text}</span>
                  <span className="text-amber-700"><span aria-hidden="true">⚠ </span>{labels.unknown}</span>
                </>
              ) : (
                <>
                  <IconView icon={r.icon} />
                  <span className="min-w-0 flex-1 break-words font-medium">{r.label}</span>
                  <span className={r.state === "ready" ? "text-emerald-700" : "text-muted"}><span aria-hidden="true">{r.state === "ready" ? "✓ " : ""}</span>{status(r)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {shown + ready.length > max && <p className={ui.help} role="status" data-testid="social-paste-limit">{fill(labels.limit, { max, n: shown + ready.length })}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {canInstall ? (
          <button type="button" onClick={addAll} disabled={busy || ready.length === 0} className={`${ui.btnPrimary} min-h-11`} data-testid="social-paste-add">
            {ready.length === 0 ? labels.add : ready.length === 1 ? labels.addOne : fill(labels.addMany, { n: ready.length })}
          </button>
        ) : <p className={ui.help} data-testid="social-paste-owner-only">{labels.ownerOnly}</p>}
        {text && !busy && <button type="button" onClick={() => { setText(""); setPicks({}); setReport(null); box.current?.focus(); }} className="min-h-11 px-2 text-sm text-muted underline-offset-2 hover:underline">{labels.clear}</button>}
        <p role="status" aria-live="polite" className="text-sm" data-testid="social-paste-progress">{run ? fill(labels.running, { name: run.name, n: run.n, total: run.total }) : ""}</p>
      </div>
      {report && (
        <div role="status" className="space-y-1 text-sm" data-testid="social-paste-report">
          {report.ok.length > 0 && <p className="text-emerald-700"><span aria-hidden="true">✓ </span>{report.ok.length === 1 ? fill(labels.done, { label: report.ok[0] ?? "" }) : fill(labels.doneMany, { n: report.ok.length })}</p>}
          {report.failed.map((f) => <p key={f} role="alert" className="font-medium text-red-700"><span aria-hidden="true">⚠ </span>{f}</p>)}
        </div>
      )}
    </div>
  );
}
