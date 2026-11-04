import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { getActiveInstances } from "@/core/modules/registry";
import type { JsonSchemaLite } from "@/core/modules/types";
import { getSiteConfig } from "@/core/settings";
import { McpToolError } from "@/core/services/mcp/validate";
import type { Outcome } from "./actions";
import { redactSecrets } from "./redact";
import type { Plan } from "./requests";

/**
 * PUBLISHING AND UNPUBLISHING an entry of a content module, for an AI (`<instance>__publish`, `<instance>__unpublish`; level 3 requests).
 *
 * The rules that make this safe, and that the tests check:
 *  - it only publishes an EXISTING DRAFT, by id, of the instance the tool belongs to (an entry of another instance is "not found"); it only unpublishes a published entry;
 *  - it NEVER edits content: the one write is the status of the entry (and the publication date when it had none). A published entry is never overwritten;
 *  - same validation as the admin's Publish button: every language version has a title; and when the instance wants each language to be written
 *    (`fallbackToDefault: false`), every language of the site must exist. A missing version is refused with the languages named, never published "half";
 *  - it FOLLOWS the approval setting of the access, exactly like updates and uninstalls (see `callLevel3`): "I approve every request" -> a request the owner approves in
 *    Admin > AI assistants, "act without asking" -> done at once;
 *  - what the owner approves is what is published: the request holds a fingerprint of the texts; a draft edited afterwards is not published (ask again);
 *  - the journal gets who / what / when (`entry.publish` with `<instance>/<entry id>`), never a title or a text.
 */
export const MAX_ENTRIES_PER_CALL = 12;

export function publishInput(locales: string[]): JsonSchemaLite {
  return {
    type: "object",
    properties: {
      id: { type: "string", maxLength: 60, description: "Identifier of the entry, as returned by list_entries or create_draft." },
      ids: { type: "array", items: { type: "string" }, description: `Several entries at once (at most ${MAX_ENTRIES_PER_CALL}), one request for all of them. Use id or ids.` },
      locale: { type: "string", enum: locales, description: "Optional: demand that this language version exists and is complete. The entry is published as a whole, all its languages together." },
    },
  };
}

type Item = { id: string; title: string; locales: string[]; fp: string };

