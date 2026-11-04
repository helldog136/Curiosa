import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/core/db";
import { isSectionSize } from "@/core/home";
import { BG_POSITIONS, BLOCK_KINDS, CORE_INSTANCE, CORE_SECTION, blockToBlocks, isBlockImage, isBlockKind, isBlockLink, isBlockVideo, normalizeBlockDef, type BlockDef } from "@/core/homeBlocks";
import { pickName } from "@/core/instances";
import { publishedEntryChoices } from "@/core/content/entries";
import { ENTRY_SECTION_ID, getActiveInstances, sectionsOf, type ActiveInstance } from "@/core/modules/registry";
import { SECTION_SIZES, localized, type JsonSchemaLite, type SettingField } from "@/core/modules/types";
import { deleteSetting, getSetting, getSiteConfig, setSetting, type HomeSection } from "@/core/settings";
import { McpToolError } from "@/core/services/mcp/validate";
import type { Outcome } from "./actions";
import { redactSecrets } from "./redact";
import type { Plan } from "./requests";
import { clearUndoPoint, fingerprintOf, loadUndoPoint, saveUndoPoint } from "./undoPoint";

/**
 * THE HOME PAGE FOR AN AI: `home_sections_list` (level 1, read) and `home_sections_set` (level 3, follows the approval setting of the access).
 *
 * The home page is an ordered list of sections (Admin > Home): a section offered by a module instance (a banner, the latest entries of a blog...) with its few
 * options, or a text block made by the core (media, tabs, stats, call to action, video). `home_sections_set` takes the WHOLE list in the shape `home_sections_list`
 * returns. A section that stays is sent as its `id` alone (nothing else to resend); a section with an `id` AND fields is replaced; no `id` = a new section.
 * Reordering and removing are therefore "send the ids in the new order". One writer = one right, one summary for the owner.
 * Safe by construction: a module section must be offered by an ACTIVE instance and its options are checked against what the module declares; a text block is
 * data validated field by field (`homeBlocks.ts`): plain texts in every language of the site, images of the site or https, links to the site or https, never HTML,
 * scripts or styles. 30 sections at most, 60 KB in all. When applied, the previous list is kept as a restore point for Admin > Home.
 */
export const MAX_HOME_SECTIONS = 30;
const MAX_BYTES = 60_000;
const SETTING = "home.sections";
const BLOCK_FIELDS = ["kind", "eyebrow", "title", "text", "buttonLabel", "buttonUrl", "images", "imageSide", "tone", "bg", "video", "poster", "videoSound", "items"] as const;
const TEXT_FIELDS: Record<string, number> = { eyebrow: 120, title: 160, text: 6000, buttonLabel: 60 };
const ITEM_TEXTS: Record<string, number> = { title: 80, heading: 160, text: 4000 };
const ENTRY_KEYS = ["id", "instance", "section", "options", "size", "isolated", "block", "kind", "title", "module", "shown", "problem", "label"] as readonly string[];
const READ_ONLY = ["kind", "title", "module", "shown", "problem", "label"] as readonly string[];

export const HOME_LIST_INPUT = { type: "object" } as const;
export const HOME_SET_INPUT = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      description: `The WHOLE home page, top to bottom (${MAX_HOME_SECTIONS} sections at most). Start from what home_sections_list returns. A section that stays: {"id": "<its id>"} alone. A new section of a module: {"instance": "hero", "section": "hero", "options": {...}, "size": "full"} (instance key and section id come from home_sections_list > canAdd). A new text block: {"block": {"kind": "cta", "title": {"en": "...", "fr": "..."}, "text": {...}, "buttonLabel": {...}, "buttonUrl": "/contact"}} with EVERY language of the site (kinds: ${BLOCK_KINDS.join(", ")}). "size" is small, medium, large or full; "isolated": true puts it alone on its line. Plain text only, no HTML. Nothing is saved if one section is wrong; every problem is listed.`,
      items: { type: "object" },
    },
  },
  required: ["sections"],
} as unknown as JsonSchemaLite;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isBlockRow = (s: Pick<HomeSection, "instance" | "section">) => s.instance === CORE_INSTANCE && s.section === CORE_SECTION;

async function current(): Promise<HomeSection[]> {
  const v = await getSetting<HomeSection[]>(SETTING);
  return Array.isArray(v) ? v.filter((s) => isRow(s) && typeof s.id === "string") : [];
}

