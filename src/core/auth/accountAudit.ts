import { prisma } from "../db";
import type { Level } from "./rights";

/**
 * Audit line about an account (invitation, reset, suspension). Never a token, a password or a link. `by` is the acting LEVEL (owner, coordinator, admin, editor, none, or
 * "visitor" for a public page): it is written in the structured `data` column, so the journal names the level that acted, not only the address.
 * A failed write never blocks the action (the journal is a record, not a gate) but is reported on the server console.
 */
export async function auditAccount(actor: string, by: Level | "visitor" | "system", action: string, target = "", extra: Record<string, string | number> = {}): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { actor: actor.slice(0, 200), action, target: target.slice(0, 300), actorKind: by === "system" ? "system" : "person", data: JSON.stringify({ by, ...extra }).slice(0, 500) } });
  } catch (error) {
    console.error("[audit] could not write", action, (error as Error)?.message);
  }
}