/** A fingerprint of the texts of an entry (not the texts): lets the approval cover exactly what the owner saw. */
function fingerprint(translations: { locale: string; title: string; summary: string; body: string }[]): string {
  const rows = translations.map((t) => [t.locale, t.title, t.summary, t.body]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}

const idList = (args: { id?: unknown; ids?: unknown }): string[] => {
  const raw = Array.isArray(args.ids) ? args.ids : args.id !== undefined ? [args.id] : [];
  if (Array.isArray(args.ids) && args.id !== undefined) raw.push(args.id);
  const ids = [...new Set(raw.map((v) => (typeof v === "string" ? v.trim() : "")))].filter(Boolean);
  if (!ids.length) throw new McpToolError('Give the "id" of the entry (or "ids" for several).');
  if (ids.length > MAX_ENTRIES_PER_CALL) throw new McpToolError(`At most ${MAX_ENTRIES_PER_CALL} entries per call.`);
  return ids;
};

/** Read only: checks every entry and freezes what the owner will be asked to approve. Refuses everything if one entry is not acceptable (nothing partial). */
export async function prepareEntryPublish(action: "entry_publish" | "entry_unpublish", args: { instance?: unknown; id?: unknown; ids?: unknown; locale?: unknown }): Promise<Plan> {
  const publish = action === "entry_publish";
  const active = (await getActiveInstances()).find((a) => a.instance.key === args.instance);
  if (!active || !active.mod.manifest.content) throw new McpToolError("Unknown content instance.");
  const { instance } = active;
  const config = await getSiteConfig();
  const locale = typeof args.locale === "string" && args.locale ? args.locale : undefined;
  if (locale && !config.locales.includes(locale)) throw new McpToolError(`Unknown language "${redactSecrets(locale, 12)}". The site languages are: ${config.locales.join(", ")}.`);

  const ids = idList(args);
  // Only entries of THIS instance are visible: another instance's entry is "not found", exactly as for the other content tools.
  const rows = await prisma.entry.findMany({ where: { id: { in: ids }, instanceId: instance.id }, include: { translations: true } });
  const problems: string[] = [];
  const items: Item[] = [];
  for (const id of ids) {
    const e = rows.find((r) => r.id === id);
    if (!e) { problems.push(`${id}: entry not found`); continue; }
    if (publish && e.status !== "draft") { problems.push(`${id}: it is already published; nothing to do (its content is never overwritten through MCP)`); continue; }
    if (!publish && e.status !== "published") { problems.push(`${id}: it is a draft already; nothing to do`); continue; }
    if (publish) {
      const bare = e.translations.filter((t) => !t.title.trim()).map((t) => t.locale);
      if (!e.translations.length || bare.length) { problems.push(`${id}: ${bare.length ? `the ${bare.join(", ")} version has no title` : "it has no text"}; fix it with update_draft first`); continue; }
      if (locale && !e.translations.some((t) => t.locale === locale)) { problems.push(`${id}: there is no ${locale} version yet; add it with update_draft (locale: "${locale}") first`); continue; }
      // The instance asks for each language to be written: a missing version would leave a hole on the public site.
      const missing = instance.fallbackToDefault ? [] : config.locales.filter((l) => !e.translations.some((t) => t.locale === l));
      if (missing.length) { problems.push(`${id}: the ${missing.join(", ")} version is missing and this site shows each language only when it is written; add it with update_draft (locale) first, nothing was published`); continue; }
    }
    const shown = e.translations.find((t) => t.locale === config.defaultLocale) ?? e.translations[0];
    items.push({ id: e.id, title: redactSecrets(shown?.title ?? "", 80), locales: e.translations.map((t) => t.locale).sort(), fp: fingerprint(e.translations) });
  }
  if (problems.length) throw new McpToolError(`Not ${publish ? "published" : "unpublished"}: ${problems.join("; ")}.`);
  return { entry: { instance: instance.key, ...(locale ? { locale } : {}), items } };
}

/** After the owner's approval (or at once in "act without asking"): re-reads the entries, and flips only the status of those that are still what was requested. */
export async function executeEntryPublish(action: "entry_publish" | "entry_unpublish", plan: Plan, actorLabel: string): Promise<Outcome> {
  const publish = action === "entry_publish";
  const wanted = plan.entry!;
  const done: string[] = [];
  const skipped: string[] = [];
  let fresh: Plan;
  try { fresh = await prepareEntryPublish(action, { instance: wanted.instance, ids: wanted.items.map((i) => i.id), locale: wanted.locale }); } catch (error) {
    if (error instanceof McpToolError) return { ok: false, message: `Not done: ${error.message}` };
    throw error;
  }
  const active = (await getActiveInstances()).find((a) => a.instance.key === wanted.instance);
  for (const item of wanted.items) {
    const now = fresh.entry!.items.find((i) => i.id === item.id);
    // The texts changed after the request (the AI edited the draft again): the owner approved something else.
    if (!now || now.fp !== item.fp) { skipped.push(item.id); continue; }
    // Like the admin: a date set by a person (a scheduled publication) is kept; otherwise it is now.
    const had = (await prisma.entry.findUnique({ where: { id: item.id }, select: { publishedAt: true } }))?.publishedAt;
    // updateMany with the expected status: two executions can never both succeed.
    const r = await prisma.entry.updateMany({
      where: { id: item.id, instanceId: active!.instance.id, status: publish ? "draft" : "published" },
      data: publish ? { status: "published", publishedAt: had ?? new Date() } : { status: "draft" },
    });
    if (r.count !== 1) { skipped.push(item.id); continue; }
    await prisma.auditLog.create({ data: { actor: actorLabel, actorKind: "assistant", action: publish ? "entry.publish" : "entry.unpublish", target: `${wanted.instance}/${item.id}`, module: active!.mod.manifest.id, instance: wanted.instance } }).catch(() => {});
    done.push(item.id);
  }
  const verb = publish ? "published" : "returned to draft";
  if (!done.length) return { ok: false, message: `Not done: ${skipped.length === 1 ? "the entry changed" : "the entries changed"} since the request (or ${publish ? "are no longer drafts" : "are no longer published"}). Read ${skipped.length === 1 ? "it" : "them"} again and ask again.` };
  return {
    ok: skipped.length === 0,
    message: `${done.length} ${done.length === 1 ? "entry" : "entries"} ${verb} in "${wanted.instance}" (${done.join(", ")}). Their content was not changed.${skipped.length ? ` Not done (changed since the request): ${skipped.join(", ")}. Ask again for these.` : ""}`,
    details: { done, skipped },
  };
}
