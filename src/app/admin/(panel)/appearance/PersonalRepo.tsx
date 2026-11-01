"use client";

import { useState, useTransition } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { BigCheckbox } from "./Controls";
import { InspectPanel } from "./InspectPanel";
import { inspectSkinAction, installPersonalAction, type InspectView } from "./actions";

/**
 * « Ajouter depuis une adresse » (avancé, replié) : on colle l'adresse d'un dépôt, « Vérifier » lit le dépôt SANS rien installer (README, licences, aperçus,
 * lisibilité), puis une case « Je comprends » est obligatoire : ce skin ne vient pas de la liste vérifiée. Il ne peut changer que l'apparence.
 */
export function PersonalRepo({ locale }: { locale: "fr" | "en" }) {
  const al = useAL();
  const [url, setUrl] = useState("");
  const [checked, setChecked] = useState<InspectView | null>(null);
  const [busy, start] = useTransition();
  const check = (u: string) => start(async () => { setChecked(null); setChecked(await inspectSkinAction(u)); });
  const ready = checked && checked.ok && checked.mode === "summary" && checked.installable;
  return (
    <details className="rounded-2xl border border-line bg-surface" data-testid="personal-repo">
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-[15px] font-medium">{al("appearance.personal.summary")}</summary>
      <div className="space-y-4 px-5 pb-5">
        <p className={ui.help}>{al("appearance.personal.help")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <label className={ui.label} htmlFor="repoUrl">{al("appearance.personal.url")}</label>
            <input id="repoUrl" name="repoUrl" type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setChecked(null); }} placeholder="https://github.com/nom/depot" autoComplete="off" spellCheck={false} aria-describedby="repoUrlHelp" className={`${ui.input} min-h-11`} />
            <p id="repoUrlHelp" className={ui.help}>{al("appearance.personal.urlHelp")}</p>
          </div>
          <PendingButton type="button" variant="btn" pending={busy} pendingLabel={al("appearance.reading")} disabled={url.trim().length < 8} onClick={() => check(url.trim())}>{al("appearance.personal.check")}</PendingButton>
        </div>
        {checked && !checked.ok && <p role="alert" data-testid="personal-error" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{checked.error}</p>}
        {checked && checked.ok && checked.mode === "candidates" && (
          <div className="space-y-2" data-testid="personal-candidates">
            <p className="text-sm font-medium">{al("appearance.personal.several")}</p>
            <ul className="space-y-2">
              {checked.candidates?.map((c) => (
                <li key={c.subdir}><button type="button" className={`${ui.btn} min-h-11`} onClick={() => { const next = `${url.split("#")[0]}#:${c.subdir}`; setUrl(next); check(next); }}>{c.name} <span className="text-muted">({c.id})</span></button></li>
              ))}
            </ul>
          </div>
        )}
        {checked && checked.ok && checked.mode === "summary" && <InspectPanel data={checked} locale={locale} />}
        {ready && (
          <ActionForm action={installPersonalAction} submitLabel={al("appearance.personal.add")} pendingLabel={al("appearance.installing")} className="space-y-4">
            <input type="hidden" name="url" value={checked.url} />
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="note">{al("appearance.personal.warning")}</div>
            <BigCheckbox name="understood" label={al("appearance.personal.understood")} />
            <BigCheckbox name="activate" value="1" label={al("appearance.personal.activate")} />
          </ActionForm>
        )}
      </div>
    </details>
  );
}
