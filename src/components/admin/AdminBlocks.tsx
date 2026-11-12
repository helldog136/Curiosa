"use client";

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
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
import { Switch, SwitchField } from "./Switch";
import { Segmented, fitsSegmented } from "./Segmented";
import { MoreOptions } from "./MoreOptions";
import { NumberField } from "./NumberField";
import { PeriodField, type PeriodLabels } from "./PeriodField";
import { DateTimeField, type DateTimeLabels } from "./DateTimeField";
import { DurationField, type DurationLabels } from "./DurationField";
import { useCropLabels } from "./CropLabels";
import { askConfirm } from "./confirmDialog";
import { EditDialog, DialogLink } from "./EditDialog";
import { useModalWindow, type DiscardGuard } from "./ModalWindow";
import { SAVED_EVENT, type SavedDetail } from "./savedEvent";
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

/**
 * Textes des contrôles de la 0.6.0 (déjà traduits par le serveur) et ce que le serveur a calculé pour chaque champ : l'indication d'un nombre borné (`hints`) et le
 * résumé du groupe replié « Plus d'options » (`fold`). Absents (autre appelant) : les nouveaux contrôles se rabattent sur un champ texte.
 */
export type FormLabels = {
  locale: string; example: string; more: string;
  period: PeriodLabels; datetime: DateTimeLabels; duration: DurationLabels;
  hints?: Record<string, string>;
  /** Le message d'un nombre hors bornes (par champ), à la place de la bulle du navigateur. */
  invalid?: Record<string, string>;
  fold?: { summary: string; count: number };
  /** Texts of the edit dialog (`presentation: "dialog"`); absent: the form stays in the page. */
  dialog?: DialogLabels;
};

/** Texts of the edit dialog, already translated by the server. */
export type DialogLabels = { close: string; cancel: string; saved: string; discard: DiscardGuard };

/** Rend un champ déclaré par un module (formulaires d'admin pilotés par les modules). */
function Field({ f, labels }: { f: AdminField; labels?: FormLabels }) {
  if (f.kind === "hidden") return <input type="hidden" name={f.name} value={f.value ?? ""} />;
  const example = f.example && labels ? labels.example.replace("{example}", f.example) : undefined;
  // (0.6.0) Interrupteur, boutons segmentés, période, date et heure, durée, nombre borné : un seul contrôle par notion.
  if (f.kind === "switch") return <SwitchField label={f.label} name={f.name} defaultChecked={["on", "1", "true"].includes(f.value ?? "")} help={f.help} example={example} required={f.required} />;
  if (f.kind === "segmented" && fitsSegmented((f.options ?? []).length)) return <Segmented label={f.label} name={f.name} options={f.options ?? []} defaultValue={f.value} help={f.help} example={example} required={f.required} />;
  if (labels && f.kind === "period") return <PeriodField label={f.label} name={f.name} defaultValue={f.value} help={f.help} example={example} required={f.required} locale={labels.locale} labels={labels.period} openEnded={f.openEnded === true} />;
  if (labels && f.kind === "datetime") return <DateTimeField label={f.label} name={f.name} defaultValue={f.value} optionalTime={f.optionalTime} help={f.help} example={example} required={f.required} locale={labels.locale} labels={labels.datetime} />;
  if (labels && f.kind === "duration") return <DurationField label={f.label} name={f.name} defaultValue={f.value} min={f.min} max={f.max} invalidText={labels.invalid?.[f.name]} help={f.help} example={[labels.hints?.[f.name], example].filter(Boolean).join(" · ") || undefined} required={f.required} labels={labels.duration} />;
  if (f.kind === "number" && (f.min !== undefined || f.max !== undefined || f.step !== undefined || f.unit !== undefined)) {
    return <NumberField label={f.label} name={f.name} defaultValue={f.value} min={f.min} max={f.max} step={f.step} unit={f.unit} required={f.required} help={f.help} hint={labels?.hints?.[f.name]} invalidText={labels?.invalid?.[f.name]} example={example}
      emptyValue={f.placeholder} />;
  }
  if (f.kind === "image") return <ImageField name={f.name} label={f.label} defaultValue={f.value} uploadLabel="↑" />;
  if (f.kind === "audio") return <ImageField name={f.name} label={f.label} defaultValue={f.value} uploadLabel="↑" kind="audio" required={f.required} />;
  // Case à cocher : `value` « on », « 1 » ou « true » = cochée ; décochée, le champ est absent des `values` reçus par le module.
  if (f.kind === "checkbox") return <Checkbox label={f.label} name={f.name} value="on" defaultChecked={["on", "1", "true"].includes(f.value ?? "")} help={f.help} required={f.required} />;
  if (f.kind === "file") return <FileField f={f} />;
  const common = { id: `f_${f.name}`, name: f.name, required: f.required, defaultValue: f.value ?? "", className: ui.input, ...(example ? { "aria-describedby": `ex-${f.name}` } : {}) };
  // Un nouveau genre de champ sur un cœur qui ne le connaît pas (autre appelant) : un champ texte.
  const kind = f.kind === "segmented" || f.kind === "period" || f.kind === "datetime" || f.kind === "duration" ? "text" : f.kind;
  return (
    <div>
      <FieldLabel id={common.id} className={ui.label} help={f.help} text={f.label}>{f.label}</FieldLabel>
      {kind === "textarea" ? (
        <textarea {...common} rows={4} placeholder={f.placeholder} />
      ) : kind === "select" || f.kind === "segmented" ? (
        <select {...common}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      ) : (
        <input {...common} type={kind ?? "text"} placeholder={f.placeholder} />
      )}
      <HelpBelow help={f.help} className={ui.help} />
      {example && <p id={`ex-${f.name}`} className={ui.help} data-field-example="">{example}</p>}
    </div>
  );
}

