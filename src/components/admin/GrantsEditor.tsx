"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { askConfirm } from "./confirmDialog";
import { ui } from "./ui";
import { changesOf, countOn, editable, initialDraft, matchingProfileOf, presetDraft, setSection, type Draft, type GrantProfileId, type GrantSection, type GrantTool } from "./grantsModel";

export type GrantsLabels = {
  profileTitle: string; profileHelp: string; profiles: Record<GrantProfileId, { name: string; lines: string[] }>; profileCurrent: string;
  profileApplied: string; profileBlocked: string;
  selectAll: string; clearAll: string; selectAllIn: string; clearAllIn: string; count: string; countIn: string; sectionBlocked: string; needsWrite: string;
  riskyTitle: string; riskyIntro: string; riskyConfirm: string; riskyCancel: string;
  barChanges: string; barChangesOne: string; review: string; cancelChanges: string;
  summaryTitle: string; summaryIntro: string; summaryOn: string; summaryOff: string; summaryRisky: string; summarySave: string; summaryBack: string; saving: string;
  savedTitle: string; savedReconnect: string; close: string; rejected: string; failed: string; unsavedNone: string;
};

type SaveResult = { ok: boolean; applied: string[]; rejected: { name: string; reason: "unknown" | "ceiling" }[] };

/**
 * THE RIGHTS PAGE OF AN AI ACCESS. Everything you change here is a DRAFT until you review the summary and save: profile buttons preset the boxes, each section has
 * "Select all / Clear all" with a visible counter, and selecting the whole "Risky actions" section asks for a confirmation that lists what it allows.
 * The summary compares with what is saved now; "Save" sends only the differences (same rules as one single change, nothing fails silently).
 */
