/**
 * THE VISITOR'S BACKGROUND SOUND PLAYER (core 0.10.0): the behaviour, with no React and no browser globals, so that tests drive it with a fake audio element.
 * The component (components/site/BackgroundSound.tsx) wires the real browser to it.
 *
 * Rules (docs/BACKGROUND-SOUND.md):
 *  - Nothing is fetched and no audio element exists before the first start (`preload` is "none"); a start comes only from the visitor: a click on the control, or
 *    the first click / tap / key press anywhere on the page when the visitor has not chosen "off". The browser's autoplay policy is respected: a refused `play()`
 *    is not retried in a loop (at most MAX_REFUSALS attempts caused by gestures, never an attempt without a gesture after a refusal).
 *  - The visitor's choice ("on" / "off") is kept in localStorage (`curiosa-sound`), written ONLY when they press the control. Storage can be missing or blocked.
 *  - The sound stops when the tab is hidden and when the page is not eligible (home only), and continues across client-side navigations (one player for the layout).
 *  - Fades are short and skipped when the visitor prefers reduced motion.
 */
export const SOUND_STORAGE_KEY = "curiosa-sound";
export const FADE_MS = 400;
export const FADE_STEP_MS = 40;
export const MAX_REFUSALS = 3;

/** What the player needs from an audio element (the browser's `HTMLAudioElement` fits). */
export type AudioLike = {
  src: string; loop: boolean; volume: number; preload: string; currentTime: number; readonly paused: boolean;
  play(): Promise<void> | void; pause(): void;
  addEventListener(type: "error", fn: () => void): void; removeEventListener(type: "error", fn: () => void): void;
};