/** Is this a published entry of THIS instance (the only thing an `entry` section can show)? */
const entryShown = async (instanceId: string, id: unknown): Promise<boolean> => typeof id === "string" && !!id && !!(await prisma.entry.findFirst({ where: { id, instanceId, status: "published", publishedAt: { lte: new Date() } }, select: { id: true } }));

/* ───────────── Reading ───────────── */

const optionView = (o: SettingField, locale: string, def: string) => ({
  key: o.key, type: o.type, label: localized(o.label, locale, def), ...(o.default !== undefined ? { default: o.default } : {}),
  ...(o.options ? { choices: o.options.map((c) => c.value) } : {}),
});

/** Level 1: the home page, in the shape `home_sections_set` accepts, and what can be added. */
export async function homeSectionsList(): Promise<unknown> {
  const config = await getSiteConfig();
  const active = await getActiveInstances();
  const loc = config.defaultLocale;
  const list = await current();
  const rows = await Promise.all(list.map(async (s): Promise<Row> => {
    const base = { id: s.id, ...(s.size ? { size: s.size } : {}), ...(s.isolated ? { isolated: true } : {}) };
    if (isBlockRow(s)) {
      const block = normalizeBlockDef((s.options as { block?: unknown })?.block, config.locales);
      return { ...base, kind: "text_block", block, title: block.title[loc] ?? Object.values(block.title)[0] ?? "", shown: blockToBlocks(block, loc, loc).length > 0 };
    }
    const a = active.find((x) => x.instance.key === s.instance);
    const decl = a ? sectionsOf(a.mod.manifest).find((d) => d.id === s.section) : undefined;
    const brokenEntry = !!a && !!decl && s.section === ENTRY_SECTION_ID && !(await entryShown(a.instance.id, (s.options as { entry?: unknown })?.entry));
    return {
      ...base, kind: "module_section", instance: s.instance, section: s.section, options: s.options ?? {},
      title: decl ? localized(decl.label, loc, "en") : s.section, module: a ? pickName(a.instance, loc, loc) : s.instance, shown: !!decl && !brokenEntry,
      ...(decl ? {} : { problem: "The module that offered this section is not active any more: nothing is shown. Remove it from the list." }),
      ...(brokenEntry ? { problem: "The page this section shows does not exist or is not published any more: nothing is shown. Choose another page (see canAdd) or remove the section." } : {}),
    };
  }));
  const modules = await Promise.all(active.flatMap((a) => sectionsOf(a.mod.manifest).map(async (d) => ({
    kind: "module_section", instance: a.instance.key, section: d.id, title: localized(d.label, loc, "en"), module: pickName(a.instance, loc, loc),
    recommendedSize: d.size ?? "full",
    options: d.id === ENTRY_SECTION_ID
      ? [{ key: "entry", type: "choice", label: "Page to show", required: true, example: '{"instance": "pages", "section": "entry", "options": {"entry": "<id below>"}}', choices: await publishedEntryChoices(a.instance.id, loc, loc, 50) }]
      : (d.options ?? []).map((o) => optionView(o, loc, "en")),
  }))));
  return {
    languages: config.locales, defaultLanguage: loc, limits: { sections: MAX_HOME_SECTIONS, bytes: MAX_BYTES },
    sections: rows,
    canAdd: {
      moduleSections: modules,
      textBlocks: BLOCK_KINDS.map((kind) => ({ kind, fields: kind === "stats" || kind === "tabs" ? "title/text per language, items: [{title, heading, text, image}] (a number and its caption for stats)" : kind === "video" ? "title, text, buttonLabel, buttonUrl, video (an uploaded file), poster" : "eyebrow, title, text, buttonLabel, buttonUrl, images (up to 3), imageSide, tone" })),
      sizes: SECTION_SIZES,
      note: "A module section shows what its module offers (for example a banner, or the latest entries of a list: the \"latest\" section of a content instance, option count). To show the FULL content of one published page, use the section \"entry\" of its instance with options {entry: <id>} (the id is in that section's choices).",
    },
    howToChange: "Change the list and send ALL of it back with home_sections_set: keep = {id}, new = a description, remove = leave it out, reorder = change the order.",
  };
}

/* ───────────── Validation ───────────── */

