"use client";
import { APPEARANCE_HREF } from "@/core/adminLinks";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ActionForm, type ActionState } from "@/components/admin/ActionForm";
import { EditForm, RemoveForm, ACCESS_LABEL_KEYS } from "@/components/admin/PrivateAccess";
import type { AccessState } from "@/core/gitAccess";
import { RowMenu } from "@/components/admin/RowMenu";
import { RowDialog as SharedRowDialog } from "@/components/admin/RowDialog";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { BigCheckbox } from "./Controls";
import { checkUpdateAction, removeSkinAction, revertSkinAction, updateSkinAction, type UpdateView } from "./actions";

export type ManagedSkin = { id: string; name: string; version: string; source: "catalogue" | "personal"; active: boolean; previousVersion?: string; status: string; /** (0.42.0) Private repository: its address and what is saved for it (never the code). */ repo?: string; access?: AccessState; /** Pictures the owner uploaded for this skin (kept when it is removed unless asked). */ pictures?: number; /** (0.46.1) Added from a file: the date and the fingerprint of that file (never its content, which is not kept). */ upload?: { date: string; print: string } };

export type Which = "update" | "access" | "revert" | "remove";

/** The window is shared with the other row tables (src/components/admin/RowDialog.tsx); here the close label comes from the Appearance texts. */
function RowDialog(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const al = useAL();
  return <SharedRowDialog {...props} closeLabel={al("modal.close")} />;
}

const MENU = "flex min-h-11 w-full items-center justify-start gap-2 px-4 text-left text-sm transition hover:bg-bg";
const MENU_DANGER = "flex min-h-11 w-full items-center justify-start gap-2 px-4 text-left text-sm font-medium text-red-700 transition hover:bg-red-500/10";

/**
 * The actions of one added skin, at most two visible: ONE main button (look for an update; "Edit access" when the access code has to be entered again) and a "⋯" menu with the
 * rest (edit access, go back to the previous version, remove). Each opens a window right above the row; the row keeps its height. Removing never changes the site's content.
 */
