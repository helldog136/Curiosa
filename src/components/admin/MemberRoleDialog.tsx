"use client";

import { useCallback, useState } from "react";
import { ActionForm, type ActionState } from "./ActionForm";
import { FormDialog } from "./FormDialog";
import { MoreOptions } from "./MoreOptions";
import { ui } from "./ui";

export type RoleOption = { id: string; name: string; /** Une phrase : ce que ce rôle permet. */ summary: string };
export type MemberRoleLabels = {
  open: string; title: string; intro: string; closeLabel: string; submit: string; pending: string;
  /** « Rôle de base » : le niveau (un seul). */
  base: string;
  /** Option « aucun rôle de base » (seulement quand il y a des rôles en plus). */
  noBase: string; noBaseSummary: string;
  extra: string; extraSummary: string;
  /** Aperçu : « Ce qui change pour {name} ». */
  changeTitle: string; same: string; loses: string; gains: string;
};

/**
 * CHANGER LE RÔLE d'une personne depuis sa ligne (règles R3, R17, R24). Un rôle de base (choix unique) et, repliés sous « Rôles en plus », les rôles personnalisés
 * cumulables. Avant d'enregistrer, un aperçu dit CE QUE LA PERSONNE PERD ET CE QU'ELLE GAGNE. Le serveur reçoit les mêmes champs `roleId` que l'ancien formulaire
 * et revérifie tout (core/auth/roles.ts) : cette boîte ne décide de rien.
 */
export function MemberRoleDialog({ memberName, action, base, extra, held, allowNoBase, labels }: {
  memberName: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  base: RoleOption[];
  extra: RoleOption[];
  /** Identifiants des rôles que la personne a aujourd'hui. */
  held: string[];
  allowNoBase: boolean;
  labels: MemberRoleLabels;
}) {
  const heldBase = base.find((b) => held.includes(b.id))?.id ?? "";
  const [pickedBase, setPickedBase] = useState(heldBase);
  const [pickedExtra, setPickedExtra] = useState<string[]>(() => extra.filter((e) => held.includes(e.id)).map((e) => e.id));
  const [done, setDone] = useState(false);
  const reset = useCallback(() => { setDone(false); }, []);

  const now = new Set([pickedBase, ...pickedExtra].filter(Boolean));
  const before = new Set(held);
  const all = new Map([...base, ...extra].map((r) => [r.id, r] as const));
  const lost = [...before].filter((id) => !now.has(id) && all.has(id)).map((id) => all.get(id)!);
  const gained = [...now].filter((id) => !before.has(id)).map((id) => all.get(id)!);

  const run = useCallback(async (prev: ActionState, data: FormData) => {
    const r = await action(prev, data);
    if (r?.ok) setDone(true);
    return r;
  }, [action]);

  const title = labels.title.replace("{name}", memberName);
  return (
    <FormDialog trigger={labels.open} triggerLabel={`${labels.open} : ${memberName}`} title={title} intro={labels.intro} closeLabel={labels.closeLabel} closeWhen={done} onClose={reset} testid="member-role-open">
      <ActionForm action={run} submitLabel={labels.submit} pendingLabel={labels.pending} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[15px] font-medium">{labels.base}</legend>
          {/* Le choix de base part sous le même nom que les rôles en plus (`roleId`), comme avant ; « aucun » n'envoie rien. */}
          {pickedBase && <input type="hidden" name="roleId" value={pickedBase} />}
          {[...(allowNoBase ? [{ id: "", name: labels.noBase, summary: labels.noBaseSummary }] : []), ...base].map((r) => (
            <label key={r.id || "none"} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg/40 p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input type="radio" name="base" value={r.id} checked={pickedBase === r.id} onChange={() => setPickedBase(r.id)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--v-accent)]" />
              <span className="min-w-0"><span className="block font-medium">{r.name}</span><span className="block text-muted">{r.summary}</span></span>
            </label>
          ))}
        </fieldset>
        {extra.length > 0 && (
          <MoreOptions title={labels.extra} summary={labels.extraSummary} count={pickedExtra.length} defaultOpen={pickedExtra.length > 0}>
            <div className="space-y-2">
              {extra.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" name="roleId" value={r.id} checked={pickedExtra.includes(r.id)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--v-accent)]"
                    onChange={(e) => setPickedExtra((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} />
                  <span className="min-w-0"><span className="block font-medium">{r.name}</span><span className="block text-muted">{r.summary}</span></span>
                </label>
              ))}
            </div>
          </MoreOptions>
        )}
        <div className={`${ui.card} space-y-2 !p-4 text-sm`} role="status" aria-live="polite" data-testid="role-diff">
          <p className="font-medium">{labels.changeTitle.replace("{name}", memberName)}</p>
          {lost.length === 0 && gained.length === 0 ? <p className="text-muted">{labels.same}</p> : (
            <ul className="space-y-1.5">
              {lost.map((r) => <li key={`l${r.id}`}><span className="font-medium text-red-700">− {labels.loses}</span> {r.name}<span className="block text-muted">{r.summary}</span></li>)}
              {gained.map((r) => <li key={`g${r.id}`}><span className="font-medium text-emerald-700">+ {labels.gains}</span> {r.name}<span className="block text-muted">{r.summary}</span></li>)}
            </ul>
          )}
        </div>
      </ActionForm>
    </FormDialog>
  );
}
