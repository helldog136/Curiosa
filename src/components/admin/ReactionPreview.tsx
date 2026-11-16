"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isVideoSrc, resolveComposition, type Composition } from "@/core/compose/model";
import { sampleValues } from "@/core/compose/tokens";
import type { ComposeOption } from "@/core/compose/option";
import { COMPOSE_CSS, composeEngine } from "@/core/compose/render";
import { HelpTip } from "./HelpTip";
import type { ComposeLabels } from "./ComposeEditor";

/** One file the preview can show: a picture, a GIF or a video of the list, with its placed text when it has one. */
export type PreviewItem = { id: number; src: string; name: string; compose?: Composition };
type Bg = "checker" | "dark" | "light";
type Engine = { mount: (host: HTMLElement, c: unknown, o: unknown) => HTMLElement; unmount: (root: HTMLElement) => void };

const tx = (labels: ComposeLabels, key: string, vars: Record<string, string | number> = {}): string => {
  let out = labels[key] ?? key;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};
/** What shows through a transparent backdrop: the same three grounds as the editor, on the frame of the alert only. */
const GROUNDS = [
  '[data-rpv-bg="checker"] .cmp{background-color:#fff;background-image:linear-gradient(45deg,#d6d6d6 25%,transparent 25%),linear-gradient(-45deg,#d6d6d6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d6d6d6 75%),linear-gradient(-45deg,transparent 75%,#d6d6d6 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}',
  '[data-rpv-bg="dark"] .cmp{background-color:#16181d}',
  '[data-rpv-bg="light"] .cmp{background-color:#f4f4f2}',
].join("\n");
const small = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const on = "!border-accent !bg-accent !text-accent-fg";
const engineOf = (): Engine | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { CuriosaCompose?: Engine };
  if (!w.CuriosaCompose) composeEngine(window);
  return w.CuriosaCompose ?? null;
};

/**
 * THE INLINE PREVIEW OF A REACTION (core 0.27.0), under the files of a gallery that places text: the alert as the overlay draws it, by the SAME engine
 * (compose/render.ts): the file, its placed texts with the sample values, their entrance and exit, the readability look. Without a placed text, the file alone
 * (as the overlay shows it) with the sentence written under the frame.
 *
 * Light on purpose: the still picture first (a video loads only its first picture), the video plays on "Play" only, one video decodes at a time (the engine
 * stops the previous one), nothing plays while the composition editor is open (`paused`). Muted unless the person turns the sound on. Several files: a row of
 * small buttons picks the one shown (the overlay picks at random or in turn; here any of them can be seen).
 */
