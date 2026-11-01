"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "./ActionKit";
import { ui } from "./ui";

/** « Réessayer » : relit la page (la fiche) sans la fermer ; le bouton dit qu'il travaille, et un second clic pendant ce temps est ignoré. */
export function RetryButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" data-testid="fiche-retry" disabled={pending} aria-busy={pending} onClick={() => start(() => router.refresh())}
      className={`${ui.btn} min-h-11 disabled:cursor-progress`}>
      {pending ? <><Spinner /><span role="status">{pendingLabel}</span></> : label}
    </button>
  );
}
