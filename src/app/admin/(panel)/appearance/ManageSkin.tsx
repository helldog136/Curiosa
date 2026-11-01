"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionForm, type ActionState } from "@/components/admin/ActionForm";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { BigCheckbox } from "./Controls";
import { checkUpdateAction, removeSkinAction, revertSkinAction, updateSkinAction, type UpdateView } from "./actions";

export type ManagedSkin = { id: string; name: string; version: string; source: "catalogue" | "personal"; active: boolean; previousVersion?: string; updateKnown: boolean; status: string };

/** Mises à jour (avec retour arrière), retrait : par skin installé, dans une zone repliée. Retirer ne change JAMAIS le contenu du site. */
export function ManageSkin({ skin }: { skin: ManagedSkin }) {
  const al = useAL();
  const router = useRouter();
  // Après une mise à jour, un retour en arrière ou un retrait, la zone change (ou disparaît) : le message de réussite est donc dit en haut de la page.
  const flash = (done: string, fn: (p: ActionState, f: FormData) => Promise<ActionState>) => async (p: ActionState, f: FormData): Promise<ActionState> => {
    const r = await fn(p, f);
    if (r?.ok) router.replace(`/admin/appearance?done=${done}${(r.ok.match(/\d+\.\d+\.\d+/) ?? [""])[0] ? `&v=${(r.ok.match(/\d+\.\d+\.\d+/) ?? [""])[0]}` : ""}`);
    return r;
  };
  const [result, setResult] = useState<UpdateView | null>(null);
  const [busy, start] = useTransition();
  const check = () => start(async () => setResult(await checkUpdateAction(skin.id)));
  const major = result?.ok && result.available && result.level === "major";
  return (
    <details className="rounded-xl border border-line bg-bg" data-manage={skin.id}>
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">
        {skin.name} <span className="text-muted">{skin.version}</span>
        {skin.active && <span className={`${ui.chipOk} ml-2`}>{al("appearance.current")}</span>}
        {skin.updateKnown && <span className={`${ui.chipWarn} ml-2`}>{al("appearance.updateTag")}</span>}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <section className="space-y-2" aria-label={al("appearance.update.title")}>
          <h4 className="text-sm font-semibold">{al("appearance.update.title")}</h4>
          <PendingButton type="button" variant="btn" pending={busy} pendingLabel={al("appearance.update.checking")} onClick={check}>{al("appearance.update.check")}</PendingButton>
          {result && !result.ok && <p role="alert" className="text-sm text-red-700">{result.error}</p>}
          {result?.ok && (
            <div role="status" className="space-y-2 text-sm" data-testid="update-result">
              {result.failed ? <p>{al("appearance.update.failed")}</p>
                : result.needsCore ? <p>{al("appearance.update.needsCore", { version: result.needsCore })}</p>
                : result.available ? <p>{al("appearance.update.available", { version: result.target ?? "" })}</p>
                : <p>{al("appearance.update.none")}</p>}
              {result.available && !result.needsCore && (
                <ActionForm action={flash("updated", updateSkinAction)} submitLabel={al("appearance.update.do")} pendingLabel={al("appearance.update.doing")} className="space-y-2">
                  <input type="hidden" name="id" value={skin.id} />
                  {major && (<>
                    <p role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">{al("appearance.update.major")}</p>
                    <BigCheckbox name="acceptMajor" label={al("appearance.update.acceptMajor")} required />
                  </>)}
                  <p className={ui.help}>{al("appearance.update.safe")}</p>
                </ActionForm>
              )}
            </div>
          )}
          {skin.previousVersion && (
            <ActionForm action={flash("reverted", revertSkinAction)} submitLabel={al("appearance.revert", { version: skin.previousVersion })} secondary pendingLabel={al("appearance.reverting")} className="space-y-1">
              <input type="hidden" name="id" value={skin.id} />
              <p className={ui.help}>{al("appearance.revert.help")}</p>
            </ActionForm>
          )}
        </section>
        <section className="space-y-2" aria-label={al("appearance.remove.title")}>
          <h4 className="text-sm font-semibold">{al("appearance.remove.title")}</h4>
          <p className="text-sm">{al("appearance.remove.explain")}</p>
          {skin.active && <p className="text-sm text-muted">{al("appearance.remove.active")}</p>}
          <ActionForm action={flash(skin.active ? "removedActive" : "removed", removeSkinAction)} hideSubmit={false} submitLabel={al("appearance.remove.do")} secondary pendingLabel={al("appearance.remove.doing")} className="space-y-2" confirm={al("appearance.remove.confirm", { name: skin.name })}>
            <input type="hidden" name="id" value={skin.id} />
          </ActionForm>
        </section>
      </div>
    </details>
  );
}

