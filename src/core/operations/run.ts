import crypto from "node:crypto";
import { isOwner, type AdminUser } from "@/core/permissions";
import { OperationBusy, OperationWaitTimeout, runOperation, type OpKind } from "./tracker";

export type Tracked<R> = { busy: false; joined: boolean; result: R } | { busy: true };

/**
 * À appeler par une action serveur APRÈS son contrôle de droits (même garde que l'action). Lance `fn` comme opération suivie de cette personne
 * (voir tracker.ts) : un second lancement avec la même clé rejoint l'opération en cours. `busy` : trop d'opérations en cours, ou celle qu'on rejoint
 * est trop longue à finir ; l'action répond alors « déjà en cours » au lieu d'attendre sans fin.
 */
export async function trackOperation<R>(
  user: Pick<AdminUser, "email">,
  spec: { kind: OpKind; key: string; opId?: unknown; unitTotal?: number },
  fn: () => Promise<R>,
  judge?: (result: R) => { ok: boolean; error?: string },
): Promise<Tracked<R>> {
  try {
    const r = await runOperation({ ...spec, owner: user.email, opId: typeof spec.opId === "string" ? spec.opId : null }, fn, judge);
    return { busy: false, joined: r.joined, result: r.result };
  } catch (error) {
    if (error instanceof OperationBusy || error instanceof OperationWaitTimeout) return { busy: true };
    throw error;
  }
}

/** Identifiant d'opération reçu d'un formulaire (champ `_op`) ou d'un paramètre : texte ou rien. */
export const opIdOf = (value: unknown): string | null => (typeof value === "string" && value.length <= 64 ? value : null);

/** Empreinte salée (sel propre au processus) d'une valeur secrète, pour fabriquer une clé de lancement unique SANS garder la valeur : ne sort jamais du processus. */
const salt = crypto.randomBytes(16);
export const secretKeyPart = (value: string): string => crypto.createHmac("sha256", salt).update(value).digest("hex").slice(0, 24);

export const viewerOf = (user: AdminUser): { email: string; owner: boolean } => ({ email: user.email, owner: isOwner(user) });
