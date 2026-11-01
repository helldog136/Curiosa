"use client";

import { useState } from "react";
import { RATIOS, joinImageRef, splitImageRef, type Crop } from "@/core/imageCrop";
import { useCropLabels } from "./CropLabels";
import { ImageCropper } from "./ImageCropper";
import { ui } from "./ui";
import { Spinner } from "./ActionKit";
import { useProgressText } from "./ProgressLabels";

const CROPPABLE = /^\/uploads\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;

/**
 * Champ image : URL libre ou envoi d'un fichier (stocké dans data/uploads).
 * Une image envoyée se recadre (bouton « Recadrer ») sans jamais être modifiée : la valeur du champ est l'original + son cadrage
 * (`/uploads/xxx.png?c=…`, voir core/imageCrop.ts) ; une valeur sans cadrage est l'image telle quelle, comme avant.
 */
export function ImageField({ name, label, defaultValue, uploadLabel, kind = "image", svg = false, onValue, required }: { required?: boolean; name: string; label: string; defaultValue?: string | null; uploadLabel: string; kind?: "image" | "video"; /** Accepte aussi le SVG (logos) : nettoyé par le serveur avant d'être enregistré. */ svg?: boolean; /** Appelé à chaque changement de valeur (saisie ou envoi), pour les éditeurs qui gardent l'état eux-mêmes. */ onValue?: (value: string) => void }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const c = useCropLabels();
  const p = useProgressText();
  const ref = splitImageRef(value);
  const croppable = kind === "image" && CROPPABLE.test(ref.path);
  const change = (v: string) => { setValue(v); onValue?.(v); };
  const ratioName = (crop: Crop) => (crop.ratio === null ? c("original") : RATIOS.find((r) => Math.abs(r.value - crop.ratio!) < 0.002)?.id ?? c("free"));

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    if (svg) body.set("kind", "logo");
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body });
      const json = (await res.json()) as { url?: string; detail?: string };
      if (res.ok && json.url) change(json.url);
      else setError(json.detail ?? p("uploadFailed"));
    } catch {
      setError(p("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        {/* La valeur envoyée (champ caché) = adresse + cadrage ; la personne ne voit et ne modifie que l'adresse. */}
        <input type="hidden" name={name} value={value} />
        <input id={name} required={required} value={ref.path} onChange={(e) => change(e.target.value)} placeholder={kind === "video" ? "/uploads/…" : c("urlPlaceholder")} className={`${ui.input} min-w-0 flex-1`} />
        <label className={`${ui.btn} min-h-11 ${busy ? "pointer-events-none cursor-progress" : "cursor-pointer"}`} aria-busy={busy || undefined}>
          {busy ? <><Spinner />{p("sending")}</> : uploadLabel}
          <input type="file" disabled={busy} accept={kind === "video" ? "video/mp4,video/webm" : `image/png,image/jpeg,image/webp,image/gif${svg ? ",image/svg+xml" : ""}`} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {croppable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={ui.btn} onClick={() => setEditing(true)}>✂ {c("button")}</button>
          {ref.crop && <span className={ui.chip}>{c("state", { ratio: ratioName(ref.crop) })}</span>}
          {ref.crop && <button type="button" className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline" onClick={() => change(ref.path)}>{c("remove")}</button>}
        </div>
      )}
      {kind === "image" && !croppable && /^\/uploads\/[0-9a-f-]{36}\.(gif|svg)$/.test(ref.path) && <p className={ui.help}>{c("gif")}</p>}
      {editing && croppable && (
        <ImageCropper src={ref.path} initial={ref.crop} warnSmall={!svg} onCancel={() => setEditing(false)} onApply={(crop) => { change(joinImageRef(ref.path, crop)); setEditing(false); }} />
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      {value && kind === "video" && <video src={value} muted playsInline preload="metadata" className="mt-2 h-24 rounded-lg border border-line object-cover" />}
      {value && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 max-h-32 max-w-full rounded-lg border border-line" />
      )}
    </div>
  );
}
