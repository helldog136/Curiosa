"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { clearSecrets, submitKeepingValues } from "./keepValues";
import { useFieldErrorsDom } from "./FieldErrors";
import { PendingButton } from "./PendingButton";
import { useRouter } from "next/navigation";
import type { AdminField, Block } from "@/core/blocks";
import { ImageField } from "./ImageField";
import { FileField } from "./FileField";
import { ui } from "./ui";
import { Checkbox, FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { useCropLabels } from "./CropLabels";
import { askConfirm } from "./confirmDialog";
import { runModuleAdminAction } from "@/app/admin/(panel)/instances/module-actions";
import { runEntryPanelAction } from "@/app/admin/(panel)/entries/panel-actions";
import type { ActionState } from "./ActionForm";

/** Textes du champ fichier ({max} : taille en Mo à remplacer). */
export type FileLabels = { tooBig: string; sending: string; failed: string; done: string };
const MAX_FILE = 5 * 1024 * 1024;
const mbOf = (bytes: number) => String(Math.round((bytes / 1048576) * 10) / 10).replace(/\.0$/, "");

/** Section ajoutée à l'éditeur d'une entrée : les actions passent par `runEntryPanelAction` (droits d'éditeur, aucune redirection) au lieu des actions du panneau d'une instance. */
export type EntryScope = { panelId: string; entryId: string };
const runner = (instanceId: string, action: string, entry?: EntryScope): ((prev: ActionState, formData: FormData) => Promise<ActionState>) =>
  entry ? runEntryPanelAction.bind(null, instanceId, entry.panelId, entry.entryId, action) : runModuleAdminAction.bind(null, instanceId, action);

type FormBlock = Extract<Block, { type: "adminForm" }>;

/** Rend un champ déclaré par un module (formulaires d'admin pilotés par les modules). */
function Field({ f }: { f: AdminField }) {
  if (f.kind === "hidden") return <input type="hidden" name={f.name} value={f.value ?? ""} />;
  if (f.kind === "image") return <ImageField name={f.name} label={f.label} defaultValue={f.value} uploadLabel="↑" />;
  // Case à cocher : `value` « on », « 1 » ou « true » = cochée ; décochée, le champ est absent des `values` reçus par le module.
  if (f.kind === "checkbox") return <Checkbox label={f.label} name={f.name} value="on" defaultChecked={["on", "1", "true"].includes(f.value ?? "")} help={f.help} required={f.required} />;
  if (f.kind === "file") return <FileField f={f} />;
  const common = { id: `f_${f.name}`, name: f.name, required: f.required, defaultValue: f.value ?? "", className: ui.input };
  return (
    <div>
      <FieldLabel id={common.id} className={ui.label} help={f.help} text={f.label}>{f.label}</FieldLabel>
      {f.kind === "textarea" ? (
        <textarea {...common} rows={4} />
      ) : f.kind === "select" ? (
        <select {...common}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      ) : (
        <input {...common} type={f.kind ?? "text"} />
      )}
      <HelpBelow help={f.help} className={ui.help} />
    </div>
  );
}

/**
 * Formulaire qui contient un champ fichier : envoyé à la route du cœur `/api/admin/modules/<instance>/action/<action>` (les actions serveur de Next sont plafonnées
 * à 1 Mo). La taille est vérifiée ICI pour éviter un envoi inutile ; le cœur la revérifie (5 Mo au plus par fichier, texte UTF-8 seulement).
 */
function FileBlockForm({ instanceId, block, labels }: { instanceId: string; block: FormBlock; labels: FileLabels }) {
  const router = useRouter();
  const c = useCropLabels();
  const [state, setState] = useState<ActionState>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useFieldErrorsDom(formRef, state?.errors, state);
  const fileFields = block.fields.filter((f) => f.kind === "file");
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    for (const f of fileFields) {
      const max = Math.min(MAX_FILE, f.maxBytes && f.maxBytes > 0 ? f.maxBytes : MAX_FILE);
      const file = data.get(f.name);
      if (file instanceof File && file.size > max) { setState({ errors: { [f.name]: labels.tooBig.replace("{max}", mbOf(max)) } }); return; }
      data.set(`$max_${f.name}`, String(max));
      if (f.accept) data.set(`$accept_${f.name}`, f.accept.slice(0, 200));
    }
    setPending(true);
    setState({ ok: labels.sending });
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 150_000);
    try {
      const res = await fetch(`/api/admin/modules/${encodeURIComponent(instanceId)}/action/${encodeURIComponent(block.action)}`, { method: "POST", body: data, signal: abort.signal, headers: { accept: "application/json" }, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { ok?: string; error?: string; errors?: Record<string, string>; redirect?: string } | null;
      if (json?.error || json?.errors) setState({ error: json.error, errors: json.errors });
      else if (!res.ok) setState({ error: labels.failed });
      else {
        setState({ ok: json?.ok || labels.done });
        if (json?.redirect) router.push(json.redirect); else router.refresh();
      }
    } catch {
      setState({ error: labels.failed });
    } finally {
      window.clearTimeout(timer);
      setPending(false);
    }
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className={`${ui.card} space-y-4`}>
      {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
      {block.fields.filter((f) => f.kind === "hidden").map((f) => <Field key={f.name} f={f} />)}
      <div className="grid gap-4 sm:grid-cols-2">
        {block.fields.filter((f) => f.kind !== "hidden").map((f) => (
          <div key={f.name} className={f.kind === "textarea" || f.kind === "image" || f.kind === "file" ? "sm:col-span-2" : ""}><Field f={f} /></div>
        ))}
      </div>
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      <div className="flex items-center gap-3">
        <PendingButton pending={pending} variant="primary">{block.submitLabel}</PendingButton>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn} aria-label={c("cancel")}>↩</a>}
      </div>
    </form>
  );
}

