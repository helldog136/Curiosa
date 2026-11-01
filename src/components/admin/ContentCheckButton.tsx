"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkContentAction, type CheckResult } from "@/app/admin/(panel)/maintenance/content/actions";
import { OperationProgress } from "./OperationProgress";
import { Spinner } from "./ActionKit";
import { useTrackedRun } from "./useTrackedRun";
import { ui } from "./ui";

type Labels = { idle: string; resume: string; working: string; unit: string; busy: string; failed: string; stopped: string };

/** Un paquet de liens dure une trentaine de secondes au plus ; 200 liens tiennent en quelques paquets. Au-delà, on s'arrête et on propose « Continuer ». */
const MAX_BATCHES = 8;

/**
 * « Vérifier maintenant » / « Continuer la vérification ». Un clic lance la vérification ; tant que la page reste ouverte, les paquets de liens s'enchaînent
 * d'eux-mêmes, avec la barre de progression du cœur (lien n sur m). Fermer la page arrête la suite (rien ne tourne en arrière-plan) : la page propose alors « Continuer ».
 */
export function ContentCheckButton({ labels, resume = false, primary = true, trackKey = "content-check" }: { labels: Labels; resume?: boolean; primary?: boolean; trackKey?: string }) {
  const router = useRouter();
  const tracker = useTrackedRun(trackKey, () => router.refresh());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  // Une vérification lancée depuis cet onglet puis rechargée en route : on la suit encore.
  const busy = working || tracker.adopted;

  async function go() {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setMessage(null);
    let again = resume;
    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const opId = tracker.begin();
        let r: CheckResult;
        try { r = await checkContentAction(opId, again); } finally { tracker.end(); }
        if (r.state === "busy") { setMessage(labels.busy); break; }
        if (r.state === "error") { setMessage(labels.failed); break; }
        if (r.state === "done") break;
        again = true;
        if (i === MAX_BATCHES - 1) setMessage(labels.stopped);
      }
    } catch {
      setMessage(labels.failed);
    } finally {
      running.current = false;
      setWorking(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={go} disabled={busy} aria-busy={busy} data-testid={resume ? "content-resume" : "content-check-now"} data-tracking={trackKey}
        className={`${primary ? ui.btnPrimary : ui.btn} min-h-11 min-w-48 disabled:cursor-progress`}>
        {busy ? <><Spinner />{labels.working}</> : <><span aria-hidden="true">{resume ? "▶" : "🩺"}</span>{resume ? labels.resume : labels.idle}</>}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{busy ? labels.working : ""}</span>
      {busy && <OperationProgress kind="content-check" snap={tracker.snap} lost={tracker.lost} unreachable={tracker.unreachable} unitTemplate={labels.unit} className="max-w-sm" />}
      {message && <p role="alert" className="max-w-md rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">{message}</p>}
    </div>
  );
}
