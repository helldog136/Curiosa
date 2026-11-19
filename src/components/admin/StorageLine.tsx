"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

type Hint = { line: string | null; level?: string; icon?: string; state?: string; warning?: string | null; href?: string | null; details?: string };

/**
 * Only ONE upload field per page shows the line (R33.7: the same sentence under 6 fields says the same thing 6 times). The first VISIBLE one, in page order, keeps it;
 * a field in a hidden tab does not (it takes over when its tab opens: the election runs again after each click or key press).
 */
const registry = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let owner: string | null = null;
function elect() {
  const visible = [...registry].filter(([, el]) => el.isConnected && el.getClientRects().length > 0).sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const next = visible[0]?.[0] ?? null;
  if (next !== owner) { owner = next; listeners.forEach((l) => l()); }
}
if (typeof window !== "undefined") for (const ev of ["click", "keyup"]) window.addEventListener(ev, () => setTimeout(elect, 0), true);
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** One request per page, shared by every upload field on it. */
let shared: Promise<Hint | null> | null = null;
function load(): Promise<Hint | null> {
  shared ??= fetch("/api/admin/storage", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Hint>) : null)).catch(() => null);
  return shared;
}

/**
 * A quiet line next to an upload button: "3.2 GB free of 20 GB · See details". When the space is low it also says so BEFORE the file is sent (state in words and icon, not colour alone).
 * It shows nothing when the answer is not there (the upload itself never depends on it).
 */
export function StorageLine() {
  const [hint, setHint] = useState<Hint | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const current = useSyncExternalStore(subscribe, () => owner, () => null);
  useEffect(() => { let alive = true; load().then((h) => alive && setHint(h)); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!box.current) return;
    registry.set(id, box.current);
    elect();
    return () => { registry.delete(id); elect(); };
  }, [id]);
  const low = hint?.level === "low" || hint?.level === "critical";
  return (
    <div ref={box}>
      {hint?.line && current === id && (
        <p data-testid="storage-line" className="mt-1 text-xs text-muted" role={low ? "status" : undefined}>
          {low && <span aria-hidden="true">{hint.icon} </span>}
          {low ? <span className="font-medium text-fg">{hint.warning}</span> : <span>{hint.line}</span>}
          {hint.href && <> · <a href={hint.href} className="underline hover:text-accent">{hint.details}</a></>}
        </p>
      )}
    </div>
  );
}
