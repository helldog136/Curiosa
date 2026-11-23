"use client";

import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";

/**
 * The last step of "Add a skin", the same whether the skin came from a file or from an address: it is added, and ONE main button puts it in place ("Use this skin") with a
 * quiet "Keep as is" next to it. The skin stays chosen only when the person says so.
 */
export function SkinAdded({ name, using, onUse, onKeep }: { name: string; using: boolean; onUse: () => void; onKeep: () => void }) {
  const al = useAL();
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="skin-added">
      <p role="status" className="mr-auto text-sm font-medium text-emerald-700">{al("appearance.file.added", { name })}</p>
      <PendingButton type="button" variant="primary" pending={using} pendingLabel={al("appearance.file.using")} onClick={onUse} testid="skin-use">{al("appearance.file.use")}</PendingButton>
      <button type="button" className={`${ui.btn} min-h-11`} onClick={onKeep} disabled={using}>{al("appearance.file.keep")}</button>
    </div>
  );
}
