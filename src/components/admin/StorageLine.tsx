"use client";

import { useEffect, useState } from "react";

type Hint = { line: string | null; level?: string; icon?: string; state?: string; warning?: string | null; href?: string | null; details?: string };

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
  useEffect(() => { let alive = true; load().then((h) => alive && setHint(h)); return () => { alive = false; }; }, []);
  if (!hint?.line) return null;
  const low = hint.level === "low" || hint.level === "critical";
  return (
    <p data-testid="storage-line" className="mt-1 text-xs text-muted" role={low ? "status" : undefined}>
      {low && <span aria-hidden="true">{hint.icon} </span>}
      {low ? <span className="font-medium text-fg">{hint.warning}</span> : <span>{hint.line}</span>}
      {low && <span> · {hint.line}</span>}
      {hint.href && <> · <a href={hint.href} className="underline hover:text-accent">{hint.details}</a></>}
    </p>
  );
}
