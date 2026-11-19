"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { FieldErrorText } from "@/components/admin/FieldErrors";
import { AccessSummary, CodeField, ACCESS_LABEL_KEYS } from "@/components/admin/PrivateAccess";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import type { AccessState } from "@/core/gitAccess";
import { accessViewAction } from "../access/actions";
import { useAL } from "./AppearanceLabels";
import { BigCheckbox } from "./Controls";
import { InspectPanel } from "./InspectPanel";
import { inspectSkinAction, installPersonalAction, type InspectView } from "./actions";

/**
 * « Ajouter depuis une adresse » (avancé, replié) : on colle l'adresse d'un dépôt, « Vérifier » lit le dépôt SANS rien installer (README, licences, aperçus,
 * lisibilité), puis une case « Je comprends » est obligatoire : ce skin ne vient pas de la liste vérifiée. Il ne peut changer que l'apparence.
 *
 * Dépôt privé (0.42.0) : un seul champ au départ. Si le dépôt refuse l'accès, le champ « Code d'accès (lecture seule) » apparaît (R7), l'erreur sous le champ.
 * Le code est essayé sur le dépôt et gardé chiffré seulement s'il marche ; ensuite une ligne de résumé et un bouton « Modifier » remplacent le champ (R33).
 */
export function PersonalRepo({ locale, initial }: { locale: "fr" | "en"; /** The state the block starts in (render tests and screenshots): the address, whether the code field is shown, what is saved, the errors. */ initial?: { url?: string; needsCode?: boolean; access?: AccessState; codeError?: string; urlError?: string; open?: boolean } }) {
  const al = useAL();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState<InspectView | null>(initial?.urlError ? { ok: false, error: initial.urlError, needsCode: initial.needsCode } : null);
  const [access, setAccess] = useState<AccessState>(initial?.access ?? { state: "none" });
  const [needsCode, setNeedsCode] = useState(!!initial?.needsCode);
  const [codeError, setCodeError] = useState<string | undefined>(initial?.codeError);
  const [busy, start] = useTransition();
  const codeBox = useRef<HTMLDivElement>(null);
  const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, al(k)]));

  const refreshAccess = useCallback(async (u: string) => { try { setAccess(await accessViewAction(u)); } catch { /* the summary simply stays as it was */ } }, []);
  const reset = () => { setChecked(null); setNeedsCode(false); setCodeError(undefined); };
  const check = (u: string, c = "") => start(async () => {
    setChecked(null); setCodeError(undefined);
    if (needsCode && access.state !== "configured" && !c.trim()) { setCodeError(al("access.error.empty")); return; }
    const r = await inspectSkinAction(u, c || undefined);
    if (r.access) setAccess(r.access);
    if (r.ok) { setCode(""); setNeedsCode(false); setChecked(r); return; }
    if (r.field === "code") { setCodeError(r.error); setNeedsCode(true); return; }
    setNeedsCode(!!r.needsCode); setChecked(r);
  });
  useEffect(() => { if (needsCode && access.state !== "configured") codeBox.current?.querySelector("input")?.focus(); }, [needsCode, access.state]);
  const ready = checked && checked.ok && checked.mode === "summary" && checked.installable;
  const showCode = needsCode && access.state !== "configured";
  const urlError = checked && !checked.ok && !codeError ? checked.error : undefined;
  const base = url.split("#")[0]!.trim();
  return (
    <details className="rounded-2xl border border-line bg-surface" data-testid="personal-repo" open={initial?.open || undefined}>
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-[15px] font-medium">{al("appearance.personal.summary")}</summary>
      <div className="space-y-4 px-5 pb-5">
        <p className={ui.help}>{al("appearance.personal.help")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <label className={ui.label} htmlFor="repoUrl">{al("appearance.personal.url")}</label>
            <input id="repoUrl" name="repoUrl" type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); reset(); setAccess({ state: "none" }); }} onBlur={() => { if (url.trim().length > 8) void refreshAccess(url.trim()); }}
              placeholder="https://github.com/nom/depot" autoComplete="off" spellCheck={false} aria-describedby="repoUrlHelp repoUrlError" aria-invalid={urlError ? true : undefined} className={`${ui.input} min-h-11${urlError ? " border-red-500" : ""}`} />
            <p id="repoUrlHelp" className={ui.help}>{al("appearance.personal.urlHelp")}</p>
            <FieldErrorText id="repoUrlError" message={urlError ?? null} />
          </div>
          <PendingButton type="button" variant="btn" pending={busy} pendingLabel={al("appearance.reading")} disabled={url.trim().length < 8} onClick={() => check(url.trim(), code)}>{al("appearance.personal.check")}</PendingButton>
        </div>
        {showCode && <div ref={codeBox} data-testid="access-code-field"><CodeField labels={labels} error={codeError} value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} /></div>}
        {access.state !== "none" && <AccessSummary url={base} access={access} labels={labels} onChanged={() => void refreshAccess(base)} />}
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