export type PlayerEnv = {
  createAudio(): AudioLike;
  /** The saved choice, "on" or "off"; null when nothing is saved or storage is unavailable. Never throws. */
  readChoice(): "on" | "off" | null;
  writeChoice(choice: "on" | "off"): void;
  isHidden(): boolean;
  reducedMotion(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type PlayerView = {
  /** The sound is playing now: the control is "pressed". */
  playing: boolean;
  /** The visitor wants sound (not muted): it starts at the next gesture if it is not playing yet. */
  wanted: boolean;
  /** The file cannot be played (missing, unreadable, unsupported): the control is not shown. */
  failed: boolean;
};

const isAutoplayRefusal = (e: unknown) => (e as { name?: string } | null)?.name === "NotAllowedError";
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

export class SoundPlayer {
  private audio: AudioLike | null = null;
  private wanted: boolean;
  private playing = false;
  private failed = false;
  private active = true;
  private hidden: boolean;
  private starting = false;
  /** The sound was playing and was paused by the tab or the page (not by the visitor): it may continue by itself, because the browser already allowed it once. */
  private resumable = false;
  private refusals = 0;
  private fade: unknown = null;
  private listeners = new Set<() => void>();
  private view: PlayerView;
  private onError = () => { this.failed = true; this.playing = false; this.cancelFade(); this.emit(); };

  private cfg: { src: string; volume: number; startMuted: boolean };
  private env: PlayerEnv;

  constructor(cfg: { src: string; volume: number; startMuted: boolean }, env: PlayerEnv) {
    this.cfg = cfg;
    this.env = env;
    const saved = env.readChoice();
    this.wanted = saved === "on" ? true : saved === "off" ? false : !cfg.startMuted;
    this.hidden = env.isHidden();
    this.view = { playing: false, wanted: this.wanted, failed: false };
  }

  /** For `useSyncExternalStore`. */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getView = (): PlayerView => this.view;

  private emit() {
    if (this.view.playing === this.playing && this.view.wanted === this.wanted && this.view.failed === this.failed) return;
    this.view = { playing: this.playing, wanted: this.wanted, failed: this.failed };
    for (const fn of [...this.listeners]) fn();
  }

  private get gain() { return Math.min(1, Math.max(0, this.cfg.volume / 100)); }
  private cancelFade() { if (this.fade !== null) { this.env.clearTimer(this.fade); this.fade = null; } }

  /** Moves the volume to `target` in a few steps (at once under reduced motion), then calls `done`. */
  private fadeTo(target: number, done?: () => void) {
    this.cancelFade();
    const audio = this.audio;
    if (!audio) { done?.(); return; }
    if (this.env.reducedMotion() || FADE_MS <= 0) { audio.volume = target; done?.(); return; }
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
    const from = audio.volume;
    let i = 0;
    const tick = () => {
      i++;
      audio.volume = i >= steps ? target : from + ((target - from) * i) / steps;
      if (i >= steps) { this.fade = null; done?.(); } else this.fade = this.env.setTimer(tick, FADE_STEP_MS);
    };
    this.fade = this.env.setTimer(tick, FADE_STEP_MS);
  }

  private ensureAudio(): AudioLike {
    if (this.audio) return this.audio;
    const audio = this.env.createAudio();
    audio.preload = "none"; // set before the address: nothing is downloaded until play()
    audio.loop = true;
    audio.src = this.cfg.src;
    audio.volume = 0;
    audio.addEventListener("error", this.onError);
    this.audio = audio;
    return audio;
  }

  /** One attempt to play. `gesture`: caused by a click, tap or key press of the visitor. Returns when the attempt is over. */
  private async tryPlay(gesture: boolean): Promise<void> {
    if (!this.wanted || !this.active || this.hidden || this.failed || this.starting || this.playing) return;
    if (!gesture && (this.refusals > 0 || !this.resumable)) return; // never a start without the visitor: only a sound that already played may continue by itself
    this.starting = true;
    const audio = this.ensureAudio();
    this.cancelFade();
    try {
      if (this.env.reducedMotion()) audio.volume = this.gain; else if (audio.paused) audio.volume = 0;
      await audio.play();
      this.refusals = 0;
      this.resumable = false;
      // The visitor may have muted, or the page may have been hidden, while the browser was starting the sound.
      if (!this.wanted || !this.active || this.hidden) { audio.pause(); this.playing = false; }
      else { this.playing = true; this.fadeTo(this.gain); }
    } catch (e) {
      this.playing = false;
      if (isAbort(e)) { /* paused again before it started: nothing to say */ }
      else if (isAutoplayRefusal(e)) { if (gesture) this.refusals++; else this.refusals = Math.max(this.refusals, 1); }
      else { this.failed = true; }
    } finally {
      this.starting = false;
      this.emit();
    }
  }

  /** The first click, tap or key press of the visitor anywhere on the page (not on the control itself). */
  gesture(): void {
    if (this.refusals >= MAX_REFUSALS) return;
    void this.tryPlay(true);
  }

  /** The visitor pressed the control: mute when playing, play otherwise. The choice is remembered. */
  toggle(): void {
    if (this.playing) {
      this.wanted = false;
      this.resumable = false;
      this.playing = false;
      this.env.writeChoice("off");
      this.emit();
      const audio = this.audio;
      this.fadeTo(0, () => { if (!this.wanted) audio?.pause(); });
      return;
    }
    this.wanted = true;
    this.refusals = 0;
    this.env.writeChoice("on");
    this.emit();
    void this.tryPlay(true);
  }

  /** The tab was hidden or shown (`document.visibilityState`). Hidden: pause at once, without a fade. Shown: continue, once, if the visitor wants sound. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) { this.pauseNow(); return; }
    void this.tryPlay(false);
  }

  /** The current page is (or is not) one where the sound plays ("home only"). Leaving a page pauses; coming back continues. */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) { this.pauseNow(); return; }
    void this.tryPlay(false);
  }

  private pauseNow() {
    this.resumable = this.resumable || this.playing;
    this.cancelFade();
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.playing = false;
    this.emit();
  }

  /** The player is removed (the layout goes away): stop everything and release the element. */
  destroy(): void {
    this.cancelFade();
    if (this.audio) { this.audio.removeEventListener("error", this.onError); this.audio.pause(); this.audio.src = ""; this.audio = null; }
    this.playing = false;
    this.starting = false;
  }
}
