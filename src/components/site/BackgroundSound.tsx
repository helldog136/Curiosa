"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SOUND_STORAGE_KEY, SoundPlayer, type PlayerEnv, type PlayerView } from "@/core/soundPlayer";
import { soundVisibleOn, type SoundCorner, type SoundPages } from "@/core/soundConfig";

/** The texts of the control, translated by the layout. */
export type SoundLabels = { label: string; playTitle: string; muteTitle: string; statusOn: string; statusOff: string };

const OFF_VIEW: PlayerView = { playing: false, wanted: true, failed: false };

/** What the control looks like (and nothing else): used by the player below and rendered as is by the tests. */
export function SoundToggleView({ view, corner, labels, status, onToggle, buttonRef }: {
  view: PlayerView; corner: SoundCorner; labels: SoundLabels; status: string; onToggle: () => void; buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const on = view.playing;
  // Fixed in a corner, above the content and under the cookie tray; the safe-area inset keeps it clear of a phone's home bar. Its size never depends on the state.
  const place = corner === "bottom-left" ? "left-4" : "right-4";
  return (
    <div data-testid="sound-control" data-corner={corner} className={`fixed bottom-4 z-40 ${place} print:hidden`} style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <button ref={buttonRef} type="button" data-skin-part="sound-toggle" data-state={on ? "on" : "off"} aria-pressed={on} title={on ? labels.muteTitle : labels.playTitle} onClick={onToggle}
        className="inline-flex min-h-target min-w-target items-center justify-center gap-2 rounded-button border-token border-line bg-surface px-4 text-sm font-medium text-fg shadow-pop transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-fg motion-reduce:transition-none">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
          {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6m0-6-5 6" />}
        </svg>
        <span>{labels.label}</span>
      </button>
      {/* Announces the change after a press; empty on load so the page does not start talking. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="sound-status">{status}</p>
    </div>
  );
}

function browserEnv(): PlayerEnv {
  const store = () => { try { return window.localStorage; } catch { return null; } };
  return {
    createAudio: () => new Audio(),
    readChoice: () => { try { const v = store()?.getItem(SOUND_STORAGE_KEY); return v === "on" || v === "off" ? v : null; } catch { return null; } },
    writeChoice: (choice) => { try { store()?.setItem(SOUND_STORAGE_KEY, choice); } catch { /* private window or blocked storage: the choice lasts for this visit only */ } },
    isHidden: () => document.visibilityState === "hidden",
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
  };
}

/** True inside an iframe (a preview, someone else's page): the sound never plays there. */
const embedded = () => { try { return window.self !== window.top; } catch { return true; } };

/**
 * The background sound control of the public site. Mounted ONCE, in the layout of the public pages (src/app/(site)/layout.tsx): a client-side navigation keeps the
 * same player and the sound goes on. Admin pages and overlay pages have other layouts and never include it. See docs/BACKGROUND-SOUND.md.
 */
export function BackgroundSound({ src, volume, startMuted, corner, pages, locales, labels }: {
  src: string; volume: number; startMuted: boolean; corner: SoundCorner; pages: SoundPages; locales: string[]; labels: SoundLabels;
}) {
  const pathname = usePathname();
  const here = soundVisibleOn(pathname, pages, locales);
  // The player is made in the browser only (storage is read here, nothing is created, fetched or played on the server). The layout gives this component a `key` built from
  // the settings, so a changed setting makes a new player instead of keeping the old one.
  const [player] = useState<SoundPlayer | null>(() => (typeof window === "undefined" || embedded() ? null : new SoundPlayer({ src, volume, startMuted }, browserEnv())));
  const [status, setStatus] = useState("");
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!player) return;
    const p = player;
    const gesture = (e: Event) => {
      if (button.current && e.target instanceof Node && button.current.contains(e.target)) return; // the control decides for itself
      if (e instanceof KeyboardEvent && (e.key === "Escape" || e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta")) return;
      p.gesture();
    };
    const visibility = () => p.setHidden(document.visibilityState === "hidden");
    const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    for (const t of events) document.addEventListener(t, gesture, { capture: true, passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", visibility);
    return () => {
      for (const t of events) document.removeEventListener(t, gesture, { capture: true });
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", visibility);
      p.destroy();
    };
  }, [player]);

  useEffect(() => { player?.setActive(here); }, [player, here]);

  const view = useSyncExternalStore(player ? player.subscribe : noSubscribe, player ? player.getView : () => OFF_VIEW, () => OFF_VIEW);
  if (!here || view.failed) return null;
  return (
    <SoundToggleView view={view} corner={corner} labels={labels} status={status} buttonRef={button}
      onToggle={() => { if (!player) return; const was = view.playing; player.toggle(); setStatus(was ? labels.statusOff : labels.statusOn); }} />
  );
}

const noSubscribe = () => () => {};