/** Les champs d'un formulaire : les champs cachés, les champs visibles en grille, puis (0.6.0) les champs `folded` sous « Plus d'options » (ouvert d'office si l'un d'eux a déjà une valeur). */
function FormFields({ fields, labels }: { fields: AdminField[]; labels?: FormLabels }) {
  const wide = (f: AdminField) => f.kind === "textarea" || f.kind === "image" || f.kind === "audio" || f.kind === "file" || f.kind === "period" || f.kind === "datetime";
  const grid = (list: AdminField[]) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {list.map((f) => <div key={f.name} className={wide(f) ? "sm:col-span-2" : ""}><Field f={f} labels={labels} /></div>)}
    </div>
  );
  const visible = fields.filter((f) => f.kind !== "hidden" && !f.folded);
  const folded = fields.filter((f) => f.kind !== "hidden" && f.folded);
  return (
    <>
      {fields.filter((f) => f.kind === "hidden").map((f) => <Field key={f.name} f={f} />)}
      {grid(visible)}
      {folded.length > 0 && (
        <MoreOptions title={labels?.more ?? "…"} summary={labels?.fold?.summary} count={labels?.fold?.count} defaultOpen={folded.some((f) => (f.value ?? "") !== "" && f.value !== "0" && f.value !== "off")}>
          {grid(folded)}
        </MoreOptions>
      )}
    </>
  );
}

/**
 * Formulaire qui contient un champ fichier : envoyé à la route du cœur `/api/admin/modules/<instance>/action/<action>` (les actions serveur de Next sont plafonnées
 * à 1 Mo). La taille est vérifiée ICI pour éviter un envoi inutile ; le cœur la revérifie (5 Mo au plus par fichier, texte UTF-8 seulement).
 */
function FileBlockForm({ instanceId, block, labels, form }: { instanceId: string; block: FormBlock; labels: FileLabels; form?: FormLabels }) {
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
      <FormFields fields={block.fields} labels={form} />
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      <div className="flex items-center gap-3">
        <PendingButton pending={pending} variant="primary">{block.submitLabel}</PendingButton>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn} aria-label={c("cancel")}>↩</a>}
      </div>
    </form>
  );
}

