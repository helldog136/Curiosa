"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPoller, fetchOperation, isOpId, newOpId, type OpSnapshotLike, type Poller } from "./operationClient";

const storageKey = (key: string) => `curiosa.op.${key}`;
const remember = (key: string | undefined, id: string | null) => {
  if (!key) return;
  try { if (id) sessionStorage.setItem(storageKey(key), id); else sessionStorage.removeItem(storageKey(key)); } catch { /* stockage indisponible : pas de reprise après rechargement, rien de plus */ }
};
const recall = (key: string | undefined): string | null => {
  if (!key) return null;
  try { const v = sessionStorage.getItem(storageKey(key)); return isOpId(v) ? v : null; } catch { return null; }
};

export type TrackedRun = {
  /** Dernier état lu (null avant la première lecture). */
  snap: OpSnapshotLike | null;
  /** Plusieurs lectures ratées de suite : le site redémarre peut-être. */
  unreachable: boolean;
  /** Le serveur ne connaît plus l'opération (redémarrage du site, oubli) : on ne peut plus la suivre, elle continue peut-être. */
  lost: boolean;
  /** Reprise après rechargement de la page : une opération lancée par CE navigateur tourne encore. */
  adopted: boolean;
  /** Nouvel identifiant d'opération, et début du suivi. À passer à l'action serveur. */
  begin: () => string;
  /** Fin de l'action : on cesse de lire. */
  end: () => void;
};

/**
 * Suit une opération lancée depuis ce bouton : `begin()` donne l'identifiant à passer à l'action, puis l'avancement est lu (jamais de lecture avant ni après).
 * `trackKey` : si la page est rechargée pendant l'opération, le suivi reprend (identifiant gardé dans cet onglet seulement) ; `onAdoptedEnd` dit comment elle a fini.
 */
export function useTrackedRun(trackKey?: string, onAdoptedEnd?: (op: OpSnapshotLike | null) => void): TrackedRun {
  const [snap, setSnap] = useState<OpSnapshotLike | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [lost, setLost] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const poller = useRef<Poller | null>(null);
  const adoptedRef = useRef(false);
  const endCb = useRef(onAdoptedEnd);
  useEffect(() => { endCb.current = onAdoptedEnd; });

  useEffect(() => {
    const finishAdopted = (op: OpSnapshotLike | null) => {
      if (!adoptedRef.current) return;
      adoptedRef.current = false; setAdopted(false); remember(trackKey, null);
      endCb.current?.(op);
    };
    const p = createPoller({
      fetchOp: (id) => fetchOperation(id),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isHidden: () => document.visibilityState === "hidden",
      onSnapshot: (op) => { setSnap(op); setUnreachable(false); if (op.state !== "running") finishAdopted(op); },
      onUnknown: () => { setLost(true); finishAdopted(null); },
      onUnreachable: () => setUnreachable(true),
      onGiveUp: () => { setLost(true); finishAdopted(null); },
    });
    poller.current = p;
    const onVisible = () => p.visibilityChanged();
    document.addEventListener("visibilitychange", onVisible);
    // Reprise : une seule lecture à l'ouverture de la page, et seulement si CET onglet avait lancé une opération sur ce bouton.
    const old = recall(trackKey);
    let cancelled = false;
    if (old) {
      void fetchOperation(old).then((res) => {
        if (cancelled) return;
        if (res?.operation && res.operation.state === "running") { adoptedRef.current = true; setAdopted(true); setSnap(res.operation); p.start(old); }
        else remember(trackKey, null);
      });
    }
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); p.stop(); };
  }, [trackKey]);

  const begin = useCallback(() => {
    const id = newOpId();
    setSnap(null); setUnreachable(false); setLost(false);
    remember(trackKey, id);
    poller.current?.start(id);
    return id;
  }, [trackKey]);
  const end = useCallback(() => { poller.current?.stop(); remember(trackKey, null); }, [trackKey]);
  return { snap, unreachable, lost, adopted, begin, end };
}
