"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { chooseSkinAction, previewLinkAction } from "./actions";

export type PreviewPage = { label: string; path: string };

/**
 * Aperçu d'un skin AVANT de l'utiliser : la vraie page du site, habillée du skin, dans une fenêtre de la page (rien n'est enregistré). On peut choisir la page,
 * la largeur (téléphone / ordinateur) et, si le skin a les deux modes, clair ou sombre. « Utiliser ce skin » est dans la fenêtre : on a vu, on choisit.
 */
export function PreviewButton({ skinId, skinName, bothModes, pages, canChoose, active }: { skinId: string; skinName: string; bothModes: boolean; pages: PreviewPage[]; canChoose: boolean; active: boolean }) {
  const al = useAL();
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [path, setPath] = useState(pages[0]?.path ?? "/");
  const [width, setWidth] = useState<"phone" | "desktop">("phone");
  const [mode, setMode] = useState<"auto" | "light" | "dark">("auto");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [, start] = useTransition();
  const id = useId();

  const load = (p: string) => {
    setError(""); setLoading(true);
    start(async () => {
      const r = await previewLinkAction(skinId, p);
      if (r.ok) setSrc(r.url); else { setError(r.error); setLoading(false); }
    });
  };
  const open = () => { dialog.current?.showModal(); load(path); };
  const close = () => { dialog.current?.close(); };
  // Le choix clair / sombre est posé sur la page montrée (même origine) ; « Automatique » le retire.
  const applyMode = (m: "auto" | "light" | "dark") => {
    try {
      const root = frame.current?.contentDocument?.documentElement;
      if (!root) return;
      if (m === "auto") root.removeAttribute("data-mode"); else root.setAttribute("data-mode", m);
    } catch { /* page d'une autre origine : rien à faire */ }
  };
  useEffect(() => { applyMode(mode); }, [mode]);

  return (
    <>
      <button type="button" className={`${ui.btn} min-h-11`} onClick={open} aria-haspopup="dialog" data-testid={`preview-${skinId}`}>
        {al("appearance.preview.open")}<span className="sr-only"> — {skinName}</span>
      </button>
      <dialog ref={dialog} aria-labelledby={`${id}-t`} onClose={() => { setSrc(null); setLoading(false); }}
        className="m-0 h-dvh max-h-none w-screen max-w-none border border-line bg-surface p-0 text-fg backdrop:bg-black/60 sm:m-auto sm:h-[90dvh] sm:w-[min(72rem,96vw)] sm:rounded-2xl">
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-3 sm:px-5">
            <h2 id={`${id}-t`} className="mr-auto text-lg font-semibold">{al("appearance.preview.title", { name: skinName })}</h2>
            <button type="button" className={`${ui.btn} min-h-11`} onClick={close}>{al("appearance.preview.close")}</button>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-3 sm:px-5">
            {pages.length > 1 && (
              <label className="text-sm"><span className="mb-1 block font-medium">{al("appearance.preview.page")}</span>
                <select value={path} onChange={(e) => { setPath(e.target.value); load(e.target.value); }} className={`${ui.input} min-h-11 !w-auto`}>
                  {pages.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
                </select>
              </label>
            )}
            <fieldset className="text-sm"><legend className="mb-1 font-medium">{al("appearance.preview.size")}</legend>
              <div className="inline-flex overflow-hidden rounded-xl border border-line">
                {(["phone", "desktop"] as const).map((w) => (
                  <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)} className={`min-h-11 px-4 text-sm ${width === w ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{al(`appearance.preview.${w}`)}</button>
                ))}
              </div>
            </fieldset>
            {bothModes && (
              <fieldset className="text-sm"><legend className="mb-1 font-medium">{al("appearance.preview.mode")}</legend>
                <div className="inline-flex overflow-hidden rounded-xl border border-line">
                  {(["auto", "light", "dark"] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-11 px-4 text-sm ${mode === m ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{al(`appearance.mode.${m}`)}</button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <p className="px-3 pt-2 text-[13px] text-muted sm:px-5">{al("appearance.preview.note")}{loading && !error ? <span role="status"> · {al("appearance.preview.loading")}</span> : null}</p>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-bg/60 p-2 sm:p-4">
            {error ? <p role="alert" className="m-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{error}</p> : src && (
              <iframe ref={frame} src={src} title={al("appearance.preview.frameTitle", { name: skinName })} data-testid="preview-frame"
                onLoad={() => { setLoading(false); applyMode(mode); }}
                className={`h-full rounded-xl border border-line bg-white ${width === "phone" ? "w-[390px] max-w-full" : "w-full"}`} />
            )}
          </div>
          {canChoose && !active && (
            <div className="border-t border-line p-3 sm:px-5">
              <ActionForm action={chooseSkinAction} submitLabel={al("appearance.use")} pendingLabel={al("appearance.using")} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={skinId} />
                <p className="text-[13px] text-muted">{al("appearance.use.help")}</p>
              </ActionForm>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
