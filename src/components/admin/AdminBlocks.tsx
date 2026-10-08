"use client";

import { useActionState } from "react";
import type { AdminField, Block } from "@/core/blocks";
import { ImageField } from "./ImageField";
import { ui } from "./ui";
import { runModuleAdminAction } from "@/app/admin/(panel)/instances/module-actions";

type FormBlock = Extract<Block, { type: "adminForm" }>;

/** Rend un champ déclaré par un module (formulaires d'admin pilotés par les modules). */
function Field({ f }: { f: AdminField }) {
  if (f.kind === "hidden") return <input type="hidden" name={f.name} value={f.value ?? ""} />;
  if (f.kind === "image") return <ImageField name={f.name} label={f.label} defaultValue={f.value} uploadLabel="↑" />;
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

export function AdminBlockForm({ instanceId, block }: { instanceId: string; block: FormBlock }) {
  const [state, action, pending] = useActionState(runModuleAdminAction.bind(null, instanceId, block.action), null);
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

export function RowActionButton({ instanceId, label, action, href, id, confirm: confirmText, danger }: {
  instanceId: string; label: string; action?: string; href?: string; id?: string; confirm?: string; danger?: boolean;
}) {
  const [, formAction, pending] = useActionState(runModuleAdminAction.bind(null, instanceId, action ?? ""), null);
  if (href) return <a href={href} className={ui.btn}>{label}</a>;
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id ?? ""} />
      <button disabled={pending} className={danger ? ui.btnDanger : ui.btn}
        onClick={(e) => { if (confirmText && !confirm(confirmText)) e.preventDefault(); }}>{label}</button>
    </form>
  );
}