export function AdminBlockForm({ instanceId, block, entry, fileLabels, labels }: { instanceId: string; block: FormBlock; entry?: EntryScope; fileLabels?: FileLabels; labels?: FormLabels }) {
  // `presentation: "dialog"` (next core release): the same form, in a window above the page. Not in an entry editor, not with a file field, not without the texts.
  if (!entry && block.presentation === "dialog" && labels?.dialog && !block.fields.some((f) => f.kind === "file")) return <DialogBlockForm instanceId={instanceId} block={block} labels={labels} dialog={labels.dialog} />;
  // Un champ fichier n'existe que dans le panneau d'une instance (route dédiée) ; dans l'éditeur d'une entrée il est écarté.
  if (!entry && fileLabels && block.fields.some((f) => f.kind === "file")) return <FileBlockForm instanceId={instanceId} block={block} labels={fileLabels} form={labels} />;
  return <ActionBlockForm instanceId={instanceId} block={entry ? { ...block, fields: block.fields.filter((f) => f.kind !== "file") } : block} entry={entry} labels={labels} />;
}

function ActionBlockForm({ instanceId, block, entry, labels }: { instanceId: string; block: FormBlock; entry?: EntryScope; labels?: FormLabels }) {
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
      <FormFields fields={block.fields} labels={labels} />
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      <div className="flex items-center gap-3">
        <PendingButton pending={pending} variant="primary">{block.submitLabel}</PendingButton>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn} aria-label={c("cancel")}>↩</a>}
      </div>
    </form>
  );
}

/**
 * The form of a module in an edit dialog (`presentation: "dialog"`): the SAME fields, the same server action and the same validation as `ActionBlockForm`, in the
 * shared window. Errors stay under the fields (the first one gets the focus) and the typed values are kept; the single main button is in the sticky footer
 * (it submits the form through the `form` attribute); a success closes the window, announces itself near the saved row (see `savedEvent`) and shows the list again.
 */
function DialogBlockForm({ instanceId, block, labels, dialog }: { instanceId: string; block: FormBlock; labels: FormLabels; dialog: DialogLabels }) {
  const [state, action, pending] = useActionState(runner(instanceId, block.action), null);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  useFieldErrorsDom(formRef, state?.errors, state);
  const title = block.title ?? block.submitLabel;
  return (
    <EditDialog title={title} closeLabel={dialog.close} closeHref={block.cancelHref} guard={dialog.discard}
      footer={<DialogFooter formId={formId} submitLabel={block.submitLabel} cancel={dialog.cancel} cancelHref={block.cancelHref} pending={pending} error={state?.error} />}>
      <DialogOutcome state={state} formRef={formRef} instanceId={instanceId} saved={dialog.saved} />
      <form id={formId} ref={formRef} onSubmit={submitKeepingValues(action)} className="space-y-4" data-testid="edit-dialog-form">
        <FormFields fields={block.fields} labels={labels} />
      </form>
    </EditDialog>
  );
}

/** Footer of the edit dialog: a general error (when it concerns no field), then ONE main button with a specific verb and a discreet "Cancel". */
function DialogFooter({ formId, submitLabel, cancel, cancelHref, pending, error }: { formId: string; submitLabel: string; cancel: string; cancelHref?: string; pending: boolean; error?: string }) {
  const win = useModalWindow();
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        {(() => {
          const look = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline";
          return cancelHref
            ? <a href={cancelHref} onClick={(e) => { e.preventDefault(); win?.close(); }} className={look} data-testid="edit-dialog-cancel">{cancel}</a>
            : <button type="button" onClick={() => win?.close()} className={look} data-testid="edit-dialog-cancel">{cancel}</button>;
        })()}
        <PendingButton pending={pending} variant="primary" form={formId} testid="edit-dialog-submit">{submitLabel}</PendingButton>
      </div>
    </div>
  );
}

