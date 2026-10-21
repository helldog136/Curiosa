"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationProgress } from "./OperationProgress";
import { useProgressText } from "./ProgressLabels";
import { fetchOperation, nextPollDelay, POLL_GIVE_UP_MS, readHealth, restartDelay, waitForSite, type OpSnapshotLike } from "./operationClient";
import { ui } from "./ui";

type Phase = "running" | "restarting" | "timeout" | "done";

/**
 * Avancement de la mise à jour DU SITE, lu sur le serveur (fichier d'état écrit par la tâche de mise à jour : il survit au redémarrage). Pendant le redémarrage
 * les lectures échouent : la barre bascule alors vers « le site redémarre… » et attend, avec une borne, que le site réponde de nouveau (`/api/health`) avant de
 * relire l'état et de rafraîchir la page. Rien ne tourne en arrière-plan : la lecture se met en pause quand l'onglet est caché et s'arrête à la fin.
 */
export function CoreUpdateProgress({ initial, unitTemplate }: { initial: OpSnapshotLike | null; unitTemplate?: string }) {
  const router = useRouter();
  const p = useProgressText();
  const [snap, setSnap] = useState<OpSnapshotLike | null>(initial);
  const [phase, setPhase] = useState<Phase>("running");

  useEffect(() => {
    let stopped = false;
    const t0 = Date.now();
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // Onglet caché : on attend qu'il redevienne visible, sans minuteur.
    const visible = () => new Promise<void>((resolve) => {
      if (document.visibilityState !== "hidden") return resolve();
      const on = () => { if (document.visibilityState !== "hidden") { document.removeEventListener("visibilitychange", on); resolve(); } };
      document.addEventListener("visibilitychange", on);
    });
    void (async () => {
      const baseline = (await readHealth())?.versionHash ?? null;
      let attempt = 0;
      while (!stopped && Date.now() - t0 < POLL_GIVE_UP_MS) {
        await visible();
        if (stopped) return;
        const res = await fetchOperation("core-update");
        if (stopped) return;
        if (res?.operation) {
          setSnap(res.operation); setPhase("running");
          if (res.operation.state !== "running") { setPhase("done"); await sleep(1200); if (!stopped) router.refresh(); return; }
          await sleep(nextPollDelay(attempt++));
          continue;
        }
        // Le site ne répond plus (ou plus comme avant) : il redémarre. On l'attend, avec une borne, puis on relit l'état.
        setPhase("restarting");
        const wait = await waitForSite({ health: () => readHealth(), now: () => Date.now(), sleep, aborted: () => stopped }, baseline);
        if (stopped || wait.state === "aborted") return;
        if (wait.state === "timeout") { setPhase("timeout"); return; }
        attempt = 0;
        await sleep(restartDelay(0));
      }
    })();
    return () => { stopped = true; };
  }, [router]);

  if (phase === "timeout") {
    return (
      <div className="space-y-3" data-testid="core-restart-timeout">
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{p("restartTimeout")}</p>
        <button type="button" className={`${ui.btn} min-h-11`} onClick={() => window.location.reload()}>↻</button>
      </div>
    );
  }
  if (phase === "done") {
    const ok = snap?.state === "done";
    return <p role="status" className={`flex items-center gap-2 text-sm font-medium ${ok ? "text-emerald-700" : "text-red-700"}`} data-testid="core-done">{ok ? `✓ ${p("backDone")}` : p("failedAdopted")}</p>;
  }
  return (
    <div className="space-y-2" data-testid="core-progress" data-phase={phase}>
      <OperationProgress kind="core-update" core snap={snap} unreachable={phase === "restarting"} unitTemplate={unitTemplate} />
    </div>
  );
}
