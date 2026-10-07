"use client";

import { useState } from "react";
import { ui } from "./ui";

/** Champ image : URL libre ou envoi d'un fichier (stocké dans data/uploads). */
export function ImageField({ name, label, defaultValue, uploadLabel }: { name: string; label: string; defaultValue?: string | null; uploadLabel: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(false);
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body });
      const json = (await res.json()) as { url?: string };
      if (res.ok && json.url) setValue(json.url);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <input id={name} name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://… ou /uploads/…" className={`${ui.input} flex-1`} />
        <label className={`${ui.btn} cursor-pointer`}>
          {busy ? "…" : uploadLabel}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">!</p>}
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-2 h-24 rounded-lg border border-line object-cover" />
      )}
    </div>
  );
}
