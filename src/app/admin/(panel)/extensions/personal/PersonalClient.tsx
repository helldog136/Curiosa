"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FieldErrorText } from "@/components/admin/FieldErrors";
import { TextField } from "@/components/admin/Field";
import { CodeField, EditForm, RemoveForm } from "@/components/admin/PrivateAccess";
import { PendingButton } from "@/components/admin/PendingButton";
import { RowDialog } from "@/components/admin/RowDialog";
import { RowMenu } from "@/components/admin/RowMenu";
import { ui } from "@/components/admin/ui";
import type { AccessState } from "@/core/gitAccess";
import { addPersonalAction, checkPersonalAction, personalAccessAction, refreshPersonalAction, removePersonalAction, type CheckView } from "./actions";

/** The texts of this page, translated by the page itself (the same parts serve the render tests and the screenshots). */
export type PersonalLabels = Record<string, string>;
const fill = (text: string | undefined, vars: Record<string, string | number>) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text ?? "");

/**
 * "Add a catalogue": ONE short path, one main button per step, each right under the fields it works on.
 *   1. the address: "Check the repository" (how many extensions it offers, which are refused and why; nothing is registered by a check);
 *   2. only when the repository refuses the reading (private): the access code appears under the address, tried on the repository and kept sealed only if it works;
 *   3. the summary and ONE button "Add this catalogue", with the plain sentence that the code runs on this server. The name is prefilled (it is the pill of the catalogue).
 */
export function AddCatalogue({ labels, initial }: { labels: PersonalLabels; /** The state the block starts in (render tests and screenshots). */ initial?: { url?: string; view?: CheckView; needsCode?: boolean; codeError?: string; addError?: string; added?: number } }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState(initial?.view?.ok ? initial.view.name : "");
  const [view, setView] = useState<CheckView | null>(initial?.view ?? null);
  const [needsCode, setNeedsCode] = useState(!!initial?.needsCode);
  const [codeError, setCodeError] = useState<string | undefined>(initial?.codeError);
  const [addError, setAddError] = useState<string | undefined>(initial?.addError);
  const [added, setAdded] = useState<number | null>(initial?.added ?? null);
  const [busy, start] = useTransition();
  const [adding, startAdd] = useTransition();
  const codeBox = useRef<HTMLDivElement>(null);
  const access: AccessState = view?.ok ? view.access : { state: "none" };
  const showCode = needsCode && access.state !== "configured";
  const urlError = view && !view.ok && !codeError ? view.error : undefined;
  useEffect(() => { if (showCode) codeBox.current?.querySelector("input")?.focus(); }, [showCode]);
  useEffect(() => { if (urlError && !showCode) document.getElementById("catalogueUrl")?.focus(); }, [urlError, showCode]);

  const reset = () => { setView(null); setNeedsCode(false); setCodeError(undefined); setAddError(undefined); setAdded(null); };
  const check = () => start(async () => {
    setView(null); setCodeError(undefined); setAddError(undefined); setAdded(null);
    if (showCode && !code.trim()) { setCodeError(labels["access.error.empty"]); return; }
    const r = await checkPersonalAction(url.trim(), code || undefined);
    if (r.ok) { setCode(""); setNeedsCode(false); setName(r.name); setView(r); return; }
    if (r.field === "code") { setCodeError(r.error); setNeedsCode(true); return; }
    setNeedsCode(!!r.needsCode); setView(r);
  });
  const add = () => startAdd(async () => {
    setAddError(undefined);
    const r = await addPersonalAction(url.trim(), name);
    if (r.ok) { setAdded(r.offered); setView(null); setUrl(""); setName(""); router.refresh(); } else setAddError(r.error);
  });
  const summary = view?.ok ? view : null;
  const ready = summary ? summary.offers.filter((o) => o.ready).length : 0;

  return (
    <div className="space-y-4" data-testid="personal-add">
      {!summary && (<>
        <TextField name="catalogueUrl" type="url" label={labels["personal.url"] ?? ""} example={labels["personal.url.example"]} error={urlError} autoComplete="off" inputMode="url"
          inputProps={{ value: url, spellCheck: false, onChange: (e) => { setUrl(e.target.value); reset(); } }} />
        {showCode && <div ref={codeBox} data-testid="access-code-field"><CodeField labels={labels} error={codeError} value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} /></div>}
        <PendingButton type="button" variant="primary" pending={busy} pendingLabel={labels["personal.checking"]} disabled={url.trim().length < 8} onClick={check} testid="personal-check">
          {showCode ? labels["personal.check.code"] : labels["personal.check"]}
        </PendingButton>
      </>)}

      {summary && (<>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="personal-address-line">
          <span className="min-w-0 flex-1 basis-48 truncate text-sm text-muted" title={summary.address}>{summary.address}</span>
          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => { setView(null); setAddError(undefined); }} disabled={adding}>{labels["personal.change"]}</button>
        </div>
        <p className="text-sm font-medium" data-testid="personal-found">{fill(labels["personal.found"], { n: summary.offers.length, ready })}</p>
        {summary.offers.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="personal-offers">
            {summary.offers.map((o) => (
              <li key={o.id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-40 truncate"><span aria-hidden>{o.icon ?? "🧩"}</span> {o.name}{o.version && <span className="ml-2 text-xs text-muted">v{o.version}</span>}</span>
                {!o.ready && <span className={ui.chipWarn}>{fill(labels["personal.needsCore"], { core: o.needsCore ?? "" })}</span>}
              </li>
            ))}
          </ul>
        )}
        {summary.refused.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300" data-testid="personal-refused">
            {summary.refused.map((r) => <li key={r.id}>{r.text}</li>)}
          </ul>
        )}
        {summary.alreadyAdded
          ? <p className="text-sm text-muted">{labels["personal.error.exists"]}</p>
          : (<>
            <TextField name="catalogueName" label={labels["personal.name"] ?? ""} example={labels["personal.name.example"]} autoComplete="off" inputProps={{ value: name, maxLength: 40, onChange: (e) => setName(e.target.value) }} />
            <div className="flex flex-wrap items-center gap-3">
              <PendingButton type="button" variant="primary" pending={adding} pendingLabel={labels["personal.adding"]} onClick={add} testid="personal-add-button">{labels["personal.add"]}</PendingButton>
              <p className="min-w-0 flex-1 basis-60 text-sm" data-testid="personal-trust">{labels["personal.trust"]}</p>
            </div>
          </>)}
        <FieldErrorText id="err-personal-add" message={addError ?? null} />
      </>)}
      {added !== null && <p role="status" className="text-sm font-medium text-emerald-700" data-testid="personal-added">{fill(labels["personal.added"], { n: added })}</p>}
    </div>
  );
}