/** Renders nothing: on a success, closes the window without asking and tells the list which row was saved. */
function DialogOutcome({ state, formRef, instanceId, saved }: { state: ActionState; formRef: React.RefObject<HTMLFormElement | null>; instanceId: string; saved: string }) {
  const win = useModalWindow();
  useEffect(() => {
    if (!state || state.error || state.errors) return;
    const id = (formRef.current?.elements.namedItem("id") as HTMLInputElement | null)?.value;
    const detail: SavedDetail = { instanceId, id: id || undefined, message: state.ok || saved };
    win?.markClean();
    win?.close(true);
    window.dispatchEvent(new CustomEvent(SAVED_EVENT, { detail }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return null;
}

export function RowActionButton({ instanceId, label, action, href, id, confirm: confirmText, danger, entry, presentation }: {
  instanceId: string; label: string; action?: string; href?: string; id?: string; confirm?: string; danger?: boolean; entry?: EntryScope; presentation?: "dialog";
}) {
  const [state, formAction, pending] = useActionState(runner(instanceId, action ?? "", entry), null);
  if (href) return presentation === "dialog" && !entry ? <DialogLink href={href} className={ui.btn}>{label}</DialogLink> : <a href={href} className={ui.btn}>{label}</a>;
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

/**
 * (0.6.0) Interrupteur d'état dans une ligne de tableau : un clic appelle l'adminAction du module avec `{ id, enabled: "1" | "0" }` (l'action DIT l'état voulu, elle
 * n'inverse rien : un double clic ne défait donc jamais le premier). Retour là où on a cliqué, retour arrière si l'action échoue.
 */
export function RowSwitch({ instanceId, action, id, on, label, onText, offText, entry, failedText, savedText }: {
  instanceId: string; action: string; id?: string; on: boolean; label: string; onText?: string; offText?: string; entry?: EntryScope; failedText: string; savedText: string;
}) {
  return (
    <Switch label={label} checked={on} onText={onText} offText={offText} failedText={failedText} disabled={!id}
      onToggle={async (next) => {
        const data = new FormData();
        data.set("id", id ?? "");
        data.set("enabled", next ? "1" : "0");
        const res = await runner(instanceId, action, entry)(null, data);
        const problem = res?.error ?? (res?.errors ? Object.values(res.errors)[0] : undefined);
        return problem ? { error: problem } : { ok: res?.ok ?? savedText };
      }} />
  );
}

/** (0.6.0) Une action de ligne rangée dans le menu « ⋯ » : un élément de menu pleine largeur (cible de 44 px), même confirmation et même retour qu'un bouton de ligne. */
export function RowMenuItem({ instanceId, label, action, href, id, confirm: confirmText, danger, entry, presentation }: {
  instanceId: string; label: string; action?: string; href?: string; id?: string; confirm?: string; danger?: boolean; entry?: EntryScope; presentation?: "dialog";
}) {
  const [state, formAction, pending] = useActionState(runner(instanceId, action ?? "", entry), null);
  const item = `flex min-h-11 w-full items-center px-4 text-left text-sm transition-colors hover:bg-bg disabled:cursor-progress disabled:opacity-60 ${danger ? "font-medium text-red-700" : ""}`;
  if (href) return presentation === "dialog" && !entry ? <DialogLink href={href} role="menuitem" className={item}>{label}</DialogLink> : <a href={href} role="menuitem" className={item}>{label}</a>;
  return (
    <form onSubmit={submitKeepingValues(formAction)}>
      <input type="hidden" name="id" value={id ?? ""} />
      <button type="submit" role="menuitem" disabled={pending} className={item}
        onClick={async (e) => {
          if (!confirmText) return;
          const form = e.currentTarget.form;
          e.preventDefault();
          if (await askConfirm(confirmText)) form?.requestSubmit();
        }}>{label}</button>
      {state?.error && <p role="alert" className="px-4 pb-2 text-xs text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="px-4 pb-2 text-xs text-emerald-700">{state.ok}</p>}
    </form>
  );
}
