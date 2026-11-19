"use client";

import { useEffect, useId, useState } from "react";

type Hint = { line: string | null; level?: string; icon?: string; state?: string; warning?: string | null; href?: string | null; details?: string };

/** The upload field that shows the line (only one per page). */
let claimedBy: string | null = null;

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
  const [mine, setMine] = useState(false);
  const id = useId();
  // R33.7: the same sentence under every upload field of a page says the same thing once too often: the first field to get the answer keeps it.
  useEffect(() => {
    let alive = true;
    load().then((h) => {
      if (!alive) return;
      setHint(h);
      if (h?.line && claimedBy === null) { claimedBy = id; setMine(true); }
    });
    return () => { alive = false; if (claimedBy === id) claimedBy = null; };
  }, [id]);
  if (!hint?.line || !mine) return null;
  const low = hint.level === "low" || hint.level === "critical";
  return (
    <p data-testid="storage-line" className="mt-1 text-xs text-muted" role={low ? "status" : undefined}>
      {low && <span aria-hidden="true">{hint.icon} </span>}
      {low ? <span className="font-medium text-fg">{hint.warning}</span> : <span>{hint.line}</span>}
      {hint.href && <> · <a href={hint.href} className="underline hover:text-accent">{hint.details}</a></>}
    </p>
  );
}
