"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateModulesAction, type ModulesBilan } from "@/app/admin/(panel)/updates/actions";
import { AnimatedActionButton } from "./AnimatedActionButton";
import { sleep } from "./animatedAction";
import { ui } from "./ui";

export type ModuleUpdateRow = { id: string; name: string; icon: string; current: string; target: string; major: boolean; levelLabel: string; /** La version proposée demande un cœur plus récent : pas de bouton, un message. */ needsCore?: string };
type Labels = {
  all: { idle: string; working: string; done: string; failed: string };
  one: { idle: string; working: string; done: string; failed: string };
  confirmAll: string;
  /** Avec {name} : confirmation d'un seul module (changement majeur). */
  confirmMajor: string;
  incomplete: string;
  updatedLine: string;   // {n} {names}
  failedLine: string;    // {name} {reason}
  stoppedLine: string;   // {name}
  skippedLine: string;   // {names}
  incompatLine: string;  // {names}
  needsCore: string;     // {version}
};

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** La liste des modules en retard, « Tout mettre à jour » (un par un, côté serveur) et un bouton par module ; le bilan reste affiché après l'action. */
export function ModulesUpdates({ rows, labels }: { rows: ModuleUpdateRow[]; labels: Labels }) {
  const router = useRouter();
  const [bilan, setBilan] = useState<ModulesBilan | null>(null);
  // Les boutons passent par le même chemin : le serveur met à jour, le bilan s'affiche, la liste se rafraîchit.
  const go = (ids?: string[]) => async () => {
    try {
      const b = await updateModulesAction(ids);
      setBilan(b);
      return b.failed.length === 0 ? { ok: true } : { ok: false, error: labels.incomplete };
    } catch {
      return { ok: false, error: labels.incomplete };
    }
  };
  const after = { onDone: () => router.refresh(), onFail: async () => { await sleep(1200); router.refresh(); } };

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg" data-testid="modules-outdated">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium"><span aria-hidden>{r.icon}</span> {r.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{r.current} → <strong className="font-semibold text-fg">{r.target}</strong></span>
                    {r.levelLabel && <span className={r.major ? ui.chipWarn : ui.chip}>{r.levelLabel}</span>}
                  </p>
                </div>
                {r.needsCore
                  ? <p className="text-sm text-muted" data-testid={`modules-needs-core-${r.id}`}>{fill(labels.needsCore, { version: r.needsCore })}</p>
                  : <AnimatedActionButton look="secondary" progress="continuous" icon="⬆" testid={`modules-update-${r.id}`} labels={labels.one}
                      confirm={r.major ? fill(labels.confirmMajor, { name: r.name }) : undefined} run={go([r.id])} {...after} />}
              </li>
            ))}
          </ul>
          <div className="flex justify-center sm:justify-start">
            <AnimatedActionButton look="primary" progress="continuous" icon="⬆" testid="modules-update-all" labels={labels.all}
              confirm={fill(labels.confirmAll, { n: rows.length })} run={go()} {...after} />
          </div>
        </>
      )}

      {bilan && (
        <div role="status" data-testid="modules-bilan" className="space-y-1.5 rounded-xl border border-line bg-bg p-4 text-sm leading-6">
          {bilan.updated.length > 0 && <p>✅ {fill(labels.updatedLine, { n: bilan.updated.length, names: bilan.updated.join(", ") })}</p>}
          {bilan.failed.map((f) => <p key={f.name} className="text-red-700">❌ {fill(labels.failedLine, { name: f.name, reason: f.reason })}</p>)}
          {bilan.stoppedOn && <p className="font-medium">⏸️ {fill(labels.stoppedLine, { name: bilan.stoppedOn })}</p>}
          {bilan.incompatible && bilan.incompatible.length > 0 && <p className="text-muted">🕒 {fill(labels.incompatLine, { names: bilan.incompatible.map((i) => i.name).join(", ") })}</p>}
          {bilan.skipped.length > 0 && <p className="text-muted">{fill(labels.skippedLine, { names: bilan.skipped.join(", ") })}</p>}
        </div>
      )}
    </div>
  );
}
