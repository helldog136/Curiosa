"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FieldErrorText } from "@/components/admin/FieldErrors";
import { TextField } from "@/components/admin/Field";
import { AccessSummary, CodeField, ACCESS_LABEL_KEYS } from "@/components/admin/PrivateAccess";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import type { AccessState } from "@/core/gitAccess";
import { accessViewAction } from "@/components/admin/accessActions";
import { useAL } from "./AppearanceLabels";
import { InspectPanel } from "./InspectPanel";
import { SkinAdded } from "./SkinAdded";
import { chooseSkinAction, inspectSkinAction, installPersonalAction, type InspectView } from "./actions";

type Summary = Extract<InspectView, { ok: true }>;

/**
 * "Add from an address": ONE short path, one main button per step, each button right under the fields it works on.
 *   1. the address, "Check the address";
 *   2. only if the repository refuses the reading (private): the access code appears under the address, the error under the right field, the same button now says
 *      "Check with this code". The code is tried on the repository and kept sealed only if it works (src/core/gitAccessAdmin.ts);
 *   3. the summary of what will be added (look, licenses, what it can and cannot do; the long reading is folded under "Details"): "Add this skin". The click on that
 *      button is the confirmation, with the sentence about who is responsible next to it, exactly like adding from a file; the server still refuses an install that does
 *      not carry the confirmation;
 *   4. "Use this skin" or "Keep as is".
 * Once an access code is saved, ONE summary line with ONE "Edit" button replaces the field; "Remove access" is inside that window.
 */
