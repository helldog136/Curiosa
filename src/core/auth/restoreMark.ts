/**
 * The moment of the last restore. A link (invitation or reset) made BEFORE it belongs to the timeline the restore replaced, so it is refused whatever the cleanup did:
 * correctness never depends on `withdrawAllLinks` having succeeded. Read straight from the database (never from a cache): it is a security decision.
 */
import { prisma } from "../db";

const KEY = "security.lastRestoreAt";

export async function markRestore(now = new Date()): Promise<void> {
  const value = JSON.stringify(now.toISOString());
  await prisma.setting.upsert({ where: { key_locale: { key: KEY, locale: "" } }, create: { key: KEY, locale: "", value }, update: { value } });
}

export async function lastRestoreAt(): Promise<Date | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key_locale: { key: KEY, locale: "" } }, select: { value: true } });
    if (!row) return null;
    const at = new Date(JSON.parse(row.value) as string);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}
