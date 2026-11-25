"use client";

import { useEffect, useSyncExternalStore } from "react";

let captured: string | null = null;
let mounted = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function read(): string | null {
  if (typeof window === "undefined") return null;
  if (captured === null) {
    const m = /(?:^#|&)t=([A-Za-z0-9_-]{1,100})/.exec(window.location.hash);
    captured = m ? m[1]! : "";
    // The token leaves the address bar at once: it stays only in memory, on this page.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return captured;
}

/** Is a token held in memory right now? (not a hook; for tests and guards) */
export const hasCapturedToken = (): boolean => !!read();

/** Forgets the captured token (it is no longer needed in memory) and tells the page. Safe to call at any time. */
export function clearFragmentToken(): void {
  captured = "";
  for (const l of [...listeners]) l();
}

/**
 * Reads the one-time token from the address FRAGMENT (`#t=…`) and removes it from the address bar at once. A fragment is never sent to the server, so the token is in no
 * access log, no proxy log and no Referer header; it reaches the server only in the body of the form the person submits. `null` until the page has loaded; "" when the
 * address has no token (or it was cleared). The token is forgotten when the page unmounts and when the caller clears it after a success.
 */
export function useFragmentToken(): string | null {
  const token = useSyncExternalStore(subscribe, read, () => null);
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
      // Deferred: React may unmount and mount again at once (development checks); only a page that is really gone forgets the token.
      setTimeout(() => { if (mounted === 0) captured = ""; }, 0);
    };
  }, []);
  return token;
}

/**
 * Wraps the form action of a one-time-token page: once the action has succeeded (no error shown, or the server redirected), the token is forgotten at once. An error keeps it,
 * so the person can correct a field and send again.
 */
export function forgetTokenAfter<S extends { error?: string; errors?: unknown } | null>(action: (prev: S, formData: FormData) => Promise<S>): (prev: S, formData: FormData) => Promise<S> {
  return async (prev, formData) => {
    let result: S;
    try {
      result = await action(prev, formData);
    } catch (error) {
      if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) clearFragmentToken();
      throw error;
    }
    if (!result || (!result.error && !result.errors)) clearFragmentToken();
    return result;
  };
}