export function PersonalRepo({ locale, initial }: { locale: "fr" | "en"; /** The state the block starts in (render tests and screenshots): the address, whether the code field is shown, what is saved, the errors, the summary, the added skin. */ initial?: { url?: string; needsCode?: boolean; access?: AccessState; codeError?: string; urlError?: string; view?: Summary; installError?: string; added?: { id: string; name: string } } }) {
  const al = useAL();
  const router = useRouter();
  const [url, setUrl] = useState(initial?.url ?? initial?.view?.url ?? "");
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState<InspectView | null>(initial?.view ?? (initial?.urlError ? { ok: false, error: initial.urlError, needsCode: initial.needsCode } : null));
  const [access, setAccess] = useState<AccessState>(initial?.access ?? initial?.view?.access ?? { state: "none" });
  const [needsCode, setNeedsCode] = useState(!!initial?.needsCode);
  const [codeError, setCodeError] = useState<string | undefined>(initial?.codeError);
  const [installError, setInstallError] = useState<string | undefined>(initial?.installError);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(initial?.added ?? null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [adding, startAdd] = useTransition();
  const [using, startUse] = useTransition();
  const codeBox = useRef<HTMLDivElement>(null);
  const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, al(k)]));

  const refreshAccess = useCallback(async (u: string) => { try { setAccess(await accessViewAction(u)); } catch { /* the summary simply stays as it was */ } }, []);
  const reset = () => { setChecked(null); setNeedsCode(false); setCodeError(undefined); setInstallError(undefined); };
  const check = (u: string, c = "") => start(async () => {
    setChecked(null); setCodeError(undefined); setInstallError(undefined);
    if (needsCode && access.state !== "configured" && !c.trim()) { setCodeError(al("access.error.empty")); return; }
    const r = await inspectSkinAction(u, c || undefined);
    if (r.access) setAccess(r.access);
    if (r.ok) { setCode(""); setNeedsCode(false); setChecked(r); return; }
    if (r.field === "code") { setCodeError(r.error); setNeedsCode(true); return; }
    setNeedsCode(!!r.needsCode); setChecked(r);
  });
  const summary = checked && checked.ok && checked.mode === "summary" ? checked : null;
  const showCode = needsCode && access.state !== "configured";
  const urlError = checked && !checked.ok && !codeError ? checked.error : undefined;
  // The first field in error gets the focus: the code field when it is needed, else the address.
  useEffect(() => { if (showCode) codeBox.current?.querySelector("input")?.focus(); }, [showCode]);
  useEffect(() => { if (urlError && !showCode) document.getElementById("repoUrl")?.focus(); }, [urlError, showCode]);
  const base = url.split("#")[0]!.trim();

  const add = () => summary && startAdd(async () => {
    setInstallError(undefined);
    const fd = new FormData();
    fd.set("url", summary.url);
    fd.set("understood", "on");   // the click on "Add this skin", with the sentence about who is responsible beside it, is the confirmation (same as the file path)
    const r = await installPersonalAction(null, fd);
    if (r?.ok) { setAdded({ id: summary.skinId ?? "", name: summary.name?.[locale] ?? "" }); setChecked(null); router.refresh(); }
    else setInstallError(r?.errors?.url ?? r?.errors?.understood ?? r?.error ?? al("skins.error.failed"));
  });
  const use = () => added && startUse(async () => {
    const fd = new FormData();
    fd.set("id", added.id);
    const r = await chooseSkinAction(null, fd);
    if (r?.ok) { setDone(r.ok); setAdded(null); router.refresh(); } else setInstallError(r?.error ?? al("skins.error.failed"));
  });
  const clear = () => { setUrl(""); setCode(""); reset(); setAdded(null); setAccess({ state: "none" }); };

  return (
    <div className="space-y-4" data-testid="personal-repo">
      {!summary && !added && (<>
        <p className="text-sm text-muted">{al("appearance.personal.help")}</p>
        <TextField name="repoUrl" type="url" label={al("appearance.personal.url")} example={al("appearance.personal.urlHelp")} error={urlError} autoComplete="off" inputMode="url"
          inputProps={{ value: url, spellCheck: false, onChange: (e) => { setUrl(e.target.value); reset(); setAccess({ state: "none" }); }, onBlur: () => { if (url.trim().length > 8) void refreshAccess(url.trim()); } }} />
        {showCode && <div ref={codeBox} data-testid="access-code-field"><CodeField labels={labels} error={codeError} value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} /></div>}
        {access.state !== "none" && <AccessSummary compact url={base} access={access} labels={labels} onChanged={() => void refreshAccess(base)} />}
        {checked && checked.ok && checked.mode === "candidates" ? (
          <div className="space-y-2" data-testid="personal-candidates">
            <p className="text-sm font-medium">{al("appearance.personal.several")}</p>
            <ul className="space-y-2">
              {checked.candidates?.map((c) => (
                <li key={c.subdir}><button type="button" className={`${ui.btn} min-h-11`} onClick={() => { const next = `${url.split("#")[0]}#:${c.subdir}`; setUrl(next); check(next); }}>{c.name} <span className="text-muted">({c.id})</span></button></li>
              ))}
            </ul>
          </div>
        ) : (
          <PendingButton type="button" variant="primary" pending={busy} pendingLabel={al("appearance.reading")} disabled={url.trim().length < 8} onClick={() => check(url.trim(), code)} testid="address-check">
            {showCode ? al("appearance.address.checkCode") : al("appearance.address.check")}
          </PendingButton>
        )}
      </>)}

      {summary && (<>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="address-line">
          <span className="min-w-0 flex-1 basis-48 truncate text-sm text-muted" title={summary.url}>{summary.url}</span>
          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => { setChecked(null); setInstallError(undefined); }} disabled={adding}>{al("appearance.address.change")}</button>
        </div>
        <InspectPanel data={summary} locale={locale} />
        {summary.installable && (
          <div className="flex flex-wrap items-center gap-3">
            <PendingButton type="button" variant="primary" pending={adding} pendingLabel={al("appearance.installing")} onClick={add} testid="address-add">{al("appearance.personal.add")}</PendingButton>
            <p className="min-w-0 flex-1 basis-60 text-sm" data-testid="address-trust">{al("appearance.file.trust")}</p>
          </div>
        )}
        <FieldErrorText id="err-install" message={installError ?? null} />
      </>)}

      {added && <SkinAdded name={added.name} using={using} onUse={use} onKeep={clear} />}
      {added && installError && <FieldErrorText id="err-install" message={installError} />}
      {done && <p role="status" className="text-sm font-medium text-emerald-700">{done}</p>}
    </div>
  );
}
