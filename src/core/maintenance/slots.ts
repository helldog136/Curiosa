import { prisma } from "@/core/db";
import { McpToolError } from "@/core/services/mcp/validate";
import { deps } from "./deps";

/**
 * RATE LIMITS of the actions an AI access takes (one small shared API, used by the maintenance actions, the content writers, media and site settings).
 *
 * Two classes with separate counters, per access, over a rolling hour:
 *   risky    install, update, uninstall, core update, skins, a new instance, reinstall, restart (they bring code or change the whole site): 12 per hour by default;
 *   content  publish / unpublish, media, site settings, menu and home page, module settings, fonts and colours, content check, backups: 120 per hour by default.
 * The owner can reset the counters of an access, and change its two limits (bounded), in Admin > AI assistants > the access.
 * In memory (no timer, nothing to clean): a restart of the site gives a fresh hour, which only ever errs on the side of the owner's convenience.
 */
export type SlotClass = "risky" | "content";
export const SLOT_CLASSES: readonly SlotClass[] = ["risky", "content"];
export const DEFAULT_LIMITS: Record<SlotClass, number> = { risky: 12, content: 120 };
export const LIMIT_BOUNDS: Record<SlotClass, readonly [number, number]> = { risky: [1, 60], content: [10, 1000] };
export const WINDOW_MS = 3_600_000;
const KEY = "maintenance.limits";

const g = globalThis as unknown as { curiosaSlotHits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.curiosaSlotHits ??= new Map<string, number[]>());
const hitKey = (tokenId: string | undefined, cls: SlotClass) => `${tokenId ?? "unknown"}:${cls}`;

export type Limits = Record<SlotClass, number>;
const clamp = (cls: SlotClass, v: unknown): number => {
  const [lo, hi] = LIMIT_BOUNDS[cls];
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULT_LIMITS[cls];
};

async function readAll(): Promise<Record<string, Partial<Limits>>> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: KEY, locale: "" } } });
  if (!row) return {};
  try { const v = JSON.parse(row.value); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** The two limits of an access: its own setting, bounded, else the defaults. */
export async function getLimits(tokenId: string | undefined): Promise<Limits> {
  const own = (tokenId && (await readAll())[tokenId]) || {};
  return { risky: own.risky === undefined ? DEFAULT_LIMITS.risky : clamp("risky", own.risky), content: own.content === undefined ? DEFAULT_LIMITS.content : clamp("content", own.content) };
}

/** Owner only (the caller checked the right). Values are bounded; a value equal to the default is not stored. */
export async function setLimits(tokenId: string, limits: Partial<Limits>): Promise<Limits> {
  const all = await readAll();
  const next: Partial<Limits> = { ...all[tokenId] };
  for (const cls of SLOT_CLASSES) if (limits[cls] !== undefined) next[cls] = clamp(cls, limits[cls]);
  for (const cls of SLOT_CLASSES) if (next[cls] === DEFAULT_LIMITS[cls]) delete next[cls];
  if (Object.keys(next).length) all[tokenId] = next; else delete all[tokenId];
  const json = JSON.stringify(all);
  await prisma.setting.upsert({ where: { key_locale: { key: KEY, locale: "" } }, create: { key: KEY, locale: "", value: json }, update: { value: json } });
  return getLimits(tokenId);
}

const recent = (tokenId: string | undefined, cls: SlotClass): number[] => {
  const now = deps.now();
  const list = (hits.get(hitKey(tokenId, cls)) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.set(hitKey(tokenId, cls), list);
  return list;
};

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Takes one slot of this class for this access, or throws a plain message that says what to do. */
export async function takeSlot(tokenId: string | undefined, cls: SlotClass = "risky"): Promise<void> {
  const limit = (await getLimits(tokenId))[cls];
  const list = recent(tokenId, cls);
  if (list.length >= limit) {
    const wait = minutes(list[0]! + WINDOW_MS - deps.now());
    throw new McpToolError(`Limit reached: ${limit} ${cls === "risky" ? "risky" : "content"} actions per hour for this access. Next slot in ${wait} min, or the owner can reset it in Admin > AI assistants.`);
  }
  list.push(deps.now());
}

export type SlotState = { limit: number; used: number; remaining: number; nextSlotInMinutes: number | null };

/** Per class: the limit, what is left, and when the next slot frees up (null while some are left). */
export async function remainingSlots(tokenId: string | undefined): Promise<Record<SlotClass, SlotState>> {
  const limits = await getLimits(tokenId);
  const out = {} as Record<SlotClass, SlotState>;
  for (const cls of SLOT_CLASSES) {
    const list = recent(tokenId, cls);
    const remaining = Math.max(0, limits[cls] - list.length);
    out[cls] = { limit: limits[cls], used: list.length, remaining, nextSlotInMinutes: remaining > 0 ? null : minutes(list[0]! + WINDOW_MS - deps.now()) };
  }
  return out;
}

/** Forgets the counters of one access (both classes). */
export function resetSlots(tokenId: string): void {
  for (const cls of SLOT_CLASSES) hits.delete(hitKey(tokenId, cls));
}

/** Tests: forgets every counter. */
export function resetAllSlots(): void { hits.clear(); }
