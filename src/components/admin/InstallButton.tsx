"use client";

import { useRouter } from "next/navigation";
import { installModuleAction } from "@/app/admin/(panel)/catalogue/actions";
import { AnimatedActionButton } from "./AnimatedActionButton";

type Labels = { install: string; installing: string; done: string; failed: string };

/**
 * « Installer » = le site télécharge le module dans ses modules locaux. Le bouton le montre : une barre se remplit pendant que la flèche
 * descend, puis « Installé » s'affiche avant de passer à la page des modules.
 */
export function InstallButton({ id, labels, redirectTo = "/admin/modules" }: { id: string; labels: Labels; redirectTo?: string }) {
  const router = useRouter();
  return (
    <AnimatedActionButton look="hero" icon="⬇" testid="install-button"
      labels={{ idle: labels.install, working: labels.installing, done: labels.done, failed: labels.failed }}
      run={async () => ({ ok: (await installModuleAction(id)).ok })}
      onDone={() => { router.push(redirectTo); router.refresh(); }} />
  );
}