export function SkinActions({ skin, initial }: { skin: ManagedSkin; /** The state the block starts in (render tests and screenshots): which window is open and what the update check found. */ initial?: { open?: Which; update?: UpdateView } }) {
  const al = useAL();
  const router = useRouter();
  const [open, setOpen] = useState<Which | null>(initial?.open ?? null);
  const close = useCallback(() => setOpen(null), []);
  // After an update, a step back or a removal the row changes (or goes): the message of success is said at the top of the page.
  const flash = (done: string, fn: (p: ActionState, f: FormData) => Promise<ActionState>) => async (p: ActionState, f: FormData): Promise<ActionState> => {
    const r = await fn(p, f);
    if (r?.ok) { setOpen(null); const v = (r.ok.match(/\d+\.\d+\.\d+/) ?? [""])[0]; router.replace(`${APPEARANCE_HREF}?done=${done}${v ? `&v=${v}` : ""}`); }
    return r;
  };
  const labels = Object.fromEntries(ACCESS_LABEL_KEYS.map((k) => [k, al(k)]));
  const hasAccess = !!skin.repo && !!skin.access && skin.access.state !== "none";
  const reenter = hasAccess && skin.access?.state === "reenter";
  const canCheck = !skin.upload;
  const choose = (w: Which) => (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.closest("details")?.removeAttribute("open"); setOpen(w); };   // a menu entry closes the menu
  const primary = reenter ? "access" : canCheck ? "update" : null;
  const primaryLabel = primary === "access" ? al("appearance.manage.access") : al("appearance.update.check");
  return (
    <div className="flex items-center justify-end gap-2" data-actions={skin.id}>
      {primary && <button type="button" className={`${ui.btn} min-h-11 whitespace-nowrap`} aria-haspopup="dialog" aria-label={`${primaryLabel} ${skin.name}`} onClick={choose(primary)} data-testid="skin-primary">{primaryLabel}</button>}
      <RowMenu label={al("appearance.manage.menu", { name: skin.name })}>
        {reenter && canCheck && <button type="button" className={MENU} onClick={choose("update")}>{al("appearance.update.check")}</button>}
        {hasAccess && !reenter && <button type="button" className={MENU} onClick={choose("access")}>{al("appearance.manage.access")}</button>}
        {skin.previousVersion && <button type="button" className={MENU} onClick={choose("revert")}>{al("appearance.revert", { version: skin.previousVersion })}</button>}
        <button type="button" className={MENU_DANGER} onClick={choose("remove")}>{al("appearance.remove.do")}</button>
      </RowMenu>

      <RowDialog open={open === "update"} title={al("appearance.update.dialog", { name: skin.name })} onClose={close}>
        <UpdateBody skin={skin} flash={flash} initial={initial?.update} />
      </RowDialog>
      {hasAccess && skin.repo && skin.access && (
        <RowDialog open={open === "access"} title={al("access.edit.title", { repo: skin.access.repo ?? skin.repo })} onClose={close}>
          {skin.access.state === "reenter" && <p className="text-sm text-muted">{al("access.reenter.why")}</p>}
          <EditForm url={skin.repo} state={skin.access.state} labels={labels} onChanged={() => { setOpen(null); router.refresh(); }} />
          <div className="border-t border-line pt-3"><RemoveForm url={skin.repo} repo={skin.access.repo ?? skin.repo} labels={labels} onChanged={() => { setOpen(null); router.refresh(); }} /></div>
        </RowDialog>
      )}
      {skin.previousVersion && (
        <RowDialog open={open === "revert"} title={al("appearance.revert", { version: skin.previousVersion })} onClose={close}>
          <ActionForm action={flash("reverted", revertSkinAction)} submitLabel={al("appearance.revert.do")} pendingLabel={al("appearance.reverting")} className="space-y-4">
            <input type="hidden" name="id" value={skin.id} />
          </ActionForm>
        </RowDialog>
      )}
      <RowDialog open={open === "remove"} title={al("appearance.remove.title")} onClose={close}>
        <ActionForm action={flash(skin.active ? "removedActive" : "removed", removeSkinAction)} submitLabel={al("appearance.remove.do")} danger pendingLabel={al("appearance.remove.doing")} className="space-y-4">
          <input type="hidden" name="id" value={skin.id} />
          <p className="text-sm">{al("appearance.remove.confirm", { name: skin.name })}</p>
          {skin.active && <p className="text-sm text-muted">{al("appearance.remove.active")}</p>}
          {(skin.pictures ?? 0) > 0 && <BigCheckbox name="erase" label={al("appearance.cz.removePictures", { count: skin.pictures ?? 0 })} />}
        </ActionForm>
      </RowDialog>
    </div>
  );
}

/** What the window of an update says: it looks by itself when it opens, then the result and, when there is a new version, the one button that installs it. */
function UpdateBody({ skin, flash, initial }: { skin: ManagedSkin; initial?: UpdateView; flash: (done: string, fn: (p: ActionState, f: FormData) => Promise<ActionState>) => (p: ActionState, f: FormData) => Promise<ActionState> }) {
  const al = useAL();
  const [result, setResult] = useState<UpdateView | null>(initial ?? null);
  useEffect(() => { if (initial) return; let live = true; void checkUpdateAction(skin.id).then((r) => { if (live) setResult(r); }, () => { if (live) setResult({ ok: false, error: al("appearance.update.failed") }); }); return () => { live = false; }; }, [skin.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- looks once per opening
  if (!result) return <p role="status" className="text-sm text-muted">{al("appearance.update.checking")}</p>;
  if (!result.ok) return <p role="alert" className="text-sm text-red-700">{result.error}</p>;
  const major = result.available && result.level === "major";
  return (
    <div role="status" className="space-y-4 text-sm" data-testid="update-result">
      {result.access ? <p>{al("appearance.update.access")}</p>
        : result.failed ? <p>{al("appearance.update.failed")}</p>
        : result.needsCore ? <p>{al("appearance.update.needsCore", { version: result.needsCore })}</p>
        : result.available ? <p>{al("appearance.update.available", { version: result.target ?? "" })}</p>
        : <p>{al("appearance.update.none")}</p>}
      {result.available && !result.needsCore && (
        <ActionForm action={flash("updated", updateSkinAction)} submitLabel={al("appearance.update.do")} pendingLabel={al("appearance.update.doing")} className="space-y-3">
          <input type="hidden" name="id" value={skin.id} />
          {major && (<>
            <p role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">{al("appearance.update.major")}</p>
            <BigCheckbox name="acceptMajor" label={al("appearance.update.acceptMajor")} required />
          </>)}
        </ActionForm>
      )}
    </div>
  );
}
