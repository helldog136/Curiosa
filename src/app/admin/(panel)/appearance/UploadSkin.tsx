"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FieldErrorText } from "@/components/admin/FieldErrors";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { SkinAdded } from "./SkinAdded";
import { addUploadedSkinAction, cancelUploadAction, checkSkinFileAction, chooseSkinAction, previewStagedAction, type UploadView } from "./actions";

type Ready = Extract<UploadView, { ok: true }>;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * « Ajouter un skin depuis un fichier » (core 0.46.1). Le chemin court : on dépose le .zip (ou « Choisir un fichier »), il est vérifié tout de suite, on VOIT son skin
 * sur le vrai site (rien n'est enregistré), « Ajouter ce skin », puis « Utiliser ce skin » ou « Garder tel quel ». Aucune case à cocher : un skin ne change que l'apparence
 * et n'exécute rien ; la phrase à côté du bouton dit qui en est responsable, et le clic sur le bouton est la confirmation. Le fichier .zip n'est jamais gardé.
 */
export function UploadSkin({ initial, bare = false }: { /** Inside "Add a skin" (the card and its way choice are there): no card of its own. */ bare?: boolean; /** The state the block starts in (render tests and screenshots). */ initial?: { view?: Ready; error?: string; added?: { id: string; name: string } } }) {
  const al = useAL();
  const router = useRouter();
  const [view, setView] = useState<Ready | null>(initial?.view ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(initial?.added ?? null);
  const [done, setDone] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ token: string; url: string } | null>(null);
  const [over, setOver] = useState(false);
  const [checking, startCheck] = useTransition();
  const [adding, startAdd] = useTransition();
  const [using, startUse] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const token = view?.token;
  const previewable = view?.previewable;
  useEffect(() => {
    if (!token || !previewable) return;
    let live = true;
    void previewStagedAction(token).then((r) => { if (live && r.ok) setPreview({ token, url: r.url }); });
    return () => { live = false; };
  }, [token, previewable]);

  const src = preview && preview.token === token ? preview.url : null;
  const clear = () => { setView(null); setError(null); setAdded(null); setPreview(null); if (input.current) input.current.value = ""; };
  const take = (file: File | undefined) => {
    if (!file) return;
    setDone(null); setAdded(null); setError(null);
    if (view) void cancelUploadAction(view.token);
    setView(null);
    if (file.size > MAX_BYTES) { setError(al("skins.upload.too-big")); return; }
    const fd = new FormData();
    fd.set("skinFile", file);
    startCheck(async () => {
      const r = await checkSkinFileAction(fd);
      if (r.ok) setView(r); else setError(r.error);   // the file stays chosen: the person fixes the folder and drops the new file
    });
  };
  const cancel = () => { if (view) void cancelUploadAction(view.token); clear(); };
  const add = () => view && startAdd(async () => {
    const fd = new FormData();
    fd.set("token", view.token);
    const r = await addUploadedSkinAction(null, fd);
    if (r?.ok) { setAdded({ id: view.id, name: view.name }); setView(null); router.refresh(); }
    else setError(r?.errors?.skinFile ?? r?.error ?? al("skins.error.failed"));
  });
  const use = () => added && startUse(async () => {
    const fd = new FormData();
    fd.set("id", added.id);
    const r = await chooseSkinAction(null, fd);
    if (r?.ok) { setDone(r.ok); setAdded(null); router.refresh(); } else setError(r?.error ?? al("skins.error.failed"));
  });

  return (
    <section className={bare ? "space-y-4" : `${ui.card} space-y-4`} data-testid="upload-skin" aria-labelledby="upload-skin-title">
      <div>
        {bare ? <p id="upload-skin-title" className="text-sm text-muted">{al("appearance.file.intro")}</p> : <>
          <h3 id="upload-skin-title" className="font-semibold">{al("appearance.file.title")}</h3>
          <p className={ui.help}>{al("appearance.file.intro")}</p>
        </>}
      </div>

      {!view && !added && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
          data-testid="upload-drop" className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center ${over ? "border-accent bg-accent/10" : "border-line bg-bg"}`}>
          <p className="text-[15px] font-medium">{checking ? al("appearance.file.checking") : al("appearance.file.drop")}</p>
          <input ref={input} id="skinFile" name="skinFile" type="file" accept=".zip,application/zip,application/x-zip-compressed" className="peer sr-only" disabled={checking}
            aria-describedby="skinFileHelp skinFileError" aria-invalid={error ? true : undefined} onChange={(e) => take(e.target.files?.[0])} />
          <label htmlFor="skinFile" className={`${ui.btnPrimary} min-h-11 cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--v-accent)] ${checking ? "pointer-events-none opacity-60" : ""}`}>{al("appearance.file.choose")}</label>
          <p id="skinFileHelp" className={ui.help}>{al("appearance.file.help")}</p>
        </div>
      )}
      <div id="skinFileError" aria-live="polite"><FieldErrorText id="skinFileErrorText" message={error} /></div>

      {view && (
        <div className="space-y-4" data-testid="upload-ready">
          <div>
            <h4 className="text-base font-semibold">{view.name} <span className="text-sm font-normal text-muted">{view.version}</span></h4>
            {view.description && <p className="text-sm text-muted">{view.description}</p>}
            <p className="mt-1 text-[13px] text-muted">
              {[view.author ? al("appearance.by", { author: view.author }) : "", view.modes.length === 2 ? al("appearance.modes.both") : al(`appearance.modes.${view.modes[0] ?? "dark"}Only`), al("appearance.size", { kb: view.kb }), view.replaces ? al("appearance.file.replaces", { version: view.replaces }) : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
          {src ? (
            <iframe src={src} title={al("appearance.file.previewTitle", { name: view.name })} className="h-[28rem] w-full rounded-xl border border-line bg-bg" data-testid="upload-preview" />
          ) : view.previews.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {view.previews.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- picture read from the checked file and given as local data: nothing is loaded from another site
                <li key={i}><img src={p.dataUrl} alt={p.alt} className="w-full rounded-lg border border-line" /></li>
              ))}
            </ul>
          ) : null}
          {view.notes.length > 0 && (
            <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">{al("appearance.issues", { n: view.notes.length })}</summary>
              <ul className="list-disc pl-5">{view.notes.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <PendingButton type="button" variant="primary" pending={adding} pendingLabel={al("appearance.installing")} onClick={add} testid="upload-add">{al("appearance.personal.add")}</PendingButton>
            <button type="button" className={ui.btn + " min-h-11"} onClick={cancel} disabled={adding}>{al("appearance.file.cancel")}</button>
            <p className="min-w-0 flex-1 basis-60 text-sm" data-testid="upload-trust">{al("appearance.file.trust")}</p>
          </div>
        </div>
      )}

      {added && <SkinAdded name={added.name} using={using} onUse={use} onKeep={clear} />}
      {done && <p role="status" className="text-sm font-medium text-emerald-700">{done}</p>}
    </section>
  );
}
