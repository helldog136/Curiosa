"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "./ui";
import { AUDIO_URL_RE } from "@/core/audioTypes";
import { normalizeVolume } from "@/core/soundConfig";

/**
 * « Écouter à ce volume » : joue le son choisi dans le formulaire (même avant l'enregistrement), au volume saisi, sans rien enregistrer. Un clic de la personne
 * suffit au navigateur : aucune règle de lecture automatique n'est contournée. Un second clic arrête l'écoute.
 */
export function SoundTest({ labels, fileName, volumeName }: { labels: { listen: string; stop: string; none: string; failed: string }; fileName: string; volumeName: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState("");

  const stop = () => { audio.current?.pause(); audio.current = null; setPlaying(false); };
  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, []);

  async function toggle() {
    if (playing) { stop(); return; }
    const form = button.current?.closest("form");
    const value = (name: string) => (form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    const src = value(fileName).trim();
    if (!AUDIO_URL_RE.test(src)) { setMessage(labels.none); return; }
    setMessage("");
    const a = new Audio();
    a.preload = "auto";
    a.src = src;
    a.volume = normalizeVolume(value(volumeName) || undefined) / 100;
    a.addEventListener("ended", stop);
    a.addEventListener("error", () => { stop(); setMessage(labels.failed); });
    audio.current = a;
    try { await a.play(); setPlaying(true); } catch { if (audio.current === a) { stop(); setMessage(labels.failed); } }
  }

  return (
    <div className="space-y-1">
      <button ref={button} type="button" onClick={toggle} aria-pressed={playing} className={`${ui.btn} min-h-11`}>{playing ? labels.stop : labels.listen}</button>
      <p role="status" aria-live="polite" className={ui.help}>{message}</p>
    </div>
  );
}