type Ctx = { locales: string[]; active: ActiveInstance[]; before: Map<string, HomeSection> };

/** Texts per language: an object with EVERY language of the site, plain text, within the length. Returns the object or null (problems added). */
function texts(raw: unknown, max: number, where: string, ctx: Ctx, problems: string[]): Record<string, string> | null {
  if (!isRow(raw)) { problems.push(`${where}: write it as one text per language, for example {${ctx.locales.map((l) => `"${l}": "…"`).join(", ")}}`); return null; }
  const out: Record<string, string> = {};
  let ok = true;
  for (const k of Object.keys(raw)) if (!ctx.locales.includes(k)) { problems.push(`${where}: "${redactSecrets(k, 12)}" is not a language of this site (${ctx.locales.join(", ")})`); ok = false; }
  for (const l of ctx.locales) {
    const v = raw[l];
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) { problems.push(`${where}: the ${l} text is missing (every language of the site is written)`); ok = false; continue; }
    if (text.length > max) { problems.push(`${where}: the ${l} text is longer than ${max} characters`); ok = false; }
    if (/<\/?[a-z!][^>]*>/i.test(text)) { problems.push(`${where}: the ${l} text contains HTML; write plain text (no tags, no scripts)`); ok = false; }
    out[l] = text;
  }
  return ok ? out : null;
}

function parseBlock(raw: unknown, where: string, ctx: Ctx, problems: string[]): BlockDef | null {
  if (!isRow(raw)) { problems.push(`${where}.block: must be an object such as {"kind": "cta", "title": {...}}`); return null; }
  const start = problems.length;
  for (const k of Object.keys(raw)) if (!(BLOCK_FIELDS as readonly string[]).includes(k)) problems.push(`${where}.block: unexpected field "${redactSecrets(k, 30)}"`);
  if (!isBlockKind(raw.kind)) { problems.push(`${where}.block.kind: must be one of ${BLOCK_KINDS.join(", ")}`); return null; }
  const out: Row = { kind: raw.kind };
  for (const [f, max] of Object.entries(TEXT_FIELDS)) if (raw[f] !== undefined) { const t = texts(raw[f], max, `${where}.block.${f}`, ctx, problems); if (t) out[f] = t; }
  if (raw.buttonUrl !== undefined) {
    if (typeof raw.buttonUrl !== "string" || (raw.buttonUrl && !isBlockLink(raw.buttonUrl)) || String(raw.buttonUrl).length > 500) problems.push(`${where}.block.buttonUrl: must be an address of this site starting with "/" (for example "/contact") or a full https address`);
    else out.buttonUrl = raw.buttonUrl.trim();
  }
  if (!!raw.buttonUrl !== !!raw.buttonLabel) problems.push(`${where}.block: a button needs both buttonLabel and buttonUrl`);
  if (raw.images !== undefined) {
    if (!Array.isArray(raw.images) || raw.images.length > 3 || !raw.images.every(isBlockImage)) problems.push(`${where}.block.images: up to 3 images, each a picture of the site ("/uploads/…") or a full https address`);
    else out.images = raw.images;
  }
  for (const [f, allowed] of [["imageSide", ["left", "right"]], ["tone", ["plain", "surface", "accent"]]] as const) {
    if (raw[f] !== undefined) { if (!(allowed as readonly unknown[]).includes(raw[f])) problems.push(`${where}.block.${f}: one of ${allowed.join(", ")}`); else out[f] = raw[f]; }
  }
  if (raw.bg !== undefined) {
    const bg = raw.bg;
    if (!isRow(bg) || !isBlockImage(bg.src) || (bg.size !== undefined && !["cover", "contain", "auto"].includes(String(bg.size))) || (bg.position !== undefined && !(BG_POSITIONS as readonly string[]).includes(String(bg.position))) || (bg.veil !== undefined && !["none", "light", "dark"].includes(String(bg.veil)))) problems.push(`${where}.block.bg: {"src": "/uploads/…" or https, "size": cover|contain|auto, "position": center…, "veil": none|light|dark}`);
    else out.bg = bg;
  }
  if (raw.video !== undefined) { if (!isBlockVideo(raw.video)) problems.push(`${where}.block.video: must be a video already uploaded to the site ("/uploads/….mp4")`); else out.video = raw.video; }
  if (raw.poster !== undefined) { if (!isBlockImage(raw.poster)) problems.push(`${where}.block.poster: a picture of the site or a full https address`); else out.poster = raw.poster; }
  if (raw.videoSound !== undefined) out.videoSound = raw.videoSound === true;
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items) || raw.items.length > 24) problems.push(`${where}.block.items: a list of 24 items at most`);
    else out.items = raw.items.map((it, i) => {
      const w = `${where}.block.items[${i}]`;
      if (!isRow(it)) { problems.push(`${w}: must be an object with title, heading, text, image`); return {}; }
      const o: Row = {};
      for (const k of Object.keys(it)) if (![...Object.keys(ITEM_TEXTS), "image"].includes(k)) problems.push(`${w}: unexpected field "${redactSecrets(k, 30)}"`);
      for (const [f, max] of Object.entries(ITEM_TEXTS)) if (it[f] !== undefined) { const t = texts(it[f], max, `${w}.${f}`, ctx, problems); if (t) o[f] = t; }
      if (it.image !== undefined) { if (!isBlockImage(it.image)) problems.push(`${w}.image: a picture of the site or a full https address`); else o.image = it.image; }
      if (!o.title) problems.push(`${w}: a title is needed`);
      return o;
    });
  }
  if (problems.length > start) return null;
  const block = normalizeBlockDef(out, ctx.locales);
  if (!blockToBlocks(block, ctx.locales[0]!, ctx.locales[0]!).length) { problems.push(`${where}.block: there is nothing to show (give a title, a text, an image or items)`); return null; }
  return block;
}