export function AdminBlockForm({ instanceId, block, entry, fileLabels }: { instanceId: string; block: FormBlock; entry?: EntryScope; fileLabels?: FileLabels }) {
  // Un champ fichier n'existe que dans le panneau d'une instance (route dédiée) ; dans l'éditeur d'une entrée il est écarté.
  if (!entry && fileLabels && block.fields.some((f) => f.kind === "file")) return <FileBlockForm instanceId={instanceId} block={block} labels={fileLabels} />;
  return <ActionBlockForm instanceId={instanceId} block={entry ? { ...block, fields: block.fields.filter((f) => f.kind !== "file") } : block} entry={entry} />;
}

function ActionBlockForm({ instanceId, block, entry }: { instanceId: string; block: FormBlock; entry?: EntryScope }) {
  const [state, action, pending] = useActionState(runner(instanceId, block.action, entry), null);
  const formRef = useRef<HTMLFormElement>(null);
  const c = useCropLabels();
  useFieldErrorsDom(formRef, state?.errors, state);
  // Une erreur garde ce qui a été tapé (pour le corriger). Un formulaire qui CRÉE quelque chose se vide après un succès ; un formulaire de modification (lien « annuler ») garde ses valeurs.
  useEffect(() => {
    if (!state?.ok || !formRef.current) return;
    if (block.cancelHref) clearSecrets(formRef.current); else formRef.current.reset();
  }, [state, block.cancelHref]);
  return (
    <form ref={formRef} onSubmit={submitKeepingValues(action)} className={`${ui.card} space-y-4`}>
      {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
      {block.fields.filter((f) => f.kind === "hidden").map((f) => <Field key={f.name} f={f} />)}
      <div className="grid gap-4 sm:grid-cols-2">
        {block.fields.filter((f) => f.kind !== "hidden").map((f) => (
          <div key={f.name} className={f.kind === "textarea" || f.kind === "image" ? "sm:col-span-2" : ""}><Field f={f} /></div>
        ))}
      </div>
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      <div className="flex items-center gap-3">
        <PendingButton pending={pending} variant="primary">{block.submitLabel}</PendingButton>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn} aria-label={c("cancel")}>↩</a>}
      </div>
    </form>
  );
}

export function RowActionButton({ instanceId, label, action, href, id, confirm: confirmText, danger, entry }: {
  instanceId: string; label: string; action?: string; href?: string; id?: string; confirm?: string; danger?: boolean; entry?: EntryScope;
}) {
  const [state, formAction, pending] = useActionState(runner(instanceId, action ?? "", entry), null);
  if (href) return <a href={href} className={ui.btn}>{label}</a>;
  return (
    <form onSubmit={submitKeepingValues(formAction)}>
      <input type="hidden" name="id" value={id ?? ""} />
      <PendingButton pending={pending} variant={danger ? "danger" : "btn"}
        onClick={async (e) => {
          if (!confirmText) return;
          // Boîte dans la page (jamais window.confirm : le navigateur la supprime en silence quand l'onglet n'est pas au premier plan).
          const form = e.currentTarget.form;
          e.preventDefault();
          if (await askConfirm(confirmText)) form?.requestSubmit();
        }}>{label}</PendingButton>
      {/* Le résultat d'un bouton de ligne ne se perd pas : une erreur dit quoi faire, une réussite le confirme. */}
      {state?.error && <p role="alert" className="mt-1 max-w-64 whitespace-normal text-xs text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-1 max-w-64 whitespace-normal text-xs text-emerald-700">{state.ok}</p>}
    </form>
  );
}
