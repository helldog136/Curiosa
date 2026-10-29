import { prisma } from "../db";
import { deleteSetting, getSetting, setSetting } from "../settings";

/**
 * MÉMOIRE D'UNE MISE À JOUR REFUSÉE. Quand le contrôle de chargement (loadCheck.ts) refuse une nouvelle version, l'ancienne est restée en place. Pour que la personne propriétaire
 * et l'assistant le sachent APRÈS coup (la page d'erreur disparaît au rechargement), on garde une ligne par module : quelle version a été refusée, quand, pourquoi.
 * Effacée à la prochaine mise à jour réussie, à la réinstallation réussie et à la désinstallation. Rien de secret : identifiants, versions et une raison courte sans chemin.
 */
export type BlockedUpdate = {
  at: string;
  /** Version restée en place. */
  from: string;
  /** Version refusée. */
  to: string;
  /** « install » : première installation (rien n'a été installé) ; « update » ; « reinstall ». */
  kind: "install" | "update" | "reinstall";
  /** Raison courte, en anglais, sans chemin du serveur. */
  reason: string;
};

const key = (id: string) => `module.${id}.__blockedUpdate`;

export async function readBlockedUpdate(id: string): Promise<BlockedUpdate | null> {
  const v = await getSetting<BlockedUpdate>(key(id)).catch(() => undefined);
  return v && typeof v.to === "string" && typeof v.reason === "string" ? v : null;
}

export async function clearBlockedUpdate(id: string): Promise<void> {
  await deleteSetting(key(id)).catch(() => {});
}

/** Écrit la mémoire ET une ligne du journal d'audit (`module.update.blocked`, acteur « system » : le refus est automatique). Ne lève jamais. */
export async function recordBlockedUpdate(id: string, info: Omit<BlockedUpdate, "at">, now: Date = new Date()): Promise<void> {
  if (info.kind !== "install") await setSetting(key(id), { ...info, at: now.toISOString() }).catch(() => {});
  const what = info.kind === "install" ? "install refused" : info.kind === "reinstall" ? "reinstall refused" : "update refused";
  await prisma.auditLog.create({ data: { actor: "system", action: "module.update.blocked", target: `${id} ${info.from || "-"} -> ${info.to} (${what}: load check failed, previous version kept) ${info.reason}`.slice(0, 480) } }).catch(() => {});
}

/** Journal (une ligne, jamais une pile) + mémoire + audit d'une version refusée. */
export async function noteBlockedUpdate(id: string, from: string, to: string, error: { reason: string }, kind: BlockedUpdate["kind"]): Promise<void> {
  console.error(`[modules] ${kind} of "${id}" ${to} refused, previous version kept: ${error.reason}`);
  await recordBlockedUpdate(id, { from, to, kind, reason: error.reason });
}