function parseOptions(raw: unknown, fields: SettingField[], where: string, problems: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (raw !== undefined && !isRow(raw)) { problems.push(`${where}.options: must be an object such as {"count": 3}`); return out; }
  const given = (raw ?? {}) as Row;
  for (const k of Object.keys(given)) if (!fields.some((f) => f.key === k)) problems.push(`${where}.options: "${redactSecrets(k, 30)}" is not an option of this section${fields.length ? ` (options: ${fields.map((f) => f.key).join(", ")})` : " (it has no options)"}`);
  for (const f of fields) {
    const v = given[f.key];
    if (v === undefined || v === null || v === "") { if (f.default !== undefined) out[f.key] = f.default; continue; }
    if (f.type === "boolean") { if (typeof v !== "boolean") problems.push(`${where}.options.${f.key}: true or false`); else out[f.key] = v; }
    else if (f.type === "number") { if (typeof v !== "number" || !Number.isFinite(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) problems.push(`${where}.options.${f.key}: a number${f.min !== undefined || f.max !== undefined ? ` between ${f.min ?? "…"} and ${f.max ?? "…"}` : ""}, for example ${f.default ?? 3}`); else out[f.key] = v; }
    else if (typeof v !== "string" || v.length > 500 || /<\/?[a-z!][^>]*>/i.test(v)) problems.push(`${where}.options.${f.key}: plain text of 500 characters at most`);
    else if (f.options?.length && !f.options.some((o) => o.value === v)) problems.push(`${where}.options.${f.key}: one of ${f.options.map((o) => o.value).join(", ")}`);
    else out[f.key] = v.trim();
  }
  return out;
}

const newId = () => `ai-${crypto.randomBytes(5).toString("hex")}`;

async function parseSection(raw: unknown, i: number, ctx: Ctx, problems: string[]): Promise<HomeSection | null> {
  const where = `sections[${i}]`;
  if (!isRow(raw)) { problems.push(`${where}: each section must be an object such as {"id": "<id>"}`); return null; }
  for (const k of Object.keys(raw)) if (!ENTRY_KEYS.includes(k)) problems.push(`${where}: unexpected field "${redactSecrets(k, 30)}"`);
  const fields = Object.keys(raw).filter((k) => !READ_ONLY.includes(k) && k !== "id");
  let id: string | undefined;
  if (raw.id !== undefined) {
    id = typeof raw.id === "string" ? raw.id : "";
    if (!ctx.before.has(id)) { problems.push(`${where}: no section with the id "${redactSecrets(String(raw.id), 40)}" on the home page now (read it with home_sections_list; a new section has no id)`); return null; }
    if (!fields.length) return ctx.before.get(id)!;
  }
  const start = problems.length;
  let section: HomeSection | null = null;
  if (raw.block !== undefined) {
    if (raw.instance !== undefined || raw.section !== undefined) { problems.push(`${where}: give a "block" OR an "instance" with a "section", not both`); return null; }
    const block = parseBlock(raw.block, where, ctx, problems);
    if (block) section = { id: id ?? newId(), instance: CORE_INSTANCE, section: CORE_SECTION, options: { block } };
  } else {
    const a = ctx.active.find((x) => x.instance.key === raw.instance);
    if (typeof raw.instance !== "string" || !a) { problems.push(`${where}: give a "block" (a text block) or the key of an active module "instance" with its "section" (see home_sections_list > canAdd). Unknown instance: "${redactSecrets(String(raw.instance ?? ""), 40)}"`); return null; }
    const decl = sectionsOf(a.mod.manifest).find((d) => d.id === raw.section);
    if (!decl) { problems.push(`${where}: "${a.instance.key}" does not offer a section "${redactSecrets(String(raw.section ?? ""), 30)}". It offers: ${sectionsOf(a.mod.manifest).map((d) => d.id).join(", ") || "none"}`); return null; }
    const options = parseOptions(raw.options, (decl.options ?? []) as SettingField[], where, problems);
    if (decl.id === ENTRY_SECTION_ID && !(await entryShown(a.instance.id, options.entry))) problems.push(`${where}.options.entry: give the id of a PUBLISHED entry of "${a.instance.key}" (ids come from ${a.instance.key}__list_entries or home_sections_list > canAdd). Example: {"instance": "${a.instance.key}", "section": "entry", "options": {"entry": "<id>"}}`);
    section = { id: id ?? newId(), instance: a.instance.key, section: decl.id, options };
    if (raw.size !== undefined && isSectionSize(raw.size) && raw.size !== (decl.size ?? "full")) section.size = raw.size;
  }
  if (raw.size !== undefined && !isSectionSize(raw.size)) problems.push(`${where}.size: one of ${SECTION_SIZES.join(", ")}`);
  else if (section && raw.size !== undefined && !section.size && section.instance === CORE_INSTANCE && raw.size !== "full") section.size = raw.size as HomeSection["size"];
  if (raw.isolated !== undefined && typeof raw.isolated !== "boolean") problems.push(`${where}.isolated: true or false`);
  else if (section && raw.isolated === true) section.isolated = true;
  return problems.length > start ? null : section;
}

const nameOf = (s: HomeSection, ctx: Ctx, loc: string): string => {
  if (isBlockRow(s)) { const b = normalizeBlockDef((s.options as { block?: unknown })?.block, ctx.locales); return clip(`${b.kind} block${b.title[loc] ? ` “${b.title[loc]}”` : ""}`, 60); }
  const a = ctx.active.find((x) => x.instance.key === s.instance);
  const d = a ? sectionsOf(a.mod.manifest).find((x) => x.id === s.section) : undefined;
  return clip(`${d ? localized(d.label, loc, "en") : s.section} (${a ? pickName(a.instance, loc, loc) : s.instance})`, 60);
};

/** Level 3, preparation (read only): checks every section, then freezes the new list with a before / after summary for the owner. */
export async function prepareHomeSectionsSet(args: { sections?: unknown }): Promise<Plan> {
  if (!Array.isArray(args.sections)) throw new McpToolError('Give "sections": the whole home page as a list, for example [{"id": "<kept section>"}, {"instance": "hero", "section": "hero"}]. Read it first with home_sections_list.');
  if (args.sections.length > MAX_HOME_SECTIONS) throw new McpToolError(`The home page holds ${MAX_HOME_SECTIONS} sections at most.`);
  const config = await getSiteConfig();
  const before = await current();
  const ctx: Ctx = { locales: config.locales, active: await getActiveInstances(), before: new Map(before.map((s) => [s.id, s])) };
  const problems: string[] = [];
  const next: HomeSection[] = [];
  for (let i = 0; i < args.sections.length; i++) { const s = await parseSection(args.sections[i], i, ctx, problems); if (s) next.push(s); }
  const ids = next.map((s) => s.id);
  if (new Set(ids).size !== ids.length) problems.push("The same section is listed twice (same id)");
  if (problems.length) throw new McpToolError(`Home page not changed: ${problems.slice(0, 12).join("; ")}${problems.length > 12 ? `; and ${problems.length - 12} more` : ""}.`);
  if (JSON.stringify(next).length > MAX_BYTES) throw new McpToolError(`The home page is too large (${Math.round(MAX_BYTES / 1000)} KB at most): shorten the texts or use fewer blocks.`);

  const loc = config.defaultLocale;
  const kept = next.filter((s) => ctx.before.has(s.id));
  const replaced = kept.filter((s) => fingerprintOf(s) !== fingerprintOf(ctx.before.get(s.id)));
  const added = next.filter((s) => !ctx.before.has(s.id));
  const removed = before.filter((s) => !next.some((n) => n.id === s.id));
  const sameSet = !added.length && !removed.length;
  const reordered = sameSet && JSON.stringify(before.map((s) => s.id)) !== JSON.stringify(ids);
  return {
    change: {
      target: "home", before: fingerprintOf(before), entries: next,
      summary: { beforeCount: before.length, afterCount: next.length, added: added.map((s) => nameOf(s, ctx, loc)).slice(0, 12), removed: removed.map((s) => nameOf(s, ctx, loc)).slice(0, 12), changed: replaced.map((s) => nameOf(s, ctx, loc)).slice(0, 12), reordered, same: fingerprintOf(before) === fingerprintOf(next) },
    },
  };
}

/* ───────────── Execution ───────────── */

export async function executeHomeSectionsSet(plan: Plan, actorLabel: string): Promise<Outcome> {
  const change = plan.change;
  if (!change || change.target !== "home") return { ok: false, message: "Not done: the request is damaged. Ask again." };
  const list = change.entries as HomeSection[];
  const before = await current();
  if (fingerprintOf(before) !== change.before) return { ok: false, message: "Not done: the home page was changed by someone else since the request. Read it again with home_sections_list and ask again." };
  if (change.summary.same) return { ok: true, message: "Nothing needed to change: the home page was already like this." };
  const active = await getActiveInstances();
  const gone = list.filter((s) => !isBlockRow(s) && !active.some((a) => a.instance.key === s.instance && sectionsOf(a.mod.manifest).some((d) => d.id === s.section)));
  if (gone.length) return { ok: false, message: "Not done: a module section of the request is not offered any more (its module was changed or removed). Read the home page again with home_sections_list and ask again." };
  await setSetting(SETTING, list);
  await saveUndoPoint("home", { at: Date.now(), by: actorLabel.replace(/^mcp:/, ""), previous: before, applied: fingerprintOf(await current()) });
  const s = change.summary;
  const target = redactSecrets(`${s.beforeCount} -> ${s.afterCount} sections${s.added.length ? `; added: ${s.added.join(", ")}` : ""}${s.removed.length ? `; removed: ${s.removed.join(", ")}` : ""}${s.changed?.length ? `; changed: ${s.changed.join(", ")}` : ""}${s.reordered ? "; reordered" : ""}`, 300);
  await prisma.auditLog.create({ data: { actor: actorLabel, actorKind: "assistant", action: "home.update", target } }).catch(() => {});
  try { revalidatePath("/", "layout"); } catch { /* outside a request */ }
  return { ok: true, message: `The home page was updated (${s.beforeCount} -> ${s.afterCount} sections). The owner can restore the previous home page in Admin > Home until someone edits it again.`, details: { sections: s.afterCount } };
}

/* ───────────── Restore (admin) ───────────── */

export async function homeRestorePoint(): Promise<{ by: string; at: number } | null> {
  const p = await loadUndoPoint("home");
  if (!p || fingerprintOf(await current()) !== p.applied) return null;
  return { by: p.by, at: p.at };
}

export async function restoreHome(actorEmail: string): Promise<{ ok: true } | { ok: false; reason: "none" | "changed" }> {
  const p = await loadUndoPoint("home");
  if (!p) return { ok: false, reason: "none" };
  if (fingerprintOf(await current()) !== p.applied) return { ok: false, reason: "changed" };
  const previous = Array.isArray(p.previous) ? (p.previous as HomeSection[]) : [];
  if (previous.length) await setSetting(SETTING, previous); else await deleteSetting(SETTING);
  await clearUndoPoint("home");
  await prisma.auditLog.create({ data: { actor: actorEmail, actorKind: "person", action: "home.update", target: "restored the home page from before the AI change" } }).catch(() => {});
  try { revalidatePath("/", "layout"); } catch { /* outside a request */ }
  return { ok: true };
}
