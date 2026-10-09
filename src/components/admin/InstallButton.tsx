"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { installModuleAction } from "@/app/admin/(panel)/catalogue/actions";

type Labels = { install: string; installing: string; done: string; failed: string };

/** Durée minimale de l'animation : même si le téléchargement est instantané, on le voit se faire. */
const MIN_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * « Installer » = le site télécharge le module dans ses modules locaux. Le bouton le montre : une barre se remplit pendant que la flèche
 * descend, puis « Installé » s'affiche avant de passer à la page des modules.
 */
export function InstallButton({ id, labels, redirectTo = "/admin/modules" }: { id: string; labels: Labels; redirectTo?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  async function install() {
    if (phase === "working" || phase === "done") return;
    setPhase("working");
    try {
      const [result] = await Promise.all([installModuleAction(id), sleep(MIN_MS)]);
      if (!result.ok) { setPhase("error"); return; }
      setPhase("done");
      await sleep(700);
      router.push(redirectTo);
      router.refresh();
    } catch { setPhase("error"); }
  }
  const busy = phase === "working" || phase === "done";
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={install} disabled={busy} data-phase={phase} data-testid="install-button" aria-live="polite"
        className="relative inline-flex min-w-48 items-center justify-center gap-2 overflow-hidden rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg shadow-lg transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-default">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-white/30 ease-out" style={{ width: phase === "idle" || phase === "error" ? "0%" : "100%", transition: `width ${phase === "working" || phase === "done" ? MIN_MS : 0}ms ease-out` }} />
        <span className="relative flex items-center gap-2">
          {phase === "done" ? <span aria-hidden="true">✓</span> : phase === "working" ? <span aria-hidden="true" className="inline-block animate-bounce">⬇</span> : <span aria-hidden="true">⬇</span>}
          {phase === "done" ? labels.done : phase === "working" ? labels.installing : labels.install}
        </span>
      </button>
      {phase === "error" && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-sm">{labels.failed}</p>}
    </div>
  );
}
