"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { installSuggestedAction } from "@/app/admin/(panel)/instances/suggestActions";
import { AnimatedActionButton } from "./AnimatedActionButton";

type Labels = { install: string; installing: string; done: string; failed: string; extraWarning: string; trust: string };

/**
 * « Installer » d'un module suggéré : le bouton montre l'avancement (téléchargement, vérification…), puis la page de l'instance s'affiche avec le résultat.
 * Un module de l'index supplémentaire exige la case « je fais confiance » AVANT que le bouton s'active (le serveur la revérifie).
 */
export function SuggestInstallForm({ instanceId, service, moduleId, extra, labels }: { instanceId: string; service: string; moduleId: string; extra: boolean; labels: Labels }) {
  const router = useRouter();
  const [trusted, setTrusted] = useState(false);
  const [href, setHref] = useState<string | null>(null);
  return (
    <div className="mt-2 space-y-2">
      {extra && (
        <>
          <p className="text-sm">{labels.extraWarning}</p>
          <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} className="mt-1 h-4 w-4" />{labels.trust}</label>
        </>
      )}
      <AnimatedActionButton look="primary" icon="⬇" track="install" trackKey={`install:${moduleId}`} testid={`suggest-install-${moduleId}`} className="items-start"
        labels={{ idle: labels.install, working: labels.installing, done: labels.done, failed: labels.failed }}
        run={async (opId) => {
          if (extra && !trusted) return { ok: false, error: labels.trust };
          const r = await installSuggestedAction(instanceId, service, moduleId, extra && trusted, opId);
          setHref(r.href);
          return r.ok ? { ok: true } : { ok: false, error: r.error };
        }}
        onDone={() => { router.push(href ?? `/admin/instances/${encodeURIComponent(instanceId)}`); router.refresh(); }} />
    </div>
  );
}
