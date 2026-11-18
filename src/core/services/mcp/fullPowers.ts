import { setSetting } from "@/core/settings";
import { prisma } from "@/core/db";

/**
 * FULL POWERS of an AI access (core 0.35.0). A flag per access, kept as a core setting (a list of access ids, like the secret-address list in tokens.ts):
 * no column, so no migration, and it is part of the access settings, not of the rights (`grants`), which a rights page edit can never touch.
 *
 *  - WHO SETS IT: only the owner, in the admin (`setFullPowersAction`, which checks `adminCtx("owner")`). THIS FILE'S SETTER IS IMPORTED BY NOTHING ELSE that an assistant can
 *    reach: no MCP tool, no module action, no import. A test reads the source tree and fails if another file imports `setFullPowers`.
 *  - EFFECT: `canUse` (access.ts) grants every tool of the catalogue at the moment of the request. Nothing is copied into `grants`.
 *  - ONLY a write access can hold it (the ceiling of a read-only access is never raised).
 *  - BACKUPS: never in a backup, and a restore switches it off everywhere (the settings are replaced, and the key is filtered out of the file).
 */
export const FULL_POWERS_KEY = "mcp.fullPowers";

/** Read straight from the database, never from the settings cache: turning it off must take effect on the very next request, in any process. */
export async function fullPowersIds(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: FULL_POWERS_KEY, locale: "" } } });
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export async function hasFullPowers(id: string): Promise<boolean> {
  return (await fullPowersIds()).includes(id);
}

/**
 * Turns it on or off for one ACTIVE access. The caller (an owner-only admin action) has checked who is asking. Returns false when nothing could change
 * (unknown or revoked access, or a read-only one for "on"). Turning off always works for any id still in the list.
 */
export async function setFullPowers(id: string, on: boolean): Promise<boolean> {
  const ids = await fullPowersIds();
  if (!on) {
    if (!ids.includes(id)) return true;
    await setSetting(FULL_POWERS_KEY, ids.filter((x) => x !== id));
    return true;
  }
  const row = await prisma.apiToken.findUnique({ where: { id }, select: { scope: true, revokedAt: true } });
  if (!row || row.revokedAt || row.scope !== "write") return false;
  if (!ids.includes(id)) await setSetting(FULL_POWERS_KEY, [...ids, id]);
  return true;
}

/** The active accesses that hold full powers (for the badges and the banner). A revoked or read-only access never shows. */
export async function accessesWithFullPowers(): Promise<{ id: string; name: string }[]> {
  const ids = await fullPowersIds();
  if (!ids.length) return [];
  const rows = await prisma.apiToken.findMany({ where: { id: { in: ids }, revokedAt: null, scope: "write" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return rows;
}