type Which = "access" | "remove";
const MENU = "flex min-h-11 w-full items-center justify-start gap-2 px-4 text-left text-sm transition hover:bg-bg";
const MENU_DANGER = "flex min-h-11 w-full items-center justify-start gap-2 px-4 text-left text-sm font-medium text-red-700 transition hover:bg-red-500/10";

/**
 * The actions of one catalogue, at most two visible: the main button ("Refresh", or "Edit access" when the repository refuses the reading) and a "⋯" menu with the rest
 * (edit access, remove). Each opens a window right above the row. Removing says what stays: nothing installed is uninstalled.
 */
export function CatalogueActions({ id, name, address, installed, access, needsAccess, labels, initial }: {
  id: string; name: string; address: string; /** Installed extensions that come from this catalogue. */ installed: number; access: AccessState; needsAccess: boolean; labels: PersonalLabels; initial?: { open?: Which };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Which | null>(initial?.open ?? null);
  const [refreshing, startRefresh] = useTransition();
  const [removing, startRemove] = useTransition();
  const [state, setState] = useState<AccessState>(access);
  const close = useCallback(() => setOpen(null), []);
  const canAccess = state.state !== "none";
  const choose = (w: Which) => (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.closest("details")?.removeAttribute("open"); setOpen(w); };
  const reload = useCallback(async () => { try { setState(await personalAccessAction(address)); } catch { /* the line stays as it was */ } router.refresh(); }, [address, router]);
  const refresh = () => startRefresh(async () => { await refreshPersonalAction(); router.refresh(); });
  const remove = () => startRemove(async () => { await removePersonalAction(id); setOpen(null); router.refresh(); });
  const accessFirst = needsAccess && canAccess;
  return (
    <div className="flex items-center justify-end gap-2" data-actions={id}>
      {accessFirst
        ? <button type="button" className={`${ui.btn} min-h-11 whitespace-nowrap`} aria-haspopup="dialog" aria-label={`${labels["access.edit"]} ${name}`} onClick={choose("access")} data-testid="catalogue-primary">{labels["access.edit"]}</button>
        : <PendingButton type="button" variant="btn" pending={refreshing} pendingLabel={labels["personal.refreshing"]} onClick={refresh} testid="catalogue-primary" title={`${labels["personal.refresh"]} ${name}`}>{labels["personal.refresh"]}</PendingButton>}
      <RowMenu label={fill(labels["personal.menu"], { name })}>
        {canAccess && !accessFirst && <button type="button" className={MENU} onClick={choose("access")}>{labels["access.edit"]}</button>}
        <button type="button" className={MENU_DANGER} onClick={choose("remove")}>{labels["personal.remove"]}</button>
      </RowMenu>

      {canAccess && (
        <RowDialog open={open === "access"} title={fill(labels["access.edit.title"], { repo: state.repo ?? name })} onClose={close} closeLabel={labels["modal.close"] ?? ""}>
          <div className="space-y-4" data-testid="personal-access-dialog">
            {state.state === "reenter" && <p className="text-sm text-muted">{labels["access.reenter.why"]}</p>}
            <EditForm url={address} state={state.state} labels={labels} onChanged={reload} />
            <div className="border-t border-line pt-3"><RemoveForm url={address} repo={state.repo ?? name} labels={labels} onChanged={reload} /></div>
          </div>
        </RowDialog>
      )}
      <RowDialog open={open === "remove"} title={fill(labels["personal.remove.title"], { name })} onClose={close} closeLabel={labels["modal.close"] ?? ""}>
        <div className="space-y-4">
          <p className="text-sm" data-testid="personal-remove-loss">{installed > 0 ? fill(labels["personal.remove.kept"], { n: installed }) : labels["personal.remove.nothing"]}</p>
          <PendingButton type="button" variant="dangerSolid" pending={removing} pendingLabel={labels["personal.removing"]} onClick={remove} testid="personal-remove-confirm">{labels["personal.remove"]}</PendingButton>
        </div>
      </RowDialog>
    </div>
  );
}
