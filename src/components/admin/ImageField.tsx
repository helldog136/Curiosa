"use client";

import { useState } from "react";
import { ui } from "./ui";

/** Champ image : URL libre ou envoi d'un fichier (stocké dans data/uploads). */
export function ImageField({ name, label, defaultValue, uploadLabel, kind = "image", svg = false, onValue, required }: { required?: boolean; name: string; label: string; defaultValue?: string | null; uploadLabel: string; kind?: "image" | "video"; /** Accepte aussi le SVG (logos) : nettoyé par le serveur avant d'être enregistré. */ svg?: boolean; /** Appelé à chaque changement de valeur (saisie ou envoi), pour les éditeurs qui gardent l'état eux-mêmes. */ onValue?: (value: string) => void }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    if (svg) body.set("kind", "logo");
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body });
      const json = (await res.json()) as { url?: string; detail?: string };
      if (res.ok && json.url) { setValue(json.url); onValue?.(json.url); }
      else setError(json.detail ?? "!");
    } catch {
      setError("!");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <input id={name} name={name} required={required} value={value} onChange={(e) => { setValue(e.target.value); onValue?.(e.target.value); }} placeholder={kind === "video" ? "/uploads/…" : "https://… ou /uploads/…"} className={`${ui.input} flex-1`} />
        <label className={`${ui.btn} cursor-pointer`}>
          {busy ? "…" : uploadLabel}
          <input type="file" accept={kind === "video" ? "video/mp4,video/webm" : `image/png,image/jpeg,image/webp,image/gif${svg ? ",image/svg+xml" : ""}`} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      {value && kind === "video" && <video src={value} muted playsInline preload="metadata" className="mt-2 h-24 rounded-lg border border-line object-cover" />}
      {value && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-24 rounded-lg border border-line object-cover" />
      )}
    </div>
  );
}