export function GrantsEditor({ sections, labels, save, riskyApproval }: {
  sections: GrantSection[]; labels: GrantsLabels; save: (changes: Record<string, boolean>) => Promise<SaveResult>;
  /** The risky-section confirmation sentence that matches how this access is set (approve each request, or act without asking). */
  riskyApproval: string;
}) {
  const [saved, setSaved] = useState<Draft>(() => initialDraft(sections));
  const [draft, setDraft] = useState<Draft>(saved);
  const [done, setDone] = useState(false);
  // The server renders the page again after a save. When what comes back is exactly what we saved, keep the draft and the "saved" notice; when it differs
  // (a reset button, another tab), start again from the server's state.
  const incoming = initialDraft(sections);
  const incomingSig = JSON.stringify(incoming);
  const [seen, setSeen] = useState(incomingSig);
  if (incomingSig !== seen) {
    setSeen(incomingSig);
    if (JSON.stringify(saved) !== incomingSig) { setSaved(incoming); setDraft(incoming); setDone(false); }
  }
  const [live, setLive] = useState("");
  const [profileNote, setProfileNote] = useState("");
  const [problem, setProblem] = useState("");
  const [pending, start] = useTransition();
  const summary = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const risky = useRef<HTMLDialogElement>(null);
  const [riskySection, setRiskySection] = useState<GrantSection | null>(null);
  const id = useId();

  const changes = useMemo(() => changesOf(sections, draft, saved), [sections, draft, saved]);
  const n = Object.keys(changes).length;
  const current = matchingProfileOf(sections, draft);
  const byName = useMemo(() => new Map(sections.flatMap((s) => s.tools.map((t) => [t.name, { tool: t, section: s }] as const))), [sections]);
  const fill = (text: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);

  function applyProfile(p: GrantProfileId) {
    const { draft: next, blocked } = presetDraft(p, sections, draft);
    setDraft(next); setDone(false); setProblem("");
    setProfileNote(blocked ? fill(labels.profileBlocked, { n: blocked }) : "");
    setLive(fill(labels.profileApplied, { profile: labels.profiles[p].name, n: sections.flatMap((s) => s.tools).filter((t) => next[t.name]).length }));
  }
  function selectAll(s: GrantSection) {
    if (s.risky) { setRiskySection(s); risky.current?.showModal(); return; }
    const next = setSection(s, draft, true); setDraft(next); setDone(false);
    setLive(fill(labels.countIn, { n: countOn(s, next), total: s.tools.length, section: s.title }));
  }
  function clearAll(s: GrantSection) {
    const next = setSection(s, draft, false); setDraft(next); setDone(false);
    setLive(fill(labels.countIn, { n: countOn(s, next), total: s.tools.length, section: s.title }));
  }
  function confirmRisky() {
    if (riskySection) { const next = setSection(riskySection, draft, true); setDraft(next); setDone(false); setLive(fill(labels.countIn, { n: countOn(riskySection, next), total: riskySection.tools.length, section: riskySection.title })); }
    risky.current?.close();
  }
  function openSummary() { summary.current?.showModal(); heading.current?.focus(); }
  function cancelAll() { setDraft(saved); setProfileNote(""); setProblem(""); }
  function doSave() {
    const sent = changes;
    start(async () => {
      let res: SaveResult;
      try { res = await save(sent); } catch { res = { ok: false, applied: [], rejected: [] }; setProblem(labels.failed); }
      const nextSaved = { ...saved };
      for (const name of res.applied) nextSaved[name] = !!sent[name];
      setSaved(nextSaved);
      // Whatever was refused goes back to what is saved, and is named: nothing fails silently.
      const back = { ...draft };
      for (const name of Object.keys(sent)) back[name] = nextSaved[name] ?? false;
      setDraft(back);
      if (res.rejected.length) setProblem(fill(labels.rejected, { n: res.rejected.length, list: res.rejected.map((r) => byName.get(r.name)?.tool.label ?? r.name).join(", ") }));
      else if (!res.applied.length) setProblem(labels.failed);
      else setProblem("");
      setDone(res.applied.length > 0);
      summary.current?.close();
    });
  }

  const groups = sections.reduce<string[]>((acc, s) => (acc.includes(s.group) ? acc : [...acc, s.group]), []);
  const summaryRows = (on: boolean) => Object.entries(changes).filter(([, v]) => v === on).map(([name]) => byName.get(name)).filter((x): x is NonNullable<typeof x> => !!x);
  const btn = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";
  const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-fg shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";
  const dialogClass = "m-auto max-h-[90vh] w-[min(94vw,36rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60";

  return (
    <div className="space-y-6" data-testid="grants-editor">
      <p role="status" aria-live="polite" className="sr-only" data-testid="grants-live">{live}</p>

      {done && n === 0 && (
        <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm leading-6" data-testid="grants-saved">
          <p className="font-semibold">✓ {labels.savedTitle}</p>
          <p>{labels.savedReconnect}</p>
          <button type="button" className={`${btn} mt-2`} onClick={() => setDone(false)}>{labels.close}</button>
        </div>
      )}
      {problem && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm" data-testid="grants-problem">⚠ {problem}</p>}

      <section className={`${ui.card} space-y-3`} aria-labelledby={`${id}-p`} data-testid="grants-profiles">
        <div>
          <h2 id={`${id}-p`} className="text-lg font-semibold">{labels.profileTitle}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{labels.profileHelp}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-labelledby={`${id}-p`}>
          {(["read", "assistant", "full"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={current === p} onClick={() => applyProfile(p)} data-profile={p}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${current === p ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/60"}`}>
              <span className="font-semibold">{current === p && <span aria-hidden="true">✓ </span>}{labels.profiles[p].name}{current === p && <span className="sr-only"> ({labels.profileCurrent})</span>}</span>
              <span className="text-muted">{labels.profiles[p].lines[0]}</span>
            </button>
          ))}
        </div>
        {profileNote && <p className="text-sm" data-testid="grants-profile-blocked">{profileNote}</p>}
      </section>

      {groups.map((g) => (
        <div key={g} className="space-y-6">
          <h2 className="text-xl font-semibold">{g}</h2>
          {sections.filter((s) => s.group === g).map((s) => {
            const total = s.tools.length;
            const on = countOn(s, draft);
            const blockedHere = s.tools.filter((t) => t.blocked).length;
            const canEdit = s.tools.some(editable);
            // R14: a label that is the same on every row says nothing; the kind only shows when the rows differ.
            const mixed = new Set(s.tools.map((x) => x.kind)).size > 1;
            return (
              <section key={s.id} className={`${ui.card} space-y-3`} aria-labelledby={`${id}-${s.id}`} data-testid={`grants-section-${s.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={`${id}-${s.id}`} className="text-lg font-semibold">{s.title}</h3>
                    {s.help && <p className="mt-1 text-sm leading-6 text-muted">{s.help}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium tabular-nums" aria-live="polite" aria-atomic="true" data-testid={`grants-count-${s.id}`}>{fill(labels.count, { n: on, total })}</span>
                    <button type="button" className={btn} disabled={!canEdit} onClick={() => selectAll(s)} aria-label={fill(labels.selectAllIn, { section: s.title })} data-action="select-all">{labels.selectAll}</button>
                    <button type="button" className={btn} disabled={!canEdit} onClick={() => clearAll(s)} aria-label={fill(labels.clearAllIn, { section: s.title })} data-action="clear-all">{labels.clearAll}</button>
                  </div>
                </div>
                {s.header}
                {blockedHere > 0 && <p className="text-sm text-muted" data-testid={`grants-blocked-${s.id}`}>{fill(labels.sectionBlocked, { n: blockedHere })}</p>}
                <ul className="divide-y divide-line">
                  {s.tools.map((t) => (
                    <li key={t.name}>
                      <label className={`flex min-h-11 items-start gap-3 py-2.5 ${editable(t) ? "cursor-pointer" : "opacity-70"}`}>
                        <input type="checkbox" role="switch" checked={!!draft[t.name]} disabled={!editable(t)} data-tool={t.name}
                          onChange={async (e) => {
                            const next = e.target.checked;
                            if (next && t.confirm && !(await askConfirm(t.confirm))) return;
                            setDraft((d) => ({ ...d, [t.name]: next })); setDone(false);
                          }}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--v-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block">
                            {t.code && <span className="break-all font-mono">{t.code} </span>}
                            {mixed && <span className={`rounded px-1.5 py-0.5 text-xs ${t.kind === "destructive" ? "bg-red-500/20 text-red-700" : t.kind === "read" ? "bg-surface" : "bg-amber-500/20"}`}>{t.kindLabel}</span>}
                            {t.blocked && <span className="sr-only"> ({labels.needsWrite})</span>}
                          </span>
                          {t.help && <span className="mt-0.5 block text-muted">{t.help}</span>}
                          {!t.code && <span className="sr-only">{t.label}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ))}

      {n > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/50 bg-surface p-3 shadow-2xl" role="region" aria-label={fill(n === 1 ? labels.barChangesOne : labels.barChanges, { n })} data-testid="grants-bar">
          <p className="text-sm font-medium" aria-live="polite">{fill(n === 1 ? labels.barChangesOne : labels.barChanges, { n })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={cancelAll} data-action="cancel-changes">{labels.cancelChanges}</button>
            <button type="button" className={primary} onClick={() => openSummary()} data-action="review">{labels.review}</button>
          </div>
        </div>
      )}

      <dialog ref={summary} aria-labelledby={`${id}-sum`} className={dialogClass} onClick={(e) => { if (e.target === summary.current) summary.current?.close(); }} data-testid="grants-summary">
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 id={`${id}-sum`} ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{labels.summaryTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{labels.summaryIntro}</p>
          </div>
          {([true, false] as const).map((flag) => {
            const rows = summaryRows(flag);
            if (!rows.length) return null;
            return (
              <div key={String(flag)}>
                <h3 className="text-sm font-semibold">{fill(flag ? labels.summaryOn : labels.summaryOff, { n: rows.length })}</h3>
                <ul className="mt-1 space-y-1 text-sm" data-testid={flag ? "summary-on" : "summary-off"}>
                  {rows.map(({ tool, section }) => (
                    <li key={tool.name} className="flex gap-2"><span aria-hidden="true">{flag ? "＋" : "－"}</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{tool.code ?? short(tool.help ?? tool.label)}{" "}<span className="text-muted">· {section.title}</span>{flag && tool.kind === "destructive" && <span className="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-700">{labels.summaryRisky}</span>}</span></li>
                  ))}
                </ul>
              </div>
            );
          })}
          {Object.entries(changes).some(([name, v]) => v && byName.get(name)?.section.risky) && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm leading-6">{riskyApproval}</p>}
          <div className="sticky bottom-0 -mx-5 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 py-3 sm:-mx-6 sm:px-6">
            <button type="button" className={btn} onClick={() => summary.current?.close()} disabled={pending}>{labels.summaryBack}</button>
            <button type="button" className={primary} onClick={doSave} disabled={pending} aria-busy={pending || undefined} data-action="save">{pending ? labels.saving : labels.summarySave}</button>
          </div>
        </div>
      </dialog>

      <dialog ref={risky} aria-labelledby={`${id}-risky`} className={dialogClass} data-testid="grants-risky">
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 id={`${id}-risky`} className="text-lg font-semibold">{labels.riskyTitle}</h2>
            <p className="mt-1 text-sm leading-6">{labels.riskyIntro}</p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6" data-testid="risky-list">
            {(riskySection?.tools ?? []).filter(editable).map((t) => <li key={t.name}>{t.help ?? t.label}</li>)}
          </ul>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm leading-6">{riskyApproval}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btn} onClick={() => risky.current?.close()} autoFocus>{labels.riskyCancel}</button>
            <button type="button" className={primary} onClick={confirmRisky} data-action="risky-confirm">{labels.riskyConfirm}</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
const short = (text: string) => text.split(/\.\s/)[0]!.replace(/\.$/, "");
export type { GrantTool };
