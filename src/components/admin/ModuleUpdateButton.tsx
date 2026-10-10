"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { checkUpdateAction, updateModuleAction } from "@/app/admin/(panel)/modules/actions";
import { AnimatedActionButton } from "./AnimatedActionButton";
import { sleep } from "./animatedAction";

type Labels = { idle: string; working: string; done: string; failed: string };

/** « Chercher une mise à jour » / « Mettre à jour » d'un module : même animation que l'installation, puis la page des modules affiche le résultat. */
export function ModuleUpdateButton({ id, kind, labels }: { id: string; kind: "check" | "update"; labels: Labels }) {
  const router = useRouter();
  // L'action dit où aller ensuite (page du module, avec le résultat ou l'erreur) ; on y va après l'animation.
  const target = useRef(`/admin/modules/${id}`);
  return (
    <AnimatedActionButton look="secondary" progress={kind === "update" ? "continuous" : "fill"} icon={kind === "update" ? "⬆" : "🔍"} testid={`module-${kind}-${id}`} labels={labels}
      run={async () => { const r = await (kind === "update" ? updateModuleAction(id) : checkUpdateAction(id)); target.current = r.href; return { ok: r.ok }; }}
      onDone={() => { router.push(target.current); router.refresh(); }}
      onFail={async () => { await sleep(1200); router.push(target.current); router.refresh(); }} />
  );
}
