"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { installModuleAction } from "@/app/admin/(panel)/extensions/add/actions";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { AnimatedActionButton } from "./AnimatedActionButton";

type Labels = { install: string; installing: string; done: string; failed: string };

/**
 * « Installer » = le site télécharge le module dans ses modules locaux. Le bouton le montre : une barre se remplit pendant que la flèche
 * descend, puis « Installé » s'affiche avant de passer à la liste des extensions.
 */
export function InstallButton({ id, name, labels, redirectTo = EXTENSIONS_HREF }: { id: string; /** Nom affiché dans l'avis « vos données ont été retrouvées ». */ name: string; labels: Labels; redirectTo?: string }) {
  const router = useRouter();
  const restored = useRef(false);
  return (
    <AnimatedActionButton look="hero" icon="⬇" testid="install-button"
      labels={{ idle: labels.install, working: labels.installing, done: labels.done, failed: labels.failed }}
      run={async () => { const r = await installModuleAction(id); if (r.ok) restored.current = r.restored > 0; return r.ok ? { ok: true } : { ok: false, error: r.error }; }}
      onDone={() => { router.push(restored.current ? `${redirectTo}?notice=restored&name=${encodeURIComponent(name.slice(0, 80))}` : redirectTo); router.refresh(); }} />
  );
}
