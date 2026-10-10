"use client";

import { useRouter } from "next/navigation";
import { applyUpdate } from "@/app/admin/(panel)/updates/actions";
import { AFTER_UPDATE_MS, sleep } from "./animatedAction";
import { AnimatedActionButton } from "./AnimatedActionButton";

type Labels = { idle: string; working: string; done: string; failed: string };

/**
 * « Installer la nouvelle version » : après la confirmation, la barre défile et la flèche rebondit tant que la mise à jour travaille, puis « Installée ».
 * `running` (état lu sur le serveur) garde le bouton animé et inactif quand une mise à jour est déjà en cours, même après un rechargement de la page.
 */
export function UpdateButton({ running, confirm, labels }: { running: boolean; confirm: string; labels: Labels }) {
  const router = useRouter();
  return (
    <AnimatedActionButton look="hero" icon="⬆" progress="continuous" testid="update-button" confirm={confirm} running={running} labels={labels}
      run={async () => { const r = await applyUpdate(); return r?.error ? { ok: false, error: r.error } : { ok: true }; }}
      onDone={async () => { await sleep(AFTER_UPDATE_MS); router.refresh(); }} />
  );
}
