"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { codeBlockText, copyText } from "@/core/copyText";

/** Texts of the copy button, already translated by the layout (site and admin). Without a provider no button is added: the code stays readable and selectable. */
export type CodeCopyLabels = { copy: string; aria: string; copied: string; failed: string };
const LabelsCtx = createContext<CodeCopyLabels | null>(null);
export function CodeCopyProvider({ labels, children }: { labels: CodeCopyLabels; children: React.ReactNode }) {
  return <LabelsCtx.Provider value={labels}>{children}</LabelsCtx.Provider>;
}

export type CopyState = "idle" | "copied" | "failed";
/** How long the "Copied" feedback stays (ms). */
export const COPIED_MS = 2000;

/** The button and its live region, without any behaviour (rendered as is by the tests). */
export function CopyButtonView({ state, labels, onCopy }: { state: CopyState; labels: CodeCopyLabels; onCopy: () => void }) {
  return (
    <>
      <button type="button" data-skin-part="copy-code" data-state={state} onClick={onCopy} aria-label={labels.aria}
        className="absolute end-2 top-2 inline-flex min-h-11 min-w-[5.5rem] items-center justify-center rounded-chip border-token border-line bg-surface px-3 text-sm text-fg transition-colors hover:border-accent hover:text-accent">
        {state === "copied" ? labels.copied : labels.copy}
      </button>
      {/* One persistent live region: "Copied" is announced politely, the failure message is also shown as plain text under the block. */}
      <div role="status" aria-live="polite" data-testid="code-copy-status" className={state === "failed" ? "mt-1 text-sm text-fg" : "sr-only"}>
        {state === "copied" ? labels.copied : state === "failed" ? labels.failed : ""}
      </div>
    </>
  );
}

const subscribe = () => () => {};
/** A fenced code block: the `<pre>` as before, plus (with JavaScript only) a "Copy" button that copies exactly the code. */
export function CodeBlock({ children, className }: { children: React.ReactNode; className: string }) {
  const labels = useContext(LabelsCtx);
  // false on the server and during hydration, true afterwards: the button appears only when JavaScript runs.
  const live = useSyncExternalStore(subscribe, () => true, () => false);
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function onCopy() {
    const code = pre.current?.querySelector("code") ?? pre.current;
    const ok = await copyText(codeBlockText(code?.textContent));
    if (timer.current) clearTimeout(timer.current);
    setState(ok ? "copied" : "failed");
    if (ok) timer.current = setTimeout(() => setState("idle"), COPIED_MS);
  }

  return (
    <div className="relative mt-4">
      <pre ref={pre} data-skin-part="code-block" className={labels ? `${className} min-h-[3.75rem] pe-14` : className}>{children}</pre>
      {labels && live && <CopyButtonView state={state} labels={labels} onCopy={onCopy} />}
    </div>
  );
}
