import { revalidatePath } from "next/cache";
import { prisma } from "@/core/db";
import { getSetting, setSetting } from "@/core/settings";
import { McpToolError } from "@/core/services/mcp/validate";
import { takeSlot } from "./slots";

/**
 * CORRECTING THE SUMMARY OF A PUBLISHED ENTRY, for an AI (`<instance>__update_published_meta`).
 *
 * The data model only has a `summary` per language version (no separate description or SEO field), so that is the one thing this tool can change.
 * The rules that make it safe, and that the tests check:
 *  - the input is `id`, `locale` and `summary` only: no title, slug, body, status or link, and no unknown property;
 *  - it only touches a PUBLISHED entry of the instance the tool belongs to (a draft has `update_draft`; another instance's entry is "not found");
 *  - the entry stays published the whole time: one write, the summary of one language version;
 *  - one slot of the shared "content" hourly class, like the other content writes;
 *  - the journal (`entry.meta.update`, target `<instance>/<entry id>`) keeps the language and the LENGTHS before and after, never the text;
 *  - a restore point keeps the previous summary: the previous text is put back only while nobody edited that version since (see `restoreEntrySummary`).
 */
export const UNDO_KEY = "mcp.undo.entryMeta";
/** The restore points kept (the oldest are forgotten): small, and enough for a work session. */
export const MAX_UNDO_POINTS = 20;

export type EntrySummaryUndo = { at: number; by: string; key: string; id: string; locale: string; previous: string; applied: string };

export const loadSummaryUndoPoints = async (): Promise<EntrySummaryUndo[]> => {
  const v = await getSetting<unknown>(UNDO_KEY);
  return Array.isArray(v) ? v.filter((p): p is EntrySummaryUndo => !!p && typeof p === "object" && typeof (p as EntrySummaryUndo).previous === "string" && typeof (p as EntrySummaryUndo).applied === "string" && typeof (p as EntrySummaryUndo).id === "string") : [];
};

/** Updates the summary of one language version of a published entry. */
export async function updatePublishedSummary(
  instance: { id: string; key: string },
  actor: { name: string; tokenId?: string },
  args: { id: string; locale: string; summary: string },
): Promise<{ id: string; status: "published"; locale: string; changed: boolean; note: string }> {
  await takeSlot(actor.tokenId, "content");
  const entry = await prisma.entry.findFirst({ where: { id: args.id, instanceId: instance.id }, include: { translations: true } });
  if (!entry) throw new McpToolError("entry not found");
  if (entry.status !== "published") throw new McpToolError("this entry is a draft: edit it with update_draft. This tool only corrects the summary of a published entry.");
  const tr = entry.translations.find((t) => t.locale === args.locale);
  if (!tr) throw new McpToolError(`there is no ${args.locale} version of this entry. Languages that exist: ${entry.translations.map((t) => t.locale).join(", ")}. A new language version is added with update_draft after returning the entry to draft.`);
  if (tr.summary === args.summary) return { id: entry.id, status: "published", locale: args.locale, changed: false, note: "The summary was already like this; nothing changed." };

  // Compare-and-swap on the previous value: a person saving at the same moment is never overwritten silently.
  const done = await prisma.entryTranslation.updateMany({ where: { id: tr.id, summary: tr.summary }, data: { summary: args.summary } });
  if (done.count !== 1) throw new McpToolError("the entry was edited at the same moment; read it again with get_entry and retry");
  const points = (await loadSummaryUndoPoints()).filter((p) => !(p.id === entry.id && p.locale === args.locale));
  points.push({ at: Date.now(), by: actor.name, key: instance.key, id: entry.id, locale: args.locale, previous: tr.summary, applied: args.summary });
  await setSetting(UNDO_KEY, points.slice(-MAX_UNDO_POINTS));
  await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, actorKind: "assistant", action: "entry.meta.update", target: `${instance.key}/${entry.id}`, instance: instance.key, data: JSON.stringify({ locale: args.locale, lengthBefore: tr.summary.length, lengthAfter: args.summary.length }) } }).catch(() => {});
  try { revalidatePath("/", "layout"); } catch { /* outside a request (tests, scripts): the page is read again at the next visit */ }
  return { id: entry.id, status: "published", locale: args.locale, changed: true, note: "Summary updated; the entry stayed published. The owner can put the previous summary back until someone edits it again." };
}

/** Puts the previous summary back, only while the version still has the text the AI wrote (nobody edited it since). */
export async function restoreEntrySummary(key: string, id: string, locale: string): Promise<{ ok: true } | { ok: false; reason: "none" | "changed" }> {
  const points = await loadSummaryUndoPoints();
  const p = points.find((x) => x.key === key && x.id === id && x.locale === locale);
  if (!p) return { ok: false, reason: "none" };
  const done = await prisma.entryTranslation.updateMany({ where: { entryId: id, locale, summary: p.applied }, data: { summary: p.previous } });
  if (done.count !== 1) return { ok: false, reason: "changed" };
  await setSetting(UNDO_KEY, points.filter((x) => x !== p));
  return { ok: true };
}