export function ReactionPreview({ items, option, labels, phrase, paused }: { items: PreviewItem[]; option: ComposeOption; labels: ComposeLabels; phrase: string; paused: boolean }) {
  const L = (k: string, v?: Record<string, string | number>) => tx(labels, k, v);
  const uid = useId();
  const [pick, setPick] = useState<number | null>(null);
  const [bg, setBg] = useState<Bg>("checker");
  const [listen, setListen] = useState(false);
  const [playOf, setPlayOf] = useState<unknown>(null);
  const [played, setPlayed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const item = items.find((i) => i.id === pick) ?? items[0] ?? null;
  const video = !!item && isVideoSrc(item.src);
  const values = useMemo(() => sampleValues(option.variables, "normal"), [option.variables]);

  // What the engine draws: the placed text filled with the samples, or the file alone (a frame with no text box).
  const src = item?.src ?? "", placed = item?.compose ?? null;
  const drawn = useMemo(() => {
    if (!src) return null;
    if (placed) return resolveComposition(placed, { phrase, values });
    return { v: 1, format: "media", backdrop: { src, fit: "contain", focus: [50, 50], play: "once" }, boxes: [] };
  }, [src, placed, phrase, values]);
  const seconds = item?.compose?.duration?.seconds ?? 6;

  // It plays only what was asked: a change of file, sentence or placement, or the editor opening, shows the still picture again (nothing plays by itself).
  const playing = !paused && !!drawn && playOf === drawn;
  const setPlaying = (v: boolean) => setPlayOf(v ? drawn : null);

  useEffect(() => {
    const h = host.current, engine = engineOf();
    if (!h || !engine || !drawn || paused) return;
    const root = engine.mount(h, drawn, playing ? { seconds, muted: !listen } : { still: true, motion: false, light: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (playing) {
      const end = (s: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => setPlayOf(null), Math.min(60, Math.max(2, s)) * 1000 + 200); };
      end(seconds);
      // a video without a placed text lasts as long as itself (as on the overlay)
      const v = !placed ? root.querySelector("video") : null;
      if (v) v.addEventListener("loadedmetadata", () => { if (Number.isFinite(v.duration) && v.duration > 0) end(v.duration); });
    }
    return () => { if (timer) clearTimeout(timer); engine.unmount(root); };
  }, [drawn, playing, listen, seconds, paused, placed]);

  if (!item || !drawn) return null;
  const play = () => { if (playing) { setPlaying(false); return; } setPlayed(true); setPlaying(true); };
  return (
    <section className="mt-3 min-w-0 rounded-2xl border border-line bg-surface p-3" aria-labelledby={`${uid}-t`} data-reaction-preview="" data-playing={playing ? "1" : undefined}>
      <style>{`${COMPOSE_CSS}\n${GROUNDS}`}</style>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${uid}-t`} className="flex items-center gap-1 text-[15px] font-medium">{L("compose.pv.title")}<HelpTip help={L("compose.pv.help")} name={L("compose.pv.title")} /></h3>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={L("compose.preview")} data-testid="rpv-grounds">
          {(["checker", "dark", "light"] as const).map((k) => (
            <button key={k} type="button" className={`${small} !min-w-0 !px-2.5 ${bg === k ? on : ""}`} aria-pressed={bg === k} onClick={() => setBg(k)} data-testid={`rpv-bg-${k}`}>{L(`compose.preview.${k}`)}</button>
          ))}
        </div>
      </div>
      {items.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={L("compose.pv.files")} data-testid="rpv-files">
          {items.map((it, i) => {
            const sel = it.id === item.id, vid = isVideoSrc(it.src);
            const poster = vid ? it.compose?.backdrop.poster : it.src;
            return (
              <button key={it.id} type="button" aria-pressed={sel} aria-label={L("compose.pv.show", { name: it.name })} title={it.name} onClick={() => setPick(it.id)} data-rpv-file={it.id}
                className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border-2 bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${sel ? "border-accent" : "border-line"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {poster ? <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span aria-hidden="true" className="text-xs font-semibold text-muted">{i + 1}</span>}
                {vid && <span aria-hidden="true" className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] leading-4 text-white">▶</span>}
              </button>
            );
          })}
        </div>
      )}
      <div ref={host} data-rpv-bg={bg} data-testid="rpv-frame" aria-hidden="true" className="relative w-full overflow-hidden rounded-xl bg-bg/60" style={{ height: "clamp(11rem, 32vh, 20rem)" }} />
      {!item.compose && phrase && <p className="mt-1.5 truncate text-[13px] text-muted" title={phrase} data-testid="rpv-phrase">{phrase}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={`${small} ${playing ? "!border-accent !text-accent" : ""}`} onClick={play} data-testid="rpv-play" aria-label={L(playing ? "compose.stop" : played ? "compose.pv.replay" : "compose.play")}>
          <span aria-hidden="true">{playing ? "■" : played ? "↻" : "▶"}</span>{L(playing ? "compose.stop" : played ? "compose.pv.replay" : "compose.play")}
        </button>
        {video && (
          <button type="button" className={`${small} ${listen ? on : ""}`} aria-pressed={listen} onClick={() => setListen((v) => !v)} aria-label={L("compose.listen")} title={L("compose.listen")} data-testid="rpv-sound">
            <span aria-hidden="true">{listen ? "🔊" : "🔇"}</span>
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">{playing ? L("compose.pv.playing", { name: item.name }) : ""}</span>
      </div>
    </section>
  );
}

/** The sentence of the preview: what is typed in the form field the module named (`phraseField`), its `{word}`s filled with the samples; otherwise the module's sample. */
export function fillPhrase(typed: string | null, option: ComposeOption): string {
  const text = (typed ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text) return option.phrase.sample;
  const samples = Object.fromEntries(option.variables.map((v) => [v.token, v.sample]));
  return text.replace(/\{([^{}]*)\}/g, (_, w: string) => samples[w] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}
