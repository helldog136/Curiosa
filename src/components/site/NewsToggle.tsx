"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * « Me prévenir des nouveautés » : le visiteur DEMANDE lui-même la fonction. C'est ce choix, et lui seul, qui autorise le site à retenir la date de
 * sa dernière visite dans son navigateur (voir core/visit.ts) : pas de bandeau de cookies, car rien n'est déposé tant qu'il n'a pas cliqué.
 * Le désactiver efface tout.
 */
export function NewsToggle({ labels }: { labels: { on: string; off: string; title: string } }) {
  const router = useRouter();
  const [on, setOn] = useState(() => typeof document !== "undefined" && /(?:^|;\s*)curiosa_news=1/.test(document.cookie));
  const set = (value: boolean) => {
    const year = 60 * 60 * 24 * 365;
    if (value) document.cookie = `curiosa_news=1; path=/; max-age=${year}; samesite=lax`;
    else for (const name of ["curiosa_news", "curiosa_seen", "curiosa_since"]) document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
    setOn(value);
    router.refresh();
  };
  return (
    <button type="button" aria-pressed={on} title={labels.title} onClick={() => set(!on)} data-testid="news-toggle"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-accent text-accent" : "border-line text-muted hover:border-accent hover:text-fg"}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor"><path d="M12 22a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22zm7-6v-5a7 7 0 00-5-6.7V4a2 2 0 00-4 0v.3A7 7 0 005 11v5l-2 2v1h18v-1l-2-2z" /></svg>
      {on ? labels.on : labels.off}
    </button>
  );
}
