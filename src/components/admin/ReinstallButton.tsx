"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { compareSourceAction, reinstallModuleAction } from "@/app/admin/(panel)/modules/maintenanceActions";
import { AnimatedActionButton } from "./AnimatedActionButton";

type Labels = { button: string; working: string; done: string; failed: string; confirm: string; compare: string; comparing: string; compared: string; compareFailed: string; identical: string; different: string };

/** « Réinstaller ce module » (avec confirmation dans la page) et, pour un module git, « Comparer avec la source ». Le bilan reste affiché sous le bouton après le rechargement de la page. */
export function ReinstallButton({ id, labels, canCompare }: { id: string; labels: Labels; canCompare: boolean }) {
  const router = useRouter();
  const [report, setReport] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [compared, setCompared] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <AnimatedActionButton look="secondary" progress="continuous" icon="🛠" testid={`module-reinstall-${id}`} confirm={labels.confirm}
          labels={{ idle: labels.button, working: labels.working, done: labels.done, failed: labels.failed }}
          run={async () => {
            const r = await reinstallModuleAction(id);
            setReport(r);
            setCompared(null);
            return { ok: r.ok, error: r.ok ? undefined : r.lines.join(" ") };
          }}
          onDone={() => router.refresh()}
          onFail={() => router.refresh()} />
        {canCompare && (
          <AnimatedActionButton look="secondary" progress="fill" icon="🔍" testid={`module-compare-${id}`}
            labels={{ idle: labels.compare, working: labels.comparing, done: labels.compared, failed: labels.compareFailed }}
            run={async () => {
              const r = await compareSourceAction(id);
              setCompared(r.state === "identical" ? labels.identical : r.state === "different" ? labels.different.replace("{version}", r.sourceVersion ?? "?") : null);
              return { ok: r.ok };
            }} />
        )}
      </div>
      {compared && <p role="status" data-testid="compare-result" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">{compared}</p>}
      {report && (
        <div role={report.ok ? "status" : "alert"} data-testid="reinstall-report" className={`space-y-1 rounded-lg border px-3 py-2 text-sm ${report.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          {report.lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}
    </div>
  );
}
