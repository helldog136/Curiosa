"use client";

import { useEffect, useRef, useState } from "react";

type Labels = { play: string; pause: string; soundOn: string; soundOff: string };

/**
 * Bandeau d'accueil avec vidéo en fond. La vidéo ne joue QUE quand elle est visible à l'écran (et que l'onglet est ouvert) : hors de l'écran
 * elle est en pause et ne consomme rien. Elle démarre sans son (les navigateurs l'imposent) ; si le propriétaire le permet, un bouton laisse
 * le visiteur activer le son. Si le visiteur préfère les animations réduites, elle ne démarre pas toute seule (un bouton la lance).
 */
export function HeroVideo({ src, poster, sound, title, text, logo, eyebrow, button, labels }: { src: string; poster?: string; sound: boolean; title: string; text?: string; logo?: string; eyebrow?: string; button?: { label: string; href: string }; labels: Labels }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [wanted, setWanted] = useState(() => typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches); // false = le visiteur a mis la vidéo en pause (ou préfère les animations réduites)
  // Un seul effet, relancé quand le visiteur met en pause ou relance : lecture = visible à l'écran + onglet ouvert + pas de pause voulue.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && wanted) video.play().catch(() => {});
      else video.pause();
    };
    const io = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; sync(); }, { threshold: 0.25 });
    io.observe(video);
    document.addEventListener("visibilitychange", sync);
    const on = () => setPlaying(true), off = () => setPlaying(false);
    video.addEventListener("play", on); video.addEventListener("pause", off);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); video.removeEventListener("play", on); video.removeEventListener("pause", off); };
  }, [wanted]);

  const btn = "rounded-full bg-black/50 px-3 py-1.5 text-sm text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  return (
    <section data-testid="hero-video" className="relative isolate flex min-h-[70vh] items-center justify-center overflow-hidden rounded-2xl text-center text-white">
      <video ref={ref} src={src} poster={poster} muted={muted} loop playsInline preload="metadata" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover" />
      <div className="absolute inset-0 -z-10 bg-black/45" aria-hidden="true" />
      <div className="space-y-4 px-6 py-16">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="mx-auto h-24 w-24 rounded-full object-cover" />
        )}
        {eyebrow && <p className="text-lg font-semibold drop-shadow">{eyebrow}</p>}
        {title && <h1 className="text-4xl font-bold tracking-tight drop-shadow sm:text-6xl">{title}</h1>}
        {text && <p className="mx-auto max-w-2xl text-lg drop-shadow">{text}</p>}
        {button?.label && /^(\/(?!\/)|https?:\/\/|mailto:)/.test(button.href) && <a href={button.href} className="inline-block rounded-full border-2 border-white px-6 py-3 font-semibold transition-colors hover:bg-white hover:text-black">{button.label}</a>}
      </div>
      <div className="absolute bottom-3 right-3 flex gap-2">
        <button type="button" className={btn} aria-pressed={playing} onClick={() => setWanted(!playing)}>{playing ? `⏸ ${labels.pause}` : `▶ ${labels.play}`}</button>
        {sound && <button type="button" className={btn} aria-pressed={!muted} onClick={() => { const v = ref.current; if (!v) return; v.muted = !muted; setMuted(!muted); if (muted) { setWanted(true); v.play().catch(() => {}); } }}>{muted ? `🔇 ${labels.soundOn}` : `🔊 ${labels.soundOff}`}</button>}
      </div>
    </section>
  );
}
