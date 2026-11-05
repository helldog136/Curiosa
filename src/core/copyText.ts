/**
 * Copy a text to the clipboard from a click, with a safe fallback. Used by the "Copy" button of the Markdown code blocks (components/site/CodeBlock.tsx).
 * 1. Clipboard API (secure pages, user gesture). 2. If it is missing or refuses: a hidden textarea + `document.execCommand("copy")`. 3. Otherwise `false`:
 * the caller shows a plain message and the code stays selectable. The environment is a parameter so the logic is testable without a browser.
 */
export type CopyEnv = {
  clipboard?: { writeText(text: string): Promise<void> } | null;
  document?: {
    body: { appendChild(n: unknown): unknown; removeChild(n: unknown): unknown };
    activeElement?: { focus?: () => void } | null;
    createElement(tag: string): CopyTextarea;
    execCommand(command: string): boolean;
  } | null;
};
type CopyTextarea = {
  value: string; readOnly: boolean; style: Record<string, string>;
  setAttribute(name: string, value: string): void; select(): void; setSelectionRange(a: number, b: number): void;
};

export function browserCopyEnv(): CopyEnv {
  if (typeof window === "undefined") return {};
  return { clipboard: navigator.clipboard ?? null, document: document as unknown as CopyEnv["document"] };
}

export async function copyText(text: string, env: CopyEnv = browserCopyEnv()): Promise<boolean> {
  if (env.clipboard) {
    try { await env.clipboard.writeText(text); return true; } catch { /* refused (permission, insecure page): try the fallback */ }
  }
  const doc = env.document;
  if (!doc) return false;
  const area = doc.createElement("textarea");
  const before = doc.activeElement ?? null;
  try {
    area.value = text;
    area.readOnly = true;
    area.setAttribute("aria-hidden", "true");
    area.setAttribute("tabindex", "-1");
    // Off-screen, never scrolls the page, 16px so mobile browsers do not zoom.
    Object.assign(area.style, { position: "fixed", top: "0", insetInlineStart: "-9999px", opacity: "0", fontSize: "16px", pointerEvents: "none" });
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    return doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    try { doc.body.removeChild(area); } catch { /* already gone */ }
    try { before?.focus?.(); } catch { /* nothing to restore */ }
  }
}

/** The text of a fenced code block as the visitor sees it: only the code (no button label, no line number), without the single final newline Markdown adds. */
export function codeBlockText(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
}
