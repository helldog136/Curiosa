"use client";

import { useActionState } from "react";
import type { AdminField, Block } from "@/core/blocks";
import { ImageField } from "./ImageField";
import { ui } from "./ui";
import { Checkbox } from "./Field";
import { askConfirm } from "./confirmDialog";
import { runModuleAdminAction } from "@/app/admin/(panel)/instances/module-actions";
import { runEntryPanelAction } from "@/app/admin/(panel)/entries/panel-actions";
import type { ActionState } from "./ActionForm";

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
  const common = { id: `f_${f.name}`, name: f.name, required: f.required, defaultValue: f.value ?? "", className: ui.input };
  return (
    <div>
      <label className={ui.label} htmlFor={common.id}>{f.label}</label>
      {f.kind === "textarea" ? (
        <textarea {...common} rows={4} />
      ) : f.kind === "select" ? (
        <select {...common}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      ) : (
        <input {...common} type={f.kind ?? "text"} />
      )}
      {f.help && <p className={ui.help}>{f.help}</p>}
    </div>
  );
}

export function AdminBlockForm({ instanceId, block, entry }: { instanceId: string; block: FormBlock; entry?: EntryScope }) {
  const [state, action, pending] = useActionState(runner(instanceId, block.action, entry), null);
  return (
    <form action={action} className={`${ui.card} space-y-4`}>
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
        <button type="submit" disabled={pending} className={ui.btnPrimary}>{block.submitLabel}</button>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn}>↩</a>}
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
    <form action={formAction}>
      <input type="hidden" name="id" value={id ?? ""} />
      <button disabled={pending} className={danger ? ui.btnDanger : ui.btn}
        onClick={async (e) => {
          if (!confirmText) return;
          // Boîte dans la page (jamais window.confirm : le navigateur la supprime en silence quand l'onglet n'est pas au premier plan).
          const form = e.currentTarget.form;
          e.preventDefault();
          if (await askConfirm(confirmText)) form?.requestSubmit();
        }}>{label}</button>
      {/* Le résultat d'un bouton de ligne ne se perd pas : une erreur dit quoi faire, une réussite le confirme. */}
      {state?.error && <p role="alert" className="mt-1 max-w-64 whitespace-normal text-xs text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-1 max-w-64 whitespace-normal text-xs text-emerald-700">{state.ok}</p>}
    </form>
  );
}
