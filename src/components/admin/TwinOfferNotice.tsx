"use client";

import { useState } from "react";
import { ActionForm, type ActionState } from "@/components/admin/ActionForm";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";

/**
 * (core 0.47.0) After the site skin changed to one that has an installed overlay twin: ONE button, "Use the matching overlay skin", and a quiet "Not now". Nothing happens until
 * the button is pressed. Its answer stays in the card for a few seconds, then the card goes (the offer is spent). Rendered by the administration layout only while an offer
 * is pending (overlays/twinOffer.ts); the two actions are server actions bound by the layout (overlay-pages/twinActions.ts).
 */
export function TwinOfferNotice({ text, button, dismiss, apply, notNow }: { text: string; button: string; dismiss: string; apply: (prev: ActionState, fd: FormData) => Promise<ActionState>; notNow: () => Promise<void> }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const run = async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const r = await apply(prev, fd);
    if (r?.ok) setTimeout(() => setGone(true), 4000);
    return r;
  };
  return (
    <div className={`${ui.card} mb-6 space-y-3`} data-testid="twin-offer">
      <p className="text-[15px]">{text}</p>
      <div className="flex flex-wrap items-start gap-3">
        <ActionForm action={run} submitLabel={button} pendingLabel={button} className="space-y-2">{null}</ActionForm>
        <form action={async () => { setGone(true); await notNow(); }}><PendingButton variant="btn">{dismiss}</PendingButton></form>
      </div>
    </div>
  );
}
