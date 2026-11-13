"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nextRefreshDelay, REFRESH_TOTAL_MS } from "@/core/adminkit/refresh";
import { ui } from "./ui";

export type RefreshLabels = { waiting: string; stopped: string; again: string };

/** What the page remembers across the remounts a refresh can cause, so that the 3 minutes are never restarted by the refresh itself. */
const memory: { key: string; since: number; seen: number } = { key: "", since: 0, seen: 0 };

/**
 * Block `refreshWhile` (core 0.14.0): the panel refreshes itself, softly, while the module says something is pending. A polite status line says so; when the 3 minutes are
 * over it stops by itself and offers "Check again". Paused while the tab is hidden. The dot only pulses when motion is allowed.
 */
export function RefreshWhile({ everySeconds, labels }: { everySeconds?: number; labels: RefreshLabels }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const key = `${window.location.pathname}${window.location.search}`;
    const now = Date.now();
    if (run > 0 || memory.key !== key || now - memory.seen > 15_000) { memory.key = key; memory.since = now; }
    let alive = true;
    const step = () => {
      if (!alive) return;
      const t = Date.now();
      memory.seen = t;
      const wait = nextRefreshDelay(t - memory.since, everySeconds);
      if (wait === null) { setStopped(true); return; }
      timer.current = setTimeout(() => {
        if (!alive) return;
        if (!document.hidden) router.refresh();
        step();
      }, wait);
    };
    step();
    const visible = () => { if (!document.hidden && alive && Date.now() - memory.since < REFRESH_TOTAL_MS) router.refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", visible); };
  }, [everySeconds, router, run]);
  return (
    <div role="status" aria-live="polite" data-testid="refresh-while" data-stopped={stopped ? "true" : "false"} className="flex flex-wrap items-center gap-2 text-sm text-muted">
      {stopped ? (
        <>
          <span>{labels.stopped}</span>
          <button type="button" onClick={() => { router.refresh(); setStopped(false); setRun((n) => n + 1); }} className={`${ui.btn} min-h-11`}>{labels.again}</button>
        </>
      ) : (
        <><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse" /><span>{labels.waiting}</span></>
      )}
    </div>
  );
}
