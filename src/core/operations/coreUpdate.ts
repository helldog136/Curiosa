import type { OpSnapshot } from "./tracker";
import type { UpdateState } from "@/core/updates/service";

/**
 * Suivi de la mise à jour DU SITE. Contrairement aux autres opérations, son état n'est pas en mémoire : la mise à jour tourne dans une tâche détachée qui
 * l'écrit dans un fichier (scripts/update-lib.mjs) et le site redémarre en cours de route. On le lit donc sur le disque, ce qui survit au redémarrage.
 */
export const CORE_OP_ID = "core-update";
/** Étapes de la mise à jour du site, dans l'ordre (texte : `progress.step.core.<id>`). */
export const CORE_STEPS = ["backup", "download", "verify", "swap", "migrate", "restarting", "waiting"] as const;

export type CoreUpdateSnapshot = OpSnapshot & {
  /** Le site va redémarrer (ou redémarre) : la page peut cesser de répondre un instant. */
  restarting: boolean;
  /** Numéro de version attendu après redémarrage (sans « v »), pour reconnaître le nouveau site. */
  expectedVersion: string | null;
  /** Mise à jour revenue en arrière (échec) : l'ancienne version tourne toujours. */
  rolledBack: boolean;
};

export function coreUpdateSnapshot(state: UpdateState, now = Date.now()): CoreUpdateSnapshot {
  const running = state.status === "running";
  const steps = [...CORE_STEPS];
  const known = (CORE_STEPS as readonly string[]).indexOf(state.step ?? "");
  const total = Math.max(1, state.chain?.total ?? 1);
  const index = Math.min(total, Math.max(1, state.chain?.index ?? 1));
  const stepIndex = known === -1 ? 0 : known + 1;
  const done = state.status === "success";
  const within = known === -1 ? 0 : known / steps.length;
  const fraction = done ? 1 : running ? Math.min(0.99, (index - 1 + within) / total) : null;
  return {
    id: CORE_OP_ID, kind: "core-update", state: running ? "running" : done ? "done" : state.status === "failed" ? "failed" : "done",
    steps, step: known === -1 ? null : (state.step as string), stepIndex,
    unit: total > 1 ? { index, total, name: "" } : null,
    fraction,
    // Seul le code d'erreur court (« checksum-mismatch », « step-failed:swap »…) sort d'ici ; la page le traduit. Jamais de chemin.
    error: state.status === "failed" ? String(state.error ?? "failed").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 60) || "failed" : null,
    startedAt: state.startedAt ?? now, updatedAt: state.finishedAt ?? now,
    restarting: running && (state.step === "restarting" || state.step === "waiting"),
    expectedVersion: typeof state.expectedVersion === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(state.expectedVersion) ? state.expectedVersion : null,
    rolledBack: state.rolledBack === true,
  };
}
