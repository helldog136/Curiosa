"use client";

import { useSyncExternalStore } from "react";

let captured: string | null = null;
const none = () => () => {};
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

/**
 * Reads the one-time token from the address FRAGMENT (`#t=…`) and removes it from the address bar at once. A fragment is never sent to the server, so the token is in no
 * access log, no proxy log and no Referer header; it reaches the server only in the body of the form the person submits. `null` until the page has loaded; "" when the
 * address has no token.
 */
export function useFragmentToken(): string | null {
  return useSyncExternalStore(none, read, () => null);
}
